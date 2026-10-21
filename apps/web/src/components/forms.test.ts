import { describe, expect, it } from "vitest";
import { parseCurrencyInput } from "@projeto41/finance";
import { formatMoneyInput } from "./forms.js";
import { installmentOf } from "./finance/InstallmentBadge.js";
import { purchaseTotal } from "./finance/InstallmentFields.js";
import { monthPeriod, shiftPeriod, yearPeriod } from "./finance/PeriodPicker.js";

describe("campo de dinheiro", () => {
  it("formata centavos em pt-BR, com milhar e sinal", () => {
    expect(formatMoneyInput(123456)).toBe("1.234,56");
    expect(formatMoneyInput(5)).toBe("0,05");
    expect(formatMoneyInput(-9990)).toBe("-99,90");
  });

  it("devolve texto que os formulários já sabem ler", () => {
    for (const cents of [0, 5, 123456, -9990, 1_000_000_00]) {
      expect(parseCurrencyInput(formatMoneyInput(cents))).toBe(cents);
    }
  });
});

describe("setas de período", () => {
  it("anda mês a mês atravessando o ano", () => {
    const january = monthPeriod(0, new Date(2026, 0, 15));
    expect(shiftPeriod(january, -1).period).toBe("2025-12");
    expect(shiftPeriod(january, 1)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("no modo ano, anda de ano em ano", () => {
    expect(shiftPeriod(yearPeriod(new Date(2026, 5, 1)), -1)).toMatchObject({
      from: "2025-01-01",
      to: "2025-12-31",
      year: 2025
    });
  });
});

describe("parcela", () => {
  it("usa o plano quando existe e a observação quando a parcela é solta", () => {
    expect(installmentOf({ installmentNumber: 2, installmentCount: 6, notes: null })).toEqual({
      number: 2,
      count: 6
    });
    expect(
      installmentOf({ installmentNumber: null, installmentCount: null, notes: "Parcela 3/4 (última)" })
    ).toEqual({ number: 3, count: 4 });
    expect(installmentOf({ installmentNumber: null, installmentCount: null, notes: "Sem pagador" })).toBeNull();
  });

  it("o valor digitado pode ser o total ou o de cada parcela", () => {
    expect(purchaseTotal(30000, "total", 3)).toBe(30000);
    expect(purchaseTotal(30000, "installment", 3)).toBe(90000);
  });
});
