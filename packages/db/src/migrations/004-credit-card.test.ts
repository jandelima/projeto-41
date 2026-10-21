import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migration001Baseline } from "./001-baseline.js";
import { migration002LedgerCore } from "./002-ledger-core.js";
import { migration003BudgetTargets } from "./003-budget-targets.js";
import { migration004CreditCard } from "./004-credit-card.js";
import { runMigrations, type MigrationDatabase } from "./runner.js";
import { seedTestPeople } from "../testing.js";

const BEFORE = [migration001Baseline, migration002LedgerCore, migration003BudgetTargets];
/**
 * Só até a 004: a 005 mexe em `operations`, que pertence ao `migrate()` legado
 * e não existe num banco montado apenas pelo runner.
 */
const THROUGH_004 = [...BEFORE, migration004CreditCard];

function dbAtPhase2() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, BEFORE);
  seedTestPeople(db);
  return db;
}

function tableSql(db: MigrationDatabase, name: string) {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string })
    .sql;
}

function indexNames(db: MigrationDatabase, table: string) {
  return (db.pragma(`index_list(${table})`) as { name: string }[]).map((row) => row.name);
}

function seedLedger(db: MigrationDatabase) {
  db.exec(`
    INSERT INTO accounts(id, person_id, name, kind, color, closing_day, due_day,
                         credit_limit_cents, created_at)
      VALUES (1, 1, 'Nubank', 'checking', '#fff', NULL, NULL, NULL, 'x'),
             (2, 1, 'Cartao', 'credit_card', '#f00', 20, 27, 500000, 'x');
    INSERT INTO entries(id, account_id, person_id, date, amount_cents, kind, status,
                        description, statement_month, counts_toward_target,
                        created_at, updated_at)
      VALUES (1, 1, 1, '2026-03-01', -5000, 'expense', 'cleared', 'Mercado', NULL, 1, 'x', 'x'),
             (2, 2, 1, '2026-03-02', -19900, 'expense', 'pending', 'Livro', '2026-03', 1, 'x', 'x');
  `);
}

describe("migration 004 — credit card", () => {
  it("cria installment_plans e nao cria tabela de fatura (D22)", () => {
    const db = dbAtPhase2();
    runMigrations(db, THROUGH_004);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toContain("installment_plans");
    expect(tables).not.toContain("invoices");
    expect(tables).not.toContain("statements");
  });

  it("nao reconstroi accounts: o SQL fica byte a byte identico", () => {
    const db = dbAtPhase2();
    seedLedger(db);
    const before = tableSql(db, "accounts");
    runMigrations(db, THROUGH_004);
    expect(tableSql(db, "accounts")).toBe(before);
  });

  it("preserva contagem e valores de entries ao reconstruir", () => {
    const db = dbAtPhase2();
    seedLedger(db);
    const before = db.prepare("SELECT * FROM entries ORDER BY id").all();
    runMigrations(db, THROUGH_004);
    expect(db.prepare("SELECT * FROM entries ORDER BY id").all()).toEqual(before);
  });

  it("mantem todos os indices da migracao 002 e acrescenta os da fatura", () => {
    const db = dbAtPhase2();
    runMigrations(db, THROUGH_004);
    const indexes = indexNames(db, "entries");
    for (const name of [
      "entries_account_date",
      "entries_date",
      "entries_category_date",
      "entries_person_date",
      "entries_account_external"
    ]) {
      expect(indexes).toContain(name);
    }
    for (const name of [
      "entries_account_statement",
      "entries_installment",
      "entries_refund_of",
      "entries_installment_unique"
    ]) {
      expect(indexes).toContain(name);
    }
  });

  it("preserva os CHECK da 002 depois do rebuild", () => {
    const db = dbAtPhase2();
    runMigrations(db, THROUGH_004);
    db.exec(
      `INSERT INTO accounts(id, name, kind, color, created_at)
       VALUES (9, 'X', 'checking', '#fff', 'x')`
    );
    const insert = db.prepare(
      `INSERT INTO entries(account_id, date, amount_cents, kind, category_id, created_at, updated_at)
       VALUES (9, '2026-03-01', -100, ?, ?, 'x', 'x')`
    );
    expect(() => insert.run("transfer", 1)).toThrow();
    expect(() => insert.run("bitcoin", null)).toThrow();
  });

  it("da integridade a installment_plan_id", () => {
    const db = dbAtPhase2();
    seedLedger(db);
    runMigrations(db, THROUGH_004);
    expect(() =>
      db
        .prepare(
          `INSERT INTO entries(account_id, date, amount_cents, kind, installment_plan_id,
                               installment_number, created_at, updated_at)
           VALUES (2, '2026-03-01', -100, 'expense', 999, 1, 'x', 'x')`
        )
        .run()
    ).toThrow();
  });

  it("rejeita plano com zero parcelas e parcela duplicada na serie", () => {
    const db = dbAtPhase2();
    seedLedger(db);
    runMigrations(db, THROUGH_004);

    const plan = db.prepare(
      `INSERT INTO installment_plans(account_id, purchase_date, total_cents,
                                     installment_count, created_at)
       VALUES (2, '2026-03-01', 10000, ?, 'x')`
    );
    expect(() => plan.run(0)).toThrow();
    const planId = Number(plan.run(3).lastInsertRowid);

    const insert = db.prepare(
      `INSERT INTO entries(account_id, date, amount_cents, kind, installment_plan_id,
                           installment_number, created_at, updated_at)
       VALUES (2, '2026-03-01', -3334, 'expense', ?, ?, 'x', 'x')`
    );
    insert.run(planId, 1);
    expect(() => insert.run(planId, 1)).toThrow();
    expect(() => insert.run(planId, 2)).not.toThrow();
  });

  it("nao reaplica quando ja rodou", () => {
    const db = dbAtPhase2();
    runMigrations(db, THROUGH_004);
    expect(runMigrations(db, THROUGH_004)).toHaveLength(0);
  });
});
