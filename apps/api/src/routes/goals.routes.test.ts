import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createCdiService } from "../cdi/cdi-service.js";

const priceService = { runAll: async () => [] };

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let dir: string;
let steylor: number;
let checking: number;

/** Rede sempre desligada: as rotas precisam funcionar com a semente. */
const offlineFetcher = vi.fn(async () => {
  throw new Error("offline");
});

async function post(url: string, payload: Record<string, unknown> = {}) {
  return await app.inject({ method: "POST", url, payload });
}

beforeEach(async () => {
  db = createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), "projeto41-goals-"));
  const cdiService = createCdiService(db, dir, offlineFetcher as unknown as typeof fetch, [0, 0, 0]);
  app = buildApp({ db, priceService, cdiService });
  await app.ready();

  steylor = db.ledger.people.list()[0]!.id;
  checking = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
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

describe("cadastro", () => {
  it("cria caixinha de conta e devolve o progresso", async () => {
    const response = await create({ targetAmountCents: 5_000_000 });
    expect(response.statusCode).toBe(201);
    expect(response.json().goal.mode).toBe("account");
    expect(response.json().goal.accountId).not.toBeNull();
    expect(response.json().goal.parentAccountId).toBe(checking);
    expect(response.json().goal.parentAccountName).toBe("Nubank");
  });

  it("sem modo, nasce com conta própria; sem conta atrelada, recusa", async () => {
    const created = await post("/api/ledger/goals", {
      name: "Casa",
      color: "#00a86b",
      parentAccountId: checking
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().goal.mode).toBe("account");
    // A conta da caixinha é de quem é dono da conta atrelada.
    const account = db.ledger.accounts.get(created.json().goal.accountId);
    expect(account?.personId).toBe(steylor);

    const missing = await post("/api/ledger/goals", { name: "Casa", color: "#00a86b" });
    expect(missing.statusCode).toBe(400);
  });

  it("não atrela a cartão nem a outra caixinha", async () => {
    const card = db.ledger.accounts.create({
      name: "Cartão",
      kind: "credit_card",
      color: "#000000",
      closingDay: 1,
      dueDay: 10
    });
    expect((await create({ parentAccountId: card })).statusCode).toBe(400);
    const other = (await create({ name: "Outra" })).json().goal.accountId;
    expect((await create({ parentAccountId: other })).statusCode).toBe(400);
  });

  it("PUT troca a conta atrelada e renomeia a conta da caixinha", async () => {
    const id = (await create()).json().id;
    const savings = db.ledger.accounts.create({ name: "BTG", kind: "checking", color: "#123456" });
    const response = await app.inject({
      method: "PUT",
      url: `/api/ledger/goals/${id}`,
      payload: { name: "Viagem 2027", color: "#00a86b", parentAccountId: savings }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().goal.parentAccountName).toBe("BTG");
    expect(db.ledger.accounts.get(response.json().goal.accountId)?.name).toBe("Viagem 2027");

    // Sem o campo, a conta atrelada fica a mesma.
    const kept = await app.inject({
      method: "PUT",
      url: `/api/ledger/goals/${id}`,
      payload: { name: "Viagem 2027", color: "#00a86b" }
    });
    expect(kept.json().goal.parentAccountId).toBe(savings);
  });

  it("aceita rendimento em modo marcacao", async () => {
    const response = await create({
      mode: "earmark",
      accountId: checking,
      cdiPercent: 110
    });
    expect(response.statusCode).toBe(201);
  });

  it("PUT nao troca o modo e responde 200 com o modo original", async () => {
    const id = (await create()).json().id;
    const response = await app.inject({
      method: "PUT",
      url: `/api/ledger/goals/${id}`,
      payload: { name: "Viagem 2027", color: "#00a86b", mode: "earmark" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().goal.mode).toBe("account");
    expect(response.json().goal.name).toBe("Viagem 2027");
  });

  it("404 em id inexistente", async () => {
    expect((await app.inject("/api/ledger/goals/999")).statusCode).toBe(404);
  });
});

describe("deposito e saque", () => {
  it("deposito move as duas contas", async () => {
    const id = (await create()).json().id;
    const response = await post(`/api/ledger/goals/${id}/deposit`, {
      amountCents: 200_000,
      date: "2026-09-16",
      fromAccountId: checking
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().goal.balanceCents).toBe(200_000);
    expect(
      db.ledger.balances.forAccount(checking, { asOf: "2026-09-18" })?.currentBalanceCents
    ).toBe(800_000);
  });

  it("sem conta escolhida, guardar tira da conta atrelada e resgatar devolve para ela", async () => {
    const id = (await create()).json().id;
    const balance = () =>
      db.ledger.balances.forAccount(checking, { asOf: "2026-09-30" })?.currentBalanceCents;

    const saved = await post(`/api/ledger/goals/${id}/deposit`, { amountCents: 300_000, date: "2026-09-16" });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().goal.balanceCents).toBe(300_000);
    expect(balance()).toBe(700_000);

    const back = await post(`/api/ledger/goals/${id}/withdraw`, { amountCents: 100_000, date: "2026-09-20" });
    expect(back.statusCode).toBe(201);
    expect(back.json().goal.balanceCents).toBe(200_000);
    expect(balance()).toBe(800_000);

    // No livro da conta, cada movimento diz para qual caixinha foi.
    const ledger = await app
      .inject(`/api/ledger/entries?accountId=${checking}&from=2026-09-01&to=2026-09-30`)
      .then((r) => r.json());
    const moves = ledger.rows.map((row: { amountCents: number; goalName: string; description: string }) => [
      row.amountCents,
      row.goalName,
      row.description
    ]);
    expect(moves).toContainEqual([-300_000, "Viagem", "Guardado · Viagem"]);
    expect(moves).toContainEqual([100_000, "Viagem", "Resgate · Viagem"]);

    // O saldo guardado aparece ao lado da conta, fora do saldo dela.
    const summary = await app.inject("/api/ledger/summary").then((r) => r.json());
    const account = summary.accounts.find((row: { id: number }) => row.id === checking);
    expect(account.goalsCents).toBe(200_000);
  });
});

describe("marcacao", () => {
  it("allocate acima do saldo devolve 400 com o disponivel na mensagem", async () => {
    const id = (await create({ mode: "earmark", accountId: checking })).json().id;
    const entryId = db.ledger.entries.create({
      accountId: checking,
      date: "2026-09-01",
      amountCents: -10_000,
      kind: "expense"
    });

    const response = await post(`/api/ledger/goals/${id}/allocate`, {
      entryId,
      amountCents: 5_000_000
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/passam do saldo/i);
  });

  it("allocate em caixinha de conta devolve 400 explicando o modo", async () => {
    const id = (await create()).json().id;
    const entryId = db.ledger.entries.create({
      accountId: checking,
      date: "2026-09-01",
      amountCents: -10_000,
      kind: "expense"
    });
    const response = await post(`/api/ledger/goals/${id}/allocate`, {
      entryId,
      amountCents: 1000
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/marcacao/i);
  });
});

describe("extrato", () => {
  it("devolve so os lancamentos daquela caixinha", async () => {
    const a = (await create({ name: "A" })).json().id;
    const b = (await create({ name: "B" })).json().id;
    await post(`/api/ledger/goals/${a}/deposit`, {
      amountCents: 100_000,
      date: "2026-09-16",
      fromAccountId: checking
    });
    await post(`/api/ledger/goals/${b}/deposit`, {
      amountCents: 200_000,
      date: "2026-09-16",
      fromAccountId: checking
    });

    const entries = await app.inject(`/api/ledger/goals/${a}/entries`).then((r) => r.json());
    expect(entries.total).toBe(1);
    expect(entries.rows[0].amountCents).toBe(100_000);
    expect(entries.rows[0].goalName).toBe("A");
  });
});

describe("rendimento offline", () => {
  it("responde 200 com a serie semeada e online: false", async () => {
    const id = (await create({ cdiPercent: 110 })).json().id;
    await post(`/api/ledger/goals/${id}/deposit`, {
      amountCents: 1_000_000,
      date: "2026-09-16",
      fromAccountId: checking
    });

    const response = await app.inject(`/api/ledger/goals/${id}`);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    // Quatro números distintos e rotulados, nunca um só.
    expect(body.goal).toHaveProperty("realizedYieldCents");
    expect(body.goal).toHaveProperty("realizedThroughDate");
    expect(body.goal).toHaveProperty("projectedYieldCents");
    expect(body.goal).toHaveProperty("projectedThroughDate");
    expect(body.goal.realizedYieldCents).toBeGreaterThan(0);
    expect(body.cdi.online).toBe(false);
    expect(body.cdi.rowCount).toBeGreaterThan(1000);
  });

  it("apura o rendimento e lanca na conta da caixinha", async () => {
    const id = (await create({ cdiPercent: 110 })).json().id;
    await post(`/api/ledger/goals/${id}/deposit`, {
      amountCents: 1_000_000,
      date: "2026-09-16",
      fromAccountId: checking
    });

    const response = await post(`/api/ledger/goals/${id}/accrue`, { through: "2026-09-18" });
    expect(response.statusCode).toBe(200);
    expect(response.json().cents).toBeGreaterThan(0);
  });
});

describe("status do CDI", () => {
  it("expoe ate onde a serie esta atualizada", async () => {
    const status = await app.inject("/api/cdi/status").then((r) => r.json());
    expect(status.lastDate).toBe("2026-09-18");
    expect(status.seededThrough).toBe("2026-09-18");
  });

  it("refresh sem rede nao derruba a rota e explica o motivo", async () => {
    const response = await post("/api/cdi/refresh");
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(response.json().reason).toMatch(/sem rede|cache recente/i);
  });
});
