import { rebuildTable, type Migration } from "./runner.js";

/**
 * Caixinha de marcação também rende CDI.
 *
 * O dinheiro marcado continua na conta, e muitas contas (Nubank, BTG) pagam
 * CDI sobre o saldo. O rendimento da marcação é creditado na conta marcada e
 * alocado na própria caixinha, então não precisa de conta própria — a regra
 * antiga `cdi_percent IS NULL OR mode = 'account'` sai. O resto do esquema é
 * o mesmo da 006.
 */
export const migration013EarmarkCdi: Migration = {
  version: 13,
  name: "earmark-cdi",
  up: (db) => {
    rebuildTable(db, {
      table: "goals",
      createSql: `
        CREATE TABLE goals__new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('earmark','account')),
          account_id INTEGER REFERENCES accounts(id),
          target_amount_cents INTEGER,
          target_date TEXT,
          cdi_percent REAL,
          color TEXT NOT NULL,
          icon TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          CHECK (mode = 'earmark' OR account_id IS NOT NULL),
          CHECK (cdi_percent IS NULL OR cdi_percent > 0),
          CHECK (target_amount_cents IS NULL OR target_amount_cents > 0)
        )`,
      columns: [
        "id",
        "name",
        "mode",
        "account_id",
        "target_amount_cents",
        "target_date",
        "cdi_percent",
        "color",
        "icon",
        "archived",
        "created_at"
      ],
      indexes: [
        `CREATE UNIQUE INDEX IF NOT EXISTS goals_account_unique
           ON goals(account_id) WHERE mode = 'account'`
      ]
    });
  }
};
