/**
 * Parsers puros de valor, data e parcela em pt-BR. Sem I/O, sem `new Date()`
 * sem parametro: o que entra e texto, o que sai e estrutura.
 */
import { normalizeName } from "@projeto41/finance";

/**
 * A normalizacao de descricao e a **mesma** do hash de conteudo da dedupe
 * (`normalizeName`). Uma segunda normalizacao aqui faria a mesma compra, vinda
 * do OFX e do PDF, ter hashes diferentes — e entrar duas vezes.
 */
export const normalizeDescription = normalizeName;

export type ParsedAmount = { cents: number; signKnown: boolean };

/**
 * `R$ 1.234,56`, `-R$ 80,00`, `1.234,56 D`, `(1.234,56)`, `1.234,56-` ->
 * centavos inteiros, sempre pela string.
 *
 * `signKnown` diz se o texto traz marcador de credito ou debito. Sem marcador,
 * o sinal e positivo **por falta de informacao**, e quem chama decide se o
 * layout garante que debito sempre vem marcado.
 */
export function parseAmountBR(text: string): ParsedAmount | null {
  let value = text.replace(/\u00a0/g, " ").trim();
  if (value === "") return null;
  let sign = 1;
  let signKnown = false;

  const suffix = /\s*([DC])$/i.exec(value);
  if (suffix) {
    sign = suffix[1]!.toUpperCase() === "D" ? -1 : 1;
    signKnown = true;
    value = value.slice(0, suffix.index).trim();
  }
  if (value.startsWith("(") && value.endsWith(")")) {
    sign = -1;
    signKnown = true;
    value = value.slice(1, -1).trim();
  }
  if (value.endsWith("-")) {
    sign = -1;
    signKnown = true;
    value = value.slice(0, -1).trim();
  }
  if (value.startsWith("-") || value.startsWith("+")) {
    sign = value.startsWith("-") ? -1 : 1;
    signKnown = true;
    value = value.slice(1).trim();
  }
  value = value.replace(/^R\$\s*/i, "");
  if (value.startsWith("-") || value.startsWith("+")) {
    sign = value.startsWith("-") ? -1 : 1;
    signKnown = true;
    value = value.slice(1).trim();
  }

  const match = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(value);
  if (!match) return null;
  const cents = Number(`${match[1]!.replace(/\./g, "")}${match[2]}`);
  return { cents: cents === 0 ? 0 : sign * cents, signKnown };
}

export type ReferenceContext = { statementYear: number; statementMonth: number };

const MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function realDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}`
    : null;
}

/**
 * Data para ISO. Sem ano no texto, o ano vem do **contexto do documento**, nunca
 * do relogio: a fatura de dezembro lida em janeiro continua em dezembro. Data
 * resolvida mais de 2 meses a frente da referencia volta um ano. Sem ano e sem
 * contexto, `null` — o adapter falha visivelmente em vez de inventar.
 */
export function parseDateBR(text: string, context: ReferenceContext | null = null): string | null {
  const value = normalizeName(text);
  let day: number;
  let month: number;
  let year: number | null = null;

  const numeric = /^(\d{1,2}) (\d{1,2})(?: (\d{2}|\d{4}))?$/.exec(value);
  const named = /^(\d{1,2}) ([a-z]{3})[a-z]*(?: (\d{2}|\d{4}))?$/.exec(value);
  if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    if (numeric[3]) year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
  } else if (named && MONTHS[named[2]!]) {
    day = Number(named[1]);
    month = MONTHS[named[2]!]!;
    if (named[3]) year = Number(named[3].length === 2 ? `20${named[3]}` : named[3]);
  } else {
    return null;
  }

  if (year === null) {
    if (!context) return null;
    year = context.statementYear;
    const monthsAhead = (year - context.statementYear) * 12 + month - context.statementMonth;
    if (monthsAhead > 2) year -= 1;
  }
  return realDate(year, month, day);
}

/** `11h27` ou `11:27` -> `11:27`. */
export function parseTimeBR(text: string): string | null {
  const match = /^(\d{1,2})[h:](\d{2})$/i.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? `${pad(hours)}:${pad(minutes)}` : null;
}

/** `PARCELA 3/7`, `PARC 03/07`, `3/7`, `3 DE 7`, `(3/7)`. */
export function parseInstallment(description: string): { current: number; total: number } | null {
  const value = description.toUpperCase();
  const match =
    /\b(?:PARCELA|PARC\.?)\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\b/.exec(value) ??
    /\(?\b(\d{1,2})\s*(?:\/|\bDE\b)\s*(\d{1,2})\b\)?/.exec(value);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (current < 1 || total < 2 || current > total) return null;
  return { current, total };
}
