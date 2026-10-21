import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const priceService = { runAll: async () => [] };

let db: AppDatabase;
let app: ReturnType<typeof buildApp>;
let steylor: number;
let bianca: number;
let checking: number;
let savings: number;
let mercado: number;
let lazer: number;

const PERIOD = "2026-03";

function seedExpense(amountCents: number, categoryId: number | null, extra: object = {}) {
  return db.ledger.entries.create({
    accountId: checking,
    date: "2026-03-10",
    amountCents: -Math.abs(amountCents),
    kind: "expense",
    categoryId,
    ...extra
  });
}

beforeEach(async () => {
  db = createTestDatabase();
  app = buildApp({ db, priceService });
  await app.ready();

  const people = db.ledger.people.list();
  steylor = people[0]!.id;
  bianca = people[1]!.id;

  checking = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    openingBalanceCents: 200000
  });
  savings = db.ledger.accounts.create({
    name: "Caixinha",
    kind: "cash",
    color: "#00a86b",
    personId: steylor
  });

  const categories = db.ledger.categories.list();
  mercado = categories.find((c) => c.name === "Mercado")!.id;
  lazer = categories.find((c) => c.name === "Lazer")!.id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("GET /api/ledger/summary", () => {
  it("bate com os lancamentos semeados e separa atual de previsto", async () => {
    seedExpense(50000, mercado);
    seedExpense(30000, lazer, { status: "pending", date: "2026-03-28" });

    const summary = await app
      .inject(`/api/ledger/summary?period=${PERIOD}`)
      .then((r) => r.json());

    expect(summary.month.expenseCents).toBe(-80000);
    // A migração 005 semeia as duas contas de corretora, então contamos só as
    // que este teste criou.
    expect(
      summary.accounts.filter((a: { kind: string }) => a.kind !== "investment")
    ).toHaveLength(2);
    // Os dois numeros sao distintos por construcao (6.1).
    expect(summary.consolidated).toHaveProperty("currentCents");
    expect(summary.consolidated).toHaveProperty("cardStatementCents");
    expect(summary.consolidated).not.toHaveProperty("projectedCents");
  });

  it("traz a fatura corrente de cada cartao junto da conta que paga", async () => {
    const card = db.ledger.accounts.create({
      name: "Cartao",
      kind: "credit_card",
      color: "#8a2be2",
      personId: steylor,
      closingDay: 31,
      dueDay: 8,
      paymentAccountId: checking
    });
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    db.ledger.entries.create({ accountId: card, date: todayIso, amountCents: -4235, kind: "expense" });

    const summary = await app.inject("/api/ledger/summary").then((r) => r.json());
    const cardRow = summary.accounts.find((a: { id: number }) => a.id === card);
    expect(cardRow).toMatchObject({ paymentAccountId: checking, statement: { amountCents: 4235 } });
    expect(cardRow.statement.dueDate).toMatch(/-08$/);
    expect(cardRow.statement.dueDate > cardRow.statement.closingDate).toBe(true);
    expect(summary.accounts.find((a: { id: number }) => a.id === checking).statement).toBeNull();
    expect(cardRow.flows).toEqual({ incomeCents: 0, expenseCents: -4235, netCents: -4235 });
  });

  it("separa entradas, saidas e liquido por conta no periodo", async () => {
    seedExpense(50000, mercado);
    db.ledger.entries.create({
      accountId: savings,
      date: "2026-03-05",
      amountCents: 12000,
      kind: "income"
    });
    const summary = await app.inject(`/api/ledger/summary?period=${PERIOD}`).then((r) => r.json());
    const flowsOf = (id: number) => summary.accounts.find((a: { id: number }) => a.id === id).flows;
    expect(flowsOf(checking)).toEqual({ incomeCents: 0, expenseCents: -50000, netCents: -50000 });
    expect(flowsOf(savings)).toEqual({ incomeCents: 12000, expenseCents: 0, netCents: 12000 });
  });

  it("recusa periodo malformado", async () => {
    expect((await app.inject("/api/ledger/summary?period=2026-13")).statusCode).toBe(400);
  });

  it("resume o mesmo recorte da rosca quando o periodo e um ano ou intervalo", async () => {
    seedExpense(50000, mercado);
    seedExpense(20000, lazer, { date: "2026-07-02" });

    const year = await app.inject("/api/ledger/summary?year=2026").then((r) => r.json());
    expect(year.month.expenseCents).toBe(-70000);

    const range = await app
      .inject("/api/ledger/summary?from=2026-07-01&to=2026-07-31")
      .then((r) => r.json());
    expect(range.month.expenseCents).toBe(-20000);
  });

  it("sem recorte, usa o mes de hoje", async () => {
    const response = await app.inject("/api/ledger/summary");
    expect(response.statusCode).toBe(200);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    expect(response.json().period).toBe(month);
  });
});

