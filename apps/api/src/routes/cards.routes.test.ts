import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const priceService = { runAll: async () => [] };

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let steylor: number;
let checking: number;
let card: number;
let mercado: number;

async function post(url: string, payload: Record<string, unknown> = {}) {
  return await app.inject({ method: "POST", url, payload });
}

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService });
  await app.ready();

  steylor = db.ledger.people.list()[0]!.id;
  checking = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    openingBalanceCents: 500000
  });
  mercado = db.ledger.categories.list().find((c) => c.name === "Mercado")!.id;

  // O cartão é criado pela rota de contas: não existe CRUD paralelo (D04).
  const created = await post("/api/ledger/accounts", {
    name: "Cartao",
    kind: "credit_card",
    color: "#ff0000",
    personId: steylor,
    closingDay: 20,
    dueDay: 27,
    creditLimitCents: 500000,
    paymentAccountId: checking
  });
  card = created.json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("cadastro e resumo do cartao", () => {
  it("cria pela rota de contas e lista com os dois numeros separados", async () => {
    const cards = await app.inject("/api/ledger/cards").then((r) => r.json());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveProperty("currentStatementCents");
    expect(cards[0]).toHaveProperty("totalOwedCents");
    expect(cards[0].closingDay).toBe(20);
    expect(cards[0].paymentAccountName).toBe("Nubank");
  });

  it("fatura atual e total devido vem DIFERENTES com parcela futura", async () => {
    await post("/api/ledger/installment-plans", {
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const summary = await app.inject(`/api/ledger/cards/${card}`).then((r) => r.json());
    expect(summary.totalOwedCents).toBe(30000);
    expect(summary.currentStatementCents).not.toBe(summary.totalOwedCents);
  });

  it("devolve 404 para cartao inexistente e para conta que nao e cartao", async () => {
    expect((await app.inject("/api/ledger/cards/999")).statusCode).toBe(404);
    expect((await app.inject(`/api/ledger/cards/${checking}`)).statusCode).toBe(404);
  });
});

describe("faturas", () => {
  it("navega para uma fatura futura e encontra as parcelas", async () => {
    await post("/api/ledger/installment-plans", {
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const statement = await app
      .inject(`/api/ledger/cards/${card}/statements/2026-07`)
      .then((r) => r.json());
    expect(statement.purchases).toHaveLength(1);
    expect(statement.purchases[0].installmentNumber).toBe(3);
    expect(statement.purchases[0].installmentCount).toBe(3);
  });

  it("recusa mes malformado", async () => {
    expect((await app.inject(`/api/ledger/cards/${card}/statements/2026-13`)).statusCode).toBe(400);
    expect((await app.inject(`/api/ledger/cards/${card}/statements/maio`)).statusCode).toBe(400);
  });
});

describe("pagamento da fatura", () => {
  beforeEach(() => {
    db.ledger.entries.create({
      accountId: card,
      date: "2026-05-10",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
  });

  it("cria a transferencia e zera a fatura", async () => {
    const response = await post(`/api/ledger/cards/${card}/statements/2026-05/payment`, {
      date: "2026-05-27",
      amountCents: 10000
    });
    expect(response.statusCode).toBe(201);
    // `totalOwedCents` nao depende de qual mes e "hoje" no ambiente de teste,
    // ao contrario de `currentStatementCents`.
    expect(response.json().card.totalOwedCents).toBe(0);

    const statement = await app
      .inject(`/api/ledger/cards/${card}/statements/2026-05`)
      .then((r) => r.json());
    expect(statement.totalCents).toBe(0);
    expect(statement.payments).toHaveLength(1);
  });

  it("recusa valor diferente do total (D12)", async () => {
    const response = await post(`/api/ledger/cards/${card}/statements/2026-05/payment`, {
      date: "2026-05-27",
      amountCents: 5000
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/parcial/i);
  });

  it("desfazer devolve o saldo devedor", async () => {
    const payment = await post(`/api/ledger/cards/${card}/statements/2026-05/payment`, {
      date: "2026-05-27",
      amountCents: 10000
    });
    const transferId = db.ledger.entries.get(payment.json().payment.fromEntryId)!.transferId!;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/ledger/cards/${card}/statements/2026-05/payment/${transferId}`
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().card.totalOwedCents).toBe(10000);
  });
});

describe("antecipacao", () => {
  it("antecipa e desfaz, voltando ao estado original", async () => {
    const plan = await post("/api/ledger/installment-plans", {
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const last = plan.json().installments.find((row: { installmentNumber: number }) =>
      row.installmentNumber === 3
    );
    const before = { month: last.statementMonth, date: last.date };

    const moved = await post(`/api/ledger/cards/${card}/anticipate`, {
      entryIds: [last.id],
      targetMonth: "2026-05"
    });
    expect(moved.json().moved[0].previousStatementMonth).toBe(before.month);
    expect(db.ledger.entries.get(last.id)?.statementMonth).toBe("2026-05");
    expect(db.ledger.entries.get(last.id)?.date).toBe(before.date);

    await post(`/api/ledger/cards/${card}/anticipate/undo`, { entryIds: [last.id] });
    expect(db.ledger.entries.get(last.id)?.statementMonth).toBe(before.month);
  });
});

describe("parcelamento pela rota", () => {
  it("cria o plano com as parcelas e o rotulo da serie", async () => {
    const response = await post("/api/ledger/installment-plans", {
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 10000,
      installmentCount: 3,
      categoryId: mercado,
      description: "Fone"
    });
    expect(response.statusCode).toBe(201);
    expect(
      response.json().installments.map((row: { amountCents: number }) => -row.amountCents)
    ).toEqual([3334, 3333, 3333]);
  });

  it("editar uma parcela avisa da soma divergente", async () => {
    const plan = await post("/api/ledger/installment-plans", {
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 10000,
      installmentCount: 3,
      categoryId: mercado
    });
    const response = await app.inject({
      method: "PUT",
      url: `/api/ledger/installment-plans/${plan.json().id}/installments/2`,
      payload: { amountCents: 5000 }
    });
    expect(response.json().sumMatchesTotal).toBe(false);
    expect(response.json().differenceCents).toBe(1667);
  });

  it("devolve 404 para plano inexistente", async () => {
    expect((await app.inject("/api/ledger/installment-plans/999")).statusCode).toBe(404);
  });
});

describe("escopo de serie na edicao", () => {
  let planId: number;
  let middle: { id: number; amountCents: number; date: string };

  beforeEach(async () => {
    const plan = await post("/api/ledger/installment-plans", {
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado,
      description: "Fone"
    });
    planId = plan.json().id;
    middle = plan.json().installments.find((row: { installmentNumber: number }) =>
      row.installmentNumber === 2
    );
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    accountId: card,
    date: middle.date,
    amountCents: middle.amountCents,
    kind: "expense",
    categoryId: mercado,
    description: "Fone bluetooth",
    ...overrides
  });

  it("scope=forward muda desta parcela em diante, nunca as anteriores", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/api/ledger/entries/${middle.id}?scope=forward`,
      payload: body()
    });
    expect(response.statusCode).toBe(200);

    const rows = db.ledger.installmentPlans.installments(planId);
    expect(rows.map((row) => row.description)).toEqual(["Fone", "Fone bluetooth", "Fone bluetooth"]);
    // Cada irmã manteve o próprio valor e a própria data.
    expect(rows.map((row) => row.amountCents)).toEqual([-10000, -10000, -10000]);
    expect(rows.map((row) => row.statementMonth)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });

  it("scope=all muda a serie inteira", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/ledger/entries/${middle.id}?scope=all`,
      payload: body()
    });
    const rows = db.ledger.installmentPlans.installments(planId);
    expect(rows.every((row) => row.description === "Fone bluetooth")).toBe(true);
  });

  it("scope diferente de one junto com mudanca de valor devolve 400", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/api/ledger/entries/${middle.id}?scope=all`,
      payload: body({ amountCents: -5000 })
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/scope=one/);
  });
});

describe("estorno pela rota", () => {
  it("estorna um lancamento e devolve limite", async () => {
    const entry = await post("/api/ledger/entries", {
      accountId: card,
      date: "2026-05-10",
      amountCents: -20000,
      kind: "expense",
      categoryId: mercado
    });
    const response = await post(`/api/ledger/entries/${entry.json().id}/refund`, {
      date: "2026-05-12"
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().entry.amountCents).toBe(20000);
    expect(db.ledger.cards.summary(card, "2026-05-15").availableCents).toBe(500000);
  });

  it("estorna a compra parcelada inteira sem interromper as parcelas", async () => {
    const plan = await post("/api/ledger/installment-plans", {
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const response = await post(`/api/ledger/installment-plans/${plan.json().id}/refund`, {
      date: "2026-05-12"
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().card.totalOwedCents).toBe(0);
    expect(db.ledger.installmentPlans.installments(plan.json().id)).toHaveLength(3);
  });
});
