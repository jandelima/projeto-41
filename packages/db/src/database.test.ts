import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./index.js";

let db: AppDatabase | undefined;
let temporaryDirectory: string | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("database", () => {
  it("creates generic allocation targets for a new database", () => {
    db = createDatabase(":memory:");

    const targets = db.targets.list();

    expect(targets.map((target) => target.category)).toEqual([
      "acoes_globais",
      "bitcoin",
      "bolsa_brasil",
      "caixa_br",
      "dolar",
      "renda_fixa",
      "shitcoins"
    ]);
    expect(targets.reduce((sum, target) => sum + target.weight, 0)).toBeCloseTo(1);
  });

  it("does not add defaults to an existing custom allocation", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "projeto41-db-"));
    const databasePath = join(temporaryDirectory, "portfolio.sqlite");
    db = createDatabase(databasePath);
    db.raw.exec("DELETE FROM allocation_targets");
    db.targets.set("custom", 1);
    db.close();

    db = createDatabase(databasePath);

    expect(db.targets.list()).toEqual([{ category: "custom", weight: 1 }]);
  });

  it("stores operations and enforces one snapshot per date", () => {
    db = createDatabase(":memory:");
    db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-06-09",
      quantity: 0.01,
      total: 650,
      currency: "USD"
    });

    expect(db.operations.list()).toHaveLength(1);

    db.snapshots.upsert({
      date: "2026-06-09",
      totalBrl: 100,
      payload: { BTC: 100 }
    });
    db.snapshots.upsert({
      date: "2026-06-09",
      totalBrl: 110,
      payload: { BTC: 110 }
    });

    expect(db.snapshots.list()).toHaveLength(1);
    expect(db.snapshots.list()[0]?.totalBrl).toBe(110);
  });

  it("rolls the daily price baseline only when a new day arrives", () => {
    db = createDatabase(":memory:");
    const base = {
      symbol: "BTC",
      currency: "USD" as const,
      provider: "test",
      marketTime: null,
      error: null
    };

    // Primeiro dia: o baseline é o próprio preço (sem referência anterior).
    db.prices.upsert({ ...base, price: 100, fetchedAt: "2026-06-09T10:00:00Z" });
    let row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(100);
    expect(row?.prevDay).toBe("2026-06-09");

    // Mais cotações no mesmo dia não mudam o baseline.
    db.prices.upsert({ ...base, price: 120, fetchedAt: "2026-06-09T18:00:00Z" });
    row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(100);
    expect(row?.prevDay).toBe("2026-06-09");

    // Novo dia: o último preço do dia anterior (120) vira a referência.
    db.prices.upsert({ ...base, price: 132, fetchedAt: "2026-06-10T09:00:00Z" });
    row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(120);
    expect(row?.prevDay).toBe("2026-06-09");

    // Outra cotação ainda no dia 10 mantém a referência do dia 9.
    db.prices.upsert({ ...base, price: 140, fetchedAt: "2026-06-10T15:00:00Z" });
    row = db.prices.get("BTC");
    expect(row?.prevPrice).toBe(120);
    expect(row?.prevDay).toBe("2026-06-09");
  });
});
