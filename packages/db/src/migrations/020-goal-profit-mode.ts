import type { Migration } from "./runner.js";

/**
 * Como o lucro de uma caixinha entra: sozinho ou lançado pelo usuário.
 *
 * - `auto`: o rendimento do CDI é apurado e lançado todo dia, a partir do
 *   percentual do CDI da caixinha (comportamento que já existia);
 * - `manual`: nada entra sozinho. O usuário lança o lucro quando quiser, e pode
 *   ajustá-lo para o valor que o banco mostra.
 *
 * Caixinha que já rendia pelo CDI continua `auto`; a que não tinha percentual
 * nunca recebeu rendimento sozinha, então já era manual.
 */
export const migration020GoalProfitMode: Migration = {
  version: 20,
  name: "goal-profit-mode",
  up: (db) => {
    db.exec(
      `ALTER TABLE goals ADD COLUMN profit_mode TEXT NOT NULL DEFAULT 'auto'
         CHECK (profit_mode IN ('auto', 'manual'))`
    );
    db.exec("UPDATE goals SET profit_mode = 'manual' WHERE cdi_percent IS NULL");
  }
};
