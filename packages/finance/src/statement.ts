import {
  addMonths,
  clampDayToMonth,
  daysInMonth,
  formatMonth,
  parseMonth,
  addDays,
  statementMonthFor,
  type YearMonth
} from "./dates.js";

/**
 * Calendario da fatura do cartao (plano mestre 6.2).
 *
 * Esta e a **unica** implementacao da regra em todo o repositorio: nem
 * repositorio, nem rota, nem tela recalculam fatura — todos chamam daqui. A
 * aritmetica de dia/mes/ano mora em `dates.ts` e e compartilhada com o resto do
 * livro; este arquivo e a camada de fatura em cima dela.
 *
 * Nenhuma funcao usa `new Date('YYYY-MM-DD')`: essa forma e interpretada como
 * UTC e `getDate()` devolve o dia anterior em fuso negativo — e assim que a
 * fatura vira o mes errado no dia 1o.
 */

export { clampDayToMonth as clampDay, daysInMonth, statementCycleFor } from "./dates.js";
export { statementMonthFor } from "./dates.js";

export const lastDayOfMonth = (year: number, month: number) => daysInMonth(year, month);

/** Data ISO do fechamento daquele mes, com o dia ancorado ao ultimo do mes. */
export function closingDateFor(year: number, month: number, closingDay: number): string {
  return clampDayToMonth(year, month, closingDay);
}

export type StatementDates = {
  closingDate: string;
  dueDate: string;
  /** Dia seguinte ao fechamento anterior. */
  periodStart: string;
  /** O fechamento desta fatura. */
  periodEnd: string;
};

/**
 * A inversa de `statementMonthFor`: dado o mes de **vencimento**, devolve as
 * quatro datas que o cabecalho da tela mostra. Ninguem as recalcula depois.
 */
export function statementDatesFor(
  statementMonth: string,
  closingDay: number,
  dueDay: number
): StatementDates {
  const due = parseMonth(statementMonth);
  // O fechamento e no mes anterior quando `dueDay <= closingDay`, que e a mesma
  // condicao usada na ida — as duas funcoes precisam concordar.
  const closingAnchor: YearMonth = dueDay > closingDay ? due : addMonths(due, -1);
  const previousAnchor = addMonths(closingAnchor, -1);

  const periodEnd = clampDayToMonth(closingAnchor.year, closingAnchor.month, closingDay);
  const previousClosing = clampDayToMonth(previousAnchor.year, previousAnchor.month, closingDay);

  return {
    closingDate: periodEnd,
    dueDate: clampDayToMonth(due.year, due.month, dueDay),
    periodStart: addDays(previousClosing, 1),
    periodEnd
  };
}

/**
 * Fatura natural da parcela `number` (1 = a da compra) de um parcelamento.
 *
 * Uma parcela por fatura, a partir da fatura da compra. Recalcular o mes pela
 * data de cada parcela falha com fechamento no dia 28-31: a data encurtada no
 * mes curto cai antes do fechamento e duas parcelas vao para a mesma fatura.
 * Criacao, troca de cartao e antecipacao usam esta regra, e so ela.
 */
export function installmentStatementMonth(
  purchaseDate: string,
  number: number,
  closingDay: number,
  dueDay: number
): string {
  const first = parseMonth(statementMonthFor(purchaseDate, closingDay, dueDay));
  return formatMonth(addMonths(first, number - 1));
}

/** Sequencia inclusiva de meses `YYYY-MM`, usada pela navegacao de faturas. */
export function statementMonthsBetween(fromMonth: string, toMonth: string): string[] {
  const from = parseMonth(fromMonth);
  const to = parseMonth(toMonth);
  const span = (to.year - from.year) * 12 + (to.month - from.month);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_, index) => formatMonth(addMonths(from, index)));
}

export type StatementStatus = "open" | "closed" | "paid" | "overdue";

/**
 * Status derivado da fatura (nunca armazenado).
 *
 * `paid` exige um pagamento atribuido ao mes: uma fatura que zerou porque a
 * compra foi estornada nao esta paga, esta zerada.
 */
export function statementStatus(input: {
  today: string;
  closingDate: string;
  dueDate: string;
  totalCents: number;
  hasPayment: boolean;
}): StatementStatus {
  if (input.totalCents === 0 && input.hasPayment) return "paid";
  if (input.today <= input.closingDate) return "open";
  // Sem saldo devedor não há o que vencer: a fatura vazia ou zerada por
  // estorno fica fechada, não vencida.
  if (input.totalCents <= 0) return "closed";
  if (input.today > input.dueDate) return "overdue";
  return "closed";
}
