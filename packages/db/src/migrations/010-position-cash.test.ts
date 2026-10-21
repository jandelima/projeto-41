import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";
import { migration010PositionCash } from "./010-position-cash.js";

const setting = (db: ReturnType<typeof createTestDatabase>, key: string) => db.settings.get(key);

describe("migração 010", () => {
  it("deixa uma ponte só, chamada Investimentos, fora do patrimônio", () => {
    const db = createTestDatabase();
    const bridge = Number(setting(db, "investment.bridge_account_id"));
    const investments = db.raw
      .prepare(
        "SELECT id, name, archived, include_in_net_worth AS flag FROM accounts WHERE kind = 'investment'"
      )
      .all() as { id: number; name: string; archived: number; flag: number }[];

    const active = investments.filter((account) => !account.archived);
    expect(active).toEqual([{ id: bridge, name: "Investimentos", archived: 0, flag: 0 }]);
    expect(setting(db, "investment.crypto_account_id")).toBe(String(bridge));
    expect(setting(db, "investment.b3_account_id")).toBe(String(bridge));
  });

  it("desfaz o caixa da corretora da 009 e solta a operação que só dependia dele", () => {
    const db = createTestDatabase();
    const bridge = Number(setting(db, "investment.bridge_account_id"));
    // Recria o estado deixado pela 009: operação paga pelo caixa da corretora.
    db.raw.exec(`
      CREATE TABLE operation_cash_entries (
        operation_id INTEGER PRIMARY KEY REFERENCES operations(id),
        entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id),
        created_at TEXT NOT NULL
      );
    `);
    const operationId = db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-05-10",
      quantity: 0.01,
      total: 100,
      currency: "BRL",
      accountId: bridge
    });
    const entryId = db.ledger.entries.create({
      accountId: bridge,
      date: "2026-05-10",
      amountCents: -100_00,
      kind: "adjustment"
    });
    db.raw
      .prepare("INSERT INTO operation_cash_entries VALUES (?, ?, 'x')")
      .run(operationId, entryId);

    migration010PositionCash.up(db.raw);

    expect(
      db.raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'operation_cash_entries'").get()
    ).toBeUndefined();
    expect(db.ledger.entries.get(entryId)).toBeUndefined();
    expect(db.operations.list()[0]?.accountId).toBeNull();
  });

  it("aporte avulso que estava numa corretora vira um caixa, sem sumir do patrimônio", () => {
    const db = createTestDatabase();
    const bridge = Number(setting(db, "investment.bridge_account_id"));
    const bank = db.ledger.accounts.create({ name: "Nubank", kind: "checking", color: "#000", openingBalanceCents: 10_000_00 });
    // O aporte da tela antiga: transferência do banco para a corretora.
    db.ledger.entries.createTransfer({
      fromAccountId: bank,
      toAccountId: bridge,
      date: "2026-09-24",
      amountCents: 8_000_00,
      purpose: "investment"
    });

    migration010PositionCash.up(db.raw);

    const caixa = db.positions.list().find((position) => position.category === "cash");
    expect(caixa?.currentValue).toBe(8000);
    const movements = db.positionMovements.list({ positionId: caixa!.id });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ kind: "deposit", amount: 8000 });
    // Rodar de novo não duplica o caixa.
    migration010PositionCash.up(db.raw);
    expect(db.positions.list().filter((position) => position.category === "cash")).toHaveLength(1);
  });

  it("rodar de novo não muda nada", () => {
    const db = createTestDatabase();
    const before = setting(db, "investment.bridge_account_id");
    migration010PositionCash.up(db.raw);
    expect(setting(db, "investment.bridge_account_id")).toBe(before);
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM accounts WHERE kind = 'investment' AND archived = 0").get() as {
        n: number;
      }).n
    ).toBe(1);
  });
});
