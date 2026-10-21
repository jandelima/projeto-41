import type { Migration } from "./runner.js";

/**
 * Alvos do periodo (plano mestre 4.3).
 *
 * `total_expense_target_cents` preenche uma lacuna do plano mestre: os modos
 * `none` e `income_proportional` de 6.4 precisam de um teto de gasto do periodo
 * inteiro, e a secao 4.3 nao nomeia a coluna que o guarda.
 *
 * `split_mode` ja nasce com o CHECK completo para que nenhuma fase futura
 * precise de `rebuildTable` (R-01).
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS budget_periods (
    period TEXT PRIMARY KEY,
    split_mode TEXT NOT NULL DEFAULT 'none'
      CHECK(split_mode IN ('none','income_proportional','pooled')),
    total_expense_target_cents INTEGER,
    pooled_income_cents INTEGER,
    joint_expense_target_cents INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS person_period_budgets (
    person_id INTEGER NOT NULL REFERENCES people(id),
    period TEXT NOT NULL,
    income_override_cents INTEGER,
    target_override_cents INTEGER,
    PRIMARY KEY(person_id, period)
  );
`;

/**
 * Backfill de `entries.counts_toward_target` pela regra de 6.4.
 *
 * A coluna existe desde a fase 1, mas ate aqui era preenchida por uma
 * aproximacao (`kind = 'expense'`). Este UPDATE reescreve todas as linhas com a
 * derivacao completa, que precisa do `purpose` da transferencia — por isso o
 * LEFT JOIN em `transfers`.
 */
const BACKFILL = `
  UPDATE entries SET counts_toward_target = (
    CASE
      WHEN entries.refund_of_entry_id IS NOT NULL THEN 1
      WHEN entries.kind = 'expense' THEN 1
      WHEN entries.kind = 'transfer' AND entries.amount_cents < 0 AND EXISTS (
        SELECT 1 FROM transfers t
        WHERE (t.from_entry_id = entries.id OR t.to_entry_id = entries.id)
          AND t.purpose = 'goal_deposit'
      ) THEN 1
      ELSE 0
    END
  )
`;

export const migration003BudgetTargets: Migration = {
  version: 3,
  name: "budget-targets",
  up: (db) => {
    db.exec(SCHEMA);
    db.exec(BACKFILL);
  }
};