describe("GET /api/ledger/reports/categories", () => {
  it("soma exatamente 1000 milesimos nas fatias da rosca", async () => {
    seedExpense(33333, mercado);
    seedExpense(33333, lazer);
    const outros = db.ledger.categories.list().find((c) => c.name === "Outros" && c.kind === "expense")!.id;
    seedExpense(33334, outros);

    const report = await app
      .inject(`/api/ledger/reports/categories?period=${PERIOD}`)
      .then((r) => r.json());

    const total = report.slices.reduce(
      (sum: number, slice: { sharePerMille: number }) => sum + slice.sharePerMille,
      0
    );
    expect(total).toBe(1000);
  });

  it("marca overBudget na categoria estourada e deixa a sem orcamento sem par", async () => {
    db.ledger.categories.setBudget(mercado, 40000);
    seedExpense(50000, mercado);
    seedExpense(10000, lazer);

    const report = await app
      .inject(`/api/ledger/reports/categories?period=${PERIOD}`)
      .then((r) => r.json());

    const mercadoRow = report.rows.find((row: { name: string }) => row.name === "Mercado");
    const lazerRow = report.rows.find((row: { name: string }) => row.name === "Lazer");
    expect(mercadoRow.budgetCents).toBe(40000);
    expect(mercadoRow.overBudget).toBe(true);
    expect(lazerRow.budgetCents).toBeNull();
    expect(lazerRow.overBudget).toBe(false);
  });

  it("compara com o mes anterior e monta a frase pronta", async () => {
    db.ledger.entries.create({
      accountId: checking,
      date: "2026-02-10",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
    seedExpense(13200, mercado);

    const report = await app
      .inject(`/api/ledger/reports/categories?period=${PERIOD}`)
      .then((r) => r.json());

    const row = report.comparison.rows.find((item: { name: string }) => item.name === "Mercado");
    expect(row.label).toBe("gastou 32% a mais em Mercado");
    expect(row.tone).toBe("negative");
  });

  it("aceita o ano inteiro pela mesma rota", async () => {
    seedExpense(50000, mercado);
    const report = await app
      .inject("/api/ledger/reports/categories?year=2026")
      .then((r) => r.json());
    expect(report.range).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("recusa mais de um seletor de periodo e intervalo invertido", async () => {
    expect(
      (await app.inject("/api/ledger/reports/categories?year=2026&period=2026-03")).statusCode
    ).toBe(400);
    expect(
      (await app.inject("/api/ledger/reports/categories?from=2026-03-31&to=2026-03-01")).statusCode
    ).toBe(400);
  });
});

describe("GET /api/ledger/targets", () => {
  it("reproduz as tres barras do exemplo do plano mestre no modo pooled", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/ledger/targets/${PERIOD}`,
      payload: {
        splitMode: "pooled",
        pooledIncomeCents: 750000,
        jointExpenseTargetCents: 400000
      }
    });

    const targets = await app
      .inject(`/api/ledger/targets?period=${PERIOD}`)
      .then((r) => r.json());

    const byName = Object.fromEntries(
      targets.bars.map((bar: { name: string; targetCents: number }) => [bar.name, bar.targetCents])
    );
    expect(byName).toEqual({ Conjunto: 400000, Steylor: 175000, Bianca: 175000 });
  });

  it("nao conta investimento e conta deposito em caixinha no realizado", async () => {
    seedExpense(50000, mercado);
    db.ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-03-12",
      amountCents: 30000,
      purpose: "goal_deposit"
    });
    db.ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-03-13",
      amountCents: 90000,
      purpose: "investment"
    });

    const targets = await app
      .inject(`/api/ledger/targets?period=${PERIOD}`)
      .then((r) => r.json());
    expect(targets.bars[0].realizedCents).toBe(80000);
  });

  it("devolve o agregado recalculado na mutacao, numa ida so", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/api/ledger/targets/${PERIOD}`,
      payload: { splitMode: "none", totalExpenseTargetCents: 400000 }
    });
    expect(response.json().targets.totalTargetCents).toBe(400000);
  });

  it("mostra a renda apurada ao lado do override, para o usuario ver o que sobrescreve", async () => {
    db.ledger.entries.create({
      accountId: checking,
      date: "2026-03-05",
      amountCents: 500000,
      kind: "income"
    });
    await app.inject({
      method: "PUT",
      url: `/api/ledger/targets/${PERIOD}/people/${steylor}`,
      payload: { incomeOverrideCents: 250000 }
    });

    const targets = await app
      .inject(`/api/ledger/targets?period=${PERIOD}`)
      .then((r) => r.json());
    const person = targets.people.find((item: { id: number }) => item.id === steylor);
    expect(person.incomeCents).toBe(500000);
    expect(person.incomeOverrideCents).toBe(250000);
  });

  it("reparte 33,3% e 66,7% no modo proporcional", async () => {
    db.ledger.entries.create({
      accountId: checking,
      date: "2026-03-05",
      amountCents: 250000,
      kind: "income"
    });
    db.ledger.entries.create({
      accountId: checking,
      date: "2026-03-05",
      amountCents: 500000,
      kind: "income",
      personId: bianca
    });
    await app.inject({
      method: "PUT",
      url: `/api/ledger/targets/${PERIOD}`,
      payload: { splitMode: "income_proportional", totalExpenseTargetCents: 400000 }
    });

    const targets = await app
      .inject(`/api/ledger/targets?period=${PERIOD}`)
      .then((r) => r.json());
    const byName = Object.fromEntries(
      targets.bars.map((bar: { name: string; targetCents: number }) => [bar.name, bar.targetCents])
    );
    expect(byName.Steylor).toBe(133333);
    expect(byName.Bianca).toBe(266667);
    expect(byName.Steylor + byName.Bianca).toBe(400000);
  });
});

describe("PATCH /api/ledger/entries/:id/target", () => {
  it("muda o realizado da pessoa na consulta seguinte", async () => {
    const id = seedExpense(50000, mercado);
    const before = await app
      .inject(`/api/ledger/targets?period=${PERIOD}`)
      .then((r) => r.json());
    expect(before.bars[0].realizedCents).toBe(50000);

    await app.inject({
      method: "PATCH",
      url: `/api/ledger/entries/${id}/target`,
      payload: { countsTowardTarget: false }
    });

    const after = await app.inject(`/api/ledger/targets?period=${PERIOD}`).then((r) => r.json());
    expect(after.bars[0].realizedCents).toBe(0);
  });

  it("a excecao manual sobrevive a uma edicao de descricao", async () => {
    const id = seedExpense(50000, mercado);
    await app.inject({
      method: "PATCH",
      url: `/api/ledger/entries/${id}/target`,
      payload: { countsTowardTarget: false }
    });

    await app.inject({
      method: "PUT",
      url: `/api/ledger/entries/${id}`,
      payload: {
        accountId: checking,
        date: "2026-03-10",
        amountCents: -50000,
        kind: "expense",
        categoryId: mercado,
        description: "Descricao nova"
      }
    });

    expect(db.ledger.entries.get(id)?.countsTowardTarget).toBe(false);
  });

  it("devolve 404 em id inexistente", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/ledger/entries/999/target",
      payload: { countsTowardTarget: false }
    });
    expect(response.statusCode).toBe(404);
  });
});
