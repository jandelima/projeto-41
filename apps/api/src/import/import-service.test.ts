import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@projeto41/db";
import { importMappedWorkbook } from "./import-service.js";

let db: AppDatabase | undefined;
afterEach(() => db?.close());

describe("importMappedWorkbook", () => {
  it("imports once and rejects the same fingerprint", () => {
    db = createDatabase(":memory:");
    const data = {
      operations: [
        {
          portfolio: "crypto" as const,
          type: "buy" as const,
          asset: "BTC",
          date: "2026-01-01",
          quantity: 1,
          total: 100,
          currency: "USD" as const
        }
      ],
      positions: [],
      dividends: [],
      contributions: [],
      targets: [],
      prices: [],
      snapshots: [],
      settings: {}
    };

    expect(importMappedWorkbook(db, "abc", data).imported).toBe(true);
    expect(importMappedWorkbook(db, "abc", data).imported).toBe(false);
    expect(db.operations.list()).toHaveLength(1);
  });
});
