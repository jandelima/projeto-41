import type { DeclaredTotal, ParsedRow, ParseWarning, StatementAdapter } from "../adapter.js";
import { PdfParseError } from "../errors.js";
import {
  assignToColumns,
  detectColumns,
  groupIntoLines,
  mergeContinuationLines,
  type ColumnSpec,
  type Line
} from "../layout.js";
import { normalizeDescription, parseAmountBR, parseDateBR, parseTimeBR } from "../parse-br.js";
import type { PdfItem, PdfPage } from "../text-layer.js";

/**
 * Extrato de conta corrente do BTG Pactual, layout de 2026-10.
 *
 * O que o layout tem, e como e tratado:
 *
 * - toda pagina repete o cabecalho do cliente (nome, CPF, conta) e o da tabela;
 * - cada lancamento e uma linha com data e hora (`28/09/2026 11h27`); categoria
 *   e transacao longas quebram em duas linhas impressas centradas nela;
 * - **toda saida vem com `-R$`**, e entrada vem sem sinal. O sinal e dado pelo
 *   layout, e a conciliacao por dia confere essa premissa: um sinal lido errado
 *   aparece como diferenca do dobro do valor naquele dia;
 * - `Saldo Diario` fecha cada dia com movimento. A diferenca entre dois saldos
 *   seguidos e o movimento declarado do dia — o eixo de conciliacao;
 * - `Saldo atual` no topo e o saldo final do periodo;
 * - nao ha saldo anterior: o primeiro dia com movimento nao tem conferencia, e
 *   isso vira aviso, nunca suposicao.
 */

type Key = "date" | "category" | "transaction" | "description" | "amount";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "date", label: "Data e hora", align: "left" },
  { key: "category", label: "Categoria", align: "left" },
  { key: "transaction", label: "Transação", align: "left" },
  { key: "description", label: "Descrição", align: "left" },
  { key: "amount", label: "Valor", align: "right" }
];

const DATE_TIME = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}h\d{2})$/;
const FOOTER = /^(Ouvidoria|©\s*BTG)/;

const BASE_CONFIDENCE = 0.9;

function allText(page: PdfPage) {
  return page.items.map((item) => item.text).join(" ");
}

function headerLine(lines: Line[]): Line | undefined {
  return lines.find((line) =>
    COLUMNS.every((column) => line.items.some((item) => item.text.trim() === column.label))
  );
}

