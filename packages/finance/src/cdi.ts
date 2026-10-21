import { businessDaysBetween, type Holidays } from "./business-days.js";

/**
 * Motor de rendimento CDI (plano mestre 6.8).
 *
 * **Toda a matemática de CDI mora aqui**, pura: sem rede, sem banco e sem
 * relógio — "hoje" é sempre parâmetro. A API só busca e guarda; a interface só
 * desenha.
 */

export type CdiRate = {
  date: string;
  /**
   * O valor da **série 12** como o BCB publica: percentual ao dia útil
   * (`0.050788` = 0,050788%). Não é fator: multiplicar o principal por isso
   * direto erra por três ordens de grandeza.
   */
  dailyRatePercent: number;
};

/** Arredonda o TDI em 8 casas, como a convenção do Índice DI. */
const round8 = (value: number) => Math.round(value * 1e8) / 1e8;

/**
 * TDI a partir da série **4389** (anualizada base 252).
 *
 * `TDI = (1 + DI/100) ^ (1/252) − 1`
 */
export function tdiFromAnnual252(annualPercent: number): number {
  return round8((1 + annualPercent / 100) ** (1 / 252) - 1);
}

/**
 * TDI a partir da série **12**.
 *
 * O valor publicado **já é a taxa ao dia útil**: o BCB já aplicou a raiz 252 e
 * já arredondou em 8 casas na origem. Elevar a `1/252` de novo reduziria o
 * rendimento a praticamente zero — é o erro silencioso que 6.8 alerta.
 */
export function tdiFromDailyPercent(dailyRatePercent: number): number {
  return round8(dailyRatePercent / 100);
}

/**
 * Fator de um dia para uma caixinha a `p`% do CDI.
 *
 * `fator = 1 + TDI × (p / 100)`
 *
 * **A multiplicação pelo percentual é LINEAR, jamais exponencial.**
 * `(1 + TDI) ** (p/100)` é o erro clássico: para 110% do CDI ele diverge alguns
 * centavos no primeiro mês e alguns reais no primeiro ano.
 */
export function dayFactor(rate: CdiRate, cdiPercent: number): number {
  return 1 + tdiFromDailyPercent(rate.dailyRatePercent) * (cdiPercent / 100);
}

/** Produtório dos fatores diários. Série vazia devolve exatamente 1. */
export function accumulatedFactor(rates: readonly CdiRate[], cdiPercent: number): number {
  return rates.reduce((factor, rate) => factor * dayFactor(rate, cdiPercent), 1);
}

export type Lot = {
  /** Valor aportado, em centavos. */
  principalCents: number;
  /** O rendimento começa nesta data, inclusive: aporte rende em D+0. */
  startDate: string;
};

export type LotYield = Lot & {
  factor: number;
  realizedYieldCents: number;
  projectedYieldCents: number;
};

export type AccrualResult = {
  lots: LotYield[];
  principalCents: number;
  /** Rendimento de dias com taxa **publicada**. */
  realizedYieldCents: number;
  realizedThroughDate: string | null;
  /**
   * Rendimento de dias úteis **sem** taxa publicada, repetindo o último fator
   * conhecido. Nunca somado ao realizado: são campos distintos de propósito.
   */
  projectedYieldCents: number;
  projectedThroughDate: string | null;
  grossCents: number;
};

/** Half-up simétrico, como `toCents`. */
const roundCents = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * Math.round(magnitude + Number.EPSILON * magnitude);
};

/**
 * Rende cada lote separadamente.
 *
 * Aportes são **lotes, não um saldo único**, porque o IR depende da idade de
 * cada aporte — somar tudo e aplicar uma alíquota média seria errado.
 *
 * O arredondamento para centavo acontece **uma vez por lote**, no fim, e o
 * total é a soma dos lotes arredondados: assim o todo sempre fecha com as
 * partes e não aparece diferença de 1 centavo na tela.
 *
 * Fim de semana e feriado **não têm linha e isso está certo** — não são buraco,
 * não geram projeção e não disparam alerta. Só dia **útil** sem taxa vira
 * projeção, inclusive hoje, porque o BCB publica em D+1.
 */
export function accrueLots(input: {
  lots: readonly Lot[];
  rates: readonly CdiRate[];
  cdiPercent: number;
  from: string;
  to: string;
  holidays: Holidays;
}): AccrualResult {
  const { lots, rates, cdiPercent, from, to, holidays } = input;
  const byDate = new Map(rates.map((rate) => [rate.date, rate]));
  const lastPublished = rates.length > 0 ? (rates.at(-1) as CdiRate) : null;
  const businessDays = businessDaysBetween(from, to, holidays);

  const realizedDays = businessDays.filter((date) => byDate.has(date));
  const projectedDays = businessDays.filter((date) => !byDate.has(date));

  const result: LotYield[] = lots.map((lot) => {
    const realizedFactor = realizedDays
      .filter((date) => date >= lot.startDate)
      .reduce((factor, date) => factor * dayFactor(byDate.get(date)!, cdiPercent), 1);

    // A projeção repete o último fator conhecido; sem nenhuma taxa publicada
    // não há o que repetir, e a projeção é zero — nunca NaN.
    const projectedCount = lastPublished
      ? projectedDays.filter((date) => date >= lot.startDate).length
      : 0;
    const projectedFactor = lastPublished
      ? dayFactor(lastPublished, cdiPercent) ** projectedCount
      : 1;

    const realizedYieldCents = roundCents(lot.principalCents * (realizedFactor - 1));
    const grossRealized = lot.principalCents * realizedFactor;
    const projectedYieldCents = roundCents(grossRealized * (projectedFactor - 1));

    return {
      ...lot,
      factor: realizedFactor,
      realizedYieldCents,
      projectedYieldCents
    };
  });

  const principalCents = lots.reduce((sum, lot) => sum + lot.principalCents, 0);
  const realizedYieldCents = result.reduce((sum, lot) => sum + lot.realizedYieldCents, 0);
  const projectedYieldCents = result.reduce((sum, lot) => sum + lot.projectedYieldCents, 0);

  return {
    lots: result,
    principalCents,
    realizedYieldCents,
    realizedThroughDate: realizedDays.at(-1) ?? null,
    projectedYieldCents,
    projectedThroughDate: projectedDays.at(-1) ?? null,
    grossCents: principalCents + realizedYieldCents
  };
}

/**
 * Consome lotes em **FIFO**: o dinheiro mais antigo sai primeiro, que é o que
 * também define qual alíquota de IR se aplica ao que resta.
 */
export function consumeLots(lots: readonly Lot[], amountCents: number): Lot[] {
  let remaining = amountCents;
  const ordered = [...lots].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const result: Lot[] = [];

  for (const lot of ordered) {
    if (remaining <= 0) {
      result.push(lot);
      continue;
    }
    if (lot.principalCents <= remaining) {
      remaining -= lot.principalCents;
      continue;
    }
    result.push({ ...lot, principalCents: lot.principalCents - remaining });
    remaining = 0;
  }
  return result;
}
