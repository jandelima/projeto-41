import { describe, expect, it } from "vitest";
import type { DeclaredTotal, ParsedRow, ParsedStatement } from "./adapter.js";
import { reconcile } from "./reconcile.js";

const row = (date: string, amountCents: number): ParsedRow => ({
  date,
  time: null,
  rawDescription: "x",
  amountCents,
  signKnown: true,
  installment: null,
  confidence: 0.9,
  sourcePage: 1,
  sourceLine: 1,
  cells: {},
  trnType: null
});

const statement = (rows: ParsedRow[], declaredTotals: DeclaredTotal[]): ParsedStatement => ({
  adapterId: "teste",
  layoutVersion: "1",
  reference: null,
  periodStart: null,
  periodEnd: null,
  closingBalanceCents: null,
  declaredTotals,
  rows,
  warnings: []
});

const total = (key: string, declaredCents: number | null, dateFrom: string, dateTo = dateFrom): DeclaredTotal => ({
  key,
  label: key,
  declaredCents,
  dateFrom,
  dateTo
});

const ROWS = [row("2026-09-29", 16000), row("2026-09-29", -8000), row("2026-09-30", -713)];

describe("reconcile", () => {
  it("soma batendo e match", () => {
    const result = reconcile(statement(ROWS, [total("dia", 8000, "2026-09-29")]));
    expect(result.status).toBe("match");
    expect(result.axes[0]).toMatchObject({ parsedCents: 8000, differenceCents: 0, rowCount: 2 });
  });

  it("linha faltando aparece com a diferenca exata em centavos", () => {
    const result = reconcile(statement(ROWS.slice(1), [total("dia", 8000, "2026-09-29")]));
    expect(result.status).toBe("mismatch");
    expect(result.axes[0]).toMatchObject({ status: "mismatch", differenceCents: -16000 });
  });

  it("sinal invertido: a diferenca e o dobro do valor da linha", () => {
    const flipped = [row("2026-09-29", 16000), row("2026-09-29", 8000)];
    const [axis] = reconcile(statement(flipped, [total("dia", 8000, "2026-09-29")])).axes;
    expect(axis!.differenceCents).toBe(2 * 8000);
  });

  it("total ausente e unavailable e bloqueia como mismatch", () => {
    const result = reconcile(statement(ROWS, [total("dia", null, "2026-09-29")]));
    expect(result.axes[0]!.status).toBe("unavailable");
    expect(result.status).toBe("mismatch");
  });

  it("documento sem nenhum total conferivel nao passa", () => {
    expect(reconcile(statement(ROWS, [])).status).toBe("mismatch");
  });

  it("varios eixos: so o que falha e reportado como falha", () => {
    const result = reconcile(
      statement(ROWS, [total("29", 8000, "2026-09-29"), total("30", -700, "2026-09-30")])
    );
    expect(result.axes.map((axis) => [axis.key, axis.status, axis.differenceCents])).toEqual([
      ["29", "match", 0],
      ["30", "mismatch", -13]
    ]);
  });
});
