import type {
  AttachmentRecord,
  EntryKind,
  TransferPurpose,
  EntryFilter,
  EntryDraft,
  EntryListResult,
  EntryRecord,
  TagRecord,
  TransferDraft
} from "@projeto41/contracts";
import { statementMonthFor } from "@projeto41/finance";
import { createAccountsRepository } from "./accounts.js";
import { LedgerError, fromBit, notFound, nowIso, toBit, type Db } from "./shared.js";

const SELECT_COLUMNS = `
  e.id,
  e.account_id AS accountId,
  a.name AS accountName,
  a.kind AS accountKind,
  e.person_id AS personId,
  p.name AS personName,
  p.color AS personColor,
  e.date,
  e.amount_cents AS amountCents,
  e.kind,
  e.status,
  e.category_id AS categoryId,
  c.name AS categoryName,
  c.color AS categoryColor,
  e.place_id AS placeId,
  pl.name AS placeName,
  e.description,
  e.notes,
  e.raw_description AS rawDescription,
  e.payment_method AS paymentMethod,
  e.statement_month AS statementMonth,
  e.installment_plan_id AS installmentPlanId,
  e.installment_number AS installmentNumber,
  e.refund_of_entry_id AS refundOfEntryId,
  e.counts_toward_target AS countsTowardTarget,
  e.created_at AS createdAt,
  e.updated_at AS updatedAt,
  t.id AS transferId,
  t.purpose AS transferPurpose,
  CASE WHEN t.from_entry_id = e.id THEN t.to_entry_id ELSE t.from_entry_id END AS counterpartEntryId,
  -- A caixinha do movimento sai de dois caminhos: a conta da contraparte numa
  -- transferencia de caixinha (modo conta) ou a alocacao (modo marcacao).
  COALESCE(gt.id, ga_goal.id) AS goalId,
  COALESCE(gt.name, ga_goal.name) AS goalName,
  COALESCE(gt.color, ga_goal.color) AS goalColor
`;

const FROM_JOINS = `
  FROM entries e
  JOIN accounts a ON a.id = e.account_id
  LEFT JOIN people p ON p.id = e.person_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN places pl ON pl.id = e.place_id
  LEFT JOIN transfers t ON t.from_entry_id = e.id OR t.to_entry_id = e.id
  LEFT JOIN entries ce
    ON t.purpose IN ('goal_deposit','goal_withdrawal')
   AND ce.id = CASE WHEN t.from_entry_id = e.id THEN t.to_entry_id ELSE t.from_entry_id END
  LEFT JOIN goals gt ON gt.mode = 'account' AND gt.account_id IN (e.account_id, ce.account_id)
  LEFT JOIN goal_allocations ga ON ga.entry_id = e.id
  LEFT JOIN goals ga_goal ON ga_goal.id = ga.goal_id
`;

type EntryRow = Omit<
  EntryRecord,
  | "countsTowardTarget"
  | "tags"
  | "attachments"
  | "installmentCount"
  | "counterpartAccountId"
  | "counterpartAccountName"
> & {
  countsTowardTarget: number;
  counterpartEntryId: number | null;
};

