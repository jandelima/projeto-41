import { describe, expect, it } from "vitest";
import { profitMetrics, SHORT_HISTORY_DAYS, type ProfitEvent } from "./goal-profit.js";

const put = (date: string, cents: number): ProfitEvent => ({ date, cents, profit: false });
const profit = (date: string, cents: number): ProfitEvent => ({ date, cents, profit: true });

describe("profitMetrics", () => {
  it("sem aporte nao ha base para percentual", () => {
    const result = profitMetrics({ events: [], asOf: "2026-10-14" });
    expect(result).toMatchObject({ profitCents: 0, periodPercent: null, annualPercent: null });
  });

  it("lucro sobre o capital parado, e a taxa anual composta", () => {
    // R$ 1.000 por 100 dias com R$ 10 de lucro: 1% no periodo.
    const result = profitMetrics({
      events: [put("2026-01-01", 100_000), profit("2026-04-11", 1_000)],
      asOf: "2026-04-11"
    });
    expect(result.days).toBe(100);
    expect(result.averageCapitalCents).toBe(100_000);
    expect(result.periodPercent).toBeCloseTo(1, 6);
    expect(result.annualPercent).toBeCloseTo((Math.pow(1.01, 3.65) - 1) * 100, 6);
    expect(result.shortHistory).toBe(false);
  });

  it("o lucro nao entra no capital: o percentual nao se dilui no proprio lucro", () => {
    const withProfit = profitMetrics({
      events: [put("2026-01-01", 100_000), profit("2026-02-01", 5_000)],
      asOf: "2026-04-11"
    });
    expect(withProfit.averageCapitalCents).toBe(100_000);
    expect(withProfit.periodPercent).toBeCloseTo(5, 6);
  });

  it("aporte novo pesa menos que um antigo", () => {
    const result = profitMetrics({
      events: [put("2026-01-01", 100_000), put("2026-01-11", 100_000)],
      asOf: "2026-01-21"
    });
    // 20 dias: 10 com 1.000 e 10 com 2.000.
    expect(result.averageCapitalCents).toBe(150_000);
    expect(result.depositedCents).toBe(200_000);
  });

  it("resgatar tudo mede ate o ultimo movimento, nao ate hoje", () => {
    const result = profitMetrics({
      events: [put("2026-09-28", 70_000), profit("2026-10-14", 38), { date: "2026-10-14", cents: -70_038, profit: false }],
      asOf: "2026-12-31"
    });
    expect(result.days).toBe(16);
    expect(result.profitCents).toBe(38);
    expect(result.averageCapitalCents).toBe(70_000);
    expect(result.shortHistory).toBe(true);
  });

  it("poucos dias avisam que a taxa anual e so indicativa", () => {
    const result = profitMetrics({
      events: [put("2026-10-01", 100_000), profit("2026-10-08", 100)],
      asOf: "2026-10-08"
    });
    expect(result.days).toBeLessThan(SHORT_HISTORY_DAYS);
    expect(result.shortHistory).toBe(true);
    expect(result.annualPercent).not.toBeNull();
  });

  it("no dia do aporte nao projeta ano nenhum", () => {
    const result = profitMetrics({ events: [put("2026-10-14", 50_000)], asOf: "2026-10-14" });
    expect(result.days).toBe(0);
    expect(result.annualPercent).toBeNull();
    expect(result.averageCapitalCents).toBe(50_000);
  });

  it("lucro negativo vira percentual negativo", () => {
    const result = profitMetrics({
      events: [put("2026-01-01", 100_000), profit("2026-02-01", -1_000)],
      asOf: "2026-04-11"
    });
    expect(result.periodPercent).toBeCloseTo(-1, 6);
    expect(result.annualPercent!).toBeLessThan(0);
  });

  it("ignora o que e depois da data", () => {
    const result = profitMetrics({
      events: [put("2026-01-01", 100_000), profit("2026-12-01", 9_999)],
      asOf: "2026-04-11"
    });
    expect(result.profitCents).toBe(0);
  });
});
