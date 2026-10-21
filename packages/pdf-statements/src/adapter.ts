import type { PdfPage } from "./text-layer.js";

/**
 * O que o documento afirma, para conferir contra a soma das linhas.
 *
 * `declaredCents` e o movimento que o proprio documento declara para as
 * linhas entre `dateFrom` e `dateTo` (inclusive); `null` quando o adapter nao
 * conseguiu ler o numero.
 */
export type DeclaredTotal = {
  key: string;
  label: string;
  declaredCents: number | null;
  dateFrom: string;
  dateTo: string;
};

export type ParseWarning = { code: string; message: string; page?: number; line?: number };

export type ParsedRow = {
  date: string;
  /** `HH:MM`, quando o documento traz. */
  time: string | null;
  /** O texto do banco, imutavel para sempre (D25). */
  rawDescription: string;
  /** Inteiro assinado, saida negativa (D19). */
  amountCents: number;
  signKnown: boolean;
  installment: { current: number; total: number } | null;
  /** 0..1, sempre abaixo de 1: nenhuma linha de PDF e certeza. */
  confidence: number;
  sourcePage: number;
  sourceLine: number;
  /** As celulas como sairam do documento, coluna -> texto. */
  cells: Record<string, string>;
  /** O tipo da transacao no documento (`Pix enviado`), quando houver. */
  trnType: string | null;
};

export type ParsedStatement = {
  adapterId: string;
  layoutVersion: string;
  reference: { year: number; month: number } | null;
  periodStart: string | null;
  periodEnd: string | null;
  closingBalanceCents: number | null;
  declaredTotals: DeclaredTotal[];
  rows: ParsedRow[];
  warnings: ParseWarning[];
};

export type StatementAdapter = {
  /** `btg-extrato` */
  id: string;
  label: string;
  kind: "statement" | "invoice";
  /** Muda quando o banco muda o layout: `2026-10`. */
  layoutVersion: string;
  /** Confianca 0..1 de que o documento e deste layout. */
  detect(pages: PdfPage[]): number;
  parse(pages: PdfPage[]): ParsedStatement;
};
