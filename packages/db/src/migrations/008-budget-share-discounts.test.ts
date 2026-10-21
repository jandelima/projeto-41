import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import { migration008BudgetShareDiscounts } from "./008-budget-share-discounts.js";

describe("migração 008", () => {
  it("o banco novo nasce sem nenhuma pessoa", () => {
    const db = createDatabase(":memory:");
    expect(db.ledger.people.list()).toEqual([]);
  });

  it("apaga as pessoas semeadas que nunca foram usadas e preserva as que foram", () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, color TEXT,
                           active INTEGER, created_at TEXT);
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, person_id INTEGER);
      CREATE TABLE entries (id INTEGER PRIMARY KEY, person_id INTEGER);
      CREATE TABLE person_period_budgets (person_id INTEGER, period TEXT);
      CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO people VALUES
        (1, 'Steylor', 'individual', '#fff', 1, 'x'),
        (2, 'Bianca', 'individual', '#fff', 1, 'x'),
        (3, 'Conjunto', 'joint', '#fff', 1, 'x'),
        (4, 'Ana', 'individual', '#fff', 1, 'x');
      INSERT INTO accounts VALUES (10, 1);
    `);
    migration008BudgetShareDiscounts.up(raw);

    const names = (raw.prepare("SELECT name FROM people ORDER BY id").all() as { name: string }[])
      .map((row) => row.name);
    // Steylor tem conta e fica; Bianca e Conjunto nunca foram usados e saem;
    // Ana foi criada pelo usuario e nao e da conta desta migracao.
    expect(names).toEqual(["Steylor", "Ana"]);
  });

  it("aceita objetivo percentual entre 0 e 100%", () => {
    const db = createDatabase(":memory:");
    const mercado = db.ledger.categories.list().find((c) => c.name === "Mercado")!;
    db.ledger.categories.setBudget(mercado.id, { budgetSharePerMille: 250 });
    expect(db.ledger.categories.get(mercado.id)).toMatchObject({
      budgetSharePerMille: 250,
      monthlyBudgetCents: null
    });
    expect(() =>
      db.raw.prepare("UPDATE categories SET budget_share_per_mille = 1001 WHERE id = ?").run(mercado.id)
    ).toThrow(/CHECK/i);
  });

  it("definir um modo de objetivo apaga o outro", () => {
    const db = createDatabase(":memory:");
    const mercado = db.ledger.categories.list().find((c) => c.name === "Mercado")!;
    db.ledger.categories.setBudget(mercado.id, { monthlyBudgetCents: 80000 });
    db.ledger.categories.setBudget(mercado.id, { budgetSharePerMille: 300 });
    expect(db.ledger.categories.get(mercado.id)?.monthlyBudgetCents).toBeNull();
    db.ledger.categories.setBudget(mercado.id, { monthlyBudgetCents: 50000 });
    expect(db.ledger.categories.get(mercado.id)).toMatchObject({
      monthlyBudgetCents: 50000,
      budgetSharePerMille: null
    });
  });
});
