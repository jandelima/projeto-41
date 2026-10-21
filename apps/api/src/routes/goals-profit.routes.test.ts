import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createCdiService } from "../cdi/cdi-service.js";

/**
 * Lucro da caixinha: automático (CDI) ou lançado pelo usuário, ajuste do lucro
 * e o percentual até agora e ao ano.
 */

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let dir: string;
let steylor: number;
let checking: number;

const offlineFetcher = vi.fn(async () => {
  throw new Error("offline");
});

const post = (url: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url, payload });
const put = (url: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "PUT", url, payload });

beforeEach(async () => {
  db = createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), "projeto41-profit-"));
  const cdiService = createCdiService(db, dir, offlineFetcher as unknown as typeof fetch, [0, 0, 0]);
  app = buildApp({ db, priceService: { runAll: async () => [] }, cdiService });
  await app.ready();
  steylor = db.ledger.people.list()[0]!.id;
  checking = db.ledger.accounts.create({
    name: "BTG conjunta",
    kind: "checking",
    color: "#003366",
    personId: steylor,
    openingBalanceCents: 1_000_000
  });
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const create = (payload: Record<string, unknown> = {}) =>
  post("/api/ledger/goals", {
    name: "Viagem",
    mode: "account",
    color: "#00a86b",
    personId: steylor,
    parentAccountId: checking,
    ...payload
  });

async function goalWithDeposit(payload: Record<string, unknown> = {}, cents = 100_000, date = "2026-08-01") {
  const { id } = (await create(payload)).json();
  await post(`/api/ledger/goals/${id}/deposit`, { amountCents: cents, date });
  return id as number;
}

const editBody = { name: "Viagem", color: "#00a86b", parentAccountId: undefined as number | undefined };

describe("modo do lucro", () => {
  it("sem % do CDI o lucro é manual; com %, automático", async () => {
    expect((await create()).json().goal.profitMode).toBe("manual");
    expect((await create({ name: "Carro", cdiPercent: 100 })).json().goal.profitMode).toBe("auto");
  });

  it("automático sem % do CDI é recusado", async () => {
    const response = await create({ profitMode: "auto" });
    expect(response.statusCode).toBe(400);
  });

  it("editar: tirar o CDI de uma automática a torna manual; pedir automático sem CDI é erro", async () => {
    const { id } = (await create({ cdiPercent: 100 })).json();
    const body = { ...editBody, parentAccountId: checking };
    const manual = await put(`/api/ledger/goals/${id}`, { ...body, cdiPercent: null });
    expect(manual.json().goal.profitMode).toBe("manual");
    expect(
      (await put(`/api/ledger/goals/${id}`, { ...body, cdiPercent: null, profitMode: "auto" })).statusCode
    ).toBe(400);
    const back = await put(`/api/ledger/goals/${id}`, { ...body, cdiPercent: 90, profitMode: "auto" });
    expect(back.json().goal).toMatchObject({ profitMode: "auto", cdiPercent: 90 });
  });

  it("no manual nada entra sozinho, mesmo com % do CDI guardado", async () => {
    const id = await goalWithDeposit({ cdiPercent: 100 });
    await put(`/api/ledger/goals/${id}`, {
      ...editBody,
      parentAccountId: checking,
      cdiPercent: 100,
      profitMode: "manual"
    });
    const result = (await post(`/api/ledger/goals/${id}/accrue`, { through: "2026-09-30" })).json();
    expect(result).toMatchObject({ cents: 0, entryId: null });
    expect(result.goal.yieldCents).toBe(0);
  });
});

