import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

type App = ReturnType<typeof buildApp>;

let db: AppDatabase;
let app: App;

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService: { runAll: async () => [] } });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

const as = (account: number | "all") => ({ "x-investment-account": String(account) });

/** A conta de investimento de uma pessoa do módulo de finanças, pelo nome. */
async function createAccount(name: string): Promise<number> {
  const list = await app.inject("/api/investment-accounts").then((r) => r.json());
  return list.find((account: { name: string }) => account.name === name).id;
}

describe("contas de investimento", () => {
  it("as contas são as pessoas de Finanças: a Principal vira a primeira, e cada pessoa ganha a sua", async () => {
    const list = await app.inject("/api/investment-accounts").then((r) => r.json());
    // Steylor e Bianca; o "Conjunto" não investe.
    expect(list.map((a: { id: number; name: string; personId: number }) => [a.id, a.name, a.personId])).toEqual([
      [1, "Steylor", 1],
      [2, "Bianca", 2]
    ]);
  });

  it("acompanha as pessoas: renomear muda a conta, pessoa nova ganha uma e arquivada some", async () => {
    await app.inject("/api/investment-accounts");
    db.raw.prepare("UPDATE people SET name = 'Bia' WHERE id = 2").run();
    db.raw
      .prepare("INSERT INTO people(name, kind, color, active, created_at) VALUES ('Carol', 'individual', '#123456', 1, ?)")
      .run(new Date().toISOString());
    let list = await app.inject("/api/investment-accounts").then((r) => r.json());
    expect(list.map((a: { id: number; name: string }) => [a.id, a.name])).toEqual([
      [1, "Steylor"],
      [2, "Bia"],
      [3, "Carol"]
    ]);

    db.raw.prepare("UPDATE people SET active = 0 WHERE id = 2").run();
    list = await app.inject("/api/investment-accounts").then((r) => r.json());
    expect(list.map((a: { name: string }) => a.name)).toEqual(["Steylor", "Carol"]);
  });

  it("não há como criar conta de investimento à mão", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/investment-accounts",
      payload: { name: "Outra" }
    });
    expect(response.statusCode).toBe(404);
  });

  it("cada conta vê só as próprias posições, operações e aportes", async () => {
    const other = await createAccount("Bianca");

    const position = (headers: Record<string, string>, name: string, category = "reserve") =>
      app.inject({
        method: "POST",
        url: "/api/positions",
        headers,
        payload: { category, name, invested: 0, currentValue: 100, currency: "BRL" }
      });
    expect((await position(as(1), "Reserva principal")).statusCode).toBe(201);
    expect((await position(as(other), "Reserva Bianca")).statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: "/api/operations",
      headers: as(other),
      payload: {
        portfolio: "b3",
        type: "buy",
        asset: "ITSA4",
        date: "2026-09-01",
        quantity: 10,
        total: 100,
        currency: "BRL"
      }
    });
    await app.inject({
      method: "POST",
      url: "/api/contributions",
      headers: as(other),
      payload: { date: "2026-09-01", amount: 100 }
    });

    const names = async (headers: Record<string, string>) =>
      (await app.inject({ url: "/api/positions", headers }).then((r) => r.json())).map(
        (item: { name: string }) => item.name
      );
    expect(await names(as(1))).toEqual(["Reserva principal"]);
    expect(await names(as(other))).toEqual(["Reserva Bianca"]);
    expect((await names(as("all"))).sort()).toEqual(["Reserva Bianca", "Reserva principal"]);

    const operations = (headers: Record<string, string>) =>
      app.inject({ url: "/api/operations", headers }).then((r) => r.json());
    expect(await operations(as(1))).toHaveLength(0);
    expect(await operations(as(other))).toHaveLength(1);

    const contributions = (headers: Record<string, string>) =>
      app.inject({ url: "/api/contributions", headers }).then((r) => r.json());
    expect(await contributions(as(1))).toHaveLength(0);
    expect(await contributions(as(other))).toHaveLength(1);
  });

  it("o banco entra na Principal e no todo, nunca numa conta extra", async () => {
    const other = await createAccount("Bianca");
    await app.inject({
      method: "POST",
      url: "/api/ledger/accounts",
      payload: { name: "Nubank", kind: "checking", color: "#8a2be2", personId: 1, openingBalanceCents: 500_00 }
    });
    await app.inject({
      method: "POST",
      url: "/api/positions",
      headers: as(other),
      payload: { category: "cash", name: "Caixa", invested: 0, currentValue: 200, currency: "BRL" }
    });

    const total = (headers: Record<string, string>) =>
      app.inject({ url: "/api/dashboard", headers }).then((r) => r.json().totalBrl);
    expect(await total(as(1))).toBe(500);
    expect(await total(as(other))).toBe(200);
    expect(await total(as("all"))).toBe(700);
  });

  it("metas de alocação e planejamento são de cada conta", async () => {
    const other = await createAccount("Bianca");
    await app.inject({
      method: "PUT",
      url: "/api/allocation/bitcoin",
      headers: as(other),
      payload: { weight: 0.9 }
    });
    const weight = async (headers: Record<string, string>) =>
      (await app.inject({ url: "/api/allocation", headers }).then((r) => r.json())).find(
        (item: { category: string }) => item.category === "bitcoin"
      ).weight;
    expect(await weight(as(1))).toBe(0.25);
    expect(await weight(as(other))).toBe(0.9);

    await app.inject({
      method: "PUT",
      url: "/api/planning",
      headers: as(other),
      payload: {
        initialCapital: 1000,
        monthlyContribution: 100,
        monthlyReturnPercent: 1,
        months: 12,
        annualInflationPercent: 4,
        initialYear: 2026
      }
    });
    const capital = (headers: Record<string, string>) =>
      app.inject({ url: "/api/planning", headers }).then((r) => r.json().initialCapital);
    expect(await capital(as(other))).toBe(1000);
    expect(await capital(as(1))).toBe(0);
  });

  it("recusa conta que não existe", async () => {
    const response = await app.inject({ url: "/api/positions", headers: as(99) });
    expect(response.statusCode).toBe(400);
  });
});
