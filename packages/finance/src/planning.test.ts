import { describe, expect, it } from "vitest";
import { projectWealth } from "./index.js";

describe("projectWealth", () => {
  it("projects annual balances and adjusts them for inflation", () => {
    const [year] = projectWealth({
      initialCapital: 10_000,
      monthlyContribution: 1_000,
      monthlyReturnPercent: 1,
      months: 12,
      annualInflationPercent: 6,
      initialYear: 2026
    });

    expect(year?.year).toBe(2027);
    expect(year?.nominalBalance).toBeGreaterThan(22_000);
    expect(year?.realBalance).toBeLessThan(year?.nominalBalance ?? 0);
  });
});

