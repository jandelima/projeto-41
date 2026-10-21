import { describe, expect, it } from "vitest";
import { estimateRedemption, iofFreeDate, iofRatePercent, irRatePercent } from "./taxes.js";

/** Um lote cujo rendimento é 10.000 centavos, começando na data dada. */
const lot = (startDate: string, yieldCents = 10_000, principalCents = 1_000_000) => ({
  principalCents,
  startDate,
  yieldCents
});

describe("IOF", () => {
  it("cobra 96% no primeiro dia e 3% no vigesimo nono", () => {
    expect(iofRatePercent(1)).toBe(96);
    expect(iofRatePercent(29)).toBe(3);
  });

  it("zera a partir do trigesimo dia", () => {
    expect(iofRatePercent(30)).toBe(0);
    expect(iofRatePercent(31)).toBe(0);
    expect(iofRatePercent(400)).toBe(0);
  });

  it("fronteira 29 x 30 dias sobre um rendimento de 100 reais", () => {
    // 29 dias: 3% de 10.000 centavos = 300.
    const antes = estimateRedemption({ lots: [lot("2026-01-01")], asOf: "2026-01-30" });
    expect(antes.byLot[0]?.days).toBe(29);
    expect(antes.iofCents).toBe(300);

    // 30 dias: zero.
    const depois = estimateRedemption({ lots: [lot("2026-01-01")], asOf: "2026-01-31" });
    expect(depois.byLot[0]?.days).toBe(30);
    expect(depois.iofCents).toBe(0);
  });

  it("informa o dia em que o IOF zera", () => {
    expect(iofFreeDate("2026-01-01")).toBe("2026-01-31");
  });
});

describe("IR regressivo", () => {
  it("respeita cada fronteira, inclusiva na faixa de baixo", () => {
    expect(irRatePercent(180)).toBe(22.5);
    expect(irRatePercent(181)).toBe(20);
    expect(irRatePercent(360)).toBe(20);
    expect(irRatePercent(361)).toBe(17.5);
    expect(irRatePercent(720)).toBe(17.5);
    expect(irRatePercent(721)).toBe(15);
  });

  it("aplica a aliquota da faixa no resgate", () => {
    // 200 dias: 20% de 10.000 = 2.000, sem IOF (passou de 30 dias).
    const result = estimateRedemption({
      lots: [lot("2026-01-01")],
      asOf: "2026-07-20"
    });
    expect(result.byLot[0]?.days).toBe(200);
    expect(result.iofCents).toBe(0);
    expect(result.irCents).toBe(2_000);
  });
});

describe("composicao de IOF e IR", () => {
  it("o IR incide sobre o rendimento JA liquido de IOF", () => {
    // 10 dias: IOF 66% de 10.000 = 6.600. Sobram 3.400, e o IR de 22,5% sobre
    // isso é 765 — não 2.250, que seria o IR sobre o bruto.
    const result = estimateRedemption({ lots: [lot("2026-01-01")], asOf: "2026-01-11" });
    expect(result.iofCents).toBe(6_600);
    expect(result.irCents).toBe(765);
    expect(result.netCents).toBe(1_000_000 + 10_000 - 6_600 - 765);
  });

  it("nenhum imposto incide sobre o principal", () => {
    const result = estimateRedemption({
      lots: [{ principalCents: 1_000_000, startDate: "2026-01-01", yieldCents: 0 }],
      asOf: "2026-01-11"
    });
    expect(result.iofCents).toBe(0);
    expect(result.irCents).toBe(0);
    expect(result.netCents).toBe(1_000_000);
  });

  it("rendimento negativo nao gera imposto negativo", () => {
    const result = estimateRedemption({
      lots: [{ principalCents: 1_000_000, startDate: "2026-01-01", yieldCents: -500 }],
      asOf: "2026-06-01"
    });
    expect(result.iofCents).toBe(0);
    expect(result.irCents).toBe(0);
  });
});

describe("isencao", () => {
  it("zera so o IR e mantem o IOF", () => {
    const result = estimateRedemption({
      lots: [lot("2026-01-01")],
      asOf: "2026-01-11",
      taxExempt: true
    });
    expect(result.iofCents).toBe(6_600);
    expect(result.irCents).toBe(0);
  });
});

describe("lote a lote", () => {
  it("aportes de idades diferentes pagam aliquotas diferentes", () => {
    const result = estimateRedemption({
      lots: [
        // Dois anos e um mês: 15%.
        lot("2024-01-01"),
        // Cem dias: 22,5%.
        lot("2025-12-01")
      ],
      asOf: "2026-03-11"
    });

    const [velho, novo] = result.byLot;
    expect(velho!.irCents).toBe(1_500);
    expect(novo!.irCents).toBe(2_250);
    // Somar tudo e aplicar uma alíquota média daria outro número.
    expect(result.irCents).toBe(3_750);
  });
});
