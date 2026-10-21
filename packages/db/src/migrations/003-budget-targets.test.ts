import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migration001Baseline } from "./001-baseline.js";
import { migration002LedgerCore } from "./002-ledger-core.js";
import { migration003BudgetTargets } from "./003-budget-targets.js";
import { runMigrations, type MigrationDatabase } from "./runner.js";
import { seedTestPeople } from "../testing.js";

const ALL = [migration001Baseline, migration002LedgerCore, migration003BudgetTargets];

function migratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, [migration001Baseline, migration002LedgerCore]);
  seedTestPeople(db);
  runMigrations(db, ALL);
  return db;
}

/** Semeia um livro no estado da fase 1, antes do backfill da fase 2. */
function ledgerBeforeBackfill() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, [migration001Baseline, migration002LedgerCore]);
  seedTestPeople(db);
  db.exec(`
    INSERT INTO accounts(id, person_id, name, kind, color, created_at)
      VALUES (1, 1, 'Nubank', 'checking', '#fff', 'x'),
             (2, 1, 'Caixinha', 'savings', '#fff', 'x');
    INSERT INTO entries(id, account_id, date, amount_cents, kind, counts_toward_target,
                        created_at, updated_at)
      VALUES (1, 1, '2026-03-01', -5000, 'expense', 0, 'x', 'x'),
             (2, 1, '2026-03-02',  9000, 'income',  1, 'x', 'x'),
             (3, 1, '2026-03-03', -1000, 'transfer', 1, 'x', 'x'),
             (4, 2, '2026-03-03',  1000, 'transfer', 1, 'x', 'x'),
             (5, 1, '2026-03-04', -2000, 'transfer', 1, 'x', 'x'),
             (6, 2, '2026-03-04',  2000, 'transfer', 1, 'x', 'x');
    INSERT INTO transfers(from_entry_id, to_entry_id, purpose, created_at)
      VALUES (3, 4, 'goal_deposit', 'x'),
             (5, 6, 'investment', 'x');
  `);
  return db;
}

function flag(db: MigrationDatabase, id: number) {
  return (
    db.prepare("SELECT counts_toward_target AS f FROM entries WHERE id = ?").get(id) as {
      f: number;
    }
  ).f;
}

describe("migration 003 — budget targets", () => {
  it("cria as duas tabelas de alvo", () => {
    const db = migratedDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toContain("budget_periods");
    expect(tables).toContain("person_period_budgets");
  });

  it("nasce com o CHECK completo de split_mode e o padrao 'none'", () => {
    const db = migratedDb();
    const insert = db.prepare(
      "INSERT INTO budget_periods(period, created_at, updated_at) VALUES (?, 'x', 'x')"
    );
    insert.run("2026-03");
    expect(db.prepare("SELECT split_mode FROM budget_periods WHERE period='2026-03'").get()).toEqual(
      { split_mode: "none" }
    );

    for (const mode of ["none", "income_proportional", "pooled"]) {
      expect(() =>
        db
          .prepare(
            "INSERT INTO budget_periods(period, split_mode, created_at, updated_at) VALUES (?,?,'x','x')"
          )
          .run(`m-${mode}`, mode)
      ).not.toThrow();
    }
    expect(() =>
      db
        .prepare(
          "INSERT INTO budget_periods(period, split_mode, created_at, updated_at) VALUES (?,?,'x','x')"
        )
        .run("2026-99", "fifty_fifty")
    ).toThrow();
  });

  it("nao pre-semeia nenhum mes", () => {
    expect(migratedDb().prepare("SELECT COUNT(*) AS n FROM budget_periods").get()).toEqual({ n: 0 });
  });

  it("faz o backfill do flag de alvo pela regra 6.4", () => {
    const db = ledgerBeforeBackfill();
    runMigrations(db, ALL);

    expect(flag(db, 1)).toBe(1); // despesa conta
    expect(flag(db, 2)).toBe(0); // receita nao conta
    expect(flag(db, 3)).toBe(1); // goal_deposit: so a ponta de saida
    expect(flag(db, 4)).toBe(0); // ponta de entrada do mesmo deposito
    expect(flag(db, 5)).toBe(0); // investimento nunca conta
    expect(flag(db, 6)).toBe(0);
  });

  it("guarda override nulo e valor por pessoa e periodo", () => {
    const db = migratedDb();
    db.prepare(
      `INSERT INTO person_period_budgets(person_id, period, income_override_cents,
       target_override_cents) VALUES (1, '2026-03', 250000, NULL)`
    ).run();
    expect(
      db
        .prepare(
          `SELECT income_override_cents AS income, target_override_cents AS target
           FROM person_period_budgets WHERE person_id=1 AND period='2026-03'`
        )
        .get()
    ).toEqual({ income: 250000, target: null });
  });
});
