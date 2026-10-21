import type { ColumnMapping, CsvField, ParsedTransaction } from "@projeto41/contracts";
import { decodeStatement } from "../ofx/decode.js";
import { parseCounterparty } from "../payee.js";
import { parseCsvRows } from "./csv-rows.js";

/**
 * Leitor de extrato em CSV.
 *
 * **CSV nao tem padrao** — cada banco inventa o seu. Este leitor nao adivinha:
 * ele *propoe* um mapeamento, o usuario confirma, e o que foi confirmado fica
 * salvo por conta em `import_column_mappings`. A partir da segunda importacao
 * do mesmo banco nao ha o que perguntar.
 *
 * O CSV tambem nao tem FITID. O do Nubank e a excecao feliz: traz a coluna
 * `Identificador`, que e o mesmo UUID do OFX. Quando ela existe, a dedupe sai
 * de graca; quando nao existe, a escada de 6.7 sustenta tudo sozinha.
 */

const DELIMITERS = [";", ",", "\t"];

/** Cabecalhos que cada papel reconhece, ja normalizados. */
const HEADER_HINTS: [CsvField, string[]][] = [
  ["date", ["data", "data lancamento", "data da compra", "date", "data mov", "data e hora"]],
  ["amount", ["valor", "amount", "montante", "valor r"]],
  ["amount_in", ["entrada", "credito", "valor credito", "receita"]],
  ["amount_out", ["saida", "debito", "valor debito", "despesa"]],
  [
    "description",
    ["descricao", "historico", "title", "lancamento", "estabelecimento", "detalhes", "memo"]
  ],
  ["type", ["tipo", "type", "natureza", "transacao"]],
  ["document", ["identificador", "id", "documento", "numero documento", "fitid"]]
];

const IGNORED_HEADERS = ["saldo", "balance", "saldo r"];

export function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** O papel que o cabecalho sugere, sem levar em conta as outras colunas. */
export function headerRole(label: string): CsvField | null {
  const normalized = normalizeHeader(label);
  return HEADER_HINTS.find(([, hints]) => hints.includes(normalized))?.[0] ?? null;
}

function detectDelimiter(firstLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const candidate of DELIMITERS) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * `1.234,56` -> `123456`, sempre pela string.
 *
 * `Number(texto) * 100` erra centavo e o centavo errado muda o hash de
 * deduplicacao, que e o que faz a linha entrar duas vezes.
 */
export function centsFromCsvAmount(raw: string, decimalSeparator: "," | "."): number | null {
  let cleaned = raw.trim().replace(/R\$|\s|\u00a0/gi, "");
  if (cleaned === "" || cleaned === "-") return null;

  let sign = 1;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    sign = -1;
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("-")) {
    sign = -sign;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }
  // Fora o separador decimal, todo ponto e virgula sao separador de milhar.
  const thousands = decimalSeparator === "," ? /\./g : /,/g;
  cleaned = cleaned.replace(thousands, "");
  const parts = cleaned.split(decimalSeparator);
  if (parts.length > 2) return null;
  const whole = parts[0] ?? "";
  const fraction = `${parts[1] ?? ""}00`.slice(0, 2);
  if (!/^\d*$/.test(whole) || !/^\d+$/.test(fraction)) return null;
  if (whole === "" && (parts[1] ?? "") === "") return null;
  return sign * Number(`${whole === "" ? "0" : whole}${fraction}`);
}

/** 31/02 casa com o padrão mas não existe: ia para o banco como 2026-02-31. */
function realDate(iso: string): string | null {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? iso
    : null;
}

export function isoDateFromCsv(raw: string, format: ColumnMapping["dateFormat"]): string | null {
  const value = raw.trim();
  if (format === "yyyy-MM-dd") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? realDate(value) : null;
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match as unknown as [string, string, string, string];
  // Extrato de banco nao fala do seculo passado; `26` e 2026.
  const fullYear = year.length === 4 ? year : `20${year}`;
  return realDate(`${fullYear}-${month}-${day}`);
}

