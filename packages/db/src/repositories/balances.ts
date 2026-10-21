import type { AccountKind, AccountRecord, BalancesResult } from "@projeto41/contracts";
import { monthOf, statementMonthFor } from "@projeto41/finance";
import { fromBit, today, type Db } from "./shared.js";

/**
 * Saldos derivados por SUM, nunca armazenados (D24).
 *
 * - saldo = saldo inicial + lancamentos ate hoje com status liquidado;
 * - consolidado = soma das contas com `include_in_net_worth`, **sem** cartao;
 * - cartao reporta dois numeros distintos: fatura do mes e total devido.
 *
 * **Nao existe mais "saldo previsto".** Ele somava o que estava `pending` mas
 * ignorava a fatura do cartao que ia sair da mesma conta, entao prometia um
 * numero que nao ia acontecer. O sistema mostra o que e fato — saldo e fatura,
 * lado a lado — e nao tenta adivinhar entradas e saidas futuras.
 */

type AccountBalanceRow = {
  id: number;
  personId: number | null;
  personName: string | null;
  name: string;
  kind: AccountKind;
  institution: string | null;
  color: string;
  icon: string | null;
  openingBalanceCents: number;
  openingDate: string | null;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: number | null;
  paymentAccountId: number | null;
  includeInNetWorth: number;
  archived: number;
  sortOrder: number;
  clearedCents: number;
  allCents: number;
  statementCents: number;
};

const BALANCE_SQL = `
  SELECT
    a.id,
    a.person_id AS personId,
    p.name AS personName,
    a.name,
    a.kind,
    a.institution,
    a.color,
    a.icon,
    a.opening_balance_cents AS openingBalanceCents,
    a.opening_date AS openingDate,
    a.closing_day AS closingDay,
    a.due_day AS dueDay,
    a.credit_limit_cents AS creditLimitCents,
    a.payment_account_id AS paymentAccountId,
    a.include_in_net_worth AS includeInNetWorth,
    a.archived,
    a.sort_order AS sortOrder,
    COALESCE(SUM(CASE WHEN e.status IN ('cleared','reconciled') AND e.date <= @asOf
                      THEN e.amount_cents END), 0) AS clearedCents,
    COALESCE(SUM(e.amount_cents), 0) AS allCents,
    COALESCE(SUM(CASE WHEN e.statement_month = @statementMonth
                      THEN e.amount_cents END), 0) AS statementCents,
    a.id AS accountId
  FROM accounts a
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN entries e ON e.account_id = a.id
  GROUP BY a.id
  ORDER BY a.archived, a.sort_order, a.id
`;

export type BalanceOptions = {
  /** Data de corte do saldo atual. Padrao: hoje. */
  asOf?: string;
  /** Mes da fatura a destacar nos cartoes. Padrao: o mes de `asOf`. */
  statementMonth?: string;
  includeArchived?: boolean;
};

function mapAccount(row: AccountBalanceRow, currentStatementCents?: number): AccountRecord {
  const isCard = row.kind === "credit_card";
  const currentBalanceCents = row.openingBalanceCents + row.clearedCents;

  const account: AccountRecord = {
    id: row.id,
    personId: row.personId,
    personName: row.personName,
    name: row.name,
    kind: row.kind,
    institution: row.institution,
    color: row.color,
    icon: row.icon,
    openingBalanceCents: row.openingBalanceCents,
    openingDate: row.openingDate,
    closingDay: row.closingDay,
    dueDay: row.dueDay,
    creditLimitCents: row.creditLimitCents,
    paymentAccountId: row.paymentAccountId,
    includeInNetWorth: fromBit(row.includeInNetWorth),
    archived: fromBit(row.archived),
    sortOrder: row.sortOrder,
    currentBalanceCents
  };

  if (isCard) {
    // Saldo devedor e positivo para leitura humana: os lancamentos do cartao
    // sao negativos, entao invertemos o sinal ao reportar.
    account.totalDueCents = -(row.openingBalanceCents + row.allCents);
    account.currentStatementCents = -(currentStatementCents ?? row.statementCents);
    account.availableLimitCents =
      row.creditLimitCents == null ? null : row.creditLimitCents - account.totalDueCents;
  }

  return account;
}

