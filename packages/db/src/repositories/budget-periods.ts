import type { BudgetPeriodInput, PersonPeriodBudgetInput, SplitMode } from "@projeto41/contracts";
import { nowIso, type Db } from "./shared.js";

export type BudgetPeriodRow = {
  period: string;
  splitMode: SplitMode;
  totalExpenseTargetCents: number | null;
  pooledIncomeCents: number | null;
  jointExpenseTargetCents: number | null;
};

export type PersonPeriodBudgetRow = {
  personId: number;
  period: string;
  incomeOverrideCents: number | null;
  targetOverrideCents: number | null;
};

/** O mes nunca configurado le como padrao, sem virar linha no banco. */
const defaultsFor = (period: string): BudgetPeriodRow => ({
  period,
  splitMode: "none",
  totalExpenseTargetCents: null,
  pooledIncomeCents: null,
  jointExpenseTargetCents: null
});

export function createBudgetPeriodsRepository(db: Db) {
  const repository = {
    /**
     * Le a configuracao do periodo e os overrides por pessoa.
     *
     * Nenhum mes e pre-semeado e a leitura **nao** insere linha: abrir o
     * dashboard de um mes futuro nao deve criar registro nenhum.
     */
    get: (period: string) => {
      const row = db
        .prepare(
          `SELECT period, split_mode AS splitMode,
                  total_expense_target_cents AS totalExpenseTargetCents,
                  pooled_income_cents AS pooledIncomeCents,
                  joint_expense_target_cents AS jointExpenseTargetCents
           FROM budget_periods WHERE period = ?`
        )
        .get(period) as BudgetPeriodRow | undefined;

      const people = db
        .prepare(
          `SELECT person_id AS personId, period,
                  income_override_cents AS incomeOverrideCents,
                  target_override_cents AS targetOverrideCents
           FROM person_period_budgets WHERE period = ?`
        )
        .all(period) as PersonPeriodBudgetRow[];

      return { period: row ?? defaultsFor(period), people };
    },

    /**
     * Cria a linha sob demanda. `null` explicito **apaga** o valor; `undefined`
     * preserva o que ja estava la — e por isso cada campo checa `in` no objeto
     * em vez de usar `??`.
     */
    upsert: (period: string, input: BudgetPeriodInput) => {
      const timestamp = nowIso();
      const current = repository.get(period).period;
      const next = {
        period,
        splitMode: input.splitMode,
        totalExpenseTargetCents:
          "totalExpenseTargetCents" in input
            ? (input.totalExpenseTargetCents ?? null)
            : current.totalExpenseTargetCents,
        pooledIncomeCents:
          "pooledIncomeCents" in input
            ? (input.pooledIncomeCents ?? null)
            : current.pooledIncomeCents,
        jointExpenseTargetCents:
          "jointExpenseTargetCents" in input
            ? (input.jointExpenseTargetCents ?? null)
            : current.jointExpenseTargetCents
      };

      db.prepare(
        `INSERT INTO budget_periods
         (period, split_mode, total_expense_target_cents, pooled_income_cents,
          joint_expense_target_cents, created_at, updated_at)
         VALUES (@period, @splitMode, @totalExpenseTargetCents, @pooledIncomeCents,
                 @jointExpenseTargetCents, @timestamp, @timestamp)
         ON CONFLICT(period) DO UPDATE SET
           split_mode = excluded.split_mode,
           total_expense_target_cents = excluded.total_expense_target_cents,
           pooled_income_cents = excluded.pooled_income_cents,
           joint_expense_target_cents = excluded.joint_expense_target_cents,
           updated_at = excluded.updated_at`
      ).run({ ...next, timestamp });

      return next;
    },

    upsertPerson: (period: string, personId: number, input: PersonPeriodBudgetInput) => {
      const current = db
        .prepare(
          `SELECT income_override_cents AS incomeOverrideCents,
                  target_override_cents AS targetOverrideCents
           FROM person_period_budgets WHERE person_id = ? AND period = ?`
        )
        .get(personId, period) as
        | { incomeOverrideCents: number | null; targetOverrideCents: number | null }
        | undefined;

      const next = {
        personId,
        period,
        incomeOverrideCents:
          "incomeOverrideCents" in input
            ? (input.incomeOverrideCents ?? null)
            : (current?.incomeOverrideCents ?? null),
        targetOverrideCents:
          "targetOverrideCents" in input
            ? (input.targetOverrideCents ?? null)
            : (current?.targetOverrideCents ?? null)
      };

      db.prepare(
        `INSERT INTO person_period_budgets
         (person_id, period, income_override_cents, target_override_cents)
         VALUES (@personId, @period, @incomeOverrideCents, @targetOverrideCents)
         ON CONFLICT(person_id, period) DO UPDATE SET
           income_override_cents = excluded.income_override_cents,
           target_override_cents = excluded.target_override_cents`
      ).run(next);

      return next;
    }
  };

  return repository;
}
