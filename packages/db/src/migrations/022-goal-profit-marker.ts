import type { Migration } from "./runner.js";

/**
 * O lucro da caixinha passa a ser marcado no lançamento, não lido do texto.
 *
 * Até aqui, rendimento, lucro lançado e ajuste de lucro eram reconhecidos por
 * `description LIKE 'Rendimento CDI%'` / `'Lucro%'` / `'Ajuste de lucro%'`. O
 * `LIKE` do SQLite ignora maiúsculas, então uma entrada "lucro da venda" virava
 * lucro; e renomear um rendimento o transformava em aporte. A coluna nova diz
 * de onde o lançamento veio:
 *
 * - `yield`: rendimento do CDI apurado pelo sistema;
 * - `profit`: lucro lançado pelo usuário;
 * - `profit_adjust`: ajuste do lucro total.
 *
 * O preenchimento olha só as contas próprias de caixinha e só os textos exatos
 * que o sistema grava (`GLOB` diferencia maiúsculas), para não marcar
 * lançamento que o usuário escreveu à mão.
 */
export const migration022GoalProfitMarker: Migration = {
  version: 22,
  name: "goal-profit-marker",
  up: (db) => {
    db.exec(`
      ALTER TABLE entries ADD COLUMN goal_profit TEXT
        CHECK (goal_profit IN ('yield', 'profit', 'profit_adjust'));
    `);
    backfillGoalProfit(db);
  }
};

/** Marca os lançamentos de lucro já gravados. Exportada para os testes da 019. */
export function backfillGoalProfit(db: Parameters<Migration["up"]>[0]) {
  db.exec(`
    UPDATE entries SET goal_profit = 'yield'
    WHERE kind = 'income' AND description GLOB 'Rendimento CDI*'
      AND account_id IN (SELECT account_id FROM goals WHERE mode = 'account' AND account_id IS NOT NULL);

    UPDATE entries SET goal_profit = 'profit'
    WHERE kind = 'income' AND (description GLOB 'Lucro · *' OR description = 'Lucro lançado')
      AND account_id IN (SELECT account_id FROM goals WHERE mode = 'account' AND account_id IS NOT NULL);

    UPDATE entries SET goal_profit = 'profit_adjust'
    WHERE kind = 'adjustment' AND description = 'Ajuste de lucro'
      AND account_id IN (SELECT account_id FROM goals WHERE mode = 'account' AND account_id IS NOT NULL);
  `);
}
