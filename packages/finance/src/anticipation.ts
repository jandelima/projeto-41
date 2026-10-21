import { allocateByRatio } from "./money.js";

/**
 * Desconto na antecipacao de parcelas.
 *
 * O banco costuma abater juros quando a parcela e paga antes, e informa isso de
 * quatro jeitos: um percentual por parcela, um percentual sobre o total, um
 * valor por parcela ou um valor unico para tudo. Todos viram a mesma coisa —
 * um desconto em centavos **por parcela** —, porque cada desconto e gravado
 * colado a sua parcela e sai junto com ela se a antecipacao for desfeita.
 *
 * `value` e inteiro como o resto do modulo (D19): centavos no modo `amount` e
 * centesimos de ponto percentual no modo `percent` (`1250` = 12,5%).
 */

export type AnticipationDiscountSpec = {
  mode: "percent" | "amount";
  scope: "each" | "total";
  value: number;
};

const FULL_PERCENT = 10_000;

/** `1250` -> `"12,5%"`. */
export function formatPercentHundredths(value: number): string {
  return `${(value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * Desconto de cada parcela, na mesma ordem de `amounts`.
 *
 * `amounts` sao os valores das parcelas em centavos **positivos**. O total do
 * desconto nunca passa do que esta sendo antecipado, e nenhuma parcela recebe
 * desconto maior que ela mesma — o que sobraria seria credito inventado.
 */
export function anticipationDiscounts(
  amounts: number[],
  spec: AnticipationDiscountSpec
): number[] {
  if (amounts.length === 0) return [];
  if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
    throw new Error("Valores das parcelas precisam ser centavos positivos");
  }
  if (!Number.isInteger(spec.value) || spec.value <= 0) {
    throw new Error("O desconto precisa ser maior que zero");
  }

  const total = amounts.reduce((sum, amount) => sum + amount, 0);

  if (spec.mode === "percent") {
    if (spec.value > FULL_PERCENT) throw new Error("O desconto nao pode passar de 100%");
    if (spec.scope === "each") {
      return amounts.map((amount) => Math.round((amount * spec.value) / FULL_PERCENT));
    }
    // Sobre o total: arredonda uma vez so e reparte pelo maior resto, para que
    // o desconto somado seja exatamente o percentual do total pedido.
    const discount = Math.round((total * spec.value) / FULL_PERCENT);
    return allocateByRatio(discount, amounts);
  }

  if (spec.scope === "each") {
    const tooBig = amounts.find((amount) => spec.value > amount);
    if (tooBig !== undefined) {
      throw new Error("O desconto por parcela passa do valor de uma das parcelas");
    }
    return amounts.map(() => spec.value);
  }

  if (spec.value > total) {
    throw new Error("O desconto passa do total que esta sendo antecipado");
  }
  return allocateByRatio(spec.value, amounts);
}
