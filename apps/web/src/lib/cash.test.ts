import { describe, expect, it } from "vitest";
import { destinationOf, suggestCashAllocation } from "./cash.js";

describe("suggestCashAllocation", () => {
  const gaps = [
    { category: "bitcoin", targetBrl: 1000, actualBrl: 400 },
    { category: "bolsa_brasil", targetBrl: 1000, actualBrl: 800 },
    { category: "renda_fixa", targetBrl: 500, actualBrl: 700 },
    { category: "caixa_br", targetBrl: 100, actualBrl: 0 }
  ];

  it("divide o caixa na proporção do que falta a cada classe", () => {
    // Faltam 600 (bitcoin) e 200 (bolsa): 400 de caixa cobre metade de cada.
    expect(suggestCashAllocation(gaps, 400)).toEqual([
      { category: "bitcoin", amountBrl: 300 },
      { category: "bolsa_brasil", amountBrl: 100 }
    ]);
  });

  it("com caixa de sobra, cobre as faltas e deixa o resto", () => {
    expect(suggestCashAllocation(gaps, 5000)).toEqual([
      { category: "bitcoin", amountBrl: 600 },
      { category: "bolsa_brasil", amountBrl: 200 }
    ]);
  });

  it("nunca sugere caixa como destino nem classe acima da meta", () => {
    const categories = suggestCashAllocation(gaps, 400).map((item) => item.category);
    expect(categories).not.toContain("caixa_br");
    expect(categories).not.toContain("renda_fixa");
  });

  it("sem caixa não sugere nada", () => {
    expect(suggestCashAllocation(gaps, 0)).toEqual([]);
  });
});

describe("destinationOf", () => {
  it("leva cada classe para a tela onde se compra", () => {
    expect(destinationOf("bitcoin")).toBe("crypto");
    expect(destinationOf("bolsa_brasil")).toBe("b3");
    expect(destinationOf("renda_fixa")).toBe("positions");
  });
});