function detectDateFormat(samples: string[]): ColumnMapping["dateFormat"] {
  if (samples.some((value) => /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))) return "yyyy-MM-dd";
  if (samples.some((value) => /^\d{2}\/\d{2}\/\d{2}$/.test(value.trim()))) return "dd/MM/yy";
  return "dd/MM/yyyy";
}

function detectDecimal(samples: string[]): "," | "." {
  // `1.234,56` decide sozinho; `1234.56` tambem. Na duvida, virgula, que e o
  // que banco brasileiro escreve.
  if (samples.some((value) => /\d,\d{1,2}\b/.test(value))) return ",";
  if (samples.some((value) => /\d\.\d{1,2}\b/.test(value))) return ".";
  return ",";
}

export type CsvShape = {
  mapping: ColumnMapping;
  header: string[];
  preview: string[][];
};

/**
 * Le os bytes e *propoe* um mapeamento. Tudo aqui e sugestao pre-preenchida na
 * tela: nada e aplicado sem o usuario confirmar.
 */
export function inspectCsv(buffer: Buffer): CsvShape {
  const { text, encoding } = decodeStatement(buffer);
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("Arquivo CSV vazio.");

  const delimiter = detectDelimiter(lines[0]!);
  const allRows = parseCsvRows(text, delimiter).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );

  // O Inter imprime titular, conta e periodo antes do cabecalho. A primeira
  // linha que tem a mesma largura das seguintes e onde a tabela comeca.
  const widths = allRows.map((row) => row.length);
  const tableWidth = Math.max(...widths);
  const skipLines = widths.findIndex((width) => width === tableWidth);
  const rows = allRows.slice(skipLines < 0 ? 0 : skipLines);

  const headerRow = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const header = headerRow.map((cell) => cell.trim());

  const columns: Record<string, CsvField> = {};
  const taken = new Set<CsvField>();
  header.forEach((label, index) => {
    const normalized = normalizeHeader(label);
    if (IGNORED_HEADERS.includes(normalized)) {
      columns[String(index)] = "ignore";
      return;
    }
    const hit = HEADER_HINTS.find(
      ([role, hints]) => !taken.has(role) && hints.includes(normalized)
    );
    if (hit) {
      taken.add(hit[0]);
      columns[String(index)] = hit[0];
    } else {
      columns[String(index)] = "ignore";
    }
  });

  const columnSamples = (role: CsvField) => {
    const index = Object.entries(columns).find(([, value]) => value === role)?.[0];
    if (index === undefined) return [];
    return dataRows.slice(0, 20).map((row) => row[Number(index)] ?? "");
  };

  const hasSplit = taken.has("amount_in") && taken.has("amount_out");

  return {
    mapping: {
      delimiter,
      encoding,
      skipLines: skipLines < 0 ? 0 : skipLines,
      hasHeader: true,
      dateFormat: detectDateFormat(columnSamples("date")),
      decimalSeparator: detectDecimal([
        ...columnSamples("amount"),
        ...columnSamples("amount_in"),
        ...columnSamples("amount_out")
      ]),
      signConvention: hasSplit ? "split_columns" : "signed",
      columns
    },
    header,
    preview: dataRows.slice(0, 5)
  };
}

function roleIndex(mapping: ColumnMapping, role: CsvField): number | null {
  const found = Object.entries(mapping.columns).find(([, value]) => value === role);
  return found ? Number(found[0]) : null;
}

/** O cabecalho do arquivo novo bate com o do mapeamento salvo? */
export function headerMatches(mapping: ColumnMapping, header: string[]): boolean {
  const expected = Object.keys(mapping.columns).length;
  return header.length === expected;
}

