import { describe, expect, it } from "vitest";
import { operationSchema } from "./index.js";

describe("operationSchema", () => {
  it("accepts a valid crypto purchase", () => {
    const result = operationSchema.parse({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-06-09",
      quantity: 0.01,
      total: 650,
      currency: "USD"
    });

    expect(result.asset).toBe("BTC");
  });

  it("rejects non-positive quantities", () => {
    expect(() =>
      operationSchema.parse({
        portfolio: "b3",
        type: "buy",
        asset: "PETR4",
        date: "2026-06-09",
        quantity: 0,
        total: 100,
        currency: "BRL"
      })
    ).toThrow();
  });
});

