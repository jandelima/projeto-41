import { describe, expect, it } from "vitest";
import { buildOperationsCsv } from "./operations-csv.js";

describe("buildOperationsCsv", () => {
  it("renders header plus buy and sell rows with derived unit price", () => {
    const csv = buildOperationsCsv([
      {
        portfolio: "crypto",
        type: "buy",
        asset: "BTC",
        date: "2026-06-09",
        quantity: 0.5,
        total: 32500,
        currency: "USD"
      },
      {
        portfolio: "crypto",
        type: "sell",
        asset: "ETH",
        date: "2026-06-10",
        quantity: 2,
        total: 7000,
        currency: "USD"
      }
    ]);

    expect(csv.split("\r\n")).toEqual([
      "asset,date,type,quantity,amount_usd,unit_price_usd",
      "BTC,2026-06-09,buy,0.5,32500,65000",
      "ETH,2026-06-10,sell,2,7000,3500"
    ]);
  });

  it("uses zero unit price when quantity is zero", () => {
    const csv = buildOperationsCsv([
      {
        portfolio: "crypto",
        type: "buy",
        asset: "BTC",
        date: "2026-06-09",
        quantity: 0,
        total: 0,
        currency: "USD"
      }
    ]);

    expect(csv.split("\r\n")[1]).toBe("BTC,2026-06-09,buy,0,0,0");
  });
});
