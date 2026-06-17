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
