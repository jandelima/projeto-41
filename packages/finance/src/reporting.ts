import {
  addDays,
  clampDayToMonth,
  daysBetween,
  daysInMonth,
  endOfMonth,
  formatMonth,
  monthOf,
  parseIsoDate,
  parseMonth,
  startOfMonth,
  addMonths
} from "./dates.js";

/**
 * Agregacao de relatorio: funcoes puras sobre linhas ja somadas pelo banco.
 *
 * Zero dependencia e zero `Date.now()` — a data de referencia sempre chega por
 * parametro, senao o teste vira refem do relogio.
 */

export type Range = { from: string; to: string };

export type CategoryRow = {
  categoryId: number | null;
  name: string;
  color: string | null;
  /** Ja positivo: o repositorio entrega `-SUM(amount_cents)`. */
  totalCents: number;
  monthlyBudgetCents?: number | null;
  /** Objetivo em milesimos do total de saidas do periodo (exclusivo com o de valor). */
  budgetSharePerMille?: number | null;
};

/**
 * Participacao de cada fatia em **milesimos**, pelo metodo do maior resto.
 *
 * Milesimos inteiros em vez de fracao porque so assim da para garantir que a
 * soma fecha exatamente em 1000 — e e a soma dos rotulos exibidos que o usuario
 * confere. Empate resolvido pelo maior valor absoluto e, persistindo, pelo
 * menor indice, para o resultado nao depender da estabilidade do `sort` do
 * runtime.
 */
export function distributeShares(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);

  const exact = values.map((value) => (value * 1000) / total);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = 1000 - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({
      index,
      fraction: value - Math.floor(value),
      magnitude: Math.abs(values[index] ?? 0)
    }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction || b.magnitude - a.magnitude || a.index - b.index
    );

  const result = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}

export type CategoryTotal = {
  categoryId: number | null;
  name: string;
  color: string | null;
  spentCents: number;
  budgetCents: number | null;
  budgetMode: "absolute" | "share" | null;
  budgetSharePerMille: number | null;
  overBudget: boolean;
};

/**
 * Conta quantos meses-calendario inteiros o intervalo cobre, ou `null` quando
 * ele nao e um numero inteiro de meses.
 *
 * Proporcionalizar orcamento mensal por dias gera alarme falso e nao foi
 * pedido, entao um recorte como 10/03 a 22/04 simplesmente nao tem orcamento.
 */
export function wholeMonthsIn(range: Range): number | null {
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (from.day !== 1) return null;
  if (to.day !== daysInMonth(to.year, to.month)) return null;
  return (to.year - from.year) * 12 + (to.month - from.month) + 1;
}

/**
 * Objetivo percentual convertido em centavos: a fracao pedida do total de
 * saidas do periodo. Arredonda meio-para-cima, como `toCents`.
 *
 * Diferente do objetivo em valor, o percentual vale para **qualquer** recorte:
 * "25% do que gastei" faz sentido em dez dias ou em um ano, entao nao ha a
 * regra de meses inteiros aqui.
 */
export function shareBudgetCents(totalExpenseCents: number, sharePerMille: number): number {
  return Math.round((Math.max(totalExpenseCents, 0) * sharePerMille) / 1000);
}

export function categoryTotals(
  rows: CategoryRow[],
  options: { range: Range }
): CategoryTotal[] {
  const months = wholeMonthsIn(options.range);
  // A base do percentual e o que efetivamente saiu: categoria negativa (estorno
  // maior que a compra) nao aumenta o total de ninguem.
  const totalExpense = rows.reduce((total, row) => total + Math.max(row.totalCents, 0), 0);
  return rows.map((row) => {
    const monthly = row.monthlyBudgetCents ?? null;
    const share = row.budgetSharePerMille ?? null;
    let budgetCents: number | null = null;
    let budgetMode: CategoryTotal["budgetMode"] = null;
    if (share != null) {
      budgetCents = shareBudgetCents(totalExpense, share);
      budgetMode = "share";
    } else if (monthly != null) {
      budgetMode = "absolute";
      budgetCents = months != null ? monthly * months : null;
    }
    return {
      categoryId: row.categoryId,
      name: row.name,
      color: row.color,
      // Uma categoria pode ficar negativa quando o estorno de uma compra
      // parcelada chega inteiro antes das parcelas. O valor negativo e exibido
      // como esta, nunca zerado nem descartado (6.6).
      spentCents: row.totalCents,
      budgetCents,
      budgetMode: budgetCents == null ? null : budgetMode,
      budgetSharePerMille: budgetMode === "share" ? share : null,
      // Igualdade nao estoura.
      overBudget: budgetCents != null && row.totalCents > budgetCents
    };
  });
}

export type Slice = {
  categoryId: number | null;
  name: string;
  color: string | null;
  valueCents: number;
  sharePerMille: number;
};

/**
 * Reduz a rosca as `limit` maiores fatias e agrega o resto em "Outras".
 *
 * Com 20 categorias as linhas-guia do Donut se atropelam e a rosca deixa de
 * comunicar, entao o corte e parte do calculo — e testavel — e nao da
 * renderizacao. Fatia com valor <= 0 fica de fora (fatia negativa em pizza nao
 * significa nada) e continua na tabela.
 */
