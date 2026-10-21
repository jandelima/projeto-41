import { addDays, parseIsoDate } from "./dates.js";

/**
 * Dias úteis pelo calendário bancário brasileiro.
 *
 * **Puro e sem I/O**: o conjunto de feriados chega injetado, nunca é lido de
 * arquivo nem de banco — é assim que `packages/finance` continua com zero
 * dependências.
 *
 * Toda aritmética usa `YYYY-MM-DD` como string e `Date.UTC` por dentro. Um
 * `new Date("2026-09-07")` lido com componentes locais volta um dia em fuso
 * negativo e transforma segunda-feira em domingo.
 */

export type Holidays = ReadonlySet<string>;

export function isWeekend(date: string): boolean {
  const { year, month, day } = parseIsoDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function isBusinessDay(date: string, holidays: Holidays): boolean {
  return !isWeekend(date) && !holidays.has(date);
}

export function nextBusinessDay(date: string, holidays: Holidays): string {
  let cursor = addDays(date, 1);
  while (!isBusinessDay(cursor, holidays)) cursor = addDays(cursor, 1);
  return cursor;
}

export function previousBusinessDay(date: string, holidays: Holidays): string {
  let cursor = addDays(date, -1);
  while (!isBusinessDay(cursor, holidays)) cursor = addDays(cursor, -1);
  return cursor;
}

/** Dias úteis do intervalo, **fechado nas duas pontas**. */
export function businessDaysBetween(from: string, to: string, holidays: Holidays): string[] {
  if (to < from) return [];
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    if (isBusinessDay(cursor, holidays)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function countBusinessDays(from: string, to: string, holidays: Holidays): number {
  return businessDaysBetween(from, to, holidays).length;
}
