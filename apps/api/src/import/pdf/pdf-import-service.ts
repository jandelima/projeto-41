import type { ParsedTransaction, PdfBatchInfo } from "@projeto41/contracts";
import {
  detectAdapter,
  PdfParseError,
  readTextLayer,
  reconcile,
  UnknownLayoutError
} from "@projeto41/pdf-statements";
import { parseCounterparty } from "../payee.js";

/**
 * Extrato em PDF -> as mesmas linhas que o OFX e o CSV produzem.
 *
 * O PDF **nao tem caminho de importacao proprio**: este modulo so le, detecta
 * o layout, interpreta e concilia. O staging, a dedupe de 6.7, as regras e a
 * revisao sao os de sempre, em `ledger-import-service`. Ordem, parando no
 * primeiro erro: camada de texto -> adapter -> parse -> conciliacao.
 */

/** Metadado da linha que so o PDF tem. */
export type PdfRowInfo = {
  confidence: number;
  signKnown: boolean;
  sourcePage: number;
  sourceLine: number;
  warnings: string[];
};

export type PdfStatement = {
  kind: "statement" | "invoice";
  transactions: ParsedTransaction[];
  rows: PdfRowInfo[];
  periodStart: string | null;
  periodEnd: string | null;
  closingBalanceCents: number | null;
  info: PdfBatchInfo;
};

export async function readPdfStatement(
  buffer: Buffer,
  options: { password?: string } = {}
): Promise<PdfStatement> {
  const pages = await readTextLayer(buffer, options);
  const [best] = detectAdapter(pages);
  if (!best) throw new UnknownLayoutError();
  const parsed = best.adapter.parse(pages);
  // Sem mes de referencia as datas sem ano seriam chute: recusa.
  if (!parsed.reference) {
    throw new PdfParseError(
      "pdf_parse_failed",
      "Nao achei o periodo de referencia no PDF; sem ele as datas nao sao confiaveis."
    );
  }
  if (parsed.rows.length === 0) {
    throw new PdfParseError("pdf_parse_failed", "Nao achei nenhum lancamento no PDF.");
  }
  const reconciliation = reconcile(parsed);

  const transactions = parsed.rows.map((row, index): ParsedTransaction => {
    const counterparty = parseCounterparty(row.rawDescription);
    return {
      lineNo: index + 1,
      date: row.date,
      ...(row.time ? { time: row.time } : {}),
      amountCents: row.amountCents,
      rawDescription: row.rawDescription,
      ...(row.trnType ? { trnType: row.trnType } : {}),
      ...(counterparty ? { counterparty } : {}),
      source: row.cells,
      ...(row.installment
        ? { installment: { number: row.installment.current, total: row.installment.total, uncertain: true } }
        : {})
    };
  });

  return {
    kind: best.adapter.kind,
    transactions,
    rows: parsed.rows.map((row) => ({
      confidence: row.confidence,
      signKnown: row.signKnown,
      sourcePage: row.sourcePage,
      sourceLine: row.sourceLine,
      warnings: parsed.warnings
        .filter((warning) => warning.page === row.sourcePage && warning.line === row.sourceLine)
        .map((warning) => warning.message)
    })),
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    closingBalanceCents: parsed.closingBalanceCents,
    info: {
      adapterId: parsed.adapterId,
      layoutVersion: parsed.layoutVersion,
      reconciliation,
      warnings: parsed.warnings.filter((warning) => warning.line === undefined).map((warning) => warning.message)
    }
  };
}
