import { rebuildTable, type Migration } from "./runner.js";

/**
 * Contas do módulo de investimentos: cada uma com os próprios registros.
 *
 * Operações, posições, aportes digitados, proventos, metas de alocação e o
 * histórico passam a pertencer a uma conta. Tudo que já existe fica na conta 1,
 * "Principal", então nada muda para quem tem uma conta só.
 *
 * O histórico ganha um escopo: `0` é o retrato de todas as contas juntas (o
 * patrimônio do módulo de finanças) e cada conta tem o seu. As linhas que já
 * existem eram o todo e eram a Principal ao mesmo tempo, então vão para as duas.
 */
export const migration017InvestmentAccounts: Migration = {
  version: 17,
  name: "investment-accounts",
  up: (db) => {
    // Bancos mínimos (testes do runner) não têm todas as tabelas legadas.
    const exists = (table: string) =>
      Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
      );

    db.exec(`
      CREATE TABLE investment_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO investment_accounts(id, name, sort_order, created_at) VALUES (1, 'Principal', 0, ?)"
    ).run(new Date().toISOString());

    for (const table of ["operations", "manual_positions", "contributions"]) {
      if (!exists(table)) continue;
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN investment_account_id INTEGER NOT NULL DEFAULT 1
           REFERENCES investment_accounts(id)`
      );
      db.exec(
        `CREATE INDEX ${table}_investment_account ON ${table}(investment_account_id)`
      );
    }

    if (exists("dividends")) rebuildTable(db, {
      table: "dividends",
      createSql: `CREATE TABLE dividends__new (
        investment_account_id INTEGER NOT NULL DEFAULT 1 REFERENCES investment_accounts(id),
        asset TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (investment_account_id, asset)
      )`,
      columns: ["asset", "amount"]
    });

    if (exists("allocation_targets")) rebuildTable(db, {
      table: "allocation_targets",
      createSql: `CREATE TABLE allocation_targets__new (
        investment_account_id INTEGER NOT NULL DEFAULT 1 REFERENCES investment_accounts(id),
        category TEXT NOT NULL,
        weight REAL NOT NULL,
        PRIMARY KEY (investment_account_id, category)
      )`,
      columns: ["category", "weight"]
    });

    if (!exists("snapshots")) return;
    rebuildTable(db, {
      table: "snapshots",
      createSql: `CREATE TABLE snapshots__new (
        investment_account_id INTEGER NOT NULL DEFAULT 0,
        date TEXT NOT NULL,
        total_brl REAL NOT NULL,
        payload TEXT NOT NULL,
        price_times TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (investment_account_id, date)
      )`,
      columns: ["date", "total_brl", "payload", "price_times"]
    });
    db.exec(`
      INSERT INTO snapshots (investment_account_id, date, total_brl, payload, price_times)
      SELECT 1, date, total_brl, payload, price_times FROM snapshots WHERE investment_account_id = 0
    `);
  }
};
