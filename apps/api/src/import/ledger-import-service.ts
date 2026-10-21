import { createHash } from "node:crypto";
import {
  columnMappingSchema,
  type ColumnMapping,
  type ImportBatchSummary,
  type ImportBatchView,
  type ImportCandidate,
  type ImportRowConfirm,
  type ImportRowStatus,
  type ImportRowView,
  type MatchReason,
  type ParsedTransaction,
  type PdfBatchInfo,
  type RuleMode,
  type StatementKind
} from "@projeto41/contracts";
import { normalizeName, statementMonthFor } from "@projeto41/finance";
import { importRowConfirmSchema } from "@projeto41/contracts";
import { LedgerError, notFound, nowIso, type AppDatabase } from "@projeto41/db";
import { headerMatches, inspectCsv, readCsv } from "./csv/csv-reader.js";
import {
  contentHash,
  findDuplicates,
  INSTALLMENT_WINDOW_DAYS,
  rankCandidates,
  type DedupeCandidate,
  type DedupeMatch,
  type DedupeRow
} from "./dedupe.js";
import { timeFromNubankId } from "./nubank-id.js";
import { readOfx } from "./ofx/ofx-reader.js";
import type { PdfStatement } from "./pdf/pdf-import-service.js";
import { looksLikeSpreadsheet, spreadsheetToCsv } from "./spreadsheet/spreadsheet-reader.js";
import {
  conditionsFor,
  directionOf,
  findPayeeRule,
  installmentOf,
  payeeOf,
  paymentMethodOf,
  toPayeeRule,
  type PayeeIdentity,
  type PayeeRule
} from "./payee-rules.js";

/**
 * Importacao de extrato em estagios, revisada lancamento a lancamento.
 *
 * O arquivo vira `import_batches` + `import_rows` e **nada** entra no livro sem
 * passar por aqui:
 *
 * - linha de destinatario marcado como "sempre automatico" nasce `new`, pronta
 *   para gravar em lote;
 * - destinatario desconhecido, marcado como "perguntar sempre" ou linha que
 *   parece repetir um lancamento do livro nasce `needs_review` e vai para o
 *   popup, uma de cada vez;
 * - linha com o mesmo id do banco (ou o mesmo conteudo) de um lancamento ja
 *   gravado nasce `duplicate`: nao aparece no popup, mas pode ser forcada.
 *
 * Confirmar uma linha grava o lancamento na hora. Isso deixa o lote retomavel:
 * fechar o popup no meio nao perde o que ja foi decidido.
 */

type RowRecord = {
  id: number;
  batchId: number;
  lineNo: number;
  parsed: ParsedTransaction;
  externalId: string | null;
  contentHash: string;
  status: ImportRowStatus;
  entryId: number | null;
  duplicateOfEntryId: number | null;
  matchReason: MatchReason | null;
  /** So linha de PDF. */
  confidence: number | null;
  signKnown: number;
  sourcePage: number | null;
  warningsJson: string | null;
};

type BatchRecord = {
  id: number;
  source: "ofx" | "csv" | "pdf";
  accountId: number;
  fileName: string;
  fileHash: string;
  importedAt: string;
  status: "awaiting_mapping" | "review" | "committed" | "discarded";
  rowCount: number;
  committedCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  closingBalanceCents: number | null;
  accountName: string;
  adapterId: string | null;
  layoutVersion: string | null;
  reconciliationJson: string | null;
};

const PENDING: ImportRowStatus[] = ["new", "needs_review"];
const IMPORTABLE_KINDS = new Set(["checking", "savings", "cash", "meal_voucher", "credit_card"]);

/** Limite de extrato: nenhum arquivo honesto chega perto disso. */
export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024;

