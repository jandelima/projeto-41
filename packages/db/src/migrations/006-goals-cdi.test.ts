import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type AppDatabase } from "../index.js";

let db: AppDatabase;

beforeEach(() => {
  db = createTestDatabase();
});

const tables = () =>
  (db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[]).map((row) => row.name);

const indexes = (table: string) =>
  (db.raw.pragma(`index_list(${table})`) as { name: string }[]).map((row) => row.name);

function account(kind = "goal") {
  return Number(
    db.raw
      .prepare(
        `INSERT INTO accounts(name, kind, color, created_at) VALUES ('Caixinha', ?, '#fff', 'x')`
      )
      .run(kind).lastInsertRowid
  );
}

const insertGoal = (values: Record<string, unknown>) =>
  db.raw
    .prepare(
      `INSERT INTO goals(name, mode, account_id, cdi_percent, target_amount_cents, color, created_at)
       VALUES (@name, @mode, @accountId, @cdiPercent, @targetAmountCents, '#fff', 'x')`
    )
    .run({
      name: "Viagem",
      accountId: null,
      cdiPercent: null,
      targetAmountCents: null,
      ...values
    });

describe("migration 006 — goals e CDI", () => {
  it("cria as quatro tabelas e os indices", () => {
    for (const name of ["goals", "goal_allocations", "cdi_rates", "holidays"]) {
      expect(tables()).toContain(name);
    }
    expect(indexes("goals")).toContain("goals_account_unique");
    expect(indexes("goal_allocations")).toContain("goal_allocations_entry");
  });

  // A 013 libera o CDI na marcação; a regra do percentual positivo continua.
  it("aceita caixinha de marcacao com rendimento", () => {
    expect(() => insertGoal({ mode: "earmark", cdiPercent: 110 })).not.toThrow();
    expect(() => insertGoal({ mode: "earmark", cdiPercent: 0 })).toThrow();
  });

  it("recusa caixinha de conta sem conta", () => {
    expect(() => insertGoal({ mode: "account" })).toThrow();
    expect(() => insertGoal({ mode: "account", accountId: account() })).not.toThrow();
  });

  it("recusa duas caixinhas de conta na mesma conta", () => {
    const id = account();
    insertGoal({ mode: "account", accountId: id });
    expect(() => insertGoal({ name: "Outra", mode: "account", accountId: id })).toThrow();
  });

  it("recusa percentual e alvo nao positivos", () => {
    const id = account();
    expect(() => insertGoal({ mode: "account", accountId: id, cdiPercent: 0 })).toThrow();
    expect(() =>
      insertGoal({ mode: "account", accountId: id, targetAmountCents: 0 })
    ).toThrow();
  });

  it("recusa a serie 11 em cdi_rates (R-09)", () => {
    const insert = db.raw.prepare(
      "INSERT INTO cdi_rates(date, daily_factor, source, fetched_at) VALUES (?, ?, ?, 'x')"
    );
    expect(() => insert.run("2030-01-02", 0.05, "sgs-11")).toThrow();
    expect(() => insert.run("2030-01-02", 0.05, "sgs-12")).not.toThrow();
  });

  it("semeia feriados e CDI, e a semeadura e idempotente", () => {
    const holidayCount = (
      db.raw.prepare("SELECT COUNT(*) AS n FROM holidays").get() as { n: number }
    ).n;
    const rateCount = (
      db.raw.prepare("SELECT COUNT(*) AS n FROM cdi_rates").get() as { n: number }
    ).n;
    expect(holidayCount).toBeGreaterThan(1000);
    expect(rateCount).toBeGreaterThan(1000);

    // Toda linha semeada nasce com source='seed'.
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM cdi_rates WHERE source <> 'seed'").get()
    ).toEqual({ n: 0 });

    // A semeadura é do calendário real: o Carnaval de 2026 está lá.
    expect(db.raw.prepare("SELECT name FROM holidays WHERE date='2026-02-16'").get()).toEqual({
      name: "Carnaval"
    });
    expect(
      db.raw.prepare("SELECT daily_factor AS r FROM cdi_rates WHERE date='2026-09-17'").get()
    ).toEqual({ r: 0.050788 });
  });
});
