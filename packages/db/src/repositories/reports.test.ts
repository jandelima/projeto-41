import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";

const MARCH = { from: "2026-03-01", to: "2026-03-31" };

let ledger: LedgerRepositories;
let steylor: number;
let bianca: number;
let checking: number;
let savings: number;
let mercado: number;
let lazer: number;
let salario: number;

beforeEach(() => {
  // `createDatabase` é o caminho real: roda o `migrate()` legado e, em seguida,
  // o runner versionado. Montar só o runner produz um banco que não existe em
  // produção — sem `operations`, por exemplo.
  ledger = createTestDatabase().ledger;

  const people = ledger.people.list();
  steylor = people[0]!.id;
  bianca = people[1]!.id;

  checking = ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor
  });
  savings = ledger.accounts.create({
    name: "Caixinha",
    kind: "cash",
    color: "#00a86b",
    personId: steylor
  });

  const categories = ledger.categories.list();
  mercado = categories.find((c) => c.name === "Mercado")!.id;
  lazer = categories.find((c) => c.name === "Lazer")!.id;
  salario = categories.find((c) => c.name === "Salário" && c.kind === "income")!.id;
});

function expense(amountCents: number, categoryId: number | null, extra: object = {}) {
  return ledger.entries.create({
    accountId: checking,
    date: "2026-03-10",
    amountCents: -Math.abs(amountCents),
    kind: "expense",
    categoryId,
    ...extra
  });
}

describe("totalsByCategory", () => {
  it("soma por categoria com o sinal invertido para leitura", () => {
    expense(50000, mercado);
    expense(30000, mercado);
    expense(20000, lazer);

    const rows = ledger.reports.totalsByCategory(MARCH);
    expect(rows.find((row) => row.name === "Mercado")?.totalCents).toBe(80000);
    expect(rows.find((row) => row.name === "Lazer")?.totalCents).toBe(20000);
  });

  it("mantem lancamento sem categoria como linha 'Sem categoria'", () => {
    expense(1500, null);
    const rows = ledger.reports.totalsByCategory(MARCH);
    const uncategorized = rows.find((row) => row.categoryId === null);
    expect(uncategorized?.name).toBe("Sem categoria");
    expect(uncategorized?.totalCents).toBe(1500);
  });

  it("nao conta transferencia em nenhum total (D21)", () => {
    expense(50000, mercado);
    ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-03-12",
      amountCents: 100000,
      purpose: "investment"
    });
    ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-03-13",
      amountCents: 70000,
      purpose: "invoice_payment"
    });

    const total = ledger.reports
      .totalsByCategory(MARCH)
      .reduce((sum, row) => sum + row.totalCents, 0);
    expect(total).toBe(50000);
  });

  it("estorno reduz o total da categoria (6.6)", () => {
    const original = expense(50000, mercado);
    ledger.entries.create({
      accountId: checking,
      date: "2026-03-20",
      amountCents: 20000,
      kind: "expense",
      categoryId: mercado,
      refundOfEntryId: original
    });
    expect(
      ledger.reports.totalsByCategory(MARCH).find((row) => row.name === "Mercado")?.totalCents
    ).toBe(30000);
  });

  it("ignora lancamento fora do periodo", () => {
    expense(50000, mercado);
    ledger.entries.create({
      accountId: checking,
      date: "2026-04-02",
      amountCents: -99999,
      kind: "expense",
      categoryId: mercado
    });
    expect(
      ledger.reports.totalsByCategory(MARCH).find((row) => row.name === "Mercado")?.totalCents
    ).toBe(50000);
  });

  it("devolve o orcamento mensal da categoria junto", () => {
    ledger.categories.setBudget(mercado, 80000);
    expense(50000, mercado);
    expect(
      ledger.reports.totalsByCategory(MARCH).find((row) => row.name === "Mercado")
        ?.monthlyBudgetCents
    ).toBe(80000);
  });
});

