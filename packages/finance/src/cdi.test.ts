import { describe, expect, it } from "vitest";
import {
  accrueLots,
  accumulatedFactor,
  consumeLots,
  dayFactor,
  tdiFromAnnual252,
  tdiFromDailyPercent
} from "./cdi.js";
import { cdiCarnaval2026, cdiSetembro2026, feriadosCarnaval2026 } from "./cdi.fixtures.js";

const NO_HOLIDAYS = new Set<string>();

describe("taxa diaria", () => {
  it("as duas portas chegam ao mesmo numero para a mesma taxa", () => {
    // (1 + 13,65/100)^(1/252) − 1 = 0,00050788, que é exatamente o valor da
    // série 12 no mesmo dia (plano mestre 6.8).
    expect(tdiFromAnnual252(13.65)).toBeCloseTo(0.00050788, 8);
    expect(tdiFromDailyPercent(0.050788)).toBe(0.00050788);
  });

  it("a serie 12 nao e elevada a 1/252 de novo", () => {
    // Aplicar a raiz sobre a série 12 reduziria o rendimento a quase zero.
    const certo = tdiFromDailyPercent(0.050788);
    const errado = (1 + 0.050788 / 100) ** (1 / 252) - 1;
    expect(certo).toBeGreaterThan(errado * 100);
  });
});

describe("percentual do CDI", () => {
  it("110% do CDI e linear, nao (1 + TDI) elevado a 1,1", () => {
    const rate = { date: "2026-09-17", dailyRatePercent: 0.050788 };
    const tdi = tdiFromDailyPercent(rate.dailyRatePercent);

    const linear = dayFactor(rate, 110);
    const exponencial = (1 + tdi) ** 1.1;

    // O correto é o linear.
    expect(linear).toBeCloseTo(1 + tdi * 1.1, 12);
    expect(linear).not.toBeCloseTo(exponencial, 12);
  });

  it("100% reproduz o CDI cheio", () => {
    const rate = { date: "2026-09-17", dailyRatePercent: 0.050788 };
    expect(dayFactor(rate, 100)).toBe(1 + tdiFromDailyPercent(0.050788));
  });

  it("serie vazia devolve fator exatamente 1", () => {
    expect(accumulatedFactor([], 110)).toBe(1);
  });
});

describe("exemplo trabalhado do plano de fase", () => {
  it("R$ 10.000,00 a 110% do CDI em 16 e 17/09/2026", () => {
    const [dia16, dia17] = cdiSetembro2026;

    // Fatores diários, 9 casas.
    expect(dayFactor(dia16!, 110)).toBeCloseTo(1.00056826, 9);
    expect(dayFactor(dia17!, 110)).toBeCloseTo(1.000558668, 9);

    const factor = accumulatedFactor(cdiSetembro2026, 110);
    expect(factor).toBeCloseTo(1.00112725, 8);

    const result = accrueLots({
      lots: [{ principalCents: 1_000_000, startDate: "2026-09-16" }],
      rates: cdiSetembro2026,
      cdiPercent: 110,
      from: "2026-09-16",
      to: "2026-09-17",
      holidays: NO_HOLIDAYS
    });

    expect(result.grossCents).toBe(1_001_127);
    expect(result.realizedYieldCents).toBe(1_127);
  });
});

describe("semana com feriado", () => {
  const lots = [{ principalCents: 1_000_000, startDate: "2026-02-16" }];

  it("rende em 3 dias uteis no Carnaval, nao em 5", () => {
    const result = accrueLots({
      lots,
      rates: cdiCarnaval2026,
      cdiPercent: 100,
      from: "2026-02-16",
      to: "2026-02-22",
      holidays: feriadosCarnaval2026
    });

    // 3 dias úteis publicados, e nenhuma projeção: as linhas de 16 e 17/02 não
    // existem porque são feriado, o que está certo e não é buraco.
    expect(result.realizedThroughDate).toBe("2026-02-20");
    expect(result.projectedYieldCents).toBe(0);
    expect(result.projectedThroughDate).toBeNull();

    const esperado = 1_000_000 * accumulatedFactor(cdiCarnaval2026, 100) - 1_000_000;
    expect(result.realizedYieldCents).toBe(Math.round(esperado));
  });

  it("sabado e domingo tambem nao geram projecao", () => {
    const result = accrueLots({
      lots,
      rates: cdiCarnaval2026,
      cdiPercent: 100,
      from: "2026-02-21",
      to: "2026-02-22",
      holidays: feriadosCarnaval2026
    });
    expect(result.realizedYieldCents).toBe(0);
    expect(result.projectedYieldCents).toBe(0);
  });
});

