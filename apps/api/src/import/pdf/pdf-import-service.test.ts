import { readFileSync } from "node:fs";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { btgFixturePages, writePdf, type FixtureRow, type WriterPage } from "@projeto41/pdf-statements/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildApp } from "../../app.js";

const BTG_FIXTURE = readFileSync(
  new URL("../../../../../packages/pdf-statements/__fixtures__/btg-extrato/2026-10.pdf", import.meta.url)
);

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let accountId: number;
let cardId: number;

function multipart(fields: Record<string, string>, file: { name: string; content: Buffer }) {
  const boundary = "----projeto41pdf";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        "Content-Type: application/pdf\r\n\r\n"
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

function send(content: Buffer, fields: Record<string, string> = {}, name = "extrato.pdf") {
  return app.inject({
    method: "POST",
    url: "/api/ledger/imports",
    ...multipart({ accountId: String(accountId), kind: "bank", ...fields }, { name, content })
  });
}

const entryCount = () => (db.raw.prepare("SELECT count(*) AS n FROM entries").get() as { n: number }).n;

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService: { runAll: async () => [] } });
  await app.ready();
  const personId = db.ledger.people.list()[0]!.id;
  accountId = db.ledger.accounts.create({
    name: "BTG",
    kind: "checking",
    color: "#003366",
    personId,
    openingBalanceCents: 0
  });
  cardId = db.ledger.accounts.create({
    name: "Cartao",
    kind: "credit_card",
    color: "#003366",
    personId,
    openingBalanceCents: 0,
    closingDay: 1,
    dueDay: 8
  });
});

afterEach(async () => {
  await app.close();
});

