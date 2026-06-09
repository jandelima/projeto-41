import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "./index.js";

let db: AppDatabase | undefined;

afterEach(() => db?.close());

describe("database", () => {
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