describe("realizado e projetado", () => {
  it("dia util sem taxa publicada so entra na projecao", () => {
    const result = accrueLots({
      lots: [{ principalCents: 1_000_000, startDate: "2026-09-16" }],
      rates: cdiSetembro2026,
      cdiPercent: 100,
      from: "2026-09-16",
      // 18/09 é sexta e não tem taxa na fixture: vira projeção.
      to: "2026-09-18",
      holidays: NO_HOLIDAYS
    });

    expect(result.realizedThroughDate).toBe("2026-09-17");
    expect(result.projectedThroughDate).toBe("2026-09-18");
    expect(result.projectedYieldCents).toBeGreaterThan(0);
    // O realizado não é contaminado pela projeção.
    expect(result.grossCents).toBe(1_000_000 + result.realizedYieldCents);
  });

  it("sem nenhuma taxa publicada, nao ha projecao e nada e NaN", () => {
    const result = accrueLots({
      lots: [{ principalCents: 1_000_000, startDate: "2026-09-16" }],
      rates: [],
      cdiPercent: 110,
      from: "2026-09-16",
      to: "2026-09-18",
      holidays: NO_HOLIDAYS
    });
    expect(result.realizedYieldCents).toBe(0);
    expect(result.projectedYieldCents).toBe(0);
    expect(Number.isNaN(result.grossCents)).toBe(false);
  });
});

describe("lotes", () => {
  it("cada lote rende a partir da propria data", () => {
    const result = accrueLots({
      lots: [
        { principalCents: 1_000_000, startDate: "2026-09-16" },
        { principalCents: 1_000_000, startDate: "2026-09-17" }
      ],
      rates: cdiSetembro2026,
      cdiPercent: 110,
      from: "2026-09-16",
      to: "2026-09-17",
      holidays: NO_HOLIDAYS
    });

    const [primeiro, segundo] = result.lots;
    // O primeiro rendeu dois dias; o segundo, um só.
    expect(primeiro!.realizedYieldCents).toBeGreaterThan(segundo!.realizedYieldCents);
    expect(result.realizedYieldCents).toBe(
      primeiro!.realizedYieldCents + segundo!.realizedYieldCents
    );
  });

  it("principal zero devolve zero", () => {
    const result = accrueLots({
      lots: [{ principalCents: 0, startDate: "2026-09-16" }],
      rates: cdiSetembro2026,
      cdiPercent: 110,
      from: "2026-09-16",
      to: "2026-09-17",
      holidays: NO_HOLIDAYS
    });
    expect(result.realizedYieldCents).toBe(0);
    expect(result.grossCents).toBe(0);
  });

  it("aporte rende em D+0", () => {
    const result = accrueLots({
      lots: [{ principalCents: 1_000_000, startDate: "2026-09-17" }],
      rates: cdiSetembro2026,
      cdiPercent: 100,
      from: "2026-09-17",
      to: "2026-09-17",
      holidays: NO_HOLIDAYS
    });
    expect(result.realizedYieldCents).toBeGreaterThan(0);
  });
});

describe("consumeLots", () => {
  const lots = [
    { principalCents: 30_000, startDate: "2026-01-10" },
    { principalCents: 50_000, startDate: "2026-05-10" }
  ];

  it("consome o lote mais antigo primeiro (FIFO)", () => {
    expect(consumeLots(lots, 30_000)).toEqual([
      { principalCents: 50_000, startDate: "2026-05-10" }
    ]);
  });

  it("consome parcialmente o lote mais antigo", () => {
    expect(consumeLots(lots, 10_000)).toEqual([
      { principalCents: 20_000, startDate: "2026-01-10" },
      { principalCents: 50_000, startDate: "2026-05-10" }
    ]);
  });

  it("saque total esvazia os lotes", () => {
    expect(consumeLots(lots, 80_000)).toEqual([]);
  });
});