function shiftDate(iso: string, days: number): string {
  const time = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

function looksLikeOfx(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString("latin1");
  return /OFXHEADER|<OFX>/i.test(head);
}

export function createLedgerImportService(db: AppDatabase) {
  const sql = db.raw;
  const ledger = db.ledger;

  // Leitura -----------------------------------------------------------------

  function batchRecord(batchId: number): BatchRecord {
    const batch = sql
      .prepare(
        `SELECT b.id, b.source, b.account_id AS accountId, b.file_name AS fileName,
                b.file_hash AS fileHash, b.imported_at AS importedAt, b.status,
                b.row_count AS rowCount, b.committed_count AS committedCount,
                b.period_start AS periodStart, b.period_end AS periodEnd,
                b.closing_balance_cents AS closingBalanceCents, a.name AS accountName,
                b.adapter_id AS adapterId, b.layout_version AS layoutVersion,
                b.reconciliation_json AS reconciliationJson
         FROM import_batches b JOIN accounts a ON a.id = b.account_id
         WHERE b.id = ?`
      )
      .get(batchId) as BatchRecord | undefined;
    if (!batch) throw notFound("Lote de importacao");
    return batch;
  }

  function rowRecords(batchId: number): RowRecord[] {
    const rows = sql
      .prepare(
        `SELECT id, batch_id AS batchId, line_no AS lineNo, parsed_json AS parsedJson,
                external_id AS externalId, content_hash AS contentHash, status,
                entry_id AS entryId, duplicate_of_entry_id AS duplicateOfEntryId,
                match_reason AS matchReason, confidence, sign_known AS signKnown,
                source_page AS sourcePage, warnings_json AS warningsJson
         FROM import_rows WHERE batch_id = ? ORDER BY line_no`
      )
      .all(batchId) as (Omit<RowRecord, "parsed"> & { parsedJson: string })[];
    return rows.map(({ parsedJson, ...row }) => ({
      ...row,
      parsed: JSON.parse(parsedJson) as ParsedTransaction
    }));
  }

  function rowRecord(batchId: number, rowId: number): RowRecord {
    const row = rowRecords(batchId).find((item) => item.id === rowId);
    if (!row) throw notFound("Linha da importacao");
    return row;
  }

  function loadRules(): PayeeRule[] {
    const rules = sql
      .prepare(`SELECT id, mode, active FROM rules WHERE stage = 'default'`)
      .all() as { id: number; mode: RuleMode; active: number }[];
    const conditions = sql
      .prepare(`SELECT rule_id AS ruleId, field, op, value FROM rule_conditions`)
      .all() as { ruleId: number; field: string; op: string; value: string }[];
    const actions = sql
      .prepare(`SELECT rule_id AS ruleId, action, value FROM rule_actions`)
      .all() as { ruleId: number; action: string; value: string | null }[];
    return rules
      .map((rule) =>
        toPayeeRule({
          id: rule.id,
          mode: rule.mode,
          active: rule.active === 1,
          conditions: conditions.filter((c) => c.ruleId === rule.id),
          actions: actions.filter((a) => a.ruleId === rule.id)
        })
      )
      .filter((rule): rule is PayeeRule => rule !== null);
  }

  // O que o livro ja tem --------------------------------------------------

  type BookEntry = {
    id: number;
    date: string;
    amountCents: number;
    externalId: string | null;
    contentHash: string | null;
    kind: ImportCandidate["kind"];
    status: ImportCandidate["status"];
    description: string | null;
    rawDescription: string | null;
    importRowId: number | null;
    planId: number | null;
    installmentNumber: number | null;
    installmentTotal: number | null;
    placeName: string | null;
    categoryName: string | null;
    personName: string | null;
    transferWith: string | null;
  };

  const BOOK_SELECT = `
    SELECT e.id, e.date, e.amount_cents AS amountCents, e.external_id AS externalId,
           e.content_hash AS contentHash, e.kind, e.status, e.description,
           e.raw_description AS rawDescription, e.import_row_id AS importRowId,
           e.installment_plan_id AS planId, e.installment_number AS installmentNumber,
           ip.installment_count AS installmentTotal,
           p.name AS placeName, c.name AS categoryName, pe.name AS personName,
           (SELECT a2.name FROM transfers t
              JOIN entries e2 ON e2.id = CASE WHEN t.from_entry_id = e.id THEN t.to_entry_id
                                              ELSE t.from_entry_id END
              JOIN accounts a2 ON a2.id = e2.account_id
            WHERE t.from_entry_id = e.id OR t.to_entry_id = e.id) AS transferWith
    FROM entries e
    LEFT JOIN places p ON p.id = e.place_id
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN people pe ON pe.id = e.person_id
    LEFT JOIN installment_plans ip ON ip.id = e.installment_plan_id`;

  /** Lancamentos da conta na janela de datas; ajuste nunca e do banco, fica de fora. */
  function bookEntries(accountId: number, from: string, to: string): BookEntry[] {
    return sql
      .prepare(
        `${BOOK_SELECT}
         WHERE e.account_id = ? AND e.date BETWEEN ? AND ? AND e.kind <> 'adjustment'
         ORDER BY e.date, e.id`
      )
      .all(accountId, shiftDate(from, -INSTALLMENT_WINDOW_DAYS), shiftDate(to, INSTALLMENT_WINDOW_DAYS)) as BookEntry[];
  }

  function bookEntry(entryId: number): BookEntry | undefined {
    return sql.prepare(`${BOOK_SELECT} WHERE e.id = ?`).get(entryId) as BookEntry | undefined;
  }

  /**
   * Por que vincular este lancamento nao e possivel (ou `null`).
   *
   * O extrato e a verdade do banco: lancamento comum assume o valor do arquivo.
   * Transferencia tem outra ponta e parcela tem um plano; nelas o valor so muda
   * por arredondamento (ate R$ 1,00), e alem disso a diferenca e recusada.
   */
  function linkBlock(
    entry: Pick<BookEntry, "status" | "kind" | "planId" | "amountCents">,
    bankCents: number
  ): string | null {
    if (entry.status === "reconciled") {
      return "Lançamento conciliado não pode ser alterado pela importação";
    }
    if (bankCents === entry.amountCents) return null;
    const rounding = Math.abs(bankCents - entry.amountCents) <= 100;
    if (
      entry.kind === "transfer" ||
      Math.sign(bankCents) !== Math.sign(entry.amountCents) ||
      (entry.planId != null && !rounding)
    ) {
      return "O valor do arquivo é diferente do lançamento: corrija o lançamento antes de vincular";
    }
    return null;
  }

  function toCandidate(entry: BookEntry, match: DedupeMatch, bankCents: number): ImportCandidate {
    return {
      entryId: entry.id,
      reason: match.reason,
      confidence: match.confidence,
      dayDistance: match.dayDistance,
      date: entry.date,
      amountCents: entry.amountCents,
      kind: entry.kind,
      status: entry.status,
      description: entry.description,
      placeName: entry.placeName,
      categoryName: entry.categoryName,
      personName: entry.personName,
      transferWith: entry.transferWith,
      installment:
        entry.installmentNumber != null && entry.installmentTotal != null
          ? { number: entry.installmentNumber, total: entry.installmentTotal }
          : null,
      reconciled: entry.status === "reconciled",
      blocked: linkBlock(entry, bankCents)
    };
  }

  const dedupeCandidateOf = (entry: BookEntry): DedupeCandidate => ({
    id: entry.id,
    date: entry.date,
    amountCents: entry.amountCents,
    externalId: entry.externalId,
    contentHash: entry.contentHash,
    text: [entry.description, entry.placeName, entry.rawDescription].filter(Boolean).join(" "),
    // Ligado a uma linha importada: e o par dela, nao serve de par para outra.
    linked: entry.importRowId != null,
    installmentNumber: entry.planId != null ? entry.installmentNumber : null
  });

  const MAX_CANDIDATES = 5;

  /**
   * Para cada linha ainda pendente, os lancamentos do livro que ela parece
   * repetir: o melhor primeiro (pareado sem repetir lancamento entre linhas) e
   * depois os outros parecidos. Calculado na hora, e nao gravado: o livro muda
   * a cada resposta no popup, e o par de uma linha muda junto.
   */
  function pendingMatches(batchId: number, rows = rowRecords(batchId)): Map<number, ImportCandidate[]> {
    const pending = rows.filter((row) => PENDING.includes(row.status));
    const result = new Map<number, ImportCandidate[]>();
    if (pending.length === 0) return result;

    const batch = batchRecord(batchId);
    const dates = pending.map((row) => row.parsed.date).sort();
    const entries = bookEntries(batch.accountId, dates[0]!, dates[dates.length - 1]!);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const candidates = entries.map(dedupeCandidateOf);

    const dedupeRows: DedupeRow[] = pending.map((row) => ({
      key: row.id,
      date: row.parsed.date,
      amountCents: row.parsed.amountCents,
      externalId: row.externalId,
      contentHash: row.contentHash,
      text: payeeOf(row.parsed).display,
      installment: installmentOf(row.parsed.rawDescription)
    }));

    const best = findDuplicates(dedupeRows, candidates, { fuzzyOnly: true });
    for (const row of dedupeRows) {
      const own = best.get(row.key);
      // O melhor das outras linhas ja tem dono; o que sobra e alternativa.
      const takenByOthers = new Set(
        [...best].filter(([key]) => key !== row.key).map(([, match]) => match.entryId)
      );
      const others = rankCandidates(row, candidates, takenByOthers).filter(
        (match) => match.entryId !== own?.entryId
      );
      const ordered = (own ? [own, ...others] : others).slice(0, MAX_CANDIDATES);
      if (ordered.length > 0) {
        result.set(
          row.key,
          ordered.map((match) => toCandidate(byId.get(match.entryId)!, match, row.amountCents))
        );
      }
    }
    return result;
  }

  // Sugestao e situacao ----------------------------------------------------

  function suggestionFor(
    parsed: ParsedTransaction,
    payee: PayeeIdentity,
    rule: PayeeRule | null,
    accountPersonId: number | null,
    isCard = false
  ) {
    const kind = parsed.amountCents < 0 ? ("expense" as const) : ("income" as const);
    const categoryFits = (categoryId: number | null) => {
      if (categoryId == null) return null;
      const category = ledger.categories
        .list({ includeArchived: false })
        .find((c) => c.id === categoryId);
      return category && category.kind === kind ? category.id : null;
    };

    if (rule && !rule.ignore) {
      const place = rule.placeId != null ? ledger.places.get(rule.placeId) : undefined;
      return {
        kind,
        categoryId: categoryFits(rule.categoryId),
        placeName: place?.name ?? null,
        // A descricao e daquele lancamento, nunca do destinatario: o Pix para a
        // mesma pessoa e almoco hoje e aluguel amanha. Regra antiga que gravou
        // `set_description` e ignorada aqui de proposito.
        description: null,
        personId: rule.personId ?? accountPersonId
      };
    }

    // Sem regra: o nome do outro lado vira o local, e um local que ja existe
    // traz a categoria padrao dele.
    // Na fatura do cartao o texto e sempre o estabelecimento; no extrato, um
    // texto sem contraparte e canal ("Debito em conta") e nao vira local.
    const hasName = isCard || !payee.key.startsWith("raw:");
    const place = hasName ? ledger.places.getByName(payee.display) : undefined;
    return {
      kind,
      categoryId: categoryFits(place?.defaultCategoryId ?? null),
      placeName: place?.name ?? (hasName ? payee.display : null),
      description: null,
      personId: accountPersonId
    };
  }

  /**
   * Recalcula a situacao das linhas ainda pendentes. Roda depois do upload e de
   * cada resposta no popup: marcar um destinatario como automatico tira da fila
   * todas as outras linhas dele no mesmo lote.
   */
  function reclassify(batchId: number) {
    const batch = batchRecord(batchId);
    const account = ledger.accounts.raw(batch.accountId);
    const rules = loadRules();
    const rows = rowRecords(batchId);
    const matches = pendingMatches(batchId, rows);
    const update = sql.prepare(
      `UPDATE import_rows SET status = @status, suggested_place_id = @placeId,
         suggested_category_id = @categoryId, suggested_kind = @kind
       WHERE id = @id`
    );
    for (const row of rows) {
      if (!PENDING.includes(row.status)) continue;
      const payee = payeeOf(row.parsed);
      const rule = findPayeeRule(rules, payee, row.parsed.amountCents);
      const suggestion = suggestionFor(
        row.parsed,
        payee,
        rule,
        account?.personId ?? null,
        account?.kind === "credit_card"
      );
      let status: ImportRowStatus = "needs_review";
      // Parece repetir um lancamento do livro: sempre pergunta, mesmo com regra
      // automatica. Gravar sem olhar duplicaria o dinheiro.
      if (matches.has(row.id)) status = "needs_review";
      else if (rule?.ignore) status = "ignored";
      else if (
        rule?.mode === "auto" &&
        !(rule.categoryId != null && suggestion.categoryId == null)
      ) {
        // Regra automatica cuja categoria nao serve mais (arquivada, ou de
        // saida numa entrada) volta a perguntar em vez de gravar sem categoria.
        // Linha de PDF nunca fica pronta para gravar em lote: o PDF erra em
        // silencio, entao toda linha dele passa pelo popup, com regra ou sem.
        status = batch.source === "pdf" ? "needs_review" : "new";
      }
      update.run({
        id: row.id,
        status,
        placeId: suggestion.placeName
          ? (ledger.places.getByName(suggestion.placeName)?.id ?? null)
          : null,
        categoryId: suggestion.categoryId,
        kind: suggestion.kind
      });
    }
    refreshBatchStatus(batchId);
  }

  function refreshBatchStatus(batchId: number) {
    const counts = sql
      .prepare(
        `SELECT SUM(status IN ('new','needs_review')) AS pending,
                SUM(status = 'committed') AS committed
         FROM import_rows WHERE batch_id = ?`
      )
      .get(batchId) as { pending: number | null; committed: number | null };
    const current = batchRecord(batchId).status;
    const status =
      current === "discarded" ? "discarded" : (counts.pending ?? 0) > 0 ? "review" : "committed";
    sql
      .prepare(`UPDATE import_batches SET status = ?, committed_count = ? WHERE id = ?`)
      .run(status, counts.committed ?? 0, batchId);
  }

  function viewOf(batchId: number, previousImportAt: string | null = null): ImportBatchView {
    const batch = batchRecord(batchId);
    const account = ledger.accounts.raw(batch.accountId);
    const rules = loadRules();
    const isCard = account?.kind === "credit_card";
    const records = rowRecords(batchId);
    const live = pendingMatches(batchId, records);

    /** Linha ja pareada por id ou hash: o lancamento foi gravado por uma importacao anterior. */
    const exactCandidate = (row: RowRecord): ImportCandidate | null => {
      if (row.duplicateOfEntryId == null || !row.matchReason) return null;
      const entry = bookEntry(row.duplicateOfEntryId);
      if (!entry) return null;
      return toCandidate(
        entry,
        {
          entryId: entry.id,
          reason: row.matchReason,
          confidence: "certain",
          score: 100,
          dayDistance: Math.abs(
            Math.round((Date.parse(entry.date) - Date.parse(row.parsed.date)) / 86_400_000)
          ),
          textMatch: 1
        },
        row.parsed.amountCents
      );
    };

    const rows: ImportRowView[] = records.map((row) => {
      const payee = payeeOf(row.parsed);
      const rule = findPayeeRule(rules, payee, row.parsed.amountCents);
      const candidates = live.get(row.id) ?? [];
      const exact = row.status === "duplicate" ? exactCandidate(row) : null;
      return {
        id: row.id,
        lineNo: row.lineNo,
        status: row.status,
        date: row.parsed.date,
        // Calculada na leitura, e nao gravada: vale tambem para lote antigo.
        time: row.parsed.time ?? timeFromNubankId(row.externalId, row.parsed.date),
        amountCents: row.parsed.amountCents,
        rawDescription: row.parsed.rawDescription,
        paymentMethod: paymentMethodOf(row.parsed.rawDescription),
        installment: installmentOf(row.parsed.rawDescription),
        statementMonth:
          isCard && account?.closingDay != null && account.dueDay != null
            ? statementMonthFor(row.parsed.date, account.closingDay, account.dueDay)
            : null,
        payee,
        suggestion: suggestionFor(row.parsed, payee, rule, account?.personId ?? null, isCard),
        rule: rule ? { id: rule.id, mode: rule.mode, ignore: rule.ignore } : null,
        duplicate: exact ?? candidates[0] ?? null,
        alternatives: exact ? [] : candidates.slice(1),
        entryId: row.entryId,
        skippedBefore:
          row.status === "ignored" && row.matchReason != null && row.duplicateOfEntryId == null,
        pdf:
          batch.source === "pdf"
            ? {
                confidence: row.confidence ?? 0,
                signKnown: row.signKnown === 1,
                sourcePage: row.sourcePage,
                warnings: row.warningsJson ? (JSON.parse(row.warningsJson) as string[]) : []
              }
            : null
      };
    });

    const count = (...statuses: ImportRowStatus[]) =>
      rows.filter((row) => statuses.includes(row.status)).length;
    const { accountName, adapterId, layoutVersion, reconciliationJson, ...rest } = batch;
    const pdf: PdfBatchInfo | null =
      adapterId && layoutVersion && reconciliationJson
        ? { adapterId, layoutVersion, ...(JSON.parse(reconciliationJson) as Omit<PdfBatchInfo, "adapterId" | "layoutVersion">) }
        : null;
    return {
      batch: { ...rest, accountName, statementKind: isCard ? "card" : "bank", pdf },
      previousImportAt,
      rows,
      counts: {
        review: count("needs_review"),
        ready: count("new"),
        duplicate: count("duplicate"),
        ignored: count("ignored"),
        committed: count("committed")
      }
    };
  }

  // Arquivo -------------------------------------------------------------------

  function savedMapping(accountId: number): ColumnMapping | null {
    const row = sql
      .prepare(`SELECT mapping_json AS json FROM import_column_mappings WHERE account_id = ?`)
      .get(accountId) as { json: string } | undefined;
    if (!row) return null;
    const parsed = columnMappingSchema.safeParse(JSON.parse(row.json));
    return parsed.success ? parsed.data : null;
  }

  function saveMapping(accountId: number, mapping: ColumnMapping) {
    sql
      .prepare(
        `INSERT INTO import_column_mappings
           (account_id, delimiter, encoding, skip_lines, has_header, date_format,
            decimal_separator, sign_convention, mapping_json, updated_at)
         VALUES (@accountId, @delimiter, @encoding, @skipLines, @hasHeader, @dateFormat,
                 @decimalSeparator, @signConvention, @json, @now)
         ON CONFLICT(account_id) DO UPDATE SET
           delimiter = excluded.delimiter, encoding = excluded.encoding,
           skip_lines = excluded.skip_lines, has_header = excluded.has_header,
           date_format = excluded.date_format, decimal_separator = excluded.decimal_separator,
           sign_convention = excluded.sign_convention, mapping_json = excluded.mapping_json,
           updated_at = excluded.updated_at`
      )
      .run({
        accountId,
        delimiter: mapping.delimiter,
        encoding: mapping.encoding,
        skipLines: mapping.skipLines,
        hasHeader: mapping.hasHeader ? 1 : 0,
        dateFormat: mapping.dateFormat,
        decimalSeparator: mapping.decimalSeparator,
        signConvention: mapping.signConvention,
        json: JSON.stringify(mapping),
        now: nowIso()
      });
  }

  /** O PDF ja lido, na forma do resto: o tipo do documento tem de bater com a conta. */
  function pdfStatement(accountKind: string, kind: StatementKind, pdf: PdfStatement) {
    const isCardAccount = accountKind === "credit_card";
    if (pdf.kind === "statement" && (kind === "card" || isCardAccount)) {
      throw new LedgerError("Este PDF e extrato de conta: escolha Extrato da conta e uma conta do banco");
    }
    if (pdf.kind === "invoice" && (kind === "bank" || !isCardAccount)) {
      throw new LedgerError("Este PDF e fatura de cartao: escolha Fatura do cartao e a conta do cartao");
    }
    return {
      source: "pdf" as const,
      transactions: pdf.transactions,
      periodStart: pdf.periodStart,
      periodEnd: pdf.periodEnd,
      closingBalanceCents: pdf.closingBalanceCents
    };
  }

  function readStatement(
    accountId: number,
    accountKind: string,
    kind: StatementKind,
    buffer: Buffer
  ) {
    const isCardAccount = accountKind === "credit_card";
    if (kind === "card" && !isCardAccount) {
      throw new LedgerError("Fatura do cartao: escolha a conta do cartao");
    }
    if (kind === "bank" && isCardAccount) {
      throw new LedgerError("Extrato da conta: escolha uma conta, nao um cartao");
    }
    if (looksLikeOfx(buffer)) {
      const statement = readOfx(buffer);
      const isCard = accountKind === "credit_card";
      if (statement.envelope === "credit_card" && !isCard) {
        throw new LedgerError("Este OFX e de cartao: escolha a conta do cartao");
      }
      if (statement.envelope === "bank" && isCard) {
        throw new LedgerError("Este OFX e de conta corrente: escolha a conta do banco");
      }
      return {
        source: "ofx" as const,
        transactions: statement.transactions,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        closingBalanceCents: statement.closingBalanceCents
      };
    }

    // Planilha vira CSV e segue o mesmo caminho, com o mesmo mapeamento salvo.
    const isSpreadsheet = looksLikeSpreadsheet(buffer);
    let table = buffer;
    if (isSpreadsheet) {
      try {
        table = spreadsheetToCsv(buffer);
      } catch (error) {
        throw new LedgerError(error instanceof Error ? error.message : String(error));
      }
    }
    const fileLabel = isSpreadsheet ? "A planilha" : "O CSV";

    const shape = inspectCsv(table);
    // Os dois CSVs do Nubank tem cabecalhos que nao se confundem: o extrato
    // traz `Identificador` e `Descricao`; a fatura, `date,title,amount`.
    const headers = shape.header.map((label) => normalizeName(label));
    const looksLikeInvoice = headers.includes("title") && !headers.includes("identificador");
    const looksLikeBank = headers.includes("identificador") || headers.includes("descricao");
    if (kind === "bank" && looksLikeInvoice) {
      throw new LedgerError(
        `${fileLabel} parece a fatura do cartao (date, title, amount). Escolha Fatura do cartao.`
      );
    }
    if (kind === "card" && looksLikeBank && !looksLikeInvoice) {
      throw new LedgerError(
        `${fileLabel} parece o extrato da conta (Data, Valor, Descricao). Escolha Extrato da conta.`
      );
    }
    const saved = savedMapping(accountId);
    let mapping = saved && headerMatches(saved, shape.header) ? saved : null;
    if (!mapping) {
      const proposed = { ...shape.mapping };
      // A fatura do Nubank lista compra com valor positivo; no extrato da
      // conta, saida ja vem negativa.
      if (accountKind === "credit_card" && proposed.signConvention === "signed") {
        proposed.signConvention = "debit_positive";
      }
      const checked = columnMappingSchema.safeParse(proposed);
      if (!checked.success) {
        const reason = checked.error.issues.map((issue) => issue.message).join(" ");
        throw new LedgerError(
          `Nao reconheci as colunas d${fileLabel.toLowerCase()} (${shape.header.join(", ")}). ${reason}`
        );
      }
      mapping = checked.data;
      saveMapping(accountId, mapping);
    }
    const transactions = readCsv(table, mapping);
    const dates = transactions.map((row) => row.date).sort();
    return {
      source: "csv" as const,
      transactions,
      periodStart: dates[0] ?? null,
      periodEnd: dates[dates.length - 1] ?? null,
      closingBalanceCents: null
    };
  }

  // Gravacao ------------------------------------------------------------------

  type EntryValues = {
    kind: "expense" | "income" | "transfer";
    toAccountId?: number | null;
    categoryId?: number | null;
    placeName?: string | null;
    description?: string | null;
    notes?: string | null;
    personId?: number | null;
    tagIds?: number[];
  };

  /** O id do banco so vai para o lancamento se nenhum outro da conta ja o usa. */
  function freeExternalId(accountId: number, externalId: string | null) {
    if (!externalId) return null;
    const taken = sql
      .prepare(`SELECT 1 FROM entries WHERE account_id = ? AND external_id = ?`)
      .get(accountId, externalId);
    return taken ? null : externalId;
  }

  function createFromRow(batch: BatchRecord, row: RowRecord, values: EntryValues): number {
    const { amountCents, date, rawDescription } = row.parsed;
    const externalId = freeExternalId(batch.accountId, row.externalId);
    const text = (value: string | null | undefined) =>
      value && value.trim() !== "" ? value.trim() : null;

    if (values.kind === "transfer") {
      const other = values.toAccountId!;
      const outgoing = amountCents < 0;
      const created = ledger.entries.createTransfer({
        fromAccountId: outgoing ? batch.accountId : other,
        toAccountId: outgoing ? other : batch.accountId,
        date,
        amountCents: Math.abs(amountCents),
        description: text(values.description),
        notes: text(values.notes),
        personId: values.personId ?? null
      });
      const legId = outgoing ? created.fromEntryId : created.toEntryId;
      sql
        .prepare(
          `UPDATE entries SET raw_description = ?, external_id = ?, content_hash = ?,
             import_row_id = ? WHERE id = ?`
        )
        .run(rawDescription, externalId, row.contentHash, row.id, legId);
      return legId;
    }

    if (values.kind === "expense" && amountCents > 0) {
      throw new LedgerError("Valor positivo no extrato e entrada, nao saida");
    }
    if (values.kind === "income" && amountCents < 0) {
      throw new LedgerError("Valor negativo no extrato e saida, nao entrada");
    }
    const placeName = text(values.placeName);
    const placeId = placeName
      ? ledger.places.findOrCreate(placeName, values.categoryId ?? null)
      : null;
    return ledger.entries.createInternal({
      accountId: batch.accountId,
      personId: values.personId ?? null,
      date,
      amountCents,
      kind: values.kind,
      status: "cleared",
      categoryId: values.categoryId ?? null,
      placeId,
      description: text(values.description),
      notes: text(values.notes),
      // Pix e debito viraram "Dinheiro" na 011; o canal fica no descritor cru.
      rawDescription,
      externalId,
      importRowId: row.id,
      contentHash: row.contentHash,
      tagIds: values.tagIds ?? []
    });
  }

  /**
   * Liga a linha a um lancamento que ja existe, sem criar outro.
   *
   * O arquivo e a verdade do banco: o lancamento passa a ter o valor e o dia
   * dele, e o que era previsto vira confirmado. Categoria, local e descricao
   * continuam os do usuario. Parcela mantem o dia do plano.
   */
  function linkRow(batch: BatchRecord, row: RowRecord, entryId: number): number {
    const entry = bookEntry(entryId);
    const accountId = sql.prepare("SELECT account_id AS id FROM entries WHERE id = ?").get(entryId) as
      | { id: number }
      | undefined;
    if (!entry || accountId?.id !== batch.accountId) throw notFound("Lancamento para vincular");
    if (entry.importRowId != null) {
      throw new LedgerError("Este lancamento ja esta vinculado a outra linha importada");
    }
    const blocked = linkBlock(entry, row.parsed.amountCents);
    if (blocked) throw new LedgerError(blocked);

    const bankCents = row.parsed.amountCents;
    if (bankCents !== entry.amountCents) {
      sql.prepare("UPDATE entries SET amount_cents = ? WHERE id = ?").run(bankCents, entryId);
    }
    if (entry.planId == null && row.parsed.date !== entry.date) {
      // A transferencia tem duas pontas, e as duas ficam no mesmo dia.
      const legs = sql
        .prepare(
          `SELECT from_entry_id AS fromId, to_entry_id AS toId FROM transfers
           WHERE from_entry_id = ? OR to_entry_id = ?`
        )
        .get(entryId, entryId) as { fromId: number; toId: number } | undefined;
      const ids = legs ? [legs.fromId, legs.toId] : [entryId];
      for (const id of ids) {
        sql.prepare("UPDATE entries SET date = ? WHERE id = ?").run(row.parsed.date, id);
      }
    }
    sql
      .prepare(
        `UPDATE entries SET external_id = COALESCE(external_id, @externalId),
           content_hash = COALESCE(content_hash, @hash),
           raw_description = COALESCE(raw_description, @raw),
           status = CASE WHEN status = 'pending' THEN 'cleared' ELSE status END,
           import_row_id = @rowId, updated_at = @now
         WHERE id = @id`
      )
      .run({
        id: entryId,
        externalId: freeExternalId(batch.accountId, row.externalId),
        hash: row.contentHash,
        raw: row.parsed.rawDescription,
        rowId: row.id,
        now: nowIso()
      });
    return entryId;
  }

  function markCommitted(rowId: number, entryId: number) {
    sql
      .prepare(`UPDATE import_rows SET status = 'committed', entry_id = ? WHERE id = ?`)
      .run(entryId, rowId);
  }

  /** Grava, troca ou apaga a regra do destinatario conforme a resposta. */
  function remember(
    payee: PayeeIdentity,
    amountCents: number,
    choice: "none" | "auto" | "ask" | "ignore",
    values: {
      placeId: number | null;
      categoryId: number | null;
      description: string | null;
      personId: number | null;
    }
  ) {
    const existing = findPayeeRule(loadRules(), payee, amountCents);
    if (choice === "none") {
      if (existing) sql.prepare(`DELETE FROM rules WHERE id = ?`).run(existing.id);
      return;
    }
    const mode: RuleMode = choice === "ask" ? "ask" : "auto";
    let ruleId: number;
    if (existing) {
      ruleId = existing.id;
      sql.prepare(`UPDATE rules SET mode = ?, active = 1 WHERE id = ?`).run(mode, ruleId);
      sql.prepare(`DELETE FROM rule_actions WHERE rule_id = ?`).run(ruleId);
    } else {
      const direction = directionOf(amountCents);
      ruleId = Number(
        sql
          .prepare(
            `INSERT INTO rules (name, stage, priority, active, mode, stop_processing, created_at)
             VALUES (?, 'default', 100, 1, ?, 1, ?)`
          )
          .run(`${payee.display} (${direction === "out" ? "saida" : "entrada"})`, mode, nowIso())
          .lastInsertRowid
      );
      const insertCondition = sql.prepare(
        `INSERT INTO rule_conditions (rule_id, field, op, value) VALUES (?, ?, ?, ?)`
      );
      for (const condition of conditionsFor(payee.key, direction)) {
        insertCondition.run(ruleId, condition.field, condition.op, condition.value);
      }
    }
    const insertAction = sql.prepare(
      `INSERT INTO rule_actions (rule_id, action, value) VALUES (?, ?, ?)`
    );
    if (choice === "ignore") {
      insertAction.run(ruleId, "ignore", null);
      return;
    }
    if (values.placeId != null) insertAction.run(ruleId, "set_place", String(values.placeId));
    if (values.categoryId != null)
      insertAction.run(ruleId, "set_category", String(values.categoryId));
    if (values.description) insertAction.run(ruleId, "set_description", values.description);
    if (values.personId != null) insertAction.run(ruleId, "set_person", String(values.personId));
  }

  // API do servico ------------------------------------------------------------

  return {
    upload(input: {
      accountId: number;
      fileName: string;
      buffer: Buffer;
      /** Ausente: deduzido da conta (cartao le fatura, o resto le extrato). */
      kind?: StatementKind;
      /** PDF ja lido por `readPdfStatement`: a leitura e assincrona, o staging nao. */
      pdf?: PdfStatement;
    }): ImportBatchView {
      const account = ledger.accounts.raw(input.accountId);
      if (!account) throw notFound("Conta");
      if (!IMPORTABLE_KINDS.has(account.kind)) {
        throw new LedgerError("Escolha uma conta de banco, dinheiro ou cartao");
      }
      const fileHash = createHash("sha256").update(input.buffer).digest("hex");
      const previous = sql
        .prepare(
          `SELECT imported_at AS importedAt FROM import_batches
           WHERE account_id = ? AND file_hash = ? ORDER BY id LIMIT 1`
        )
        .get(input.accountId, fileHash) as { importedAt: string } | undefined;

      const kind = input.kind ?? (account.kind === "credit_card" ? "card" : "bank");
      // O leitor de CSV e OFX explica o que está errado no arquivo com um
      // `Error` comum; sem embrulhar, a mensagem virava "Erro interno".
      let statement: ReturnType<typeof readStatement> | ReturnType<typeof pdfStatement>;
      try {
        statement = input.pdf
          ? pdfStatement(account.kind, kind, input.pdf)
          : readStatement(input.accountId, account.kind, kind, input.buffer);
      } catch (error) {
        if (error instanceof LedgerError) throw error;
        throw new LedgerError(error instanceof Error ? error.message : "Arquivo ilegivel");
      }
      const pdf = input.pdf ?? null;
      if (statement.transactions.length === 0) {
        throw new LedgerError("Arquivo sem lancamentos");
      }

      const batchId = db.transaction(() => {
        const id = Number(
          sql
            .prepare(
              `INSERT INTO import_batches
                 (source, account_id, file_name, file_hash, imported_at, status, row_count,
                  period_start, period_end, closing_balance_cents,
                  adapter_id, layout_version, reconciliation_status, reconciliation_json)
               VALUES (?, ?, ?, ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              statement.source,
              input.accountId,
              input.fileName.slice(0, 200),
              fileHash,
              nowIso(),
              statement.transactions.length,
              statement.periodStart,
              statement.periodEnd,
              statement.closingBalanceCents,
              pdf?.info.adapterId ?? null,
              pdf?.info.layoutVersion ?? null,
              pdf?.info.reconciliation.status ?? null,
              pdf
                ? JSON.stringify({ reconciliation: pdf.info.reconciliation, warnings: pdf.info.warnings })
                : null
            ).lastInsertRowid
        );

        const insertRow = sql.prepare(
          `INSERT INTO import_rows (batch_id, line_no, raw_json, parsed_json, external_id, content_hash, status,
                                    confidence, sign_known, source_page, source_line, warnings_json)
           VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`
        );
        const staged = statement.transactions.map((transaction, index) => {
          const pdfRow = pdf?.rows[index] ?? null;
          const hash = contentHash(
            input.accountId,
            transaction.date,
            transaction.amountCents,
            transaction.rawDescription
          );
          // `raw_json` e a linha do arquivo intocada; `parsed_json`, o que o
          // leitor entendeu dela.
          const raw = JSON.stringify({
            file: input.fileName.slice(0, 200),
            lineNo: transaction.lineNo,
            fields: transaction.source ?? null
          });
          const rowId = Number(
            insertRow.run(
              id,
              transaction.lineNo,
              raw,
              JSON.stringify(transaction),
              transaction.externalId ?? null,
              hash,
              pdfRow?.confidence ?? null,
              pdfRow && !pdfRow.signKnown ? 0 : 1,
              pdfRow?.sourcePage ?? null,
              pdfRow?.sourceLine ?? null,
              pdfRow ? JSON.stringify(pdfRow.warnings) : null
            ).lastInsertRowid
          );
          return {
            key: rowId,
            date: transaction.date,
            amountCents: transaction.amountCents,
            externalId: transaction.externalId ?? null,
            contentHash: hash
          };
        });

        // Primeiro degrau: o que ja passou por uma importacao (id do banco ou hash)
        // e certeza, nao vai para o popup. O que o usuario digitou a mao e o
        // arquivo repete e provavel, nao certo: `reclassify` pareia e manda para
        // a revisao, onde se ve os dois lados.
        const dates = staged.map((row) => row.date).sort();
        const known = bookEntries(input.accountId, dates[0]!, dates[dates.length - 1]!);
        const matches = findDuplicates(staged, known.map(dedupeCandidateOf), { exactOnly: true });
        const markDuplicate = sql.prepare(
          `UPDATE import_rows SET status = 'duplicate', duplicate_of_entry_id = ?, match_reason = ? WHERE id = ?`
        );
        for (const [rowId, match] of matches) markDuplicate.run(match.entryId, match.reason, rowId);

        // Linha que ja passou por uma importacao desta conta e foi pulada — no
        // popup, por "ignorar sempre" ou por ter o lancamento apagado depois —
        // e pulada de novo, sem perguntar. Reconhecida pelo id do banco ou pelo
        // hash, os mesmos degraus exatos da dedupe; cada linha antiga cala uma
        // so linha nova, como na dedupe.
        const skippedBefore = sql
          .prepare(
            `SELECT r.id, r.external_id AS externalId, r.content_hash AS contentHash
             FROM import_rows r JOIN import_batches b ON b.id = r.batch_id
             WHERE b.account_id = ? AND r.batch_id <> ? AND r.status = 'ignored'`
          )
          .all(input.accountId, id) as {
          id: number;
          externalId: string | null;
          contentHash: string;
        }[];
        const usedSkips = new Set<number>();
        const markSkipped = sql.prepare(
          `UPDATE import_rows SET status = 'ignored', match_reason = ? WHERE id = ?`
        );
        for (const row of staged) {
          if (matches.has(row.key)) continue;
          const byId = row.externalId
            ? skippedBefore.find(
                (old) => !usedSkips.has(old.id) && old.externalId === row.externalId
              )
            : undefined;
          const hit =
            byId ??
            skippedBefore.find(
              (old) => !usedSkips.has(old.id) && old.contentHash === row.contentHash
            );
          if (!hit) continue;
          usedSkips.add(hit.id);
          markSkipped.run(byId ? "external_id" : "content_hash", row.key);
        }

        // Na fatura, "Pagamento recebido" e o dinheiro que saiu do banco para
        // quitar a fatura anterior. Ele ja existe como pagamento (tela Fatura);
        // gravar de novo aqui contaria o pagamento duas vezes.
        if (kind === "card") {
          const skip = sql.prepare(`UPDATE import_rows SET status = 'ignored' WHERE id = ?`);
          statement.transactions.forEach((transaction, index) => {
            if (/pagamento recebido/i.test(transaction.rawDescription))
              skip.run(staged[index]!.key);
          });
        }
        return id;
      });

      reclassify(batchId);
      return viewOf(batchId, previous?.importedAt ?? null);
    },

    list(): ImportBatchSummary[] {
      return sql
        .prepare(
          `SELECT b.id, b.source, b.account_id AS accountId, b.file_name AS fileName,
                    b.file_hash AS fileHash, b.imported_at AS importedAt, b.status,
                    b.row_count AS rowCount, b.committed_count AS committedCount,
                    b.period_start AS periodStart, b.period_end AS periodEnd,
                    b.closing_balance_cents AS closingBalanceCents, a.name AS accountName,
                    (SELECT COUNT(*) FROM import_rows r
                      WHERE r.batch_id = b.id AND r.status IN ('new','needs_review')) AS pendingCount
             FROM import_batches b JOIN accounts a ON a.id = b.account_id
             ORDER BY b.id DESC LIMIT 30`
        )
        .all() as ImportBatchSummary[];
    },

    view: (batchId: number) => viewOf(batchId),

    /** A resposta do popup para uma linha. Grava na hora e devolve o lote. */
    confirm(batchId: number, rowId: number, body: ImportRowConfirm): ImportBatchView {
      const input = importRowConfirmSchema.parse(body);
      const batch = batchRecord(batchId);
      if (batch.status === "discarded") throw new LedgerError("Lote descartado", 409);
      const row = rowRecord(batchId, rowId);
      if (row.status === "committed") throw new LedgerError("Linha ja importada", 409);

      db.transaction(() => {
        const payee = payeeOf(row.parsed);
        if (input.action === "skip") {
          sql.prepare(`UPDATE import_rows SET status = 'ignored' WHERE id = ?`).run(row.id);
          if (input.remember === "ignore") {
            remember(payee, row.parsed.amountCents, "ignore", {
              placeId: null,
              categoryId: null,
              description: null,
              personId: null
            });
          }
          return;
        }

        if (input.action === "link") {
          const target =
            input.linkEntryId ??
            row.duplicateOfEntryId ??
            pendingMatches(batchId).get(row.id)?.[0]?.entryId ??
            null;
          if (target == null) throw new LedgerError("Nenhum lancamento para vincular");
          markCommitted(row.id, linkRow(batch, row, target));
          // O lancamento que ja existia (da planilha, digitado a mao) ensina o
          // destinatario: local e categoria dele viram a regra. A descricao
          // nao, porque costuma ser daquela compra e nao do destinatario.
          const linked = sql
            .prepare(
              `SELECT e.place_id AS placeId, e.category_id AS categoryId, e.person_id AS personId,
                      e.kind
               FROM entries e WHERE e.id = ?`
            )
            .get(target) as {
            placeId: number | null;
            categoryId: number | null;
            personId: number | null;
            kind: string;
          };
          if (linked.kind !== "transfer" && input.remember !== "ignore") {
            const accountPerson = ledger.accounts.raw(batch.accountId)?.personId ?? null;
            remember(payee, row.parsed.amountCents, input.remember, {
              placeId: linked.placeId,
              categoryId: linked.categoryId,
              description: null,
              personId:
                linked.personId != null && linked.personId !== accountPerson
                  ? linked.personId
                  : null
            });
          }
          return;
        }

        const entryId = createFromRow(batch, row, input);
        markCommitted(row.id, entryId);

        // Transferencia nao vira regra: a outra conta nao cabe nas acoes de
        // regra, e "sempre automatico" gravaria sem ela.
        if (input.kind !== "transfer") {
          const created = sql
            .prepare(`SELECT place_id AS placeId FROM entries WHERE id = ?`)
            .get(entryId) as { placeId: number | null };
          const accountPerson = ledger.accounts.raw(batch.accountId)?.personId ?? null;
          remember(
            payee,
            row.parsed.amountCents,
            input.remember === "ignore" ? "none" : input.remember,
            {
              placeId: created.placeId,
              categoryId: input.categoryId ?? null,
              description: null,
              // Pessoa igual a da conta nao precisa de regra: ela ja e herdada.
              personId:
                input.personId != null && input.personId !== accountPerson ? input.personId : null
            }
          );
        }
      });

      reclassify(batchId);
      return viewOf(batchId);
    },

    /** Grava de uma vez as linhas que as regras automaticas deixaram prontas. */
    commitReady(batchId: number): ImportBatchView {
      const batch = batchRecord(batchId);
      if (batch.status === "discarded") throw new LedgerError("Lote descartado", 409);
      // Nao existe caminho que grave linha de PDF sem confirmacao, linha a linha.
      if (batch.source === "pdf") {
        throw new LedgerError("Lote de PDF: cada lancamento e confirmado na revisao", 409);
      }
      const view = viewOf(batchId);
      db.transaction(() => {
        for (const item of view.rows.filter((row) => row.status === "new")) {
          const row = rowRecord(batchId, item.id);
          const entryId = createFromRow(batch, row, {
            kind: item.suggestion.kind,
            categoryId: item.suggestion.categoryId,
            placeName: item.suggestion.placeName,
            description: item.suggestion.description,
            personId: item.suggestion.personId
          });
          markCommitted(row.id, entryId);
        }
      });
      refreshBatchStatus(batchId);
      return viewOf(batchId);
    },

    /** Devolve uma linha pulada ou duplicada para a fila do popup. */
    reopen(batchId: number, rowId: number): ImportBatchView {
      const row = rowRecord(batchId, rowId);
      if (row.status !== "ignored" && row.status !== "duplicate") {
        throw new LedgerError("So linha pulada ou duplicada volta para a revisao", 409);
      }
      sql.prepare(`UPDATE import_rows SET status = 'needs_review' WHERE id = ?`).run(row.id);
      refreshBatchStatus(batchId);
      return viewOf(batchId);
    },

    /**
     * Encerra o lote sem gravar o que falta. O que ja foi importado continua no
     * livro: o historico de importacao e auditoria, nao se apaga.
     */
    discard(batchId: number): ImportBatchView {
      batchRecord(batchId);
      // As pendentes ficam como estavam: "ignored" e so o que o usuario
      // decidiu pular, e e isso que a proxima importacao pula sozinha.
      // Encerrar o lote sem revisar nao e decidir sobre cada linha.
      sql.prepare(`UPDATE import_batches SET status = 'discarded' WHERE id = ?`).run(batchId);
      return viewOf(batchId);
    }
  };
}

export type LedgerImportService = ReturnType<typeof createLedgerImportService>;
