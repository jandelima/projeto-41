import { addMonths, daysBetween, formatMonth, parseMonth } from "./dates.js";

/**
 * Progresso e projeção de caixinha. Puro: sem banco, sem relógio — "hoje" é
 * sempre parâmetro.
 */

export type GoalProgressInput = {
  balanceCents: number;
  targetAmountCents?: number | null;
  targetDate?: string | null;
  asOf: string;
};

export function goalProgress(input: GoalProgressInput) {
  const target = input.targetAmountCents ?? null;
  return {
    targetRatioPerMille:
      target != null && target > 0
        ? Math.round((input.balanceCents / target) * 1000)
        : null,
    remainingCents: target != null ? Math.max(target - input.balanceCents, 0) : null,
    daysToTarget: input.targetDate ? daysBetween(input.asOf, input.targetDate) : null
  };
}

export type CompletionProjection = {
  monthlyDepositCents: number;
  estimatedDate: string | null;
  basis: "deposits" | "deposits+yield" | "none";
};

/** Teto de iterações: 50 anos é mais do que qualquer caixinha real. */
const MAX_MONTHS = 600;

/**
 * Quando a caixinha chega ao alvo, no ritmo atual.
 *
 * O ritmo é a média dos depósitos dos **últimos 3 meses fechados** (ou desde o
 * primeiro aporte, se ele for mais recente). Ritmo zero devolve `null`, nunca
 * `Infinity` nem uma data no ano 3000 — uma data inventada é pior que nenhuma.
 */
export function projectCompletion(input: {
  balanceCents: number;
  targetAmountCents?: number | null;
  /** Depósitos por mês `YYYY-MM`, para apurar o ritmo. */
  depositsByMonth: Record<string, number>;
  /** Fator mensal do rendimento, 1 quando a caixinha não rende. */
  monthlyYieldFactor?: number;
  asOf: string;
}): CompletionProjection {
  const target = input.targetAmountCents ?? null;
  const factor = input.monthlyYieldFactor ?? 1;

  // Os 3 meses fechados anteriores ao mês corrente, a partir do primeiro
  // aporte. Mês sem depósito dentro da janela conta como zero: tirá-lo da
  // média fazia um único depósito valer como ritmo mensal.
  const current = parseMonth(input.asOf.slice(0, 7));
  const firstMonth = Object.keys(input.depositsByMonth)
    .filter((month) => (input.depositsByMonth[month] ?? 0) > 0)
    .sort()[0];
  const window = [1, 2, 3]
    .map((offset) => formatMonth(addMonths(current, -offset)))
    .filter((month) => firstMonth != null && month >= firstMonth);
  const total = window.reduce((sum, month) => sum + (input.depositsByMonth[month] ?? 0), 0);
  const monthlyDepositCents = window.length > 0 ? Math.round(total / window.length) : 0;

  if (target == null || input.balanceCents >= target) {
    return { monthlyDepositCents, estimatedDate: null, basis: "none" };
  }
  if (monthlyDepositCents <= 0 && factor <= 1) {
    return { monthlyDepositCents: 0, estimatedDate: null, basis: "none" };
  }

  let balance = input.balanceCents;
  for (let month = 1; month <= MAX_MONTHS; month += 1) {
    balance = balance * factor + monthlyDepositCents;
    if (balance >= target) {
      const anchor = addMonths(current, month);
      return {
        monthlyDepositCents,
        estimatedDate: `${formatMonth(anchor)}-01`,
        basis: factor > 1 ? "deposits+yield" : "deposits"
      };
    }
  }
  return { monthlyDepositCents, estimatedDate: null, basis: "none" };
}
