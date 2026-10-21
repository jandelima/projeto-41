import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { beforeEach, describe, expect, it } from "vitest";
import { LEDGER_CLASSES, buildNetWorth, markCashControlStart } from "./net-worth-service.js";

let db: AppDatabase;
let steylor: number;

const account = (overrides: Record<string, unknown>) =>
  db.ledger.accounts.create({
    name: "Conta",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    ...overrides
  } as Parameters<typeof db.ledger.accounts.create>[0]);

beforeEach(() => {
  db = createTestDatabase();
  steylor = db.ledger.people.list()[0]!.id;
});

describe("classes do livro", () => {
  it("soma conta corrente ao patrimonio total", () => {
    account({ name: "Nubank", openingBalanceCents: 250_000 });
    const netWorth = buildNetWorth(db);
    expect(netWorth.classes["ledger:bank"]).toBe(2500);
    expect(netWorth.totalBrl).toBe(2500);
    expect(netWorth.bankOnlyBrl).toBe(2500);
  });

  it("separa dinheiro vivo, vale-refeicao e caixinhas", () => {
    account({ name: "Carteira", kind: "cash", openingBalanceCents: 10_000 });
    account({ name: "VR", kind: "meal_voucher", openingBalanceCents: 50_000 });
    account({ name: "Reserva", kind: "goal", openingBalanceCents: 30_000 });

    const { classes } = buildNetWorth(db);
    expect(classes["ledger:cash"]).toBe(100);
    expect(classes["ledger:voucher"]).toBe(500);
    expect(classes["ledger:goals"]).toBe(300);
  });

  it("conta-ponte de investimento NAO altera o total, nem com include_in_net_worth ligado", () => {
    // O dinheiro aportado já aparece como valor das posições (010).
    account({
      name: "Investimentos",
      kind: "investment",
      openingBalanceCents: 900_000,
      includeInNetWorth: true
    });
    expect(buildNetWorth(db).totalBrl).toBe(0);
  });

  it("cartao entra negativo e reduz o total, pelo total devido", () => {
    account({ name: "Nubank", openingBalanceCents: 100_000 });
    const card = account({
      name: "Cartao",
      kind: "credit_card",
      closingDay: 20,
      dueDay: 27,
      creditLimitCents: 500_000
    });
    // Duas parcelas futuras: o total devido é maior que a fatura corrente.
    db.ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 60_000,
      installmentCount: 2
    });

    const netWorth = buildNetWorth(db);
    expect(netWorth.classes["ledger:credit_card"]).toBe(-600);
    expect(netWorth.liabilitiesBrl).toBe(600);
    expect(netWorth.totalBrl).toBe(1000 - 600);
  });

  it("ignora conta arquivada e conta fora do patrimonio", () => {
    account({ name: "Fora", openingBalanceCents: 100_000, includeInNetWorth: false });
    const archived = account({ name: "Velha", openingBalanceCents: 100_000 });
    db.ledger.accounts.archive(archived);
    expect(buildNetWorth(db).classes["ledger:bank"]).toBe(0);
  });

  it("nao conta lancamento pendente", () => {
    const id = account({ name: "Nubank", openingBalanceCents: 100_000 });
    db.ledger.entries.create({
      accountId: id,
      date: "2020-01-05",
      amountCents: -50_000,
      kind: "expense",
      status: "pending"
    });
    expect(buildNetWorth(db).classes["ledger:bank"]).toBe(1000);
  });
});

describe("namespace das classes", () => {
  it("nenhuma chave ledger: colide com o vocabulario existente", () => {
    // As sete chaves do dashboard e os apelidos das metas de alocação.
    const dashboardKeys = ["crypto", "b3", "dollar", "cash", "reserve", "fixed_income", "global"];
    const allocationAliases = [
      "bitcoin",
      "shitcoins",
      "dolar",
      "caixa_br",
      "bolsa_brasil",
      "renda_fixa",
      "acoes_globais"
    ];
    const existing = new Set([...dashboardKeys, ...allocationAliases]);
    for (const key of LEDGER_CLASSES) {
      expect(existing.has(key)).toBe(false);
      // A colisão é impossível por construção: nenhuma chave antiga tem ":".
      expect(key).toContain(":");
    }
    expect([...existing].some((key) => key.includes(":"))).toBe(false);
  });
});

describe("recortes", () => {
  it("separa so-banco de banco-mais-investimentos", () => {
    account({ name: "Nubank", openingBalanceCents: 100_000 });
    db.positions.upsert({
      category: "fixed_income",
      name: "CDB",
      invested: 5000,
      currentValue: 5000,
      currency: "BRL"
    });
    const netWorth = buildNetWorth(db);
    expect(netWorth.bankOnlyBrl).toBe(1000);
    expect(netWorth.investmentsBrl).toBe(5000);
    expect(netWorth.totalBrl).toBe(6000);
  });

  it("investableBrl mede so o modulo de investimentos, sem a reserva", () => {
    account({ name: "Nubank", openingBalanceCents: 100_000 });
    db.positions.upsert({
      category: "reserve",
      name: "Reserva",
      invested: 2000,
      currentValue: 2000,
      currency: "BRL"
    });
    db.positions.upsert({
      category: "fixed_income",
      name: "CDB",
      invested: 3000,
      currentValue: 3000,
      currency: "BRL"
    });
    // Caixa de conta corrente não pode entrar nos pesos da carteira.
    expect(buildNetWorth(db).investableBrl).toBe(3000);
  });
});

describe("dupla contagem (R-07)", () => {
  it("avisa quando existe posicao manual de caixa e conta do livro com saldo", () => {
    account({ name: "Nubank", openingBalanceCents: 100_000 });
    db.positions.upsert({
      category: "cash",
      name: "Conta antiga",
      invested: 900,
      currentValue: 900,
      currency: "BRL"
    });
    const { doubleCounting } = buildNetWorth(db);
    expect(doubleCounting.active).toBe(true);
    expect(doubleCounting.manualPositions).toHaveLength(1);
    expect(doubleCounting.manualPositions[0]?.name).toBe("Conta antiga");
  });

  it("nao avisa quando so um dos dois existe", () => {
    db.positions.upsert({
      category: "cash",
      name: "Conta antiga",
      invested: 900,
      currentValue: 900,
      currency: "BRL"
    });
    expect(buildNetWorth(db).doubleCounting.active).toBe(false);

    const other = createTestDatabase();
    other.ledger.accounts.create({
      name: "Nubank",
      kind: "checking",
      color: "#fff",
      openingBalanceCents: 100_000
    });
    expect(buildNetWorth(other).doubleCounting.active).toBe(false);
  });
});

describe("marca do inicio do controle de caixa", () => {
  it("grava uma unica vez e nao muda no dia seguinte", () => {
    account({ name: "Nubank", openingBalanceCents: 100_000 });
    markCashControlStart(db, "2026-05-10", buildNetWorth(db));
    expect(db.settings.get("networth.cash_started_on")).toBe("2026-05-10");

    markCashControlStart(db, "2026-05-11", buildNetWorth(db));
    expect(db.settings.get("networth.cash_started_on")).toBe("2026-05-10");
  });

  it("nao grava enquanto nao houver nenhuma classe do livro", () => {
    markCashControlStart(db, "2026-05-10", buildNetWorth(db));
    expect(db.settings.get("networth.cash_started_on")).toBeUndefined();
  });
});
