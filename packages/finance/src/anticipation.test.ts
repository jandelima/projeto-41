import { describe, expect, it } from "vitest";
import { anticipationDiscounts, formatPercentHundredths } from "./anticipation.js";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("anticipationDiscounts", () => {
  const installments = [33334, 33333, 33333];

  it("aplica percentual em cada parcela", () => {
    expect(anticipationDiscounts(installments, { mode: "percent", scope: "each", value: 1000 })).toEqual([
      3333, 3333, 3333
    ]);
  });

  it("aplica percentual sobre o total fechando exatamente no percentual", () => {
    const result = anticipationDiscounts(installments, { mode: "percent", scope: "total", value: 1000 });
    // 10% de 1000,00 e 100,00, nem um centavo a mais ou a menos.
    expect(sum(result)).toBe(10000);
    expect(result).toHaveLength(3);
  });

  it("repete o valor fixo em cada parcela", () => {
    expect(anticipationDiscounts([5000, 5000], { mode: "amount", scope: "each", value: 750 })).toEqual([
      750, 750
    ]);
  });

  it("reparte o valor total pelo tamanho das parcelas", () => {
    const result = anticipationDiscounts([10000, 30000], { mode: "amount", scope: "total", value: 1000 });
    expect(result).toEqual([250, 750]);
  });

  it("reparte sem perder centavo quando a divisao nao e exata", () => {
    const result = anticipationDiscounts([100, 100, 100], { mode: "amount", scope: "total", value: 100 });
    expect(sum(result)).toBe(100);
  });

  it("recusa desconto maior que o que esta sendo antecipado", () => {
    expect(() =>
      anticipationDiscounts([5000], { mode: "amount", scope: "total", value: 5001 })
    ).toThrow(/passa do total/);
    expect(() =>
      anticipationDiscounts([5000, 100], { mode: "amount", scope: "each", value: 200 })
    ).toThrow(/passa do valor/);
    expect(() =>
      anticipationDiscounts([5000], { mode: "percent", scope: "each", value: 10001 })
    ).toThrow(/100%/);
  });

  it("recusa desconto zero ou quebrado", () => {
    expect(() => anticipationDiscounts([5000], { mode: "amount", scope: "each", value: 0 })).toThrow();
    expect(() => anticipationDiscounts([5000], { mode: "amount", scope: "each", value: 1.5 })).toThrow();
  });

  it("devolve lista vazia sem parcelas", () => {
    expect(anticipationDiscounts([], { mode: "percent", scope: "total", value: 500 })).toEqual([]);
  });
});

describe("formatPercentHundredths", () => {
  it("formata em pt-BR", () => {
    expect(formatPercentHundredths(1250)).toBe("12,5%");
    expect(formatPercentHundredths(500)).toBe("5%");
  });
});