/** Ramos de WHERE construidos a partir do filtro validado. */
function buildWhere(filter: Partial<EntryFilter>) {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.from) {
    clauses.push("e.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    clauses.push("e.date <= @to");
    params.to = filter.to;
  }
  if (filter.kind) {
    clauses.push("e.kind = @kind");
    params.kind = filter.kind;
  } else if (filter.includeTransfers === false) {
    clauses.push("e.kind <> 'transfer'");
  }
  if (filter.accountId) {
    clauses.push("e.account_id = @accountId");
    params.accountId = filter.accountId;
  }
  if (filter.personId) {
    clauses.push("e.person_id = @personId");
    params.personId = filter.personId;
  }
  if (filter.placeId) {
    clauses.push("e.place_id = @placeId");
    params.placeId = filter.placeId;
  }
  if (filter.status) {
    clauses.push("e.status = @status");
    params.status = filter.status;
  }
  if (filter.statementMonth) {
    clauses.push("e.statement_month = @statementMonth");
    params.statementMonth = filter.statementMonth;
  }
  if (filter.installmentPlanId) {
    clauses.push("e.installment_plan_id = @installmentPlanId");
    params.installmentPlanId = filter.installmentPlanId;
  }
  if (filter.goalId) {
    // Os dois modos: conta da caixinha, ou alocacao apontando para ela.
    clauses.push(
      `(e.account_id IN (SELECT account_id FROM goals WHERE id = @goalId AND account_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM goal_allocations ga2
                   WHERE ga2.entry_id = e.id AND ga2.goal_id = @goalId))`
    );
    params.goalId = filter.goalId;
  }
  if (filter.categoryId && filter.categoryId.length > 0) {
    // Lista de ids vem validada como inteiros pelo contrato, entao interpolar
    // aqui e seguro e evita gerar N placeholders nomeados.
    clauses.push(`e.category_id IN (${filter.categoryId.join(",")})`);
  }
  if (filter.tagId && filter.tagId.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id
               AND et.tag_id IN (${filter.tagId.join(",")}))`
    );
  }
  if (filter.search) {
    clauses.push(
      `(e.description LIKE @search OR e.notes LIKE @search
        OR e.raw_description LIKE @search OR pl.name LIKE @search)`
    );
    params.search = `%${filter.search}%`;
  }
  // Os limites comparam magnitude: o usuario pensa "gastos acima de 100",
  // nao "lancamentos com amount_cents >= -10000".
  if (filter.minCents != null) {
    clauses.push("ABS(e.amount_cents) >= @minCents");
    params.minCents = Math.abs(filter.minCents);
  }
  if (filter.maxCents != null) {
    clauses.push("ABS(e.amount_cents) <= @maxCents");
    params.maxCents = Math.abs(filter.maxCents);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

/**
 * Materializa a regra de "o que conta como realizado" do plano mestre 6.4 —
 * e nada alem dela.
 *
 * O caso sutil e o deposito em caixinha: ele conta **so na ponta de saida**.
 * Marcar as duas pontas faria o deposito somar e subtrair, anulando-se.
 * Saque de caixinha nao devolve folga ao alvo do mes, e transferencia para
 * investimento nunca conta — e justamente para sobrar dinheiro para investir
 * que o alvo existe.
 */
export function deriveCountsTowardTarget(input: {
  kind: EntryKind;
  amountCents: number;
  transferPurpose?: TransferPurpose | null;
  refundOfEntryId?: number | null;
}): boolean {
  // Estorno entra positivo e abate a despesa original no somatorio (6.6).
  if (input.refundOfEntryId != null) return true;
  if (input.kind === "expense") return true;
  if (input.kind === "transfer") {
    return input.transferPurpose === "goal_deposit" && input.amountCents < 0;
  }
  return false;
}

/** `targetFlagReset` avisa a UI que a excecao manual foi refeita (6.4). */
export type UpdateResult = { changes: number; targetFlagReset: boolean };

export function createEntriesRepository(db: Db) {
  const accounts = createAccountsRepository(db);

  /**
   * Resolve pessoa e mes de fatura a partir da conta.
   *
   * Pessoa e herdada da conta quando nao informada (D01). `statement_month` e
   * calculado na escrita para contas de cartao e pode vir sobrescrito — e assim
   * que a antecipacao de parcela funciona (plano mestre 6.2).
   */
  function resolveAccountDefaults(input: {
    accountId: number;
    personId?: number | null;
    date: string;
    statementMonth?: string | null;
  }) {
    const account = accounts.raw(input.accountId);
    if (!account) throw notFound("Conta");

    let statementMonth = input.statementMonth ?? null;
    if (account.kind === "credit_card" && !statementMonth) {
      if (account.closingDay == null || account.dueDay == null) {
        throw new LedgerError("Cartao sem ciclo configurado");
      }
      statementMonth = statementMonthFor(input.date, account.closingDay, account.dueDay);
    }
    if (account.kind !== "credit_card") statementMonth = null;

    return {
      personId: input.personId ?? account.personId ?? null,
      statementMonth,
      accountKind: account.kind
    };
  }

  /** Despesa e negativa, receita e positiva — menos em estorno (6.6). */
  function normalizeAmount(input: Pick<EntryDraft, "kind" | "amountCents" | "refundOfEntryId">) {
    if (input.refundOfEntryId != null) return input.amountCents;
    const magnitude = Math.abs(input.amountCents);
    if (input.kind === "expense") return -magnitude;
    if (input.kind === "income") return magnitude;
    return input.amountCents;
  }

  /**
   * A fatura que um lancamento mantem numa edicao que nao fala dela.
   *
   * Se a linha estava na fatura natural da data, ela acompanha a data nova.
   * Se estava noutra — parcela antecipada, pagamento de uma fatura especifica —
   * foi uma escolha, e trocar a descricao nao pode desfaze-la. Mudar de conta
   * zera tudo: o ciclo e o do cartao novo.
   */
  function keptStatementMonth(
    existing: {
      accountId: number;
      date: string;
      statementMonth: string | null;
      installmentPlanId: number | null;
    },
    accountId: number
  ): string | null | undefined {
    if (existing.statementMonth == null || existing.accountId !== accountId) return undefined;
    // Parcela nao segue a propria data: a fatura dela vem da serie (uma por
    // fatura a partir da compra) e so muda por antecipacao ou troca de cartao.
    if (existing.installmentPlanId != null) return existing.statementMonth;
    const account = accounts.raw(accountId);
    if (!account || account.closingDay == null || account.dueDay == null) return undefined;
    const natural = statementMonthFor(existing.date, account.closingDay, account.dueDay);
    return existing.statementMonth === natural ? undefined : existing.statementMonth;
  }

  /**
   * O proposito de uma transferencia generica sai das contas envolvidas.
   *
   * Dinheiro que entra numa caixinha e deposito, e o que sai dela e saque:
   * so assim ele conta no alvo da caixinha (6.4), venha da tela que vier.
   * Cartao e diferente: pagar fatura exige saber *qual* fatura, e quem sabe
   * disso e `statements.pay`. Uma transferencia avulsa para o cartao viraria
   * "compra" na fatura seguinte.
   */
  function transferPurposeFor(input: TransferDraft): TransferPurpose {
    const purpose = input.purpose ?? "generic";
    const from = accounts.raw(input.fromAccountId);
    const to = accounts.raw(input.toAccountId);
    if (!from) throw notFound("Conta de origem");
    if (!to) throw notFound("Conta de destino");
    if (purpose !== "generic") return purpose;
    if (to.kind === "credit_card") {
      throw new LedgerError("Para pagar o cartao, use Pagar fatura na tela de fatura");
    }
    if (to.kind === "goal") return "goal_deposit";
    if (from.kind === "goal") return "goal_withdrawal";
    // A conta-ponte dos investimentos so recebe dinheiro junto de uma posicao
    // (aporte) ou de uma operacao. Transferencia avulsa para ela sumiria do
    // patrimonio: o dinheiro sairia do banco sem chegar a posicao nenhuma.
    if (to.kind === "investment" || from.kind === "investment") {
      throw new LedgerError("Para investir, use Aportar em Investimentos > Em caixa");
    }
    return "generic";
  }

  /**
   * Aporte e resgate sao de Investimentos: o livro mostra, mas quem desfaz e
   * a tela que tambem devolve o valor da posicao.
   */
  /**
   * O dinheiro separado numa caixinha de marcação fica preso a um lançamento
   * de entrada (o esquema pede), e a alocação some junto com ele em cascata.
   * Antes de o lançamento sair da conta (excluído ou movido), a marcação passa
   * para outra entrada da mesma conta: separar dinheiro não depende de qual
   * lançamento o trouxe. Sem outra entrada, recusa em vez de zerar a caixinha.
   */
  function rehomeAllocations(entryIds: number[]) {
    for (const entryId of entryIds) {
      const held = db
        .prepare(
          `SELECT ga.goal_id AS goalId, ga.amount_cents AS amountCents, g.account_id AS accountId
           FROM goal_allocations ga JOIN goals g ON g.id = ga.goal_id
           WHERE ga.entry_id = ?`
        )
        .all(entryId) as {
        goalId: number;
        amountCents: number;
        accountId: number;
      }[];
      if (held.length === 0) continue;
      for (const row of held) {
        const anchor = db
          .prepare(
            `SELECT id FROM entries
             WHERE account_id = ? AND amount_cents > 0 AND id NOT IN (${entryIds.map(() => "?").join(",")})
             ORDER BY date DESC, id DESC LIMIT 1`
          )
          .get(row.accountId, ...entryIds) as { id: number } | undefined;
        if (!anchor) {
          throw new LedgerError(
            "Este lancamento guarda dinheiro separado em caixinhas: libere o valor da caixinha antes de excluir"
          );
        }
        db.prepare(
          `INSERT INTO goal_allocations(goal_id, entry_id, amount_cents) VALUES (?, ?, ?)
           ON CONFLICT(goal_id, entry_id) DO UPDATE SET amount_cents = amount_cents + excluded.amount_cents`
        ).run(row.goalId, anchor.id, row.amountCents);
      }
      db.prepare("DELETE FROM goal_allocations WHERE entry_id = ?").run(entryId);
    }
  }

  /** Entrada com categoria de saída (ou o contrário) some dos dois relatórios. */
  function assertCategoryKind(input: Pick<EntryDraft, "kind" | "categoryId">) {
    if (input.categoryId == null || (input.kind !== "income" && input.kind !== "expense")) return;
    const category = db
      .prepare("SELECT kind FROM categories WHERE id = ?")
      .get(input.categoryId) as { kind: string } | undefined;
    if (category && category.kind !== input.kind) {
      throw new LedgerError(
        input.kind === "income"
          ? "Entrada precisa de categoria de entrada"
          : "Saida precisa de categoria de saida"
      );
    }
  }

  function assertNotOperationCash(entryId: number) {
    // Aporte e resgate mudam o valor de uma posicao junto com o banco (010).
    // Apagar so a ponta do livro deixaria a posicao com dinheiro que nao saiu
    // de lugar nenhum.
    const linked = db
      .prepare(
        `SELECT 1 FROM position_movements m
         JOIN transfers t ON t.id = m.transfer_id
         WHERE t.from_entry_id = ? OR t.to_entry_id = ?`
      )
      .get(entryId, entryId);
    if (linked) {
      throw new LedgerError(
        "Aporte ou resgate de investimento: desfaca em Investimentos > Em caixa"
      );
    }
  }

  /** Os estornos somados nunca passam do lancamento que estornam (6.6). */
  function assertRefundFits(originalId: number, refundId: number, amountCents: number) {
    const original = db
      .prepare(
        `SELECT e.amount_cents AS amountCents, e.installment_plan_id AS planId,
                p.total_cents AS planTotal
         FROM entries e LEFT JOIN installment_plans p ON p.id = e.installment_plan_id
         WHERE e.id = ?`
      )
      .get(originalId) as
      { amountCents: number; planId: number | null; planTotal: number | null } | undefined;
    if (!original) throw notFound("Lancamento estornado");
    if (Math.sign(amountCents) === Math.sign(original.amountCents)) {
      throw new LedgerError("Estorno tem o sinal oposto ao do lancamento original");
    }
    // Numa compra parcelada o teto é o total da compra, e conta o estorno de
    // qualquer parcela: o estorno integral aponta para a primeira, mas devolve
    // a compra inteira.
    const others = (
      original.planId != null
        ? db
            .prepare(
              `SELECT COALESCE(SUM(r.amount_cents), 0) AS total FROM entries r
               JOIN entries o ON o.id = r.refund_of_entry_id
               WHERE o.installment_plan_id = ? AND r.id <> ?`
            )
            .get(original.planId, refundId)
        : db
            .prepare(
              `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries
               WHERE refund_of_entry_id = ? AND id <> ?`
            )
            .get(originalId, refundId)
    ) as { total: number };
    const cap =
      original.planId != null ? (original.planTotal ?? 0) : Math.abs(original.amountCents);
    if (Math.abs(others.total + amountCents) > cap) {
      throw new LedgerError("Estornos passariam do valor do lancamento original");
    }
  }

  function replaceTags(entryId: number, tagIds: number[] | undefined) {
    if (!tagIds) return;
    db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(entryId);
    const insert = db.prepare("INSERT OR IGNORE INTO entry_tags(entry_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) insert.run(entryId, tagId);
  }

  const insertStatement = db.prepare(
    `INSERT INTO entries
     (account_id, person_id, date, amount_cents, kind, status, category_id, place_id,
      description, notes, raw_description, payment_method, statement_month,
      installment_plan_id, installment_number, parent_entry_id, refund_of_entry_id,
      counts_toward_target, external_id, import_row_id, content_hash, goal_profit,
      created_at, updated_at)
     VALUES (@accountId, @personId, @date, @amountCents, @kind, @status, @categoryId, @placeId,
             @description, @notes, @rawDescription, @paymentMethod, @statementMonth,
             @installmentPlanId, @installmentNumber, @parentEntryId, @refundOfEntryId,
             @countsTowardTarget, @externalId, @importRowId, @contentHash, @goalProfit,
             @createdAt, @updatedAt)`
  );

  /** Os campos extras so sao preenchidos pelas fases 3 (parcelas) e 6 (importacao). */
  function insertRow(
    input: EntryDraft & {
      installmentPlanId?: number | null;
      installmentNumber?: number | null;
      parentEntryId?: number | null;
      /** So a criacao de transferencia informa; define o flag de alvo (6.4). */
      transferPurpose?: TransferPurpose | null;
      rawDescription?: string | null;
      externalId?: string | null;
      importRowId?: number | null;
      contentHash?: string | null;
      /** So a caixinha informa: de onde vem o lucro (migracao 022). */
      goalProfit?: "yield" | "profit" | "profit_adjust" | null;
    }
  ): number {
    const defaults = resolveAccountDefaults(input);
    const timestamp = nowIso();
    const id = Number(
      insertStatement.run({
        accountId: input.accountId,
        personId: defaults.personId,
        date: input.date,
        amountCents: normalizeAmount(input),
        kind: input.kind,
        status: input.status ?? "cleared",
        categoryId: input.kind === "transfer" ? null : (input.categoryId ?? null),
        placeId: input.placeId ?? null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        rawDescription: input.rawDescription ?? null,
        // Lancamento em cartao nasce como 'credit' quando o metodo nao vem.
        paymentMethod:
          input.paymentMethod ?? (defaults.accountKind === "credit_card" ? "credit" : null),
        statementMonth: defaults.statementMonth,
        installmentPlanId: input.installmentPlanId ?? null,
        installmentNumber: input.installmentNumber ?? null,
        parentEntryId: input.parentEntryId ?? null,
        refundOfEntryId: input.refundOfEntryId ?? null,
        // O valor derivado e o padrao; um `countsTowardTarget` explicito no
        // input e a excecao manual caso a caso prevista em 6.4.
        countsTowardTarget: toBit(
          input.countsTowardTarget,
          deriveCountsTowardTarget({
            kind: input.kind,
            amountCents: normalizeAmount(input),
            transferPurpose: input.transferPurpose,
            refundOfEntryId: input.refundOfEntryId
          })
        ),
        externalId: input.externalId ?? null,
        importRowId: input.importRowId ?? null,
        contentHash: input.contentHash ?? null,
        goalProfit: input.goalProfit ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      }).lastInsertRowid
    );
    replaceTags(id, input.tagIds);
    return id;
  }

  const repository = {
    create: (input: EntryDraft): number =>
      db.transaction(() => {
        // Transferência tem duas pontas e uma linha em `transfers`: só nasce
        // por `createTransfer`. Uma ponta solta tirava dinheiro de uma conta
        // sem pôr na outra.
        if (input.kind === "transfer") {
          throw new LedgerError(
            "Transferencia se cria com origem e destino, nao como lancamento avulso"
          );
        }
        // Estorno avulso passa pela mesma régua da edição: sinal oposto e nunca
        // mais que o original.
        if (input.refundOfEntryId != null) {
          assertRefundFits(input.refundOfEntryId, -1, normalizeAmount(input));
        }
        assertCategoryKind(input);
        return insertRow(input);
      })(),

    /** Usado pelas fases 3 e 6, que precisam gravar campos internos. */
    createInternal: (input: Parameters<typeof insertRow>[0]): number => insertRow(input),

    get: (id: number): EntryRecord | undefined => {
      const rows = repository.hydrate(
        db.prepare(`SELECT ${SELECT_COLUMNS} ${FROM_JOINS} WHERE e.id = ?`).all(id) as EntryRow[]
      );
      return rows[0];
    },

    /**
     * Anexa a cada linha as etiquetas, os anexos, o total de parcelas do plano e
     * a conta da outra ponta da transferencia. Tudo em consultas agregadas pelo
     * conjunto de ids da pagina, para nao gerar N+1.
     */
    hydrate: (rows: EntryRow[]): EntryRecord[] => {
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id).join(",");

      const tagsByEntry = new Map<number, TagRecord[]>();
      for (const row of db
        .prepare(
          `SELECT et.entry_id AS entryId, t.id, t.name, t.color
           FROM entry_tags et JOIN tags t ON t.id = et.tag_id
           WHERE et.entry_id IN (${ids}) ORDER BY t.name`
        )
        .all() as (TagRecord & { entryId: number })[]) {
        const { entryId, ...tag } = row;
        const list = tagsByEntry.get(entryId) ?? [];
        list.push(tag);
        tagsByEntry.set(entryId, list);
      }

      const attachmentsByEntry = new Map<number, AttachmentRecord[]>();
      for (const row of db
        .prepare(
          `SELECT id, entry_id AS entryId, mime, byte_size AS byteSize, width, height,
                  original_name AS originalName, created_at AS createdAt
           FROM attachments WHERE entry_id IN (${ids}) ORDER BY id`
        )
        .all() as AttachmentRecord[]) {
        const list = attachmentsByEntry.get(row.entryId) ?? [];
        list.push(row);
        attachmentsByEntry.set(row.entryId, list);
      }

      const counterpartIds = rows
        .map((row) => row.counterpartEntryId)
        .filter((value): value is number => value != null);
      const counterparts = new Map<number, { accountId: number; accountName: string }>();
      if (counterpartIds.length > 0) {
        for (const row of db
          .prepare(
            `SELECT e.id, e.account_id AS accountId, a.name AS accountName
             FROM entries e JOIN accounts a ON a.id = e.account_id
             WHERE e.id IN (${counterpartIds.join(",")})`
          )
          .all() as { id: number; accountId: number; accountName: string }[]) {
          counterparts.set(row.id, {
            accountId: row.accountId,
            accountName: row.accountName
          });
        }
      }

      const planIds = rows
        .map((row) => row.installmentPlanId)
        .filter((value): value is number => value != null);
      const planCounts = new Map<number, number>();
      if (planIds.length > 0 && tableExists(db, "installment_plans")) {
        for (const row of db
          .prepare(
            `SELECT id, installment_count AS installmentCount
             FROM installment_plans WHERE id IN (${planIds.join(",")})`
          )
          .all() as { id: number; installmentCount: number }[]) {
          planCounts.set(row.id, row.installmentCount);
        }
      }

      return rows.map((row) => {
        const { counterpartEntryId, ...rest } = row;
        const counterpart =
          counterpartEntryId != null ? counterparts.get(counterpartEntryId) : undefined;
        return {
          ...rest,
          countsTowardTarget: fromBit(row.countsTowardTarget),
          installmentCount:
            row.installmentPlanId != null ? (planCounts.get(row.installmentPlanId) ?? null) : null,
          counterpartAccountId: counterpart?.accountId ?? null,
          counterpartAccountName: counterpart?.accountName ?? null,
          tags: tagsByEntry.get(row.id) ?? [],
          attachments: attachmentsByEntry.get(row.id) ?? []
        } satisfies EntryRecord;
      });
    },

    list: (filter: Partial<EntryFilter> = {}): EntryListResult => {
      const { where, params } = buildWhere(filter);
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 50;

      const total = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM (SELECT e.id ${FROM_JOINS} ${where} GROUP BY e.id)`)
          .get(params) as { n: number }
      ).n;

      // Os totais do rodape cobrem o filtro inteiro, nao so a pagina visivel.
      const totals = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN kind = 'income' THEN amountCents END), 0) AS incomeCents,
             COALESCE(SUM(CASE WHEN kind = 'expense' THEN amountCents END), 0) AS expenseCents,
             COALESCE(SUM(CASE WHEN kind IN ('income','expense') THEN amountCents END), 0) AS netCents
           FROM (SELECT e.id, e.kind, e.amount_cents AS amountCents ${FROM_JOINS} ${where}
                 GROUP BY e.id)`
        )
        .get(params) as {
        incomeCents: number;
        expenseCents: number;
        netCents: number;
      };

      const rows = db
        .prepare(
          `SELECT ${SELECT_COLUMNS} ${FROM_JOINS} ${where}
           GROUP BY e.id
           ORDER BY e.date DESC, e.id DESC
           LIMIT @limit OFFSET @offset`
        )
        .all({
          ...params,
          limit: pageSize,
          offset: (page - 1) * pageSize
        }) as EntryRow[];

      return { rows: repository.hydrate(rows), total, page, pageSize, totals };
    },

    /**
     * Cria as duas pontas de uma transferencia numa transacao so (D20). E a
     * unica maneira de criar transferencia: pontas soltas nao existem.
     */
    createTransfer: (input: TransferDraft): { fromEntryId: number; toEntryId: number } => {
      if (input.fromAccountId === input.toAccountId) {
        throw new LedgerError("Conta de origem e destino precisam ser diferentes");
      }
      const magnitude = Math.abs(input.amountCents);
      const purpose = transferPurposeFor(input);

      return db.transaction(() => {
        const fromEntryId = insertRow({
          accountId: input.fromAccountId,
          personId: input.personId ?? null,
          date: input.date,
          amountCents: -magnitude,
          kind: "transfer",
          status: input.status ?? "cleared",
          description: input.description ?? null,
          notes: input.notes ?? null,
          // A regra de 6.4 fica em `deriveCountsTowardTarget`, alimentada pelo
          // purpose: aqui nao se decide nada.
          transferPurpose: purpose,
          tagIds: []
        });
        const toEntryId = insertRow({
          accountId: input.toAccountId,
          personId: input.personId ?? null,
          date: input.date,
          amountCents: magnitude,
          kind: "transfer",
          status: input.status ?? "cleared",
          statementMonth: input.statementMonth ?? null,
          description: input.description ?? null,
          notes: input.notes ?? null,
          transferPurpose: purpose,
          tagIds: []
        });
        db.prepare(
          `INSERT INTO transfers(from_entry_id, to_entry_id, purpose, created_at)
           VALUES (?, ?, ?, ?)`
        ).run(fromEntryId, toEntryId, purpose, nowIso());
        return { fromEntryId, toEntryId };
      })();
    },

    /**
     * Atualiza um lancamento. Mexer numa ponta de transferencia arrasta a outra
     * na mesma transacao: data, valor e status precisam continuar espelhados.
     */
    update: (id: number, input: EntryDraft): UpdateResult =>
      db.transaction((): UpdateResult => {
        const existing = db
          .prepare(
            `SELECT e.id, e.kind, e.counts_toward_target AS countsTowardTarget,
                    e.refund_of_entry_id AS refundOfEntryId, e.account_id AS accountId,
                    e.date, e.amount_cents AS amountCents, e.statement_month AS statementMonth,
                    e.installment_plan_id AS installmentPlanId,
                    EXISTS (SELECT 1 FROM anticipation_discounts d WHERE d.entry_id = e.id)
                      AS isDiscount,
                    t.id AS transferId, t.purpose AS transferPurpose,
                    t.from_entry_id AS fromEntryId, t.to_entry_id AS toEntryId
             FROM entries e
             LEFT JOIN transfers t ON t.from_entry_id = e.id OR t.to_entry_id = e.id
             WHERE e.id = ?`
          )
          .get(id) as
          | {
              id: number;
              kind: EntryKind;
              countsTowardTarget: number;
              refundOfEntryId: number | null;
              accountId: number;
              date: string;
              amountCents: number;
              statementMonth: string | null;
              installmentPlanId: number | null;
              isDiscount: number;
              transferId: number | null;
              transferPurpose: TransferPurpose | null;
              fromEntryId: number | null;
              toEntryId: number | null;
            }
          | undefined;
        if (!existing) throw notFound("Lancamento");
        assertNotOperationCash(id);
        // Virar ou deixar de ser transferência numa edição deixaria uma ponta
        // sem a outra: a conta de destino nunca recebia o dinheiro.
        if ((existing.transferId != null) !== (input.kind === "transfer")) {
          throw new LedgerError(
            existing.transferId != null
              ? "Transferencia continua transferencia: exclua e lance de novo para mudar o tipo"
              : "Para virar transferencia, o lancamento precisa de conta de destino"
          );
        }
        if (existing.transferId != null && input.accountId !== existing.accountId) {
          const otherId = existing.fromEntryId === id ? existing.toEntryId : existing.fromEntryId;
          const other = db
            .prepare("SELECT account_id AS accountId FROM entries WHERE id = ?")
            .get(otherId) as { accountId: number } | undefined;
          if (other?.accountId === input.accountId) {
            throw new LedgerError(
              "Origem e destino da transferencia precisam ser contas diferentes"
            );
          }
        }
        // O desconto de antecipacao e da antecipacao: nasce e morre com ela.
        if (existing.isDiscount) {
          throw new LedgerError(
            "Desconto de antecipacao nao se edita: restaure a parcela para desfazer"
          );
        }

        // Campo ausente e "nao mexa", nao "apague": um formulario que nao
        // conhece o vinculo de estorno ou a fatura escolhida nao pode zera-los.
        const refundOfEntryId =
          input.refundOfEntryId === undefined ? existing.refundOfEntryId : input.refundOfEntryId;
        const statementMonth =
          input.statementMonth === undefined
            ? keptStatementMonth(existing, input.accountId)
            : input.statementMonth;
        const draft = { ...input, refundOfEntryId, statementMonth };
        if (refundOfEntryId != null) assertRefundFits(refundOfEntryId, id, draft.amountCents);

        const defaults = resolveAccountDefaults(draft);
        const amount = normalizeAmount(draft);
        if (input.accountId !== existing.accountId || amount <= 0) rehomeAllocations([id]);

        // Re-derivar em toda edicao apagaria a excecao manual do usuario numa
        // simples troca de descricao. So o que muda o resultado de 6.4 —
        // `kind` e `refund_of_entry_id` — dispara a re-derivacao.
        const flagInputsChanged =
          input.kind !== existing.kind || refundOfEntryId !== existing.refundOfEntryId;
        const previousFlag = fromBit(existing.countsTowardTarget);
        const derivedFlag = deriveCountsTowardTarget({
          kind: input.kind,
          amountCents: amount,
          transferPurpose: existing.transferPurpose,
          refundOfEntryId
        });
        const nextFlag =
          input.countsTowardTarget ?? (flagInputsChanged ? derivedFlag : previousFlag);
        const targetFlagReset = flagInputsChanged && nextFlag !== previousFlag;

        db.prepare(
          `UPDATE entries SET account_id=@accountId, person_id=@personId, date=@date,
           amount_cents=@amountCents, kind=@kind, status=@status, category_id=@categoryId,
           place_id=@placeId, description=@description, notes=@notes,
           payment_method=@paymentMethod, statement_month=@statementMonth,
           refund_of_entry_id=@refundOfEntryId, counts_toward_target=@countsTowardTarget,
           updated_at=@updatedAt
           WHERE id=@id`
        ).run({
          id,
          accountId: input.accountId,
          personId: defaults.personId,
          date: input.date,
          amountCents: amount,
          kind: input.kind,
          status: input.status ?? "cleared",
          categoryId: input.kind === "transfer" ? null : (input.categoryId ?? null),
          placeId: input.placeId ?? null,
          description: input.description ?? null,
          notes: input.notes ?? null,
          paymentMethod:
            input.paymentMethod ?? (defaults.accountKind === "credit_card" ? "credit" : null),
          statementMonth: defaults.statementMonth,
          refundOfEntryId,
          countsTowardTarget: nextFlag ? 1 : 0,
          updatedAt: nowIso()
        });
        replaceTags(id, input.tagIds);

        if (existing.transferId != null) {
          const otherId = existing.fromEntryId === id ? existing.toEntryId : existing.fromEntryId;
          if (otherId != null) {
            db.prepare(
              `UPDATE entries SET date = ?, amount_cents = ?, status = ?, description = ?,
               updated_at = ? WHERE id = ?`
            ).run(
              input.date,
              -amount,
              input.status ?? "cleared",
              input.description ?? null,
              nowIso(),
              otherId
            );
          }
        }
        return { changes: 1, targetFlagReset };
      })(),

    /** Unica porta da excecao manual de 6.4: nao toca em mais nada. */
    setCountsTowardTarget: (id: number, value: boolean): number => {
      const changes = db
        .prepare("UPDATE entries SET counts_toward_target = ?, updated_at = ? WHERE id = ?")
        .run(value ? 1 : 0, nowIso(), id).changes;
      if (changes === 0) throw notFound("Lancamento");
      return changes;
    },

    /** Remover uma ponta remove a outra e a linha de `transfers`, em cascata. */
    remove: (id: number): number =>
      db.transaction(() => {
        assertNotOperationCash(id);
        const transfer = db
          .prepare(
            `SELECT id, from_entry_id AS fromEntryId, to_entry_id AS toEntryId
             FROM transfers WHERE from_entry_id = ? OR to_entry_id = ?`
          )
          .get(id, id) as { id: number; fromEntryId: number; toEntryId: number } | undefined;

        if (transfer) {
          // A transferencia de uma operacao de investimento pertence a operacao:
          // apaga-la daqui deixaria a operacao apontando para o nada.
          const linked = db
            .prepare("SELECT 1 FROM operation_transfers WHERE transfer_id = ?")
            .get(transfer.id);
          if (linked) {
            throw new LedgerError(
              "Transferencia criada por uma operacao de investimento: edite ou exclua a operacao"
            );
          }
          rehomeAllocations([transfer.fromEntryId, transfer.toEntryId]);
          db.prepare("DELETE FROM transfers WHERE id = ?").run(transfer.id);
          db.prepare("DELETE FROM entries WHERE id IN (?, ?)").run(
            transfer.fromEntryId,
            transfer.toEntryId
          );
          return 2;
        }
        // Excluir o original deixando o estorno orfao apagaria o vinculo que
        // explica por que a categoria ficou negativa (6.6).
        const refunds = (
          db.prepare("SELECT COUNT(*) AS n FROM entries WHERE refund_of_entry_id = ?").get(id) as {
            n: number;
          }
        ).n;
        if (refunds > 0) {
          throw new LedgerError("Remova antes o estorno deste lancamento");
        }

        rehomeAllocations([id]);
        const changes = db.prepare("DELETE FROM entries WHERE id = ?").run(id).changes;
        if (changes === 0) throw notFound("Lancamento");
        return changes;
      })(),

    /** Marca em lote, usado pelos botoes de conciliacao da listagem. */
    setStatus: (ids: number[], status: "pending" | "cleared" | "reconciled"): number => {
      if (ids.length === 0) return 0;
      // A outra ponta de uma transferência muda junto: com status diferentes,
      // o dinheiro saía de uma conta (ou voltava) sem a outra acompanhar.
      const marks = ids.map(() => "?").join(",");
      const legs = db
        .prepare(
          `SELECT from_entry_id AS a, to_entry_id AS b FROM transfers
           WHERE from_entry_id IN (${marks}) OR to_entry_id IN (${marks})`
        )
        .all(...ids, ...ids) as { a: number; b: number }[];
      const all = [...new Set([...ids, ...legs.flatMap((leg) => [leg.a, leg.b])])];
      return db
        .prepare(
          `UPDATE entries SET status = ?, updated_at = ?
           WHERE id IN (${all.map(() => "?").join(",")})`
        )
        .run(status, nowIso(), ...all).changes;
    },

    /** Linhas cruas de um filtro, sem paginacao — usado pela exportacao CSV. */
    listAll: (filter: Partial<EntryFilter> = {}): EntryRecord[] => {
      const { where, params } = buildWhere(filter);
      const rows = db
        .prepare(
          `SELECT ${SELECT_COLUMNS} ${FROM_JOINS} ${where}
           GROUP BY e.id ORDER BY e.date DESC, e.id DESC`
        )
        .all(params) as EntryRow[];
      return repository.hydrate(rows);
    }
  };

  return repository;
}

function tableExists(db: Db, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name)
  );
}
