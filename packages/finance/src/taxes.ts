import { addDays, daysBetween } from "./dates.js";

/**
 * IOF e IR regressivos sobre o rendimento (D15).
 *
 * As duas alíquotas incidem **só sobre o rendimento, jamais sobre o
 * principal** — errar isso faz o app dizer que o usuário perdeu dinheiro
 * guardado.
 *
 * **Verificado em 2026-09-21:** estas alíquotas de IR seguem em vigor. A MP
 * 1.303/2025, que criaria alíquota única de 17,5%, caducou sem votação em
 * 08/10/2025. Uma revisão futura deve reconferir a partir dessa data.
 *
 * **Come-cotas não se aplica.** É antecipação semestral de IR de fundo de
 * investimento, e caixinha não é fundo. Não implementar.
 */

/**
 * IOF regressivo por dia corrido de aplicação: dia 1 cobra 96% do rendimento,
 * dia 29 cobra 3%, e a partir do dia 30 não há IOF.
 */
const IOF_TABLE = [
  96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23,
  20, 16, 13, 10, 6, 3, 0
] as const;

export function iofRatePercent(days: number): number {
  if (days < 1) return IOF_TABLE[0];
  if (days >= IOF_TABLE.length) return 0;
  return IOF_TABLE[days - 1] ?? 0;
}

/**
 * IR/IRRF regressivo em dias corridos. Os limites são inclusivos na faixa de
 * baixo: 180 ainda é 22,5%, 181 já é 20%.
 */
export function irRatePercent(days: number): number {
  if (days <= 180) return 22.5;
  if (days <= 360) return 20;
  if (days <= 720) return 17.5;
  return 15;
}

const roundCents = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * Math.round(magnitude + Number.EPSILON * magnitude);
};

export type TaxLot = {
  principalCents: number;
  startDate: string;
  yieldCents: number;
};

export type LotTax = TaxLot & {
  days: number;
  iofCents: number;
  irCents: number;
  netYieldCents: number;
};

export type RedemptionEstimate = {
  principalCents: number;
  yieldCents: number;
  grossCents: number;
  iofCents: number;
  irCents: number;
  netCents: number;
  byLot: LotTax[];
};

/**
 * Estima o resgate **lote a lote**: um aporte de ontem e um de dois anos atrás
 * pagam alíquotas diferentes, e aplicar uma alíquota média ao total seria
 * errado.
 *
 * `taxExempt` existe para caixinha modelada sobre LCI/LCA ou poupança, isentas
 * de IR para pessoa física. Isento zera o IR e **mantém** o IOF.
 */
export function estimateRedemption(input: {
  lots: readonly TaxLot[];
  asOf: string;
  taxExempt?: boolean;
}): RedemptionEstimate {
  const byLot: LotTax[] = input.lots.map((lot) => {
    const days = daysBetween(lot.startDate, input.asOf);
    // Rendimento negativo é impossível no CDI, mas o tipo permite: imposto
    // sobre prejuízo não existe, então zera.
    const taxable = Math.max(lot.yieldCents, 0);

    const iofCents = roundCents((taxable * iofRatePercent(days)) / 100);
    // O IR incide sobre o rendimento **já líquido de IOF**, nunca sobre o bruto.
    const afterIof = taxable - iofCents;
    const irCents = input.taxExempt ? 0 : roundCents((afterIof * irRatePercent(days)) / 100);

    return {
      ...lot,
      days,
      iofCents,
      irCents,
      netYieldCents: lot.yieldCents - iofCents - irCents
    };
  });

  const principalCents = byLot.reduce((sum, lot) => sum + lot.principalCents, 0);
  const yieldCents = byLot.reduce((sum, lot) => sum + lot.yieldCents, 0);
  const iofCents = byLot.reduce((sum, lot) => sum + lot.iofCents, 0);
  const irCents = byLot.reduce((sum, lot) => sum + lot.irCents, 0);

  return {
    principalCents,
    yieldCents,
    grossCents: principalCents + yieldCents,
    iofCents,
    irCents,
    netCents: principalCents + yieldCents - iofCents - irCents,
    byLot
  };
}

/** Dia em que o IOF zera para um aporte, para a interface avisar. */
export function iofFreeDate(startDate: string): string {
  return addDays(startDate, IOF_TABLE.length);
}
