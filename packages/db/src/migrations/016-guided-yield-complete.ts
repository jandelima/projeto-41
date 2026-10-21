import type { Migration } from "./runner.js";

/**
 * Completa a 015 em bancos que a aplicaram numa versão anterior dela (a API
 * em modo de desenvolvimento recarrega a cada arquivo salvo). Cada passo só
 * roda se a peça ainda não existe: num banco que já tem a 015 inteira, nada
 * acontece.
 */
export const migration016GuidedYieldComplete: Migration = {
  version: 16,
  name: "guided-yield-complete",
  up: (db) => {
    const hasTable = (name: string) =>
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null;
    const hasColumn = (table: string, column: string) =>
      (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).some(
        (row) => row.name === column
      );

    if (hasTable("position_movements") && !hasColumn("position_movements", "target_value")) {
      db.exec("ALTER TABLE position_movements ADD COLUMN target_value REAL");
    }
    if (hasTable("goals")) {
      if (!hasColumn("goals", "cdi_accrued_through")) {
        db.exec("ALTER TABLE goals ADD COLUMN cdi_accrued_through TEXT");
      }
      if (!hasColumn("goals", "cdi_yield_cents")) {
        db.exec("ALTER TABLE goals ADD COLUMN cdi_yield_cents INTEGER NOT NULL DEFAULT 0");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS goal_corrections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          target_cents INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS goal_corrections_goal ON goal_corrections(goal_id, date);
      `);
    }
  }
};
