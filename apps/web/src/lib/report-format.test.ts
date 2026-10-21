import { describe, expect, it } from "vitest";
import { spendTone, variationText } from "./report-format.js";

describe("variationText", () => {
  it("mostra o sinal e arredonda", () => {
    expect(variationText(13400, 10000)).toBe("+34%");
    expect(variationText(5748, 10000)).toBe("−43%");
    expect(variationText(10000, 10000)).toBe("0%");
  });

  it("sem base anterior é novo, e zerar é −100%", () => {
    expect(variationText(5000, 0)).toBe("novo");
    expect(variationText(0, 0)).toBe("0%");
    expect(variationText(0, 5000)).toBe("−100%");
  });
});

describe("spendTone", () => {
  it("gastar mais é o tom ruim", () => {
    expect(spendTone(2, 1)).toBe("fin-negative");
    expect(spendTone(1, 2)).toBe("fin-positive");
    expect(spendTone(1, 1)).toBe("fin-muted");
  });
});
