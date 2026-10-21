import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations } from "./index.js";
import { migration001Baseline } from "./001-baseline.js";
import { migration002LedgerCore } from "./002-ledger-core.js";
import { migration003BudgetTargets } from "./003-budget-targets.js";
import { migration004CreditCard } from "./004-credit-card.js";
import { runMigrations, type MigrationDatabase } from "./runner.js";

const BEFORE = [
  migration001Baseline,
  migration002LedgerCore,
  migration003BudgetTargets,
  migration004CreditCard
];

/** Recria o esquema legado de `operations` como `migrate()` o cria. */
function dbBeforePhase4() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio TEXT NOT NULL CHECK(portfolio IN ('crypto','b3')),
      type TEXT NOT NULL CHECK(type IN ('buy','sell')),
      asset TEXT NOT NULL,
      date TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      total REAL NOT NULL CHECK(total >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('BRL','USD')),
      notes TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  runMigrations(db, BEFORE);
  return db;
}

const setting = (db: MigrationDatabase, key: string) =>
  (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)
    ?.value;

describe("migration 005 — investment link", () => {
  it("acrescenta account_id sem tocar no CHECK de portfolio (R-02)", () => {
    const db = dbBeforePhase4();
    db.prepare(
      `INSERT INTO operations(portfolio, type, asset, date, quantity, total, currency)
       VALUES ('crypto','buy','BTC','2026-01-10', 0.01, 5000, 'BRL')`
    ).run();
    const before = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name='operations'").get() as { sql: string }
    ).sql;

    runMigrations(db, migrations);

    const after = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name='operations'").get() as { sql: string }
    ).sql;
    // Qualquer rebuild acidental desta tabela, em qualquer fase futura, quebra aqui.
    expect(after).toContain("CHECK(portfolio IN ('crypto','b3'))");
    expect(after).toContain("account_id");
    expect(before).not.toContain("account_id");
  });

  it("deixa as operacoes antigas sem conta, sem migrar ninguem", () => {
    const db = dbBeforePhase4();
    db.prepare(
      `INSERT INTO operations(portfolio, type, asset, date, quantity, total, currency)
       VALUES ('b3','buy','PETR4','2026-01-10', 100, 3000, 'BRL')`
    ).run();
    runMigrations(db, migrations);
    expect(db.prepare("SELECT account_id FROM operations").get()).toEqual({ account_id: null });
  });

  it("cria o indice e a tabela de vinculo 1-1", () => {
    const db = dbBeforePhase4();
    runMigrations(db, migrations);
    const indexes = (db.pragma("index_list(operations)") as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain("idx_operations_account");

    db.prepare(
      `INSERT INTO operations(id, portfolio, type, asset, date, quantity, total, currency)
       VALUES (1,'crypto','buy','BTC','2026-01-10', 0.01, 5000, 'BRL')`
    ).run();
    db.prepare(
      `INSERT INTO accounts(id, name, kind, color, created_at)
       VALUES (50, 'Conta', 'checking', '#fff', 'x')`
    ).run();
    db.prepare(
      `INSERT INTO entries(id, account_id, date, amount_cents, kind, created_at, updated_at)
       VALUES (1, 50, '2026-01-10', -5000, 'transfer', 'x', 'x'),
              (2, 50, '2026-01-10',  5000, 'transfer', 'x', 'x')`
    ).run();
    db.prepare(
      "INSERT INTO transfers(id, from_entry_id, to_entry_id, purpose, created_at) VALUES (7,1,2,'investment','x')"
    ).run();

    const link = db.prepare(
      "INSERT INTO operation_transfers(operation_id, transfer_id, created_at) VALUES (?,?,'x')"
    );
    link.run(1, 7);
    expect(() => link.run(1, 7)).toThrow();
  });

  it("semeia as contas de corretora e a configuracao, de forma idempotente", () => {
    const db = dbBeforePhase4();
    // So ate a 005: a 010 junta as duas numa ponte unica, e isso e dela.
    const upTo005 = migrations.filter((migration) => migration.version <= 5);
    runMigrations(db, upTo005);

    const accounts = db
      .prepare("SELECT name, include_in_net_worth AS flag FROM accounts WHERE kind='investment'")
      .all() as { name: string; flag: number }[];
    expect(accounts.map((a) => a.name).sort()).toEqual(["Corretora B3", "Corretora cripto"]);
    expect(accounts.every((a) => a.flag === 0)).toBe(true);

    expect(setting(db, "investment.auto_debit")).toBe("1");
    expect(setting(db, "investment.default_account_id")).toBe("");
    expect(Number(setting(db, "investment.crypto_account_id"))).toBeGreaterThan(0);

    // Reaplicar nao duplica nem sobrescreve.
    runMigrations(db, upTo005);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE kind='investment'").get()
    ).toEqual({ n: 2 });
  });
});
