import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

/**
 * O ciclo do cartão não pode descontar o mesmo gasto duas vezes: a compra vira
 * fatura (a conta não se mexe), e pagar a fatura troca dívida por saldo — o
 * gasto já foi contado uma vez, na compra.
 */

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let bank: number;
let card: number;
let mercado: number;

const post = (url: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url, payload });

/** Tudo que o app mostra sobre dinheiro, num lugar só. */
async function snapshot() {
  const balances = await app.inject("/api/ledger/balances").then((r) => r.json());
  const account = (id: number) =>
    balances.accounts.find((item: { id: number }) => item.id === id);
  const summary = await app
    .inject("/api/ledger/summary?from=2026-09-01&to=2026-09-30")
    .then((r) => r.json());
  const dashboard = await app.inject("/api/dashboard").then((r) => r.json());
  return {
    bankCents: account(bank).currentBalanceCents as number,
    cardOwedCents: account(card).totalDueCents as number,
    // Gastos do mês, como Painel, Gastos e Relatórios mostram.
    monthExpenseCents: summary.month.expenseCents as number,
    monthNetCents: summary.month.netCents as number,
    // Patrimônio em reais: contas menos a dívida do cartão.
    netWorthBrl: dashboard.totalBrl as number
  };
}

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService: { runAll: async () => [] } });
  await app.ready();

  const person = db.ledger.people.list()[0]!.id;
  bank = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: person,
    openingBalanceCents: 1000_00
  });
  card = (
    await post("/api/ledger/accounts", {
      name: "Cartao",
      kind: "credit_card",
      color: "#ff0000",
      personId: person,
      closingDay: 20,
      dueDay: 27,
      creditLimitCents: 5000_00,
      paymentAccountId: bank
    })
  ).json().id;
  mercado = db.ledger.categories.list().find((c) => c.name === "Mercado")!.id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("compra no cartão e pagamento da fatura", () => {
  it("a compra vira fatura sem mexer na conta, e pagar não conta o gasto de novo", async () => {
    const before = await snapshot();
    expect(before).toMatchObject({ bankCents: 1000_00, cardOwedCents: 0, monthExpenseCents: 0 });

    // Compra de R$ 100 no cartão (fecha dia 20, vence dia 27: cai na fatura 2026-09).
    expect(
      (
        await post("/api/ledger/entries", {
          accountId: card,
          date: "2026-09-10",
          amountCents: -100_00,
          kind: "expense",
          categoryId: mercado
        })
      ).statusCode
    ).toBe(201);

    const purchased = await snapshot();
    // A conta continua com tudo: o dinheiro ainda não saiu do banco.
    expect(purchased.bankCents).toBe(1000_00);
    // A dívida nasce e o gasto entra uma vez no mês.
    expect(purchased.cardOwedCents).toBe(100_00);
    expect(purchased.monthExpenseCents).toBe(-100_00);
    // O patrimônio já caiu os R$ 100 (conta menos dívida).
    expect(purchased.netWorthBrl).toBe(900);

    // Paga a fatura inteira, pela conta do cartão.
    const paid = await post("/api/ledger/cards/" + card + "/statements/2026-09/payment", {
      date: "2026-09-27",
      amountCents: 100_00
    });
    expect(paid.statusCode).toBe(201);

    const after = await snapshot();
    // Agora o dinheiro sai do banco e a dívida some...
    expect(after.bankCents).toBe(900_00);
    expect(after.cardOwedCents).toBe(0);
    // ...mas o gasto continua sendo um só, e o patrimônio não cai de novo.
    expect(after.monthExpenseCents).toBe(-100_00);
    expect(after.monthNetCents).toBe(-100_00);
    expect(after.netWorthBrl).toBe(900);
  });

  it("desfazer o pagamento devolve a fatura ao estado anterior, sem sobras", async () => {
    await post("/api/ledger/entries", {
      accountId: card,
      date: "2026-09-10",
      amountCents: -100_00,
      kind: "expense",
      categoryId: mercado
    });
    const purchased = await snapshot();
    const paid = await post("/api/ledger/cards/" + card + "/statements/2026-09/payment", {
      date: "2026-09-27",
      amountCents: 100_00
    });
    const transferId = paid.json().payment.toEntryId
      ? db.ledger.entries.get(paid.json().payment.toEntryId)!.transferId
      : null;
    expect(transferId).not.toBeNull();

    const undone = await app.inject({
      method: "DELETE",
      url: `/api/ledger/cards/${card}/statements/2026-09/payment/${transferId}`
    });
    expect(undone.statusCode).toBe(200);
    expect(await snapshot()).toEqual(purchased);
  });

  it("a fatura paga fica zerada: o pagamento não vira compra nem entra nos gastos", async () => {
    await post("/api/ledger/entries", {
      accountId: card,
      date: "2026-09-10",
      amountCents: -100_00,
      kind: "expense",
      categoryId: mercado
    });
    await post("/api/ledger/cards/" + card + "/statements/2026-09/payment", {
      date: "2026-09-27",
      amountCents: 100_00
    });
    const statement = await app
      .inject(`/api/ledger/cards/${card}/statements/2026-09`)
      .then((r) => r.json());
    // A fatura fala em dívida (positiva): R$ 100 de compras, R$ 100 pagos.
    expect(statement.purchasesCents).toBe(100_00);
    expect(statement.paymentsCents).toBe(100_00);
    expect(statement.totalCents).toBe(0);
    // O pagamento só aparece no bloco de pagamentos, nunca entre as compras.
    expect(statement.purchases).toHaveLength(1);
    expect(statement.payments).toHaveLength(1);
  });
});