export function topSlices(rows: CategoryTotal[], limit = 9): Slice[] {
  const positives = rows.filter((row) => row.spentCents > 0);
  const sorted = [...positives].sort((a, b) => b.spentCents - a.spentCents);
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);

  const slices = head.map((row) => ({
    categoryId: row.categoryId,
    name: row.name,
    color: row.color,
    valueCents: row.spentCents
  }));

  if (tail.length > 0) {
    slices.push({
      categoryId: null,
      name: "Outras",
      // Cor do tema, nao do banco: "Outras" nao e uma categoria de verdade.
      color: "var(--text-muted)",
      valueCents: tail.reduce((sum, row) => sum + row.spentCents, 0)
    });
  }

  // As participacoes sao calculadas DEPOIS do corte, sobre o que restou, para
  // continuarem somando exatamente 1000.
  const shares = distributeShares(slices.map((slice) => slice.valueCents));
  return slices.map((slice, index) => ({ ...slice, sharePerMille: shares[index] ?? 0 }));
}

export type Comparison = {
  categoryId: number | null;
  name: string;
  currentCents: number;
  previousCents: number;
  deltaCents: number;
  /** `null` quando o periodo anterior e zero: infinito nao se exibe. */
  variationRatio: number | null;
  label: string;
  /** Ja invertido: em despesa, subir e ruim. A UI usa isto, nao o sinal. */
  tone: "positive" | "negative" | "neutral";
};

export function comparePeriods(
  current: CategoryTotal[],
  previous: CategoryTotal[]
): Comparison[] {
  const previousByKey = new Map(previous.map((row) => [row.categoryId, row]));
  const keys = new Set([
    ...current.map((row) => row.categoryId),
    ...previous.map((row) => row.categoryId)
  ]);

  const result: Comparison[] = [];
  for (const key of keys) {
    const now = current.find((row) => row.categoryId === key);
    const before = previousByKey.get(key);
    const currentCents = now?.spentCents ?? 0;
    const previousCents = before?.spentCents ?? 0;
    // Categoria zerada nos dois periodos nao diz nada e sai do comparativo.
    if (currentCents === 0 && previousCents === 0) continue;

    const name = now?.name ?? before?.name ?? "Sem categoria";
    const deltaCents = currentCents - previousCents;

    let variationRatio: number | null;
    let label: string;
    let tone: Comparison["tone"];

    if (previousCents === 0) {
      variationRatio = null;
      label = `novo em ${name}`;
      tone = "negative";
    } else if (currentCents === 0) {
      variationRatio = -1;
      label = `não gastou em ${name}`;
      tone = "positive";
    } else {
      variationRatio = deltaCents / Math.abs(previousCents);
      const percent = Math.abs(Math.round(variationRatio * 100));
      if (percent === 0) {
        label = `gastou o mesmo em ${name}`;
        tone = "neutral";
      } else {
        label = `gastou ${percent}% a ${deltaCents > 0 ? "mais" : "menos"} em ${name}`;
        tone = deltaCents > 0 ? "negative" : "positive";
      }
    }

    result.push({
      categoryId: key,
      name,
      currentCents,
      previousCents,
      deltaCents,
      variationRatio,
      label,
      tone
    });
  }

  // Ordenar por variacao em reais, nao em percentual: ordenar por percentual
  // promove a categoria de R$ 12 que dobrou e esconde a de R$ 900 que subiu 20%.
  return result.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
}

/** O intervalo e exatamente um mes-calendario? */
export function isWholeMonth(range: Range): boolean {
  return range.from === startOfMonth(monthOf(range.from)) && range.to === endOfMonth(monthOf(range.from));
}

/**
 * Contra o que o periodo se compara.
 *
 * Um mes-calendario se compara com o mes-calendario anterior, nao com "30 dias
 * antes": fevereiro contra janeiro inteiro. Qualquer outro recorte se compara
 * com a mesma quantidade de dias imediatamente antes de `from`.
 */
export function previousRange(range: Range): Range {
  // N meses inteiros contra os N meses anteriores: o ano contra o ano, o
  // trimestre contra o trimestre. Contar dias deslocava um dia por ano bissexto
  // e por mês de 31.
  const months = wholeMonthsIn(range);
  if (months != null) {
    const first = addMonths(parseMonth(monthOf(range.from)), -months);
    const last = addMonths(parseMonth(monthOf(range.from)), -1);
    return { from: startOfMonth(formatMonth(first)), to: endOfMonth(formatMonth(last)) };
  }
  const span = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -(span + 1)), to: addDays(range.from, -1) };
}

export type PartialInfo = {
  partial: boolean;
  daysElapsed: number;
  daysInPeriod: number;
};

export function partialPeriod(range: Range, options: { today: string }): PartialInfo {
  const daysInPeriod = daysBetween(range.from, range.to) + 1;
  const isInside = options.today >= range.from && options.today <= range.to;
  return {
    partial: isInside,
    daysElapsed: isInside ? daysBetween(range.from, options.today) + 1 : daysInPeriod,
    daysInPeriod
  };
}

/**
 * Recorte justo do periodo anterior.
 *
 * Comparar 21 dias do mes corrente contra 31 dias do mes passado sempre diz que
 * se gastou menos, o que e mentira. O anterior e truncado no **mesmo dia do
 * mes**, com o dia limitado ao ultimo daquele mes: 30/03 contra fevereiro
 * trunca em 28/02.
 */
export function previousRangeToDate(range: Range, options: { today: string }): Range | null {
  const info = partialPeriod(range, options);
  if (!info.partial) return null;
  const previous = previousRange(range);

  if (isWholeMonth(range)) {
    const { year, month } = parseIsoDate(previous.from);
    const day = parseIsoDate(options.today).day;
    return { from: previous.from, to: clampDayToMonth(year, month, day) };
  }
  return { from: previous.from, to: addDays(previous.from, info.daysElapsed - 1) };
}
