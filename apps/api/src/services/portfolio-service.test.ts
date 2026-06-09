import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@projeto41/db";
import { buildDashboard } from "./portfolio-service.js";

let db: AppDatabase | undefined;
afterEach(() => db?.close());

describe("buildDashboard", () => {
  it("consolidates crypto, B3 and manual positions in BRL", () => {
    db = createDatabase(":memory:");
    db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-01-01",
      quantity: 1,
      total: 50_000,
      currency: "USD"
    });
    db.prices.upsert({
      symbol: "BTC",
      price: 60_000,
      currency: "USD",
      provider: "test",
      marketTime: null,
      fetchedAt: "2026-06-09T00:00:00Z",
      error: null
    });
    db.prices.upsert({
      symbol: "USDBRL",
      price: 5,
      currency: "BRL",
      provider: "test",
      marketTime: null,
      fetchedAt: "2026-06-09T00:00:00Z",
      error: null
    });
    db.positions.upsert({
      category: "cash",
      name: "Conta",
      invested: 1000,
      currentValue: 1000,
      currency: "BRL"
    });

    const dashboard = buildDashboard(db);
    expect(dashboard.totalBrl).toBe(301_000);
    expect(dashboard.categories.crypto).toBe(300_000);
    expect(dashboard.categories.cash).toBe(1000);
  });
});
