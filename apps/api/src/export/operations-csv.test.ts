import { describe, expect, it } from "vitest";
import { buildOperationsCsv, parseOperationsCsv } from "./operations-csv.js";

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
      "asset,date,type,quantity,amount,unit_price,currency",
      "BTC,2026-06-09,buy,0.5,32500,65000,USD",
      "ETH,2026-06-10,sell,2,7000,3500,USD"
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

    expect(csv.split("\r\n")[1]).toBe("BTC,2026-06-09,buy,0,0,0,USD");
  });
});

describe("parseOperationsCsv", () => {
  it("parses exported rows back into operations, using amount as total", () => {
    const csv = buildOperationsCsv([
      { portfolio: "crypto", type: "buy", asset: "BTC", date: "2026-06-09", quantity: 0.5, total: 32500, currency: "USD" },
      { portfolio: "crypto", type: "sell", asset: "ETH", date: "2026-06-10", quantity: 2, total: 7000, currency: "USD" }
    ]);

    expect(parseOperationsCsv(csv)).toEqual([
      { portfolio: "crypto", type: "buy", asset: "BTC", date: "2026-06-09", quantity: 0.5, total: 32500, currency: "USD" },
      { portfolio: "crypto", type: "sell", asset: "ETH", date: "2026-06-10", quantity: 2, total: 7000, currency: "USD" }
    ]);
  });

  it("tolerates LF line endings, blank lines and reordered columns", () => {
    const csv = "type,asset,quantity,amount,currency,date\nbuy,BTC,0.5,32500,USD,2026-06-09\n\n";

    expect(parseOperationsCsv(csv)).toEqual([
      { portfolio: "crypto", type: "buy", asset: "BTC", date: "2026-06-09", quantity: 0.5, total: 32500, currency: "USD" }
    ]);
  });

  it("throws when a required column is missing", () => {
    expect(() => parseOperationsCsv("asset,date,type,quantity,currency\nBTC,2026-06-09,buy,1,USD")).toThrow(
      /amount/
    );
  });

  it("returns an empty list for a header-only file", () => {
    expect(parseOperationsCsv("asset,date,type,quantity,amount,unit_price,currency")).toEqual([]);
  });
});
