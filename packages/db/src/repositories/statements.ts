import type {
  AnticipationResult,
  EntryRecord,
  StatementStatus,
  StatementSummary
} from "@projeto41/contracts";
import {
  anticipationDiscounts,
  installmentStatementMonth,
  statementDatesFor,
  statementMonthFor,
  statementMonthsBetween,
  statementStatus,
  type AnticipationDiscountSpec
} from "@projeto41/finance";
import { createCardsRepository } from "./cards.js";
import { createEntriesRepository } from "./entries.js";
import { LedgerError, nowIso, today, type Db } from "./shared.js";

type InstallmentRow = {
  id: number;
  accountId: number;
  statementMonth: string | null;
  personId: number | null;
  categoryId: number | null;
  placeId: number | null;
  amountCents: number;
  description: string | null;
  installmentNumber: number | null;
  countsTowardTarget: number;
  refundOfEntryId: number | null;
};

/**
 * Fatura derivada (D22): nao existe tabela de fatura, so a consulta sobre
 * `entries.statement_month`.
 */
export function createStatementsRepository(db: Db) {
  const cards = createCardsRepository(db);
  const entries = createEntriesRepository(db);

  const isDiscount = db.prepare("SELECT 1 FROM anticipation_discounts WHERE entry_id = ?");

  function refundedCents(entryId: number): number {
    return (
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries WHERE refund_of_entry_id = ?"
        )
        .get(entryId) as { total: number }
    ).total;
  }

  function applyDiscounts(
    installments: InstallmentRow[],
    spec: AnticipationDiscountSpec,
    targetMonth: string,
    date: string
  ) {
    let discounts: number[];
    try {
      discounts = anticipationDiscounts(
        installments.map((row) => Math.abs(row.amountCents)),
        spec
      );
    } catch (error) {
      throw new LedgerError(error instanceof Error ? error.message : String(error));
    }
    const register = db.prepare(
      `INSERT INTO anticipation_discounts(entry_id, installment_entry_id, created_at)
       VALUES (?, ?, ?)`
    );
    const moveTo = db.prepare("UPDATE entries SET statement_month = ? WHERE id = ?");

    installments.forEach((row, index) => {
      const cents = discounts[index] ?? 0;
      if (cents <= 0) return;
      // Estorno e desconto somados nunca passam da parcela: o que sobrasse
      // seria credito inventado no cartao.
      if (refundedCents(row.id) + cents > Math.abs(row.amountCents)) {
        throw new LedgerError(
          `O desconto somado aos estornos passa do valor da parcela ${row.installmentNumber ?? row.id}`
        );
      }
      const label = row.description ?? "parcela";
      const number = row.installmentNumber != null ? ` ${row.installmentNumber}` : "";
      const id = entries.createInternal({
        accountId: row.accountId,
        personId: row.personId,
        date,
        amountCents: cents,
        kind: "expense",
        status: "cleared",
        categoryId: row.categoryId,
        placeId: row.placeId,
        description: `Desconto na antecipação · ${label}${number}`,
        refundOfEntryId: row.id,
        countsTowardTarget: row.countsTowardTarget === 1,
        tagIds: []
      });
      // O desconto aparece na mesma fatura para onde a parcela foi, nao na do
      // dia em que foi lancado.
      moveTo.run(targetMonth, id);
      register.run(id, row.id, nowIso());
    });
  }

  /**
   * A fatura em que o lancamento cairia sem antecipacao. Parcela segue o plano
   * (uma por fatura a partir da compra), e nao a propria data: com fechamento
   * no dia 28-31 as duas regras divergem e a parcela parecia antecipada.
   */
  function naturalMonthOf(row: {
    date: string;
    accountId: number;
    installmentPlanId: number | null;
    installmentNumber: number | null;
  }): string {
    const cycle = cards.cycle(row.accountId);
    if (row.installmentPlanId != null && row.installmentNumber != null) {
      const plan = db
        .prepare("SELECT purchase_date AS purchaseDate FROM installment_plans WHERE id = ?")
        .get(row.installmentPlanId) as { purchaseDate: string } | undefined;
      if (plan) {
        return installmentStatementMonth(
          plan.purchaseDate,
          row.installmentNumber,
          cycle.closingDay,
          cycle.dueDay
        );
      }
    }
    return statementMonthFor(row.date, cycle.closingDay, cycle.dueDay);
  }

  const NATURAL_COLUMNS = `e.date, e.account_id AS accountId, e.statement_month AS statementMonth,
    e.installment_plan_id AS installmentPlanId, e.installment_number AS installmentNumber`;

  /** Meses que precisam aparecer na navegacao, incluindo os futuros com parcela. */
  function monthsFor(accountId: number, asOf: string, range?: { from?: string; to?: string }) {
    const cycle = cards.cycle(accountId);
    const current = statementMonthFor(asOf, cycle.closingDay, cycle.dueDay);

    const stored = (
      db
        .prepare(
          `SELECT DISTINCT statement_month AS month FROM entries
           WHERE account_id = ? AND statement_month IS NOT NULL`
        )
        .all(accountId) as { month: string }[]
    ).map((row) => row.month);

    // A fatura corrente aparece mesmo vazia; as futuras aparecem porque ja
    // contem parcela, e omiti-las esconderia dinheiro comprometido.
    const months = new Set([...stored, current]);
    if (range?.from && range?.to) {
      for (const month of statementMonthsBetween(range.from, range.to)) months.add(month);
    }
    // Sem buracos entre a primeira e a última: a navegação anda mês a mês, e
    // um mês sem compra ainda é uma fatura (zerada) que se quer poder ver.
    const sorted = [...months].sort();
    for (const month of statementMonthsBetween(sorted[0]!, sorted[sorted.length - 1]!)) {
      months.add(month);
    }
    return { cycle, current, months: [...months].sort() };
  }

  function totalsFor(accountId: number, month: string) {
    return db
      .prepare(
        `SELECT
           -COALESCE(SUM(CASE WHEN t.purpose IS NULL OR t.purpose <> 'invoice_payment'
                              THEN e.amount_cents END), 0) AS purchasesCents,
           COALESCE(SUM(CASE WHEN t.purpose = 'invoice_payment'
                             THEN e.amount_cents END), 0) AS paymentsCents,
           -COALESCE(SUM(e.amount_cents), 0) AS totalCents,
           COUNT(*) AS entryCount,
           SUM(CASE WHEN t.purpose = 'invoice_payment' THEN 1 ELSE 0 END) AS paymentCount
         FROM entries e
         LEFT JOIN transfers t ON t.from_entry_id = e.id OR t.to_entry_id = e.id
         WHERE e.account_id = @accountId AND e.statement_month = @month`
      )
      .get({ accountId, month }) as {
      purchasesCents: number;
      paymentsCents: number;
      totalCents: number;
      entryCount: number;
      paymentCount: number;
    };
  }

  const repository = {
    list: (
      accountId: number,
      options: { from?: string; to?: string; asOf?: string } = {}
    ): StatementSummary[] => {
      const asOf = options.asOf ?? today();
      const { cycle, current, months } = monthsFor(accountId, asOf, options);

      return months.map((month) => {
        const dates = statementDatesFor(month, cycle.closingDay, cycle.dueDay);
        const totals = totalsFor(accountId, month);
        const status: StatementStatus = statementStatus({
          today: asOf,
          closingDate: dates.closingDate,
          dueDate: dates.dueDate,
          totalCents: totals.totalCents,
          hasPayment: totals.paymentCount > 0
        });
        return {
          month,
          ...dates,
          purchasesCents: totals.purchasesCents,
          paymentsCents: totals.paymentsCents,
          totalCents: totals.totalCents,
          entryCount: totals.entryCount,
          status,
          isFuture: month > current
        };
      });
    },

    get: (accountId: number, month: string, asOf: string = today()) => {
      const cycle = cards.cycle(accountId);
      const dates = statementDatesFor(month, cycle.closingDay, cycle.dueDay);
      const rows = entries.listAll({ accountId, statementMonth: month, pageSize: 500 });

      // Pagamento nunca se mistura as compras: ele e transferencia, nao gasto.
      const payments = rows.filter((row) => row.transferPurpose === "invoice_payment");
      const purchases = rows.filter((row) => row.transferPurpose !== "invoice_payment");
      const totals = totalsFor(accountId, month);

      return {
        month,
        accountId,
        accountName: cycle.name,
        ...dates,
        purchases: sortEntries(purchases),
        payments: sortEntries(payments),
        // Desconto e estorno nao sao parcela: saem junto com a parcela a que
        // pertencem, entao nunca aparecem como antecipados.
        anticipatedIds: purchases
          .filter(
            (row) =>
              row.statementMonth != null &&
              row.refundOfEntryId == null &&
              row.statementMonth !== naturalMonthOf(row)
          )
          .map((row) => row.id),
        purchasesCents: totals.purchasesCents,
        paymentsCents: totals.paymentsCents,
        totalCents: totals.totalCents,
        entryCount: totals.entryCount,
        status: statementStatus({
          today: asOf,
          closingDate: dates.closingDate,
          dueDate: dates.dueDate,
          totalCents: totals.totalCents,
          hasPayment: totals.paymentCount > 0
        })
      };
    },

    /**
     * Paga a fatura como transferencia `purpose='invoice_payment'` (D21, 6.2).
     * Registrar como despesa contaria o gasto duas vezes.
     */
    pay: (
      accountId: number,
      month: string,
      input: { date: string; fromAccountId?: number; amountCents: number }
    ) => {
      const cycle = cards.cycle(accountId);
      const totals = totalsFor(accountId, month);

      if (totals.totalCents <= 0) {
        throw new LedgerError("Fatura sem saldo devedor para pagar");
      }
      // Pagamento parcial e rotativo estao fora de escopo em definitivo (D12).
      if (input.amountCents !== totals.totalCents) {
        throw new LedgerError(
          "Pagamento parcial esta fora de escopo: informe o valor total da fatura"
        );
      }

      const fromAccountId = input.fromAccountId ?? cycle.paymentAccountId;
      if (fromAccountId == null) {
        throw new LedgerError("Informe a conta de onde sai o pagamento");
      }
      if (fromAccountId === accountId) {
        throw new LedgerError("A fatura nao pode ser paga pelo proprio cartao");
      }
      const source = db.prepare("SELECT kind FROM accounts WHERE id = ?").get(fromAccountId) as
        | { kind: string }
        | undefined;
      if (!source) throw new LedgerError("Conta de pagamento nao encontrada", 404);
      if (source.kind === "credit_card") {
        throw new LedgerError("Nao da para pagar uma fatura com outro cartao");
      }

      return db.transaction(() => {
        const result = entries.createTransfer({
          fromAccountId,
          toAccountId: accountId,
          date: input.date,
          amountCents: input.amountCents,
          purpose: "invoice_payment",
          description: `Pagamento da fatura ${month}`,
          // A ponta do cartao recebe o mes EXPLICITAMENTE. O pagamento acontece
          // perto do vencimento, que normalmente ja e depois do fechamento
          // seguinte: o calculo natural o jogaria na fatura errada.
          statementMonth: month
        });
        return { ...result, month };
      })();
    },

    undoPayment: (transferId: number) => {
      const transfer = db
        .prepare("SELECT from_entry_id AS fromEntryId FROM transfers WHERE id = ?")
        .get(transferId) as { fromEntryId: number } | undefined;
      if (!transfer) throw new LedgerError("Pagamento nao encontrado", 404);
      entries.remove(transfer.fromEntryId);
      return { ok: true as const };
    },

    /**
     * Antecipacao: reescreve so o `statement_month`. **`date` nao muda** — a
     * data do fato e a da compra; o que se move e a fatura.
     *
     * Com desconto, cada parcela ganha um abatimento colado a ela: lancamento
     * de sinal oposto com `refund_of_entry_id` na parcela, na fatura de destino,
     * registrado em `anticipation_discounts`. Abate a categoria pela soma
     * natural, como o estorno (6.6), e sai junto se a parcela for restaurada.
     */
    anticipate: (
      accountId: number,
      input: {
        entryIds: number[];
        targetMonth: string;
        discount?: AnticipationDiscountSpec | null;
        date?: string;
      }
    ): AnticipationResult => {
      const cycle = cards.cycle(accountId);
      const targetDates = statementDatesFor(input.targetMonth, cycle.closingDay, cycle.dueDay);
      if (!targetDates.closingDate) throw new LedgerError("Fatura de destino invalida");

      const targetTotals = totalsFor(accountId, input.targetMonth);
      if (targetTotals.paymentCount > 0 && targetTotals.totalCents === 0) {
        throw new LedgerError("Nao da para antecipar para uma fatura ja paga");
      }

      return db.transaction((): AnticipationResult => {
        const result: AnticipationResult = [];
        const moved: InstallmentRow[] = [];
        for (const entryId of input.entryIds) {
          const row = db
            .prepare(
              `SELECT id, account_id AS accountId, statement_month AS statementMonth,
                      person_id AS personId, category_id AS categoryId, place_id AS placeId,
                      amount_cents AS amountCents, description,
                      installment_number AS installmentNumber,
                      counts_toward_target AS countsTowardTarget,
                      refund_of_entry_id AS refundOfEntryId
               FROM entries WHERE id = ?`
            )
            .get(entryId) as InstallmentRow | undefined;
          if (!row) throw new LedgerError(`Lancamento ${entryId} nao encontrado`, 404);
          if (row.refundOfEntryId != null) {
            throw new LedgerError(`Lancamento ${entryId} e um abatimento, nao uma parcela`);
          }
          if (row.accountId !== accountId) {
            throw new LedgerError(`Lancamento ${entryId} nao pertence a este cartao`);
          }
          if (row.statementMonth) {
            const origin = totalsFor(accountId, row.statementMonth);
            if (origin.paymentCount > 0 && origin.totalCents === 0) {
              throw new LedgerError(`Lancamento ${entryId} esta numa fatura ja paga`);
            }
          }

          db.prepare(
            "UPDATE entries SET statement_month = ?, updated_at = ? WHERE id = ?"
          ).run(input.targetMonth, nowIso(), entryId);
          result.push({ entryId, previousStatementMonth: row.statementMonth });
          moved.push(row);
        }

        if (input.discount) {
          applyDiscounts(moved, input.discount, input.targetMonth, input.date ?? today());
        }
        return result;
      })();
    },

    /**
     * Desfaz a antecipacao recalculando o mes natural: o da serie, na parcela;
     * o de `date`, no resto.
     *
     * Nao existe tabela de historico nem coluna nova: como `date` e o plano
     * nunca mudam, o natural e sempre recuperavel. Um lancamento esta antecipado quando o mes
     * armazenado difere do natural.
     *
     * Ressalva registrada: se o usuario mudar `closing_day` depois de antecipar,
     * o natural muda junto e restaurar leva para o novo natural, nao para o
     * antigo. E o comportamento correto para um valor derivado da configuracao
     * atual, e existe teste documentando a escolha.
     */
    restoreNatural: (entryIds: number[]): AnticipationResult =>
      db.transaction((): AnticipationResult => {
        const result: AnticipationResult = [];
        for (const entryId of entryIds) {
          if (isDiscount.get(entryId)) {
            throw new LedgerError(
              `Lancamento ${entryId} e um desconto de antecipacao; restaure a parcela`
            );
          }
          const row = db
            .prepare(
              `SELECT e.id, e.kind, ${NATURAL_COLUMNS} FROM entries e WHERE e.id = ?`
            )
            .get(entryId) as
            | {
                id: number;
                kind: string;
                date: string;
                accountId: number;
                statementMonth: string | null;
                installmentPlanId: number | null;
                installmentNumber: number | null;
              }
            | undefined;
          if (!row) throw new LedgerError(`Lancamento ${entryId} nao encontrado`, 404);
          // Pagamento de fatura vai para o mes que pagou, nao para o da data.
          if (row.kind === "transfer") {
            throw new LedgerError(`Lancamento ${entryId} e um pagamento, nao uma compra`);
          }
          const natural = naturalMonthOf(row);
          db.prepare("UPDATE entries SET statement_month = ?, updated_at = ? WHERE id = ?").run(
            natural,
            nowIso(),
            entryId
          );
          // O desconto so existe porque a parcela foi antecipada: sem a
          // antecipacao ele seria credito sem motivo. Sai junto.
          db.prepare(
            `DELETE FROM entries WHERE id IN
               (SELECT entry_id FROM anticipation_discounts WHERE installment_entry_id = ?)`
          ).run(entryId);
          result.push({ entryId, previousStatementMonth: row.statementMonth });
        }
        return result;
      })(),

    /** Um lancamento esta antecipado quando o mes gravado difere do natural. */
    isAnticipated: (entryId: number): boolean => {
      const row = db
        .prepare(`SELECT e.kind, ${NATURAL_COLUMNS} FROM entries e WHERE e.id = ?`)
        .get(entryId) as
        | {
            kind: string;
            date: string;
            accountId: number;
            statementMonth: string | null;
            installmentPlanId: number | null;
            installmentNumber: number | null;
          }
        | undefined;
      if (!row || !row.statementMonth || row.kind === "transfer") return false;
      return row.statementMonth !== naturalMonthOf(row);
    }
  };

  return repository;
}

const sortEntries = (rows: EntryRecord[]) =>
  [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