describe("trendByCategory", () => {
  it("preenche com zero os meses sem lancamento", () => {
    expense(50000, mercado);
    const [series] = ledger.reports.trendByCategory({
      categoryIds: [mercado],
      months: 3,
      endMonth: "2026-03"
    });
    expect(series?.points.map((point) => point.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(series?.points.map((point) => point.totalCents)).toEqual([0, 0, 50000]);
  });

  it("devolve serie zerada para categoria ainda sem lancamento", () => {
    const [series] = ledger.reports.trendByCategory({
      categoryIds: [lazer],
      months: 2,
      endMonth: "2026-03"
    });
    expect(series?.name).toBe("Lazer");
    expect(series?.points.every((point) => point.totalCents === 0)).toBe(true);
  });
});

describe("alvo", () => {
  it("apura renda por pessoa somando tambem o que esta pendente", () => {
    ledger.entries.create({
      accountId: checking,
      date: "2026-03-05",
      amountCents: 500000,
      kind: "income",
      categoryId: salario,
      status: "pending"
    });
    expect(ledger.reports.incomeByPerson(MARCH)[steylor]).toBe(500000);
  });

  it("realizado conta goal_deposit uma vez e ignora investment (6.4)", () => {
    expense(50000, mercado);
    ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-03-12",
      amountCents: 30000,
      purpose: "goal_deposit"
    });
    ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-03-13",
      amountCents: 90000,
      purpose: "investment"
    });
    // 500 de despesa + 300 do deposito na caixinha, contado uma unica vez.
    expect(ledger.reports.realizedByPerson(MARCH)[steylor]).toBe(80000);
  });

  it("agrupa o realizado pela pessoa do lancamento (D01)", () => {
    expense(50000, mercado);
    expense(20000, mercado, { personId: bianca });
    const realized = ledger.reports.realizedByPerson(MARCH);
    expect(realized[steylor]).toBe(50000);
    expect(realized[bianca]).toBe(20000);
  });

  it("soma os orcamentos de categoria de saida nao arquivadas", () => {
    ledger.categories.setBudget(mercado, 80000);
    ledger.categories.setBudget(lazer, 20000);
    expect(ledger.reports.categoryBudgetSum()).toBe(100000);
    ledger.categories.archive(lazer);
    expect(ledger.reports.categoryBudgetSum()).toBe(80000);
  });
});

describe("budgetPeriods", () => {
  it("le padroes sem inserir linha no banco", () => {
    const result = ledger.budgetPeriods.get("2026-03");
    expect(result.period.splitMode).toBe("none");
    expect(result.period.totalExpenseTargetCents).toBeNull();
    expect(ledger.budgetPeriods.get("2026-03").people).toEqual([]);
  });

  it("cria a linha sob demanda no upsert", () => {
    ledger.budgetPeriods.upsert("2026-03", {
      splitMode: "pooled",
      pooledIncomeCents: 750000,
      jointExpenseTargetCents: 400000
    });
    const result = ledger.budgetPeriods.get("2026-03");
    expect(result.period.splitMode).toBe("pooled");
    expect(result.period.pooledIncomeCents).toBe(750000);
  });

  it("preserva o campo ausente e apaga o campo explicitamente nulo", () => {
    ledger.budgetPeriods.upsert("2026-03", {
      splitMode: "income_proportional",
      totalExpenseTargetCents: 400000
    });

    // Ausente: preserva.
    ledger.budgetPeriods.upsert("2026-03", { splitMode: "income_proportional" });
    expect(ledger.budgetPeriods.get("2026-03").period.totalExpenseTargetCents).toBe(400000);

    // Nulo explicito: apaga.
    ledger.budgetPeriods.upsert("2026-03", {
      splitMode: "income_proportional",
      totalExpenseTargetCents: null
    });
    expect(ledger.budgetPeriods.get("2026-03").period.totalExpenseTargetCents).toBeNull();
  });

  it("aplica a mesma regra aos overrides da pessoa", () => {
    ledger.budgetPeriods.upsertPerson("2026-03", steylor, {
      incomeOverrideCents: 250000,
      targetOverrideCents: 100000
    });
    ledger.budgetPeriods.upsertPerson("2026-03", steylor, { targetOverrideCents: null });

    const [row] = ledger.budgetPeriods.get("2026-03").people;
    expect(row?.incomeOverrideCents).toBe(250000);
    expect(row?.targetOverrideCents).toBeNull();
  });
});
