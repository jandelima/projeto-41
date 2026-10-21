import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { readTextLayer } from "@projeto41/pdf-statements";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { collectLedgerReport } from "./ledger-report.js";
import { renderLedgerReportPdf } from "./ledger-report-pdf.js";

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let bank: number;
let card: number;
let goal: number;

const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });
const categoryId = (name: string) => db.ledger.categories.list().find((category) => category.name === name)!.id;

async function entry(payload: Record<string, unknown>) {
  const response = await post("/api/ledger/entries", payload);
  expect(response.statusCode).toBe(201);
}

/** Texto de cada pagina do PDF gerado, lido pelo mesmo leitor da importacao. */
async function pagesOf(pdf: Buffer) {
  return (await readTextLayer(pdf)).map((page) => page.items.map((item) => item.text).join(" "));
}

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService: { runAll: async () => [] } });
  await app.ready();
  const person = db.ledger.people.list()[0]!.id;
  bank = db.ledger.accounts.create({
    name: "Conta Teste",
    kind: "checking",
    color: "#2563eb",
    personId: person,
    openingBalanceCents: 1000_00
  });
  goal = db.ledger.accounts.create({
    name: "Caixinha Teste",
    kind: "goal",
    color: "#10b981",
    personId: person,
    openingBalanceCents: 0
  });
  card = (
    await post("/api/ledger/accounts", {
      name: "Cartão Teste",
      kind: "credit_card",
      color: "#ef4444",
      personId: person,
      closingDay: 20,
      dueDay: 27,
      creditLimitCents: 5000_00,
      paymentAccountId: bank
    })
  ).json().id;
  const income = db.ledger.categories.create({ name: "Salário teste", kind: "income", color: "#0f9d6b" });

  await entry({ accountId: bank, date: "2026-09-05", amountCents: 3000_00, kind: "income", categoryId: income, description: "Salário de setembro" });
  await entry({ accountId: bank, date: "2026-09-06", amountCents: -250_00, kind: "expense", categoryId: categoryId("Mercado"), description: "Feira do mês" });
  await entry({ accountId: card, date: "2026-09-10", amountCents: -120_00, kind: "expense", categoryId: categoryId("Mercado"), description: "Supermercado no cartão" });
  await entry({ accountId: card, date: "2026-09-12", amountCents: -80_00, kind: "expense", categoryId: categoryId("Saúde"), description: "Farmácia" });
  await post("/api/ledger/transfers", { fromAccountId: bank, toAccountId: goal, date: "2026-09-15", amountCents: 500_00 });
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("dados do relatorio", () => {
  it("totais, uma linha por conta e a fatura do cartao com vencimento no periodo", () => {
    const report = collectLedgerReport(db, SEPTEMBER, "2026-10-18T19:40");
    expect(report.totals).toEqual({
      incomeCents: 3000_00,
      expenseCents: -450_00,
      netCents: 2550_00,
      invoiceCents: 200_00
    });
    expect(report.accounts.map((account) => [account.name, account.group])).toEqual([
      ["Conta Teste", "accounts"],
      ["Cartão Teste", "cards"],
      ["Caixinha Teste", "savings"]
    ]);
    expect(report.accounts[0]).toMatchObject({
      incomeCents: 3000_00,
      expenseCents: -250_00,
      transfersCents: -500_00,
      invoiceCents: null
    });
    expect(report.accounts[1]).toMatchObject({ expenseCents: -200_00, invoiceCents: 200_00 });
    expect(report.accounts[2]).toMatchObject({ transfersCents: 500_00 });
  });

  it("conta arquivada depois continua no relatorio do periodo em que movimentou", () => {
    db.raw.prepare("UPDATE accounts SET archived = 1 WHERE id = ?").run(bank);
    const report = collectLedgerReport(db, SEPTEMBER, "2026-10-18T19:40");
    // Os totais seguem fechando com as categorias, que nao filtram conta.
    expect(report.totals.expenseCents).toBe(-450_00);
    const categories = report.expenseCategories.reduce((sum, category) => sum + category.cents, 0);
    expect(-report.totals.expenseCents).toBe(categories);
    expect(report.accounts.map((account) => account.name)).toContain("Conta Teste");
  });

  it("categorias de saida e de entrada, com participacoes que somam 100%", () => {
    const report = collectLedgerReport(db, SEPTEMBER, "2026-10-18T19:40");
    expect(report.expenseCategories.map((category) => [category.name, category.cents])).toEqual([
      ["Mercado", 370_00],
      ["Saúde", 80_00]
    ]);
    expect(report.expenseCategories.reduce((sum, category) => sum + category.sharePerMille, 0)).toBe(1000);
    expect(report.incomeCategories).toEqual([
      expect.objectContaining({ name: "Salário teste", cents: 3000_00, sharePerMille: 1000 })
    ]);
  });

  it("periodo sem lancamento nao quebra", () => {
    const report = collectLedgerReport(db, { from: "2020-01-01", to: "2020-01-31" }, "2026-10-18T19:40");
    expect(report.accounts).toEqual([]);
    expect(report.totals).toEqual({ incomeCents: 0, expenseCents: 0, netCents: 0, invoiceCents: 0 });
  });
});

