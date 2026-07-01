import type { Operation } from "@projeto41/contracts";

const HEADER = ["asset", "date", "type", "quantity", "amount", "unit_price", "currency"];

export function buildOperationsCsv(operations: (Operation & { id?: number })[]): string {
  const rows = operations.map((operation) => {
    const unitPrice = operation.quantity > 0 ? operation.total / operation.quantity : 0;
    return [
      operation.asset,
      operation.date,
      operation.type,
      operation.quantity,
      operation.total,
      round(unitPrice),
      operation.currency
    ]
      .map(csvCell)
      .join(",");
  });
  return [HEADER.join(","), ...rows].join("\r\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function round(value: number) {
  return Math.round(value * 1e8) / 1e8;
}

export type ParsedOperationRow = {
  portfolio: "crypto";
  type: string;
  asset: string;
  date: string;
  quantity: number;
  total: number;
  currency: string;
};

const REQUIRED_COLUMNS = ["asset", "date", "type", "quantity", "amount", "currency"];

// Reverse of buildOperationsCsv: amount becomes the operation total, unit_price is
// derived on export so it is ignored here. Values still need schema validation by the caller.
export function parseOperationsCsv(text: string): ParsedOperationRow[] {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return [];

  const header = headerRow.map((cell) => cell.trim().toLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new Error(`Coluna ausente no CSV: ${column}`);
  }
  const at = (row: string[], column: string) => (row[header.indexOf(column)] ?? "").trim();

  return dataRows.map((row) => ({
    portfolio: "crypto" as const,
    type: at(row, "type"),
    asset: at(row, "asset"),
    date: at(row, "date"),
    quantity: Number(at(row, "quantity")),
    total: Number(at(row, "amount")),
    currency: at(row, "currency")
  }));
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
