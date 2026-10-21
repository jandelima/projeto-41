/**
 * Datas do livro-caixa. Tudo em ISO `YYYY-MM-DD` tratado como string, nunca
 * como `Date`: um `new Date("2026-01-31")` interpreta UTC e, num fuso negativo
 * como o de Sao Paulo, volta 30 de janeiro. O livro nao tem hora, entao a
 * aritmetica e feita em componentes inteiros.
 */

export type YearMonth = { year: number; month: number };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(value);
  if (!match) throw new Error(`Data invalida: ${value}`);
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

export function parseMonth(value: string): YearMonth {
  const match = MONTH_RE.exec(value);
  if (!match) throw new Error(`Mes invalido: ${value}`);
  const [, year, month] = match;
  return { year: Number(year), month: Number(month) };
}

export function formatMonth({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  // Dia 0 do mes seguinte e o ultimo dia deste mes. Date.UTC evita o desvio de fuso.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Diferenca em meses, util para numerar parcelas. */
export function monthDiff(from: YearMonth, to: YearMonth): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/**
 * Ancora um dia do mes que pode nao existir: fechamento dia 31 em fevereiro cai
 * no dia 28 (ou 29). Regra explicita do plano mestre 6.2.
 */
export function clampDayToMonth(year: number, month: number, day: number): string {
  return formatIsoDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Soma dias corridos a uma data ISO. */
export function addDays(isoDate: string, days: number): string {
  const { year, month, day } = parseIsoDate(isoDate);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Dias corridos entre duas datas ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  const first = parseIsoDate(a);
  const second = parseIsoDate(b);
  const ms =
    Date.UTC(second.year, second.month - 1, second.day) -
    Date.UTC(first.year, first.month - 1, first.day);
  return Math.round(ms / 86_400_000);
}

export function startOfMonth(month: string): string {
  const { year, month: m } = parseMonth(month);
  return formatIsoDate(year, m, 1);
}

export function endOfMonth(month: string): string {
  const { year, month: m } = parseMonth(month);
  return formatIsoDate(year, m, daysInMonth(year, m));
}

export type StatementCycle = {
  /** Mes de vencimento, `YYYY-MM`. E o valor gravado em entries.statement_month. */
  statementMonth: string;
  /** Data real do fechamento dessa fatura. */
  closingDate: string;
  /** Data real do vencimento dessa fatura. */
  dueDate: string;
};

/**
 * Descobre em qual fatura cai uma compra (plano mestre 6.2).
 *
 * A fatura e aquela cujo fechamento e a **primeira data de fechamento maior ou
 * igual a data da compra** — comprar no proprio dia do fechamento entra nessa
 * fatura, nao na seguinte. O vencimento e o proximo `dueDay` a partir do
 * fechamento; quando `dueDay <= closingDay` ele cai no mes seguinte.
 */
export function statementCycleFor(
  purchaseDate: string,
  closingDay: number,
  dueDay: number
): StatementCycle {
  const { year, month, day } = parseIsoDate(purchaseDate);
  const closingThisMonth = clampDayToMonth(year, month, closingDay);
  const effectiveClosingDay = Number(closingThisMonth.slice(8, 10));

  const closingAnchor =
    day <= effectiveClosingDay ? { year, month } : addMonths({ year, month }, 1);
  const closingDate = clampDayToMonth(closingAnchor.year, closingAnchor.month, closingDay);

  // Vencimento depois do fechamento: mesmo mes se o dia for maior, senao o mes
  // seguinte. Cartao que fecha dia 28 e vence dia 5 vence no mes seguinte.
  const dueAnchor = dueDay > closingDay ? closingAnchor : addMonths(closingAnchor, 1);
  const dueDate = clampDayToMonth(dueAnchor.year, dueAnchor.month, dueDay);

  return { statementMonth: formatMonth(dueAnchor), closingDate, dueDate };
}

/** Mes de fatura de uma compra — atalho para o campo gravado no lancamento. */
export function statementMonthFor(
  purchaseDate: string,
  closingDay: number,
  dueDay: number
): string {
  return statementCycleFor(purchaseDate, closingDay, dueDay).statementMonth;
}

/**
 * Datas das N parcelas de uma compra: a primeira na data da compra e as
 * seguintes no mesmo dia dos meses subsequentes, ancorando o dia que nao existe
 * no ultimo dia do mes.
 */
export function installmentDates(purchaseDate: string, count: number): string[] {
  const { year, month, day } = parseIsoDate(purchaseDate);
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return purchaseDate;
    const anchor = addMonths({ year, month }, index);
    return clampDayToMonth(anchor.year, anchor.month, day);
  });
}