export function createBalancesRepository(db: Db) {
  const repository = {
    all: (options: BalanceOptions = {}): AccountRecord[] => {
      const asOf = options.asOf ?? today();
      const statementMonth = options.statementMonth ?? monthOf(asOf);
      const rows = db.prepare(BALANCE_SQL).all({ asOf, statementMonth }) as AccountBalanceRow[];

      // A fatura "atual" de um cartao e a do ciclo DELE, nunca o mes-calendario:
      // e a mesma definicao de `cards.summary`, e existir duas seria o comeco de
      // dois numeros diferentes na tela para a mesma coisa.
      const cardStatement = db.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries
         WHERE account_id = ? AND statement_month = ?`
      );
      const mapped = rows.map((row) => {
        if (row.kind !== "credit_card" || row.closingDay == null || row.dueDay == null) {
          return mapAccount(row);
        }
        const month = statementMonthFor(asOf, row.closingDay, row.dueDay);
        const total = (cardStatement.get(row.id, month) as { total: number }).total;
        return mapAccount(row, total);
      });
      return options.includeArchived ? mapped : mapped.filter((account) => !account.archived);
    },

    forAccount: (accountId: number, options: BalanceOptions = {}): AccountRecord | undefined =>
      repository
        .all({ ...options, includeArchived: true })
        .find((account) => account.id === accountId),

    /**
     * Saldo consolidado agrupado por `accounts.kind`, em centavos.
     *
     * Respeita 6.1 ao pe da letra: so `cleared`/`reconciled`, so `date <= hoje`,
     * so contas com `include_in_net_worth = 1`, e tudo derivado por SUM. E a
     * entrada do servico de patrimonio da fase 4.
     */
    byKind: (options: BalanceOptions = {}): Record<string, number> => {
      const accounts = repository
        .all({ ...options, includeArchived: false })
        .filter((account) => account.includeInNetWorth);
      const totals: Record<string, number> = {};
      for (const account of accounts) {
        totals[account.kind] = (totals[account.kind] ?? 0) + account.currentBalanceCents;
      }
      return totals;
    },

    /** Os dois numeros de 6.1, em centavos e **positivos**. Quem inverte o sinal
     * e o servico de patrimonio. */
    creditCardDebt: (options: BalanceOptions = {}) => {
      const cards = repository
        .all({ ...options, includeArchived: false })
        .filter((account) => account.kind === "credit_card");
      return {
        currentStatementCents: cards.reduce(
          (total, card) => total + (card.currentStatementCents ?? 0),
          0
        ),
        totalOwedCents: cards.reduce((total, card) => total + (card.totalDueCents ?? 0), 0)
      };
    },

    /**
     * Consolidado: soma das contas marcadas para patrimonio, **excluindo**
     * cartao. Cartao nao e saldo, e divida, e entra no relatorio proprio.
     */
    consolidated: (options: BalanceOptions = {}): BalancesResult => {
      const accounts = repository.all({ ...options, includeArchived: true });
      const visible = options.includeArchived
        ? accounts
        : accounts.filter((account) => !account.archived);

      // Os totais seguem `byKind`, que alimenta o Patrimonio: conta arquivada
      // fica fora dos dois. Somar aqui e nao la dava dois saldos para o mesmo
      // dinheiro, um no Painel e outro no Patrimonio.
      const active = accounts.filter((account) => !account.archived);
      const counted = active.filter(
        (account) => account.includeInNetWorth && account.kind !== "credit_card"
      );
      const cards = active.filter((account) => account.kind === "credit_card");

      return {
        accounts: visible,
        consolidatedCents: counted.reduce(
          (total, account) => total + account.currentBalanceCents,
          0
        ),
        creditCardStatementCents: cards.reduce(
          (total, account) => total + (account.currentStatementCents ?? 0),
          0
        ),
        creditCardDueCents: cards.reduce((total, account) => total + (account.totalDueCents ?? 0), 0)
      };
    }
  };

  return repository;
}
