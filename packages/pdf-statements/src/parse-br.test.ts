import { describe, expect, it } from "vitest";
import { parseAmountBR, parseDateBR, parseInstallment, parseTimeBR } from "./parse-br.js";

describe("parseAmountBR", () => {
  it.each([
    ["R$ 1.234,56", 123456, false],
    ["1234,56", 123456, false],
    ["-R$ 80,00", -8000, true],
    ["R$ -80,00", -8000, true],
    ["1.234,56 D", -123456, true],
    ["1.234,56 C", 123456, true],
    ["(1.234,56)", -123456, true],
    ["-1.234,56", -123456, true],
    ["1.234,56-", -123456, true],
    ["0,00", 0, false],
    ["R$ 2.212,80", 221280, false]
  ])("%s -> %i centavos (sinal marcado: %s)", (text, cents, signKnown) => {
    expect(parseAmountBR(text)).toEqual({ cents, signKnown });
  });

  it("espaco nao separavel (comum em PDF) conta como espaco", () => {
    expect(parseAmountBR("R$\u00a01.234,56")).toEqual({ cents: 123456, signKnown: false });
  });

  it("devolve nulo no que nao e valor", () => {
    expect(parseAmountBR("Saldo Diário")).toBeNull();
    expect(parseAmountBR("1.234,5")).toBeNull();
    expect(parseAmountBR("12.34,56")).toBeNull();
    expect(parseAmountBR("")).toBeNull();
  });
});

describe("parseDateBR", () => {
  const january = { statementYear: 2026, statementMonth: 1 };

  it("le DD/MM/AAAA e DD/MM/AA sem precisar de contexto", () => {
    expect(parseDateBR("28/09/2026")).toBe("2026-09-28");
    expect(parseDateBR("28/09/26")).toBe("2026-09-28");
  });

  it("a fatura de dezembro lida em janeiro fica em dezembro do ano anterior", () => {
    expect(parseDateBR("31/12", january)).toBe("2025-12-31");
    expect(parseDateBR("05/01", january)).toBe("2026-01-05");
    expect(parseDateBR("15 DEZ", january)).toBe("2025-12-15");
  });

  it("sem ano e sem contexto nao inventa o ano", () => {
    expect(parseDateBR("31/12")).toBeNull();
  });

  it("recusa data que nao existe", () => {
    expect(parseDateBR("31/02/2026")).toBeNull();
  });
});

describe("parseTimeBR", () => {
  it("le 11h27 e 11:27", () => {
    expect(parseTimeBR("11h27")).toBe("11:27");
    expect(parseTimeBR("8:05")).toBe("08:05");
    expect(parseTimeBR("25h00")).toBeNull();
  });
});

describe("parseInstallment", () => {
  it.each([
    ["PARCELA 3/7", 3, 7],
    ["LOJA PARC 03/07", 3, 7],
    ["LOJA 3/7", 3, 7],
    ["LOJA 3 DE 7", 3, 7],
    ["LOJA (3/7)", 3, 7]
  ])("%s", (text, current, total) => {
    expect(parseInstallment(text)).toEqual({ current, total });
  });

  it("nao confunde data nem parcela impossivel", () => {
    expect(parseInstallment("Mercado")).toBeNull();
    expect(parseInstallment("LOJA 8/7")).toBeNull();
  });
});