describe("relatorio em PDF", () => {
  it("primeira pagina e o resumo; depois as transacoes, contas antes dos cartoes", async () => {
    const pdf = await renderLedgerReportPdf(collectLedgerReport(db, SEPTEMBER, "2026-10-18T19:40"));
    const pages = await pagesOf(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(3);

    const [cover] = pages;
    expect(cover).toContain("Relatório financeiro");
    expect(cover).toContain("01/09/2026 a 30/09/2026");
    for (const text of ["R$ 3.000,00", "-R$ 450,00", "R$ 2.550,00", "R$ 200,00", "Conta Teste", "Cartão Teste", "CARTÕES"]) {
      expect(cover).toContain(text);
    }
    expect(cover).toContain("Saídas por categoria");
    expect(cover).toContain("Entradas por categoria");
    expect(cover).toContain("82,2%");
    // Nenhuma transacao na primeira pagina: ela e so o resumo.
    expect(cover).not.toContain("Feira do mês");

    const accountsPage = pages.findIndex((page) => page.includes("Transações — contas"));
    const cardsPage = pages.findIndex((page) => page.includes("Transações — cartões"));
    expect(accountsPage).toBeGreaterThan(0);
    expect(cardsPage).toBeGreaterThan(accountsPage);
    expect(pages[accountsPage]).toContain("Feira do mês");
    expect(pages[accountsPage]).not.toContain("Supermercado no cartão");
    expect(pages[cardsPage]).toContain("Supermercado no cartão");
    expect(pages.at(-1)).toContain(`Página ${pages.length} de ${pages.length}`);
  });

  it("muitas transacoes continuam na pagina seguinte, com o cabecalho da conta repetido", async () => {
    for (let day = 1; day <= 28; day += 1) {
      for (let index = 0; index < 3; index += 1) {
        await entry({
          accountId: bank,
          date: `2026-09-${String(day).padStart(2, "0")}`,
          amountCents: -(day * 100 + index),
          kind: "expense",
          categoryId: categoryId("Mercado"),
          description: `Compra ${day}-${index}`
        });
      }
    }
    const pages = await pagesOf(await renderLedgerReportPdf(collectLedgerReport(db, SEPTEMBER, "2026-10-18T19:40")));
    expect(pages.some((page) => page.includes("Conta Teste (continuação)"))).toBe(true);
    const all = pages.join(" ");
    expect(all).toContain("Compra 1-0");
    expect(all).toContain("Compra 28-2");
  });

  it("a rota devolve o PDF do periodo pedido, como anexo", async () => {
    const response = await app.inject("/api/ledger/report.pdf?period=2026-09");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toContain('filename="relatorio-2026-09.pdf"');
    expect(response.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const [cover] = await pagesOf(response.rawPayload);
    expect(cover).toContain("01/09/2026 a 30/09/2026");
  });

  it("recorte invalido responde 400", async () => {
    const response = await app.inject("/api/ledger/report.pdf?period=setembro");
    expect(response.statusCode).toBe(400);
  });
});
