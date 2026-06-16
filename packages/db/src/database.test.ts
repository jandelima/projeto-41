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

  it("remembers the CoinGecko slug for a crypto symbol", () => {
    db = createDatabase(":memory:");
    db.cryptoAssets.upsert({ symbol: "AVAX", slug: "avalanche-2", name: "Avalanche" });

    expect(db.cryptoAssets.get("AVAX")).toEqual({
      symbol: "AVAX",
      slug: "avalanche-2",
      name: "Avalanche"
    });

    db.cryptoAssets.upsert({ symbol: "AVAX", slug: "avalanche", name: "Avalanche Renamed" });
    expect(db.cryptoAssets.get("AVAX")?.slug).toBe("avalanche");
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
});
