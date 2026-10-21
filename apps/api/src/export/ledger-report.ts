import type { AccountKind, EntryRecord } from "@projeto41/contracts";
import type { AppDatabase } from "@projeto41/db";
import { categoryTotals, distributeShares, type Range } from "@projeto41/finance";

/**
 * Os numeros do relatorio em PDF, montados antes de qualquer desenho.
 *
 * Nenhuma soma nova: os totais por categoria vem do mesmo `totalsByCategory`
 * da tela Relatorios, a fatura do mesmo `statements.list` da tela Fatura, e o
 * resto e a soma direta dos lancamentos do periodo.
 */

export type ReportCategory = {
  name: string;
  color: string | null;
  cents: number;
  /** Participacao em milesimos, pelo maior resto: a soma da exatamente 100%. */
  sharePerMille: number;
};

export type ReportAccount = {
  id: number;
  name: string;
  kind: AccountKind;
  color: string | null;
  isCard: boolean;
  /** Contas do dia a dia, cartoes, e caixinhas/investimentos — nessa ordem. */
  group: "accounts" | "cards" | "savings";
  incomeCents: number;
  /** Negativo, como no livro. */
  expenseCents: number;
  /** Saldo das transferencias do periodo (entra positivo, sai negativo). */
  transfersCents: number;
  /** So cartao: compras das faturas com vencimento no periodo. */
  invoiceCents: number | null;
  entries: EntryRecord[];
};

export type LedgerReport = {
  range: Range;
  generatedAt: string;
  totals: { incomeCents: number; expenseCents: number; netCents: number; invoiceCents: number };
  accounts: ReportAccount[];
  expenseCategories: ReportCategory[];
  incomeCategories: ReportCategory[];
};

function categoriesOf(db: AppDatabase, range: Range, kind: "income" | "expense") {
  const rows = categoryTotals(db.ledger.reports.totalsByCategory(range, { kind }), { range }).filter(
    (row) => row.spentCents > 0
  );
  // Cada categoria e uma fatia, com a mesma cor na pizza e na legenda: agrupar
  // as pequenas em "Outras" esconderia valores que o relatorio deve mostrar.
  const shares = distributeShares(rows.map((row) => row.spentCents));
  return rows.map((row, index) => ({
    name: row.name,
    color: row.color,
    cents: row.spentCents,
    sharePerMille: shares[index] ?? 0
  }));
}

const monthOf = (iso: string) => iso.slice(0, 7);

export function collectLedgerReport(db: AppDatabase, range: Range, generatedAt: string): LedgerReport {
  const entries = db.ledger.entries
    .listAll({ from: range.from, to: range.to, includeTransfers: true })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const byAccount = new Map<number, EntryRecord[]>();
  for (const entry of entries) {
    byAccount.set(entry.accountId, [...(byAccount.get(entry.accountId) ?? []), entry]);
  }

  const accounts: ReportAccount[] = [];
  // Arquivada entra: o que ela movimentou no período aconteceu, e as categorias
  // (que não filtram conta) já o contam. Sem ela os totais não fechavam com a pizza.
  for (const account of db.ledger.accounts.list({ includeArchived: true })) {
    const rows = byAccount.get(account.id) ?? [];
    const isCard = account.kind === "credit_card";
    let invoiceCents: number | null = null;
    if (isCard) {
      invoiceCents = db.ledger.statements
        .list(account.id, { from: monthOf(range.from), to: monthOf(range.to) })
        .filter((statement) => statement.month >= monthOf(range.from) && statement.month <= monthOf(range.to))
        .reduce((sum, statement) => sum + statement.purchasesCents, 0);
    }
    // Conta sem movimento e sem fatura no periodo nao ocupa espaco no relatorio.
    if (rows.length === 0 && !invoiceCents) continue;
    const sum = (kind: EntryRecord["kind"]) =>
      rows.filter((row) => row.kind === kind).reduce((total, row) => total + row.amountCents, 0);
    accounts.push({
      id: account.id,
      name: account.name,
      kind: account.kind,
      color: account.color ?? null,
      isCard,
      group: isCard ? "cards" : account.kind === "goal" || account.kind === "investment" ? "savings" : "accounts",
      incomeCents: sum("income"),
      expenseCents: sum("expense"),
      transfersCents: sum("transfer"),
      invoiceCents,
      entries: rows
    });
  }
  // Contas, cartoes, caixinhas; dentro de cada grupo, pelo nome.
  const order = { accounts: 0, cards: 1, savings: 2 };
  accounts.sort((a, b) => order[a.group] - order[b.group] || a.name.localeCompare(b.name, "pt-BR"));


  const incomeCents = accounts.reduce((sum, account) => sum + account.incomeCents, 0);
  const expenseCents = accounts.reduce((sum, account) => sum + account.expenseCents, 0);

  return {
    range,
    generatedAt,
    totals: {
      incomeCents,
      expenseCents,
      netCents: incomeCents + expenseCents,
      invoiceCents: accounts.reduce((sum, account) => sum + (account.invoiceCents ?? 0), 0)
    },
    accounts,
    expenseCategories: categoriesOf(db, range, "expense"),
    incomeCategories: categoriesOf(db, range, "income")
  };
}
