import { describe, expect, it } from "vitest";
import { calculateAllocation } from "./index.js";

describe("calculateAllocation", () => {
  it("calculates ideal balance and difference", () => {
    const result = calculateAllocation(100_000, 20_000, 0.35);
    expect(result).toEqual({
      investableTotal: 80_000,
      ideal: 28_000,
      difference: 28_000
    });
  });
});

