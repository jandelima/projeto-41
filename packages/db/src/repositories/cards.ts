import type { CardSummary } from "@projeto41/contracts";
import { statementDatesFor, statementMonthFor } from "@projeto41/finance";
import { LedgerError, notFound, today, type Db } from "./shared.js";

/**
 * Resumo derivado do cartao.
 *
 * O cadastro continua sendo `accounts.create/update` (D04) — cartao e uma linha
 * de `accounts`, nao uma entidade paralela. Este repositorio so calcula o que e
 * derivado.
 */

type CardRow = {
  id: number;
  name: string;
  color: string;
  institution: string | null;
  personId: number | null;
  personName: string | null;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: number | null;
  paymentAccountId: number | null;
  paymentAccountName: string | null;
};

const SELECT_CARDS = `
  SELECT a.id, a.name, a.color, a.institution,
         a.person_id AS personId, p.name AS personName,
         a.closing_day AS closingDay, a.due_day AS dueDay,
         a.credit_limit_cents AS creditLimitCents,
         a.payment_account_id AS paymentAccountId,
         pay.name AS paymentAccountName
  FROM accounts a
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN accounts pay ON pay.id = a.payment_account_id
  WHERE a.kind = 'credit_card'
`;

export function createCardsRepository(db: Db) {
  function summaryOf(row: CardRow, asOf: string): CardSummary {
    if (row.closingDay == null || row.dueDay == null) {
      throw new LedgerError(`Cartao "${row.name}" esta sem ciclo configurado`);
    }

    // A fatura "atual" e aquela em que uma compra feita hoje cairia, ou seja, a
    // que esta aberta. Nenhuma outra camada pode inventar outra definicao.
    const currentStatementMonth = statementMonthFor(asOf, row.closingDay, row.dueDay);
    const dates = statementDatesFor(currentStatementMonth, row.closingDay, row.dueDay);

    const totals = db
      .prepare(
        `SELECT
           -COALESCE(SUM(CASE WHEN statement_month = @month THEN amount_cents END), 0)
             AS currentStatementCents,
           -COALESCE(SUM(amount_cents), 0) AS totalOwedCents
         FROM entries WHERE account_id = @accountId`
      )
      .get({ accountId: row.id, month: currentStatementMonth }) as {
      currentStatementCents: number;
      totalOwedCents: number;
    };

    // Limite considera lancamento `pending` e parcela futura: o banco bloqueia
    // limite na compra, nao na conciliacao.
    const usedCents = totals.totalOwedCents;

    return {
      id: row.id,
      name: row.name,
      color: row.color,
      institution: row.institution,
      personId: row.personId,
      personName: row.personName,
      closingDay: row.closingDay,
      dueDay: row.dueDay,
      creditLimitCents: row.creditLimitCents,
      paymentAccountId: row.paymentAccountId,
      paymentAccountName: row.paymentAccountName,
      currentStatementMonth,
      closingDate: dates.closingDate,
      dueDate: dates.dueDate,
      currentStatementCents: totals.currentStatementCents,
      totalOwedCents: totals.totalOwedCents,
      usedCents,
      // Sem limite cadastrado devolve null, nunca zero: zero significaria
      // "limite esgotado", que e outra coisa. Negativo e limite estourado, e o
      // calculo nao trunca — quem avisa e a interface.
      availableCents: row.creditLimitCents == null ? null : row.creditLimitCents - usedCents
    };
  }

  const repository = {
    list: (asOf: string = today()): CardSummary[] =>
      (db.prepare(`${SELECT_CARDS} AND a.archived = 0 ORDER BY a.sort_order, a.id`).all() as
        CardRow[]).map((row) => summaryOf(row, asOf)),

    summary: (accountId: number, asOf: string = today()): CardSummary => {
      const row = db.prepare(`${SELECT_CARDS} AND a.id = ?`).get(accountId) as CardRow | undefined;
      if (!row) throw notFound("Cartao");
      return summaryOf(row, asOf);
    },

    /** Ciclo cru do cartao, usado pelos repositorios de fatura e parcelamento. */
    cycle: (accountId: number) => {
      const row = db
        .prepare(
          `SELECT id, name, closing_day AS closingDay, due_day AS dueDay,
                  payment_account_id AS paymentAccountId, kind
           FROM accounts WHERE id = ?`
        )
        .get(accountId) as
        | {
            id: number;
            name: string;
            closingDay: number | null;
            dueDay: number | null;
            paymentAccountId: number | null;
            kind: string;
          }
        | undefined;
      if (!row) throw notFound("Conta");
      if (row.kind !== "credit_card") throw new LedgerError("A conta nao e um cartao de credito");
      if (row.closingDay == null || row.dueDay == null) {
        throw new LedgerError("Cartao sem ciclo configurado");
      }
      return { ...row, closingDay: row.closingDay, dueDay: row.dueDay };
    }
  };

  return repository;
}
