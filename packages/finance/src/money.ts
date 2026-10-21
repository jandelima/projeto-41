/**
 * Aritmética monetária em centavos inteiros (D19).
 *
 * Nada aqui formata para exibição: formatação vive em
 * `apps/web/src/lib/format.ts` porque precisa honrar o modo privacidade (R-04).
 */

/** Converte um `REAL` do módulo de investimentos em centavos (half-up). */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Valor monetário inválido: ${value}`);
  // `Math.round` arredonda -0.5 para 0 (half-up em direção a +∞), o que quebra
  // a simetria entre débito e crédito. Arredondamos a magnitude e devolvemos o
  // sinal, garantindo que toCents(-x) === -toCents(x).
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) * 100;
  // O épsilon compensa a representação binária: 1.005 * 100 === 100.49999999999999.
  return sign * Math.round(scaled + Number.EPSILON * scaled);
}

/** Converte centavos de volta para `REAL`, na fronteira com os investimentos. */
export function fromCents(cents: number): number {
  return cents / 100;
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Divide `total` em `parts` parcelas iguais, jogando **todo o resto na
 * primeira** (regra 6.3 do plano mestre). A soma fecha sempre no total por
 * construção: as parcelas 2..N são o piso e a primeira absorve a diferença.
 */
export function splitCents(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`Número de parcelas inválido: ${parts}`);
  }
  if (!Number.isInteger(total)) {
    throw new Error(`Total precisa estar em centavos inteiros: ${total}`);
  }
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const base = Math.floor(magnitude / parts);
  const values = Array.from({ length: parts }, () => sign * base);
  values[0] = total - sign * base * (parts - 1);
  return values;
}

/**
 * Reparte `total` proporcionalmente a `ratios` pelo método do maior resto, de
 * modo que a soma feche exatamente no total. Usado pela divisão-alvo
 * proporcional à renda (6.4).
 *
 * Razões todas zero (ou lista vazia de renda) caem no rateio igualitário, que é
 * o comportamento esperado quando ninguém registrou receita no período.
 */
export function allocateByRatio(total: number, ratios: number[]): number[] {
  if (ratios.length === 0) return [];
  if (!Number.isInteger(total)) {
    throw new Error(`Total precisa estar em centavos inteiros: ${total}`);
  }
  if (ratios.some((ratio) => ratio < 0)) {
    throw new Error("Proporções negativas não são permitidas");
  }
  const weightSum = ratios.reduce((acc, ratio) => acc + ratio, 0);
  const weights = weightSum > 0 ? ratios : ratios.map(() => 1);
  const normalizer = weightSum > 0 ? weightSum : ratios.length;

  const exact = weights.map((weight) => (total * weight) / normalizer);
  const floors = exact.map((value) => Math.floor(value));
  const floorTotal = floors.reduce((acc, value) => acc + value, 0);
  let remainder = total - floorTotal;

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  // `Math.floor` nunca supera o valor exato, então `remainder` está sempre em
  // [0, ratios.length): uma unidade por posição basta para fechar o total.
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}

// Inclui o NBSP, que vem colado junto ao copiar valor do internet banking.
const CURRENCY_NOISE = /[R$\s\u00a0]/gi;

/**
 * Lê o que o usuário digita em pt-BR e devolve centavos.
 *
 * Aceita `1.234,56`, `1234,56`, `1234.56`, `R$ 1.234,56`, `1234`, `-12,34` e
 * `(12,34)` (negativo contábil). Devolve `null` quando não dá para decidir.
 */
export function parseCurrencyInput(text: string): number | null {
  if (typeof text !== "string") return null;
  let cleaned = text.trim().replace(CURRENCY_NOISE, "");
  if (!cleaned) return null;

  let negative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("-")) {
    negative = true;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }
  if (!/^[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let integerPart = cleaned;
  let decimalPart = "";

  if (lastComma >= 0 || lastDot >= 0) {
    // O separador decimal é o último que aparece — mas só se o que vem depois
    // tiver 1 ou 2 dígitos. `1.234` é mil duzentos e trinta e quatro, não 1,234.
    const separatorIndex = Math.max(lastComma, lastDot);
    const tail = cleaned.slice(separatorIndex + 1);
    if (tail.length >= 1 && tail.length <= 2 && /^\d+$/.test(tail)) {
      integerPart = cleaned.slice(0, separatorIndex);
      decimalPart = tail;
    }
  }

  // Separador de milhar só é aceito em grupos de 3; isso rejeita `12,34,56`,
  // que não é nem valor com milhar nem valor com decimal.
  if (integerPart !== "" && !/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(integerPart)) return null;

  const digits = integerPart.replace(/[.,]/g, "");
  if (digits === "" && decimalPart === "") return null;

  const cents = Number(digits || "0") * 100 + Number(decimalPart.padEnd(2, "0") || "0");
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}
