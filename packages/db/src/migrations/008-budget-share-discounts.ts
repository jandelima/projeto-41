import type { Migration } from "./runner.js";

/**
 * Objetivo percentual por categoria, desconto de antecipacao e pessoas criadas
 * pelo usuario.
 *
 * **Objetivo em percentual.** Ate aqui o objetivo de uma categoria era so em
 * valor (`monthly_budget_cents`). `budget_share_per_mille` guarda a outra forma:
 * "Mercado deve ser 25% dos meus gastos". Os dois sao exclusivos — o contrato e
 * o repositorio garantem, porque um `CHECK` entre colunas nao pode entrar por
 * `ADD COLUMN` sem reconstruir `categories` inteira.
 *
 * **Desconto de antecipacao.** Antecipar parcela costuma vir com abatimento. O
 * desconto e um lancamento de sinal oposto com `refund_of_entry_id` apontando
 * para a parcela — abate a categoria pela soma natural, como o estorno (6.6).
 * `anticipation_discounts` so registra *quais* lancamentos sao desconto, para
 * que restaurar a parcela apague o desconto junto e a antecipacao continue
 * reversivel.
 *
 * **Pessoas.** Versoes anteriores semeavam tres pessoas fixas. O modulo agora
 * comeca vazio; aqui saem as semeadas que nunca foram usadas. Quem ja tem conta
 * ou lancamento fica, porque apagar historico nao e limpeza.
 */

const LEGACY_SEEDED_PEOPLE: [string, string][] = [
  ["Steylor", "individual"],
  ["Bianca", "individual"],
  ["Conjunto", "joint"]
];

export const migration008BudgetShareDiscounts: Migration = {
  version: 8,
  name: "budget-share-discounts",
  up: (db) => {
    const columns = (db.pragma("table_info(categories)") as { name: string }[]).map(
      (column) => column.name
    );
    if (!columns.includes("budget_share_per_mille")) {
      db.exec(`
        ALTER TABLE categories ADD COLUMN budget_share_per_mille INTEGER
          CHECK(budget_share_per_mille IS NULL OR
                (budget_share_per_mille >= 0 AND budget_share_per_mille <= 1000))
      `);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS anticipation_discounts (
        entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
        installment_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS anticipation_discounts_installment
        ON anticipation_discounts(installment_entry_id);
    `);

    const referenced = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM accounts WHERE person_id = @id) +
         (SELECT COUNT(*) FROM entries WHERE person_id = @id) +
         (SELECT COUNT(*) FROM person_period_budgets WHERE person_id = @id) AS n`
    );
    const find = db.prepare("SELECT id FROM people WHERE name = ? AND kind = ?");
    const remove = db.prepare("DELETE FROM people WHERE id = ?");
    for (const [name, kind] of LEGACY_SEEDED_PEOPLE) {
      const row = find.get(name, kind) as { id: number } | undefined;
      if (!row) continue;
      const { n } = referenced.get({ id: row.id }) as { n: number };
      if (n === 0) remove.run(row.id);
    }
  }
};