describe("lançar lucro", () => {
  it("entra no saldo como lucro, sem virar dinheiro que você pôs", async () => {
    const id = await goalWithDeposit();
    const response = await post(`/api/ledger/goals/${id}/profit`, { amountCents: 1234, date: "2026-09-30" });
    expect(response.statusCode).toBe(201);
    const goal = response.json().goal;
    expect(goal).toMatchObject({
      balanceCents: 101_234,
      contributedCents: 100_000,
      yieldCents: 1234,
      profit: { cents: 1234, depositedCents: 100_000 }
    });
    const entries = db.ledger.entries.list({ accountId: goal.accountId }).rows;
    expect(entries.find((entry) => entry.amountCents === 1234)).toMatchObject({
      kind: "income",
      description: "Lucro lançado"
    });
  });

  it("a descrição do usuário acompanha", async () => {
    const id = await goalWithDeposit();
    await post(`/api/ledger/goals/${id}/profit`, {
      amountCents: 500,
      date: "2026-09-30",
      description: "rendimento do app"
    });
    const accountId = db.ledger.goals.get(id)!.accountId!;
    const entry = db.ledger.entries.list({ accountId }).rows.find((e) => e.amountCents === 500)!;
    expect(entry.description).toBe("Lucro · rendimento do app");
  });

  it("recusa valor zero, dia futuro e caixinha inexistente", async () => {
    const id = await goalWithDeposit();
    expect((await post(`/api/ledger/goals/${id}/profit`, { amountCents: 0, date: "2026-09-30" })).statusCode).toBe(400);
    expect((await post(`/api/ledger/goals/${id}/profit`, { amountCents: 100, date: "2999-01-01" })).statusCode).toBe(400);
    expect((await post("/api/ledger/goals/9999/profit", { amountCents: 100, date: "2026-09-30" })).statusCode).toBe(404);
  });

  it("resgatar tudo leva o lucro junto e o saldo zera", async () => {
    const id = await goalWithDeposit();
    await post(`/api/ledger/goals/${id}/profit`, { amountCents: 38, date: "2026-09-30" });
    const goal = (await post(`/api/ledger/goals/${id}/withdraw`, { amountCents: 100_038, date: "2026-10-01" })).json().goal;
    expect(goal.balanceCents).toBe(0);
    expect(goal.profit).toMatchObject({ cents: 38 });
  });
});

describe("o que conta como lucro", () => {
  it("entrada escrita à mão com 'lucro' na descrição continua sendo aporte", async () => {
    const id = await goalWithDeposit();
    const accountId = db.ledger.goals.get(id)!.accountId!;
    db.ledger.entries.create({
      accountId,
      date: "2026-09-10",
      amountCents: 20_000,
      kind: "income",
      description: "lucro da venda do carro"
    });
    const goal = (await post(`/api/ledger/goals/${id}/profit`, { amountCents: 500, date: "2026-09-30" })).json().goal;
    expect(goal.yieldCents).toBe(500);
    expect(goal.profit.cents).toBe(500);
  });

  it("renomear o lucro lançado não o transforma em aporte", async () => {
    const id = await goalWithDeposit();
    const { entryId } = db.ledger.goals.addProfit(id, { amountCents: 700, date: "2026-09-30" });
    const entry = db.ledger.entries.get(entryId)!;
    db.ledger.entries.update(entryId, {
      accountId: entry.accountId,
      date: entry.date,
      amountCents: entry.amountCents,
      kind: "income",
      description: "Juros do mês"
    });
    expect(db.ledger.goals.progress(id, "2026-09-30").yieldCents).toBe(700);
  });
});

describe("ajustar lucro", () => {
  it("lança a diferença para chegar no lucro informado", async () => {
    const id = await goalWithDeposit();
    await post(`/api/ledger/goals/${id}/profit`, { amountCents: 135, date: "2026-09-30" });
    const result = (await post(`/api/ledger/goals/${id}/profit/adjust`, { totalCents: 16 })).json();
    expect(result.deltaCents).toBe(-119);
    expect(result.goal).toMatchObject({ yieldCents: 16, balanceCents: 100_016, contributedCents: 100_000 });
  });

  it("repetir o mesmo total não faz nada", async () => {
    const id = await goalWithDeposit();
    await post(`/api/ledger/goals/${id}/profit/adjust`, { totalCents: 50 });
    const again = (await post(`/api/ledger/goals/${id}/profit/adjust`, { totalCents: 50 })).json();
    expect(again).toMatchObject({ deltaCents: 0, entryId: null });
    expect(again.goal.yieldCents).toBe(50);
  });

  it("o ajuste não é aporte nem saque: não mexe no que você pôs", async () => {
    const id = await goalWithDeposit();
    const goal = (await post(`/api/ledger/goals/${id}/profit/adjust`, { totalCents: -300 })).json().goal;
    expect(goal.contributedCents).toBe(100_000);
    expect(goal.yieldCents).toBe(-300);
    expect(goal.balanceCents).toBe(99_700);
  });
});

describe("percentual de lucro", () => {
  it("mostra o % até agora e o % ao ano projetado", async () => {
    const id = await goalWithDeposit({}, 100_000, "2026-07-01");
    const { profit } = (await post(`/api/ledger/goals/${id}/profit/adjust`, { totalCents: 1_000 })).json().goal;
    expect(profit.cents).toBe(1_000);
    expect(profit.averageCapitalCents).toBe(100_000);
    expect(profit.percent).toBeCloseTo(1, 6);
    expect(profit.annualPercent).toBeGreaterThan(profit.percent);
    expect(profit.days).toBeGreaterThan(60);
  });

  it("sem aporte não há percentual", async () => {
    const { goal } = (await create()).json();
    expect(goal.profit).toMatchObject({ cents: 0, percent: null, annualPercent: null });
  });
});
