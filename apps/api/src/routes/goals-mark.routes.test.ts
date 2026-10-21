import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

type App = ReturnType<typeof buildApp>;

let db: AppDatabase;
let app: App;
let checking: number;
let goal: number;

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, payload });
const balanceOfGoal = async () =>
  (await app.inject(`/api/ledger/goals/${goal}`).then((r) => r.json())).goal.balanceCents;

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService: { runAll: async () => [] } });
  await app.ready();
  const person = (await app.inject("/api/ledger/people").then((r) => r.json()))[0].id;
  checking = (
    await post("/api/ledger/accounts", {
      name: "Conjunta",
      kind: "checking",
      color: "#8a2be2",
      personId: person,
      openingBalanceCents: 0
    })
  ).json().id;
  await post("/api/ledger/entries", {
    accountId: checking,
    date: "2026-01-05",
    amountCents: 1000_00,
    kind: "income",
    status: "cleared"
  });
  goal = (
    await post("/api/ledger/goals", {
      name: "Viagem",
      mode: "earmark",
      accountId: checking,
      color: "#00a86b"
    })
  ).json().id;
});

afterEach(async () => {
  await app.close();
});

describe("saldo mostrado com dinheiro em caixinha", () => {
  it("guardar tira do saldo da conta atrelada; o total continua o mesmo", async () => {
    const saved = (
      await post("/api/ledger/goals", { name: "Carro", color: "#123456", parentAccountId: checking })
    ).json().id;
    expect(
      (await post(`/api/ledger/goals/${saved}/deposit`, { amountCents: 300_00, date: "2026-01-06" })).statusCode
    ).toBe(201);

    const summary = await app.inject("/api/ledger/summary").then((r) => r.json());
    const account = summary.accounts.find((a: { id: number }) => a.id === checking);
    // R$ 1.000 na conta, R$ 300 guardados: a conta mostra R$ 700 e as
    // caixinhas dela R$ 300; o saldo de tudo continua R$ 1.000.
    expect(account.currentBalanceCents).toBe(700_00);
    expect(account.goalsCents).toBe(300_00);
    expect(summary.consolidated.currentCents).toBe(1000_00);
  });
});

describe("POST /api/ledger/goals/:id/mark", () => {
  it("separa e libera parte do saldo sem escolher lançamento", async () => {
    expect((await post(`/api/ledger/goals/${goal}/mark`, { amountCents: 300_00 })).statusCode).toBe(200);
    expect((await post(`/api/ledger/goals/${goal}/mark`, { amountCents: 200_00 })).statusCode).toBe(200);
    expect(await balanceOfGoal()).toBe(500_00);
    expect(db.ledger.goals.freeBalance(checking)).toBe(500_00);

    const release = await post(`/api/ledger/goals/${goal}/mark`, { amountCents: -150_00 });
    expect(release.statusCode).toBe(200);
    expect(await balanceOfGoal()).toBe(350_00);
  });

  it("recusa separar mais que o saldo livre", async () => {
    const response = await post(`/api/ledger/goals/${goal}/mark`, { amountCents: 1200_00 });
    expect(response.statusCode).toBe(400);
    expect(await balanceOfGoal()).toBe(0);
  });

  it("recusa liberar mais que o separado", async () => {
    await post(`/api/ledger/goals/${goal}/mark`, { amountCents: 100_00 });
    const response = await post(`/api/ledger/goals/${goal}/mark`, { amountCents: -200_00 });
    expect(response.statusCode).toBe(400);
    expect(await balanceOfGoal()).toBe(100_00);
  });
});

describe("PUT /api/ledger/goals/order", () => {
  it("devolve as caixinhas na ordem gravada, com as novas no fim", async () => {
    const second = (
      await post("/api/ledger/goals", { name: "Carro", mode: "earmark", accountId: checking, color: "#123456" })
    ).json().id;
    const put = await app.inject({
      method: "PUT",
      url: "/api/ledger/goals/order",
      payload: { ids: [second, goal, 9999] }
    });
    expect(put.json().ids).toEqual([second, goal]);

    const third = (
      await post("/api/ledger/goals", { name: "Casa", mode: "earmark", accountId: checking, color: "#654321" })
    ).json().id;
    const list = await app.inject("/api/ledger/goals").then((r) => r.json());
    expect(list.map((item: { id: number }) => item.id)).toEqual([second, goal, third]);
  });
});