/** O item a direita de um rotulo, na mesma linha. */
function valueAfter(lines: Line[], label: string): string | null {
  for (const line of lines) {
    const index = line.items.findIndex((item) => item.text.trim() === label);
    if (index >= 0) return line.items.slice(index + 1).map((item) => item.text.trim()).join(" ") || null;
  }
  return null;
}

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function brDate(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export const btgStatementAdapter: StatementAdapter = {
  id: "btg-extrato",
  label: "BTG Pactual — extrato de conta corrente",
  kind: "statement",
  layoutVersion: "2026-10",

  detect(pages) {
    const first = pages[0];
    if (!first) return 0;
    const text = allText(first);
    let score = 0;
    if (text.includes("Extrato de conta corrente")) score += 0.3;
    if (/BTG Pactual/i.test(pages.map(allText).join(" "))) score += 0.4;
    if (headerLine(groupIntoLines(first.items))) score += 0.3;
    return Math.round(score * 100) / 100;
  },

  parse(pages) {
    const warnings: ParseWarning[] = [];
    const rows: ParsedRow[] = [];
    const balances: { date: string; cents: number }[] = [];

    const firstLines = groupIntoLines(pages[0]?.items ?? []);
    const period = valueAfter(firstLines, "Período do extrato:");
    const periodMatch = period ? /^(\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})$/.exec(period) : null;
    const periodStart = periodMatch ? parseDateBR(periodMatch[1]!) : null;
    const periodEnd = periodMatch ? parseDateBR(periodMatch[2]!) : null;
    if (!periodEnd) {
      throw new PdfParseError(
        "pdf_parse_failed",
        "Nao achei o periodo do extrato no PDF; sem ele as datas nao sao confiaveis."
      );
    }
    const closing = parseAmountBR(valueAfter(firstLines, "Saldo atual") ?? "");

    for (const page of pages) {
      const lines = groupIntoLines(page.items);
      const header = headerLine(lines);
      if (!header) continue;
      const footerTop =
        page.items
          .filter((item) => FOOTER.test(item.text.trim()))
          .map((item) => item.yTop)
          .sort((a, b) => a - b)[0] ?? Infinity;
      const table = page.items.filter(
        (item) => item.yTop > header.yTop + header.items[0]!.fontHeight / 2 && item.yTop < footerTop
      );
      const columns = detectColumns(header, COLUMNS, table);
      if (!columns) continue;
      const dateEdge = columns.find((column) => column.key === "date")!.edge;
      const isAnchor = (item: PdfItem) =>
        DATE_TIME.test(item.text.trim()) && Math.abs(item.x - dateEdge) <= 1.5;

      mergeContinuationLines(table, isAnchor).forEach((group, index) => {
        const sourceLine = index + 1;
        const { cells, ambiguous, wrapped } = assignToColumns(group.items, columns);
        const [, day, clock] = DATE_TIME.exec(cells.date)!;
        const date = parseDateBR(day!);
        const amount = parseAmountBR(cells.amount);
        if (!date || !amount) {
          warnings.push({
            code: "unreadable_row",
            message: `Pagina ${page.pageNumber}, linha ${sourceLine}: nao consegui ler data ou valor ("${cells.date}", "${cells.amount}").`,
            page: page.pageNumber,
            line: sourceLine
          });
          return;
        }
        if (normalizeDescription(cells.description) === "saldo diario") {
          balances.push({ date, cents: amount.cents });
          return;
        }
        let confidence = BASE_CONFIDENCE;
        if (ambiguous) confidence -= 0.3;
        if (wrapped) confidence -= 0.05;
        rows.push({
          date,
          time: parseTimeBR(clock!),
          rawDescription: cells.description,
          amountCents: amount.cents,
          // O layout marca toda saida com `-`: sem marcador e entrada, e a
          // conciliacao do dia confere.
          signKnown: true,
          installment: null,
          confidence: Math.round(confidence * 100) / 100,
          sourcePage: page.pageNumber,
          sourceLine,
          cells: {
            "Data e hora": cells.date,
            Categoria: cells.category,
            "Transação": cells.transaction,
            "Descrição": cells.description,
            Valor: cells.amount
          },
          trnType: cells.transaction || null
        });
        if (ambiguous) {
          warnings.push({
            code: "ambiguous_column",
            message: `Pagina ${page.pageNumber}, linha ${sourceLine}: texto entre duas colunas; confira.`,
            page: page.pageNumber,
            line: sourceLine
          });
        }
      });
    }

    // Conciliacao: o movimento de cada dia e a diferenca entre dois saldos
    // diarios seguidos; o saldo atual fecha o periodo.
    const declaredTotals: DeclaredTotal[] = [];
    balances.sort((a, b) => a.date.localeCompare(b.date));
    balances.forEach((balance, index) => {
      if (index === 0) return;
      const previous = balances[index - 1]!;
      declaredTotals.push({
        key: `saldo-${balance.date}`,
        label: `Saldo diário ${brDate(balance.date)}`,
        declaredCents: balance.cents - previous.cents,
        dateFrom: addDays(previous.date, 1),
        dateTo: balance.date
      });
    });
    const firstBalance = balances[0];
    if (firstBalance) {
      declaredTotals.push({
        key: "saldo-atual",
        label: "Saldo atual do extrato",
        declaredCents: closing ? closing.cents - firstBalance.cents : null,
        dateFrom: addDays(firstBalance.date, 1),
        dateTo: periodEnd
      });
      const unchecked = rows.filter((row) => row.date <= firstBalance.date).length;
      if (unchecked > 0) {
        warnings.push({
          code: "first_day_unchecked",
          message: `O extrato nao traz saldo anterior a ${brDate(firstBalance.date)}: os ${unchecked} lancamento(s) desse dia nao tem conferencia.`
        });
      }
    } else {
      declaredTotals.push({
        key: "saldo-atual",
        label: "Saldo atual do extrato",
        declaredCents: null,
        dateFrom: periodStart ?? periodEnd,
        dateTo: periodEnd
      });
    }

    const [year, month] = periodEnd.split("-").map(Number) as [number, number];
    return {
      adapterId: this.id,
      layoutVersion: this.layoutVersion,
      reference: { year, month },
      periodStart,
      periodEnd,
      closingBalanceCents: closing?.cents ?? null,
      declaredTotals,
      rows,
      warnings
    };
  }
};
