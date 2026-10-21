import cdiSeed from "./data/cdi-sgs12-seed.json" with { type: "json" };
import holidays from "./data/feriados-anbima.json" with { type: "json" };
import type { Migration } from "./runner.js";

/**
 * Caixinhas, CDI e feriados (plano mestre 4.5).
 *
 * **Armadilha de nome:** `cdi_rates.daily_factor` se chama assim por heranca da
 * secao 4.5, mas guarda o **percentual ao dia util publicado pela serie 12**
 * (`0.050788`), nao um fator. Quem multiplicar essa coluna direto pelo principal
 * erra por tres ordens de grandeza. O SELECT do repositorio usa o alias
 * `dailyRatePercent` justamente para tornar o erro impossivel por distracao.
 *
 * **R-09:** aqui so entra a serie 12 (e a 4389 em `annual_252`). A serie 11
 * (Selic) hoje devolve valores identicos, mas **nunca** pode ser gravada nem
 * usada como substituta; se um dia for necessaria, ganha tabela propria.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS goals (
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
    -- Caixinha que rende precisa de conta propria: o rendimento e creditado
    -- como lancamento, e marcacao contabil nao tem conta onde creditar.
    CHECK (cdi_percent IS NULL OR mode = 'account'),
    CHECK (cdi_percent IS NULL OR cdi_percent > 0),
    CHECK (target_amount_cents IS NULL OR target_amount_cents > 0)
  );

  -- Uma conta 'goal' pertence a no maximo uma caixinha; duas apontando para a
  -- mesma conta contariam o mesmo dinheiro duas vezes.
  CREATE UNIQUE INDEX IF NOT EXISTS goals_account_unique
    ON goals(account_id) WHERE mode = 'account';

  CREATE TABLE IF NOT EXISTS goal_allocations (
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    PRIMARY KEY (goal_id, entry_id)
  );
  CREATE INDEX IF NOT EXISTS goal_allocations_entry ON goal_allocations(entry_id);

  CREATE TABLE IF NOT EXISTS cdi_rates (
    date TEXT PRIMARY KEY,
    daily_factor REAL NOT NULL,
    annual_252 REAL,
    source TEXT NOT NULL CHECK (source IN ('sgs-12','seed')),
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export const migration006GoalsCdi: Migration = {
  version: 6,
  name: "goals-cdi",
  up: (db) => {
    db.exec(SCHEMA);
    const now = new Date().toISOString();

    // Semeadura idempotente: so quando as tabelas estao vazias, e com
    // INSERT OR IGNORE por cima disso.
    const holidayCount = (db.prepare("SELECT COUNT(*) AS n FROM holidays").get() as { n: number })
      .n;
    if (holidayCount === 0) {
      const insert = db.prepare("INSERT OR IGNORE INTO holidays(date, name) VALUES (?, ?)");
      for (const item of holidays) insert.run(item.date, item.name);
    }

    const rateCount = (db.prepare("SELECT COUNT(*) AS n FROM cdi_rates").get() as { n: number }).n;
    if (rateCount === 0) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO cdi_rates(date, daily_factor, annual_252, source, fetched_at)
         VALUES (?, ?, NULL, 'seed', ?)`
      );
      for (const item of cdiSeed) insert.run(item.date, item.dailyRatePercent, now);
    }
  }
};
