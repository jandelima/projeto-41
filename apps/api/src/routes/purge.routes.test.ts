import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

type App = ReturnType<typeof buildApp>;

let db: AppDatabase;
let app: App;
let person: number;
let checking: number;
let other: number;
let card: number;

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });
const balanceOf = (id: number) =>
  db.ledger.balances.forAccount(id, { asOf: "2026-12-31" })?.currentBalanceCents;

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService: { runAll: async () => [] } });
  await app.ready();
  person = (await app.inject("/api/ledger/people").then((r) => r.json()))[0].id;
  checking = (
    await post("/api/ledger/accounts", {
      name: "Nubank",
      kind: "checking",
      color: "#8a2be2",
      personId: person,
      openingBalanceCents: 1000_00
    })
  ).json().id;
  other = (
    await post("/api/ledger/accounts", {
      name: "Inter",
      kind: "checking",
      color: "#ff7a00",
      personId: person,
      openingBalanceCents: 500_00
    })
  ).json().id;
  card = (
    await post("/api/ledger/accounts", {
      name: "Cartao",
      kind: "credit_card",
      color: "#333333",
      personId: person,
      closingDay: 25,
      dueDay: 2,
      paymentAccountId: checking
    })
  ).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("excluir de vez", () => {
  it("apaga a conta, os lançamentos e o cartão dela; a outra ponta vira ajuste", async () => {
    await post("/api/ledger/entries", {
      accountId: checking,
      date: "2026-03-10",
      amountCents: -45_00,
      kind: "expense"
    });
    await post("/api/ledger/entries", {
      accountId: card,
      date: "2026-03-11",
      amountCents: -30_00,
      kind: "expense"
    });
    await post("/api/ledger/transfers", {
      fromAccountId: other,
      toAccountId: checking,
      date: "2026-03-12",
      amountCents: 100_00
    });
    const before = balanceOf(other);

    const usage = (await app.inject(`/api/ledger/accounts/${checking}/usage`)).json();
    expect(usage).toMatchObject({ entries: 3, cards: 1, transfersOut: 1, investmentLinks: 0 });

    const response = await del(`/api/ledger/accounts/${checking}?purge=1`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ archived: false, cards: 1 });

    const ids = db.raw.prepare("SELECT id FROM accounts").all().map((row) => (row as { id: number }).id);
    expect(ids).not.toContain(checking);
    expect(ids).not.toContain(card);
    // O dinheiro saiu do Inter de verdade: o saldo de lá não muda.
    expect(balanceOf(other)).toBe(before);
    const leftover = db.raw
      .prepare("SELECT kind, amount_cents AS cents FROM entries WHERE account_id = ?")
      .all(other);
    expect(leftover).toEqual([{ kind: "adjustment", cents: -100_00 }]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });
  });

  it("sem purge, a conta em uso continua só arquivada", async () => {
    await post("/api/ledger/entries", {
      accountId: checking,
      date: "2026-03-10",
      amountCents: -45_00,
      kind: "expense"
    });
    const response = await del(`/api/ledger/accounts/${checking}`);
    expect(response.json()).toMatchObject({ archived: true });
    expect(db.raw.prepare("SELECT archived FROM accounts WHERE id = ?").get(checking)).toEqual({
      archived: 1
    });
  });

  it("recusa conta com aporte de investimento e a conta-ponte, sem mexer em nada", async () => {
    const positionId = (
      await post("/api/positions", {
        category: "fixed_income",
        name: "CDI",
        invested: 0,
        currentValue: 0,
        currency: "BRL"
      })
    ).json().id;
    const deposit = await post("/api/investments/deposit", {
      positionId,
      fromAccountId: checking,
      amountCents: 200_00,
      date: "2026-03-10"
    });
    expect(deposit.statusCode).toBe(201);

    const refused = await del(`/api/ledger/accounts/${checking}?purge=1`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error ?? refused.json().message).toMatch(/Investimentos/);
    expect(db.raw.prepare("SELECT 1 AS ok FROM accounts WHERE id = ?").get(checking)).toEqual({ ok: 1 });

    const bridge = Number(db.settings.get("investment.bridge_account_id"));
    expect((await del(`/api/ledger/accounts/${bridge}?purge=1`)).statusCode).toBe(409);
  });

  it("desfaz o aporte pelo livro e devolve a posição", async () => {
    const positionId = (
      await post("/api/positions", {
        category: "fixed_income",
        name: "CDI",
        invested: 0,
        currentValue: 0,
        currency: "BRL"
      })
    ).json().id;
    await post("/api/investments/deposit", {
      positionId,
      fromAccountId: checking,
      amountCents: 200_00,
      date: "2026-03-10"
    });
    const leg = db.raw
      .prepare(
        `SELECT t.id AS transferId FROM transfers t JOIN entries e ON e.id = t.from_entry_id
         WHERE e.account_id = ?`
      )
      .get(checking) as { transferId: number };

    const response = await del(`/api/investments/transfers/${leg.transferId}`);
    expect(response.statusCode).toBe(200);
    expect(balanceOf(checking)).toBe(1000_00);
    expect(db.positions.list().find((p) => p.id === positionId)?.currentValue).toBe(0);
  });

  it("categoria e pessoa saem; os lançamentos ficam sem elas", async () => {
    const categoryId = (
      await post("/api/ledger/categories", { name: "Teste", kind: "expense", color: "#123456" })
    ).json().id;
    const entryId = (
      await post("/api/ledger/entries", {
        accountId: checking,
        date: "2026-03-10",
        amountCents: -45_00,
        kind: "expense",
        categoryId
      })
    ).json().id;

    expect((await del(`/api/ledger/categories/${categoryId}?purge=1`)).statusCode).toBe(200);
    expect(db.raw.prepare("SELECT 1 FROM categories WHERE id = ?").get(categoryId)).toBeUndefined();

    expect((await del(`/api/ledger/people/${person}?purge=1`)).statusCode).toBe(200);
    expect(db.raw.prepare("SELECT 1 FROM people WHERE id = ?").get(person)).toBeUndefined();
    expect(
      db.raw.prepare("SELECT category_id AS c, person_id AS p FROM entries WHERE id = ?").get(entryId)
    ).toEqual({ c: null, p: null });
    expect(db.raw.prepare("SELECT person_id AS p FROM accounts WHERE id = ?").get(checking)).toEqual({
      p: null
    });
  });

  it("caixinha com conta própria vai junto com a conta e o depósito", async () => {
    const goal = (
      await post("/api/ledger/goals", {
        name: "Viagem",
        color: "#2a9d8f",
        mode: "account",
        personId: person,
        parentAccountId: checking
      })
    ).json();
    const goalAccount = goal.goal.accountId ?? goal.goal.account?.id;
    await post(`/api/ledger/goals/${goal.id}/deposit`, {
      amountCents: 50_00,
      date: "2026-03-10",
      fromAccountId: checking
    });
    const before = balanceOf(checking);

    expect((await del(`/api/ledger/goals/${goal.id}?purge=1`)).statusCode).toBe(200);
    expect(db.raw.prepare("SELECT 1 FROM goals WHERE id = ?").get(goal.id)).toBeUndefined();
    if (goalAccount != null) {
      expect(db.raw.prepare("SELECT 1 FROM accounts WHERE id = ?").get(goalAccount)).toBeUndefined();
    }
    expect(balanceOf(checking)).toBe(before);
  });
});
