import { describe, expect, it } from "vitest";
import { reconcile } from "../reconcile.js";
import { btgFixturePages, type FixtureRow } from "../testing/btg-fixture.js";
import { writePdf } from "../testing/pdf-writer.js";
import { readTextLayer } from "../text-layer.js";
import { btgStatementAdapter } from "./btg.js";

const parse = async (rows?: FixtureRow[]) =>
  btgStatementAdapter.parse(await readTextLayer(writePdf(btgFixturePages(rows))));

const row = (date: string, description: string, cents: number, extra: Partial<FixtureRow> = {}): FixtureRow => ({
  date,
  time: "10h00",
  category: ["Transferência"],
  transaction: ["Pix enviado"],
  description,
  cents,
  ...extra
});

describe("extrato do BTG em PDF", () => {
  it("le data, hora, valor com sinal e as celulas quebradas em duas linhas", async () => {
    const parsed = await parse();
    const academia = parsed.rows.find((item) => item.rawDescription === "Academia Exemplo")!;
    expect(academia).toMatchObject({
      date: "2026-09-28",
      time: "11:34",
      amountCents: -8000,
      signKnown: true,
      trnType: "Pix enviado"
    });
    expect(academia.cells.Categoria).toBe("Cuidados Pessoais");
    const padaria = parsed.rows.find((item) => item.rawDescription === "Padaria Do Exemplo")!;
    expect(padaria.trnType).toBe("Pix enviado por Fulana de Tal");
    // Celula quebrada custa confianca, e nenhuma linha chega a 1.
    expect(padaria.confidence).toBeLessThan(academia.confidence + 0.06);
    expect(Math.max(...parsed.rows.map((item) => item.confidence))).toBeLessThan(1);
  });

  it("saldo diario, cabecalho repetido e rodape nao viram lancamento", async () => {
    const parsed = await parse();
    expect(parsed.rows).toHaveLength(11);
    expect(parsed.rows.some((item) => /saldo/i.test(item.rawDescription))).toBe(false);
    expect(new Set(parsed.rows.map((item) => item.sourcePage))).toEqual(new Set([1, 2]));
  });

  it("le o periodo e o saldo atual do cabecalho", async () => {
    const parsed = await parse();
    expect(parsed).toMatchObject({
      periodStart: "2026-09-18",
      periodEnd: "2026-10-18",
      reference: { year: 2026, month: 10 },
      closingBalanceCents: 160224
    });
  });

  it("o primeiro dia nao tem saldo anterior: vira aviso, nao suposicao", async () => {
    const parsed = await parse();
    expect(parsed.warnings.map((warning) => warning.code)).toContain("first_day_unchecked");
    expect(parsed.declaredTotals.some((total) => total.dateFrom <= "2026-09-28")).toBe(false);
  });

  it("um lancamento lido com o sinal errado aparece na conciliacao do dia", async () => {
    const parsed = await parse([
      row("28/09/2026", "Abertura", 10000),
      row("29/09/2026", "Mercado", -2500),
      row("29/09/2026", "Padaria", -500)
    ]);
    expect(reconcile(parsed).status).toBe("match");
    const mercado = parsed.rows.find((item) => item.rawDescription === "Mercado")!;
    mercado.amountCents = 2500;
    const result = reconcile(parsed);
    expect(result.status).toBe("mismatch");
    expect(result.axes.find((axis) => axis.key === "saldo-2026-09-29")!.differenceCents).toBe(5000);
  });

  it("detecta o BTG e nao outro documento", async () => {
    expect(btgStatementAdapter.detect(await readTextLayer(writePdf(btgFixturePages())))).toBe(1);
    const other = await readTextLayer(
      writePdf([{ items: [{ text: "Extrato de conta corrente", x: 25, yTop: 84 }] }])
    );
    expect(btgStatementAdapter.detect(other)).toBeLessThan(0.7);
  });
});
