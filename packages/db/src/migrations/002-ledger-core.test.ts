import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migration001Baseline } from "./001-baseline.js";
import { migration002LedgerCore } from "./002-ledger-core.js";
import { runMigrations, type MigrationDatabase } from "./runner.js";
import { seedTestPeople } from "../testing.js";

const upToLedger = [migration001Baseline, migration002LedgerCore];

function migratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, upToLedger);
  seedTestPeople(db);
  return db;
}

function tableNames(db: MigrationDatabase) {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  ).map((row) => row.name);
}

function indexNames(db: MigrationDatabase, table: string) {
  return (db.pragma(`index_list(${table})`) as { name: string }[]).map((row) => row.name);
}

describe("migration 002 — ledger core", () => {
  let db: MigrationDatabase;

  beforeEach(() => {
    db = migratedDb();
  });

  it("cria todas as tabelas do livro", () => {
    const tables = tableNames(db);
    for (const table of [
      "people",
      "accounts",
      "categories",
      "tags",
      "places",
      "entries",
      "transfers",
      "entry_tags",
      "attachments"
    ]) {
      expect(tables).toContain(table);
    }
  });

  it("cria os índices de consulta do livro", () => {
    const indexes = indexNames(db, "entries");
    expect(indexes).toContain("entries_account_date");
    expect(indexes).toContain("entries_date");
    expect(indexes).toContain("entries_category_date");
    expect(indexes).toContain("entries_person_date");
    expect(indexes).toContain("entries_account_external");
  });

  it("começa sem pessoas e semeia as categorias uma única vez", () => {
    // O usuário cria as pessoas antes das contas; nenhum nome vem pronto.
    const empty = new Database(":memory:");
    runMigrations(empty, upToLedger);
    expect(empty.prepare("SELECT COUNT(*) AS n FROM people").get()).toEqual({ n: 0 });
    const categories = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
    expect(categories.n).toBe(16);

    // Reaplicar a migração num banco que já tem a versão gravada é no-op.
    runMigrations(db, upToLedger);
    expect(db.prepare("SELECT COUNT(*) AS n FROM categories").get()).toEqual({ n: 16 });
  });

  it("não semeia por cima de cadastros existentes", () => {
    const fresh = new Database(":memory:");
    fresh.pragma("foreign_keys = ON");
    runMigrations(fresh, [migration001Baseline]);
    fresh.exec(`
      CREATE TABLE people (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('individual','joint')), color TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      INSERT INTO people(name, kind, color, created_at) VALUES ('Ana','individual','#fff','x');
    `);
    runMigrations(fresh, upToLedger);
    expect(fresh.prepare("SELECT COUNT(*) AS n FROM people").get()).toEqual({ n: 1 });
  });

  it("aceita os sete tipos de conta previstos e rejeita um tipo desconhecido", () => {
    const insert = db.prepare(
      `INSERT INTO accounts(person_id, name, kind, color, created_at)
       VALUES (1, ?, ?, '#fff', 'x')`
    );
    for (const kind of [
      "checking",
      "savings",
      "cash",
      "meal_voucher",
      "credit_card",
      "investment",
      "goal"
    ]) {
      expect(() => insert.run(`conta ${kind}`, kind)).not.toThrow();
    }
    expect(() => insert.run("estranha", "bitcoin")).toThrow();
  });

  it("rejeita transferência com categoria", () => {
    db.prepare(
      `INSERT INTO accounts(id, person_id, name, kind, color, created_at)
       VALUES (1, 1, 'Nubank', 'checking', '#fff', 'x')`
    ).run();
    const insert = db.prepare(
      `INSERT INTO entries(account_id, date, amount_cents, kind, category_id, created_at, updated_at)
       VALUES (1, '2026-01-10', -1000, ?, ?, 'x', 'x')`
    );
    expect(() => insert.run("transfer", 1)).toThrow();
    expect(() => insert.run("transfer", null)).not.toThrow();
    expect(() => insert.run("expense", 1)).not.toThrow();
  });

  it("garante external_id único por conta, permitindo vários nulos", () => {
    db.prepare(
      `INSERT INTO accounts(id, person_id, name, kind, color, created_at)
       VALUES (1, 1, 'Nubank', 'checking', '#fff', 'x')`
    ).run();
    const insert = db.prepare(
      `INSERT INTO entries(account_id, date, amount_cents, kind, external_id, created_at, updated_at)
       VALUES (1, '2026-01-10', -1000, 'expense', ?, 'x', 'x')`
    );
    insert.run(null);
    insert.run(null);
    insert.run("FITID-1");
    expect(() => insert.run("FITID-1")).toThrow();
  });
});