describe("PDF do BTG pelo pipeline da fase 6", () => {
  it("entra no staging com conciliacao gravada, e nada vai para o livro", async () => {
    const response = await send(BTG_FIXTURE);
    expect(response.statusCode).toBe(201);
    const view = response.json();
    expect(view.batch).toMatchObject({
      source: "pdf",
      periodStart: "2026-09-18",
      periodEnd: "2026-10-18",
      closingBalanceCents: 160224,
      pdf: { adapterId: "btg-extrato", layoutVersion: "2026-10", reconciliation: { status: "match" } }
    });
    expect(view.batch.pdf.warnings[0]).toMatch(/saldo anterior/);
    expect(view.rows).toHaveLength(11);
    expect(view.rows.every((row: { status: string }) => row.status === "needs_review")).toBe(true);
    expect(view.rows[0]).toMatchObject({ time: "11:27", pdf: { signKnown: true, sourcePage: 1 } });
    expect(view.rows[0].pdf.confidence).toBeLessThan(1);
    expect(entryCount()).toBe(0);

    const stored = db.raw
      .prepare("SELECT reconciliation_status AS status FROM import_batches WHERE id = ?")
      .get(view.batch.id);
    expect(stored).toEqual({ status: "match" });
  });

  it("nem regra 'sempre automatico' nem conciliacao perfeita gravam linha de PDF sozinhas", async () => {
    const month = (day: string, cents: [number, number, number]): FixtureRow[] => [
      { date: `28/${day}`, time: "09h00", category: ["Transferência"], transaction: ["Pix recebido"], description: "Fulana de Tal", cents: cents[0] },
      { date: `29/${day}`, time: "10h00", category: ["Transporte"], transaction: ["Pix enviado"], description: "Uber", cents: cents[1] },
      { date: `29/${day}`, time: "12h00", category: ["Alimentação"], transaction: ["Pix enviado"], description: "Mercadinho Teste", cents: cents[2] }
    ];
    // Primeiro mes: o usuario ensina "sempre automatico" para todo destinatario.
    const first = (await send(writePdf(btgFixturePages(month("09/2026", [50000, -713, -4590]))))).json();
    for (const row of first.rows) {
      const confirmed = await app.inject({
        method: "POST",
        url: `/api/ledger/imports/${first.batch.id}/rows/${row.id}/confirm`,
        payload: { action: "create", kind: row.amountCents < 0 ? "expense" : "income", remember: "auto" }
      });
      expect(confirmed.statusCode).toBe(200);
    }
    const before = entryCount();

    // Mes seguinte, mesmos destinatarios, soma conferida: num CSV tudo viria pronto.
    const next = (await send(writePdf(btgFixturePages(month("09/2026", [51000, -820, -3990]))), {}, "outubro.pdf")).json();
    expect(next.batch.pdf.reconciliation.status).toBe("match");
    expect(next.rows.every((row: { rule: unknown }) => row.rule !== null)).toBe(true);
    expect(next.counts.ready).toBe(0);
    expect(next.rows.every((row: { status: string }) => row.status === "needs_review")).toBe(true);

    const commit = await app.inject({ method: "POST", url: `/api/ledger/imports/${next.batch.id}/commit-ready` });
    expect(commit.statusCode).toBe(409);
    expect(entryCount()).toBe(before);
  });

  it("reenviar o mesmo PDF marca o que ja foi gravado como duplicado", async () => {
    const first = (await send(BTG_FIXTURE)).json();
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/ledger/imports/${first.batch.id}/rows/${first.rows[1].id}/confirm`,
      payload: { action: "create", kind: "expense" }
    });
    expect(confirmed.statusCode).toBe(200);
    const again = (await send(BTG_FIXTURE)).json();
    expect(again.rows[1].status).toBe("duplicate");
    expect(again.previousImportAt).not.toBeNull();
  });

  it("a planilha e o PDF do mesmo extrato nao duplicam nenhum lancamento", async () => {
    const rows: FixtureRow[] = [
      { date: "28/09/2026", time: "09h00", category: ["Transferência"], transaction: ["Pix recebido"], description: "Fulana de Tal", cents: 50000 },
      { date: "29/09/2026", time: "10h00", category: ["Transporte"], transaction: ["Pix enviado"], description: "Uber", cents: -713 },
      { date: "29/09/2026", time: "12h00", category: ["Alimentação"], transaction: ["Pix enviado"], description: "Mercadinho Teste", cents: -4590 }
    ];
    const sheet = XLSX.utils.aoa_to_sheet([
      [null, "Data e hora", "Categoria", "Transação", "Descrição", "Valor"],
      ...rows.map((row) => [null, `${row.date} ${row.time.replace("h", ":")}`, row.category.join(" "), row.transaction.join(" "), row.description, row.cents / 100])
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Extrato");
    const xls = XLSX.write(book, { type: "buffer", bookType: "biff8" }) as Buffer;

    const fromSheet = (await send(xls, {}, "extrato.xls")).json();
    for (const row of fromSheet.rows) {
      await app.inject({
        method: "POST",
        url: `/api/ledger/imports/${fromSheet.batch.id}/rows/${row.id}/confirm`,
        payload: { action: "create", kind: row.amountCents < 0 ? "expense" : "income" }
      });
    }
    expect(entryCount()).toBe(3);

    const fromPdf = (await send(writePdf(btgFixturePages(rows)))).json();
    expect(fromPdf.rows.map((row: { status: string }) => row.status)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate"
    ]);
  });

  it("soma que nao bate fica gravada no lote, com a diferenca de cada eixo", async () => {
    const pages: WriterPage[] = btgFixturePages();
    // O ultimo saldo diario impresso com 1 centavo a mais.
    const items = pages[1]!.items;
    const label = items.filter((item) => item.text === "Saldo Diário").at(-1)!;
    const printed = items.find((item) => item.yTop === label.yTop && item.align === "right")!;
    printed.text = printed.text.replace(/,(\d)(\d)$/, (_, tens, units) => `,${tens}${Number(units) + 1}`);

    const view = (await send(writePdf(pages))).json();
    expect(view.batch.pdf.reconciliation.status).toBe("mismatch");
    const wrong = view.batch.pdf.reconciliation.axes.filter((axis: { status: string }) => axis.status !== "match");
    expect(wrong.map((axis: { key: string; differenceCents: number }) => [axis.key, axis.differenceCents])).toEqual([
      ["saldo-2026-10-01", -1]
    ]);
    expect(view.counts.ready).toBe(0);
  });
});

describe("PDF que nao da para ler", () => {
  it("digitalizado responde 422 falando de OCR, e nao grava nada", async () => {
    const response = await send(writePdf([{ items: [], imageOnly: true }]));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "pdf_scanned" });
    expect(response.json().error).toMatch(/OCR/);
    expect(db.raw.prepare("SELECT count(*) AS n FROM import_batches").get()).toEqual({ n: 0 });
  });

  it("com senha: 401 pedindo a senha, 401 na errada, 201 com a certa", async () => {
    const locked = writePdf(btgFixturePages(), { password: "123456" });
    const missing = await send(locked);
    expect(missing.statusCode).toBe(401);
    expect(missing.json().code).toBe("pdf_password_required");

    const wrong = await send(locked, { password: "000000" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe("pdf_password_incorrect");
    expect(JSON.stringify(wrong.json())).not.toContain("000000");

    const right = await send(locked, { password: "123456" });
    expect(right.statusCode).toBe(201);
    expect(right.json().rows).toHaveLength(11);
  });

  it("layout desconhecido responde 422 e sugere outro formato", async () => {
    const response = await send(writePdf([{ items: [{ text: "Fatura de outro banco", x: 30, yTop: 100 }] }]));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "pdf_layout_unknown" });
  });

  it("extrato de conta enviado como fatura de cartao e recusado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ledger/imports",
      ...multipart(
        { accountId: String(cardId), kind: "card" },
        { name: "extrato.pdf", content: BTG_FIXTURE }
      )
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/extrato de conta/);
  });
});