export function readCsv(buffer: Buffer, mapping: ColumnMapping): ParsedTransaction[] {
  const decoded =
    mapping.encoding === "windows-1252"
      ? new TextDecoder("windows-1252").decode(buffer)
      : decodeStatement(buffer).text;

  const allRows = parseCsvRows(decoded, mapping.delimiter).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );
  const header = mapping.hasHeader ? (allRows[mapping.skipLines] ?? []) : [];
  const rows = allRows.slice(mapping.skipLines + (mapping.hasHeader ? 1 : 0));
  // Coluna -> valor, com o nome do cabecalho: a linha inteira como veio,
  // inclusive as colunas que o mapeamento ignora.
  const sourceOf = (row: string[]) =>
    Object.fromEntries(
      row.map((cell, index) => [header[index]?.trim() || `coluna ${index + 1}`, cell])
    );

  const dateAt = roleIndex(mapping, "date");
  const descriptionAt = roleIndex(mapping, "description");
  const amountAt = roleIndex(mapping, "amount");
  const inAt = roleIndex(mapping, "amount_in");
  const outAt = roleIndex(mapping, "amount_out");
  const documentAt = roleIndex(mapping, "document");
  const typeAt = roleIndex(mapping, "type");

  if (dateAt === null || descriptionAt === null) {
    throw new Error("Mapeamento sem coluna de data ou de descricao.");
  }

  const transactions: ParsedTransaction[] = [];
  rows.forEach((row, index) => {
    const lineNo = index + 1;
    const cell = (at: number | null) => (at === null ? "" : (row[at] ?? "").trim());

    const date = isoDateFromCsv(cell(dateAt), mapping.dateFormat);
    if (date === null) {
      throw new Error(
        `Linha ${lineNo}: data "${cell(dateAt)}" nao esta no formato ${mapping.dateFormat}.`
      );
    }

    let amountCents: number | null;
    if (mapping.signConvention === "split_columns") {
      const credit = centsFromCsvAmount(cell(inAt), mapping.decimalSeparator) ?? 0;
      const debit = centsFromCsvAmount(cell(outAt), mapping.decimalSeparator) ?? 0;
      // As duas colunas vem em valor absoluto; o sinal e a coluna em que o
      // numero apareceu.
      amountCents = credit - Math.abs(debit);
      if (credit === 0 && debit === 0) amountCents = null;
    } else {
      amountCents = centsFromCsvAmount(cell(amountAt), mapping.decimalSeparator);
      if (amountCents !== null && mapping.signConvention === "debit_positive") {
        amountCents = -amountCents;
      }
    }
    if (amountCents === null) {
      throw new Error(`Linha ${lineNo}: valor "${cell(amountAt)}" nao e um numero.`);
    }

    const rawDescription = cell(descriptionAt);
    const externalId = cell(documentAt);
    const trnType = cell(typeAt);
    const counterparty = parseCounterparty(rawDescription);

    transactions.push({
      lineNo,
      date,
      source: sourceOf(row),
      amountCents,
      rawDescription,
      ...(externalId ? { externalId } : {}),
      ...(trnType ? { trnType } : {}),
      ...(counterparty ? { counterparty } : {})
    });
  });

  return withTrustedExternalIds(transactions);
}

/**
 * A coluna de documento so vira `externalId` quando identifica de verdade.
 *
 * O CSV do Nubank traz `Identificador` com o mesmo UUID do OFX, e usa-lo da a
 * deduplicacao exata de graca. Mas em outros bancos a coluna "documento" e o
 * numero do cheque ou do lote, que **repete** — e um `external_id` repetido
 * esbarraria no indice unico parcial e faria a importacao inteira falhar, ou
 * pior, engoliria lancamentos legitimos como duplicata. Se a coluna nao for
 * unica e completa no arquivo, ela nao serve, e a escada de 6.7 assume.
 */
function withTrustedExternalIds(transactions: ParsedTransaction[]): ParsedTransaction[] {
  const ids = transactions.map((row) => row.externalId);
  const usable =
    ids.length > 0 &&
    ids.every((id) => id !== undefined && id !== "") &&
    new Set(ids).size === ids.length;
  if (usable) return transactions;
  return transactions.map((row) => {
    const without = { ...row };
    delete without.externalId;
    return without;
  });
}
