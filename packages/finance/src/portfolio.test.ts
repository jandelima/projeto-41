import { describe, expect, it } from "vitest";
import { calculatePosition } from "./index.js";

describe("calculatePosition", () => {
  it("uses purchases only for average price and reports sold value", () => {
    const position = calculatePosition(
      [
        { type: "buy", quantity: 2, total: 200 },
        { type: "buy", quantity: 1, total: 130 },
        { type: "sell", quantity: 0.5, total: 80 }
      ],
      150,
      10
    );

    expect(position.quantity).toBe(2.5);
    expect(position.invested).toBe(330);
    expect(position.averagePrice).toBe(110);
    expect(position.soldValue).toBe(80);
    expect(position.marketValue).toBe(375);
    expect(position.totalReturn).toBeCloseTo((375 + 80 + 10) / 330 - 1);
  });

  it("returns zeroes for an asset without purchases", () => {
    expect(calculatePosition([], 10)).toEqual({
      quantity: 0,
      invested: 0,
      averagePrice: 0,
      soldValue: 0,
      marketValue: 0,
      currentReturn: 0,
      totalReturn: 0,
      dividends: 0
    });
  });
});

