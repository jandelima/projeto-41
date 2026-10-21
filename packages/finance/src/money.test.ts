import { describe, expect, it } from "vitest";
import {
  allocateByRatio,
  fromCents,
  parseCurrencyInput,
  splitCents,
  sumCents,
  toCents
} from "./money.js";

describe("toCents", () => {
  it("arredonda half-up, incluindo o caso binário de .005", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(2.675)).toBe(268);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("é simétrico para valores negativos", () => {
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(-2.675)).toBe(-268);
  });

  it("faz ida e volta em valores exatos", () => {
    expect(fromCents(toCents(1234.56))).toBeCloseTo(1234.56, 10);
  });

  it("rejeita valores não finitos", () => {
    expect(() => toCents(Number.NaN)).toThrow();
  });
});

describe("splitCents", () => {
  it("joga o resto na primeira parcela", () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it("fecha o total para 1 a 24 parcelas em valores variados", () => {
    const totals = [1, 7, 100, 999, 10000, 123457, 999999];
    for (const total of totals) {
      for (let parts = 1; parts <= 24; parts += 1) {
        const values = splitCents(total, parts);
        expect(values).toHaveLength(parts);
        expect(sumCents(values)).toBe(total);
      }
    }
  });

  it("preserva o sinal em totais negativos", () => {
    const values = splitCents(-10000, 3);
    expect(values).toEqual([-3334, -3333, -3333]);
    expect(sumCents(values)).toBe(-10000);
  });

  it("rejeita parcelas inválidas e totais fracionários", () => {
    expect(() => splitCents(100, 0)).toThrow();
    expect(() => splitCents(100.5, 2)).toThrow();
  });
});

describe("allocateByRatio", () => {
  it("divide 1/3 e 2/3 fechando o total", () => {
    const values = allocateByRatio(100000, [2500, 5000]);
    expect(sumCents(values)).toBe(100000);
    expect(values).toEqual([33333, 66667]);
  });

  it("cai no rateio igualitário quando todas as proporções são zero", () => {
    expect(allocateByRatio(100, [0, 0])).toEqual([50, 50]);
  });

  it("fecha o total também com valores negativos", () => {
    const values = allocateByRatio(-100000, [1, 2]);
    expect(sumCents(values)).toBe(-100000);
  });

  it("devolve lista vazia para entrada vazia e rejeita proporção negativa", () => {
    expect(allocateByRatio(100, [])).toEqual([]);
    expect(() => allocateByRatio(100, [-1, 2])).toThrow();
  });
});

describe("parseCurrencyInput", () => {
  it("aceita as formas que se digita em pt-BR", () => {
    expect(parseCurrencyInput("1.234,56")).toBe(123456);
    expect(parseCurrencyInput("1234,56")).toBe(123456);
    expect(parseCurrencyInput("1234.56")).toBe(123456);
    expect(parseCurrencyInput("R$ 1.234,56")).toBe(123456);
    expect(parseCurrencyInput("1234")).toBe(123400);
    expect(parseCurrencyInput("1.234")).toBe(123400);
    expect(parseCurrencyInput("0,5")).toBe(50);
  });

  it("entende negativos com sinal e com parênteses", () => {
    expect(parseCurrencyInput("-12,34")).toBe(-1234);
    expect(parseCurrencyInput("(12,34)")).toBe(-1234);
  });

  it("devolve null para entradas inválidas", () => {
    expect(parseCurrencyInput("")).toBeNull();
    expect(parseCurrencyInput("abc")).toBeNull();
    expect(parseCurrencyInput("12,34,56")).toBeNull();
    expect(parseCurrencyInput("R$")).toBeNull();
  });
});
