import type { ParsedStatement } from "./adapter.js";

/**
 * Conciliacao obrigatoria: a soma das linhas contra o que o documento afirma.
 *
 * O PDF erra em silencio — linha perdida, duplicada, sinal invertido — e a
 * unica defesa generica e comparar com o total que o proprio banco imprimiu.
 * Tolerancia **zero**, em centavos inteiros: tolerancia em dinheiro e como se
 * perde um centavo por mes e se descobre um ano depois.
 */

export type ReconciliationStatus = "match" | "mismatch" | "unavailable";

export type ReconciliationAxis = {
  key: string;
  label: string;
  declaredCents: number | null;
  parsedCents: number;
  differenceCents: number | null;
  rowCount: number;
  status: ReconciliationStatus;
};

export type ReconciliationResult = {
  /** `match` so quando todo eixo bate; `unavailable` conta como `mismatch`. */
  status: "match" | "mismatch";
  axes: ReconciliationAxis[];
};

export function reconcile(parsed: ParsedStatement): ReconciliationResult {
  const axes = parsed.declaredTotals.map((total): ReconciliationAxis => {
    const rows = parsed.rows.filter((row) => row.date >= total.dateFrom && row.date <= total.dateTo);
    const parsedCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    if (total.declaredCents === null) {
      return {
        key: total.key,
        label: total.label,
        declaredCents: null,
        parsedCents,
        differenceCents: null,
        rowCount: rows.length,
        status: "unavailable"
      };
    }
    const differenceCents = parsedCents - total.declaredCents;
    return {
      key: total.key,
      label: total.label,
      declaredCents: total.declaredCents,
      parsedCents,
      differenceCents,
      rowCount: rows.length,
      status: differenceCents === 0 ? "match" : "mismatch"
    };
  });
  // Documento sem nenhum total conferivel nao tem caminho automatico.
  const status = axes.length > 0 && axes.every((axis) => axis.status === "match") ? "match" : "mismatch";
  return { status, axes };
}
