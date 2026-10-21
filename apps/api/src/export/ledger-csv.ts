import type { EntryRecord } from "@projeto41/contracts";
import { fromCents } from "@projeto41/finance";

const HEADER = [
  "data",
  "tipo",
  "valor",
  "status",
  "conta",
  "pessoa",
  "categoria",
  "local",
  "descricao",
  "etiquetas",
  "forma_pagamento",
  "fatura",
  "parcela",
  "observacoes"
];

const KIND_LABEL: Record<EntryRecord["kind"], string> = {
  expense: "saida",
  income: "entrada",
  transfer: "transferencia",
  adjustment: "ajuste"
};

const STATUS_LABEL: Record<EntryRecord["status"], string> = {
  pending: "pendente",
  cleared: "pago",
  reconciled: "conciliado"
};

/**
 * Exporta o livro no mesmo formato do `operations.csv`: virgula, CRLF e aspas
 * so quando necessario. O valor sai em reais com duas casas, porque a planilha
 * do usuario nao entende centavos inteiros.
 */
export function buildLedgerCsv(entries: EntryRecord[]): string {
  const rows = entries.map((entry) =>
    [
      entry.date,
      KIND_LABEL[entry.kind],
      fromCents(entry.amountCents).toFixed(2),
      STATUS_LABEL[entry.status],
      entry.accountName,
      entry.personName ?? "",
      entry.categoryName ?? "",
      entry.placeName ?? "",
      entry.description ?? "",
      entry.tags.map((tag) => tag.name).join(" "),
      entry.paymentMethod ?? "",
      entry.statementMonth ?? "",
      entry.installmentNumber != null && entry.installmentCount != null
        ? `${entry.installmentNumber}/${entry.installmentCount}`
        : "",
      entry.notes ?? ""
    ]
      .map(csvCell)
      .join(",")
  );
  return [HEADER.join(","), ...rows].join("\r\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
