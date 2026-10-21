import { daysBetween } from "./dates.js";

/**
 * Lucro de uma caixinha: quanto rendeu, em % até agora e em % ao ano.
 *
 * O dinheiro que **você pôs** (aportes e saques) e o **lucro** (rendimento,
 * lucro lançado, ajustes de lucro) vêm separados, porque o percentual é lucro
 * sobre o dinheiro que esteve parado, e não sobre o saldo, que já inclui o
 * próprio lucro.
 */
export type ProfitEvent = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Positivo entra na caixinha, negativo sai. */
  cents: number;
  /** Lucro (ou o ajuste dele): conta no lucro e não no dinheiro que você pôs. */
  profit: boolean;
};

export type ProfitMetrics = {
  /** Lucro total até `asOf`, em centavos (pode ser negativo). */
  profitCents: number;
  /** Soma do que você pôs na caixinha, sem os saques. */
  depositedCents: number;
  /** Dinheiro parado em média no período, em centavos (capital × dias ÷ dias). */
  averageCapitalCents: number;
  /** Dias entre o primeiro aporte e o fim do período considerado. */
  days: number;
  /** Lucro sobre o capital médio, em % (ex.: `0.38` = 0,38%). `null` sem base. */
  periodPercent: number | null;
  /** Taxa ao ano se o ritmo se mantiver, em % composta. `null` sem base. */
  annualPercent: number | null;
  /** Poucos dias de histórico: a taxa anual oscila muito e é só indicativa. */
  shortHistory: boolean;
};

/** Abaixo disso, projetar um ano a partir do período é pouco confiável. */
export const SHORT_HISTORY_DAYS = 30;

const EMPTY: ProfitMetrics = {
  profitCents: 0,
  depositedCents: 0,
  averageCapitalCents: 0,
  days: 0,
  periodPercent: null,
  annualPercent: null,
  shortHistory: true
};

/**
 * Lucro, % até agora e % ao ano projetado.
 *
 * - **Capital** em cada dia = tudo que entrou e saiu menos o lucro acumulado até
 *   ali (nunca negativo). Resgatar tudo zera o capital, mesmo com lucro no saldo.
 * - **Capital médio** pondera cada valor pelos dias em que ficou na caixinha;
 *   um aporte de ontem pesa menos que um de três meses atrás.
 * - **% até agora** = lucro ÷ capital médio.
 * - **% ao ano** repete esse ritmo por 365 dias, em juros compostos. Quem
 *   resgatou tudo é medido até o último movimento, e não até hoje: dias sem
 *   dinheiro parado não diluem a taxa.
 */
export function profitMetrics(input: { events: ProfitEvent[]; asOf: string }): ProfitMetrics {
  const events = input.events
    .filter((event) => event.date <= input.asOf)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const profitCents = events.filter((e) => e.profit).reduce((sum, e) => sum + e.cents, 0);
  const principal = events.filter((event) => !event.profit);
  const depositedCents = principal.filter((e) => e.cents > 0).reduce((sum, e) => sum + e.cents, 0);
  const first = principal.find((event) => event.cents > 0);
  if (!first) return { ...EMPTY, profitCents, depositedCents };

  const dates = [...new Set(events.map((event) => event.date))].filter((date) => date >= first.date);
  const capitalAt = (date: string) => {
    let total = 0;
    for (const event of events) {
      if (event.date > date) break;
      total += event.profit ? 0 : event.cents;
    }
    return Math.max(total, 0);
  };
  const balanceAt = (date: string) =>
    events.filter((event) => event.date <= date).reduce((sum, e) => sum + e.cents, 0);

  // Com dinheiro na caixinha o período vai até hoje; zerada, até o último movimento.
  const last = dates[dates.length - 1] ?? first.date;
  const end = balanceAt(input.asOf) > 0 ? input.asOf : last;
  const days = Math.max(daysBetween(first.date, end), 0);

  let weighted = 0;
  const marks = [...dates.filter((date) => date < end), end];
  for (let index = 0; index < marks.length - 1; index += 1) {
    weighted += capitalAt(marks[index]!) * daysBetween(marks[index]!, marks[index + 1]!);
  }
  const averageCapitalCents =
    days > 0 ? Math.round(weighted / days) : capitalAt(end);

  if (averageCapitalCents <= 0) {
    return { ...EMPTY, profitCents, depositedCents, days };
  }
  const ratio = profitCents / averageCapitalCents;
  const periodPercent = ratio * 100;
  const annualPercent =
    days >= 1 && ratio > -1 ? (Math.pow(1 + ratio, 365 / days) - 1) * 100 : null;
  return {
    profitCents,
    depositedCents,
    averageCapitalCents,
    days,
    periodPercent,
    annualPercent: annualPercent != null && Number.isFinite(annualPercent) ? annualPercent : null,
    shortHistory: days < SHORT_HISTORY_DAYS
  };
}
