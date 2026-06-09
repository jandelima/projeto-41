import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@projeto41/db";
import { buildDashboard } from "../services/portfolio-service.js";
import { seedDemoDatabase } from "./demo-data.js";

let db: AppDatabase | undefined;

afterEach(() => db?.close());

describe("seedDemoDatabase", () => {
  it("creates a synthetic portfolio worth exactly R$ 20,000", () => {
    db = createDatabase(":memory:");
    seedDemoDatabase(db, new Date("2026-06-09T12:00:00-03:00"));

    const dashboard = buildDashboard(db);

    expect(dashboard.totalBrl).toBeCloseTo(20_000, 6);
    expect(dashboard.portfolios.crypto.map((asset) => asset.asset).sort()).toEqual([
      "BTC",
      "ETH",
      "SOL"
    ].sort());
    expect(dashboard.portfolios.b3.map((asset) => asset.asset).sort()).toEqual([
      "BBAS3",
      "PETR4",
      "WEGE3"
    ].sort());
    expect(dashboard.history.length).toBeGreaterThanOrEqual(90);
  });
});
