import * as XLSX from "xlsx";
import { headerRole, normalizeHeader } from "../csv/csv-reader.js";

/**
 * Extrato em planilha (`.xls` e `.xlsx`).
 *
 * Planilha e so uma tabela com outra embalagem, entao nao ganha leitor proprio:
 * ela vira o mesmo texto que um CSV teria e segue pelo caminho do CSV, com o
 * mesmo mapeamento confirmado e salvo por conta. O trabalho daqui e tirar a
 * embalagem que o relatorio do banco coloca em volta da tabela:
 *
 * - titular, conta e periodo impressos antes do cabecalho;
 * - colunas mescladas, que deixam colunas vazias entre os dados;
 * - data com hora (`28/09/2026 11:27`, no BTG);
 * - linha de saldo no meio dos lancamentos (`Saldo Diario`) e rodape no fim.
 *
 * O `.xls` e o binario BIFF do Excel 97 — o que o BTG exporta —, por isso o
 * SheetJS e nao o leitor de `.xlsx` do importador da planilha legada.
 */

const XLS_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** O CSV gerado usa `;` e virgula decimal, como o banco brasileiro escreve. */
const DELIMITER = ";";

export function looksLikeSpreadsheet(buffer: Buffer): boolean {
  const startsWith = (magic: number[]) => magic.every((byte, index) => buffer[index] === byte);
  // Todo `.xlsx` e um zip, e nenhum extrato em texto comeca com `PK\x03\x04`.
  return startsWith(XLS_MAGIC) || startsWith(ZIP_MAGIC);
}

const DATE_TEXT = /^(\d{2}\/\d{2}\/(?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Celula -> texto como o CSV do banco traria.
 *
 * Data vem de `parse_date_code`, que trabalha com o numero serial do Excel e
 * nao passa por `Date` — fuso nenhum desloca o dia.
 */
function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z !== undefined && XLSX.SSF.is_date(cell.z)) {
      const parsed = XLSX.SSF.parse_date_code(cell.v);
      return `${pad(parsed.d)}/${pad(parsed.m)}/${parsed.y}`;
    }
    if (Number.isInteger(cell.v)) return String(cell.v);
    // Arredonda no centavo antes de virar texto: o double da planilha pode
    // trazer `0.30000000000000004`, e o leitor de CSV corta, nao arredonda.
    return String(Math.round(cell.v * 100) / 100).replace(".", ",");
  }
  const text = String(cell.v).replace(/\s+/g, " ").trim();
  // Data com hora: o dia basta, e o leitor de CSV so aceita o dia.
  const date = DATE_TEXT.exec(text);
  return date ? date[1]! : text;
}

function isDate(text: string) {
  return DATE_TEXT.test(text);
}

function quote(value: string) {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Le a primeira aba que tiver um cabecalho de extrato e devolve o CSV
 * equivalente (UTF-8, `;`), so com o cabecalho e os lancamentos.
 */
export function spreadsheetToCsv(buffer: Buffer): Buffer {
  let workbook: XLSX.WorkBook;
  try {
    // `cellNF` traz o formato de cada celula, que e o que separa data de numero.
    workbook = XLSX.read(buffer, { type: "buffer", dense: true, cellNF: true });
  } catch {
    throw new Error("Nao consegui abrir a planilha. Confira se o arquivo e .xls ou .xlsx.");
  }

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const grid = sheet?.["!data"];
    if (!grid) continue;
    // A grade densa ainda tem buracos onde a linha esta vazia: `Array.from`
    // os visita, `map` nao.
    const rows = Array.from(grid, (row) => Array.from(row ?? [], cellText));

    // O cabecalho e a primeira linha que tem data e mais um papel conhecido;
    // tudo antes dela e o cabecalho do relatorio.
    const headerAt = rows.findIndex((row) => {
      const roles = row.map(headerRole);
      return roles.includes("date") && roles.some((role) => role !== null && role !== "date");
    });
    if (headerAt < 0) continue;

    const header = rows[headerAt]!;
    // Coluna sem titulo e sobra de celula mesclada.
    const columns = header.flatMap((label, index) => (label !== "" ? [index] : []));
    const dateAt = header.findIndex((label) => headerRole(label) === "date");
    const descriptionAt = header.findIndex((label) => headerRole(label) === "description");

    const transactions = rows.slice(headerAt + 1).filter((row) => {
      // Sem data valida e rodape, linha em branco ou subtotal.
      if (!isDate(row[dateAt] ?? "")) return false;
      // Saldo do dia nao e lancamento: entraria como dinheiro novo.
      const description = descriptionAt < 0 ? "" : normalizeHeader(row[descriptionAt] ?? "");
      return !description.startsWith("saldo");
    });

    const lines = [header, ...transactions].map((row) =>
      columns.map((index) => quote(row[index] ?? "")).join(DELIMITER)
    );
    return Buffer.from(`${lines.join("\n")}\n`, "utf8");
  }

  throw new Error(
    "Nao achei a tabela de lancamentos na planilha: falta um cabecalho com Data e Valor ou Descricao."
  );
}
