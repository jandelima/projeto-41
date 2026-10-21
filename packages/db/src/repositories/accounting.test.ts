import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type AppDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";

/**
 * Regras que mantêm o saldo do app igual ao do banco. Cada caso aqui já fez o
 * saldo divergir de verdade: dinheiro que sumia, entrava duas vezes ou mudava
 * de sinal numa edição.
 */

const DAY = "2026-09-01";

let db: AppDatabase;
let ledger: LedgerRepositories;
let steylor: number;
let checking: number;
let savings: number;
let card: number;
let mercado: number;
let salario: number;

const balance = (id: number) => ledger.balances.forAccount(id)?.currentBalanceCents ?? 0;

function income(accountId: number, cents: number, date = DAY) {
  return ledger.entries.create({
    accountId,
    date,
    amountCents: cents,
    kind: "income",
    categoryId: salario
  });
}

function expense(accountId: number, cents: number, date = DAY) {
  return ledger.entries.create({
    accountId,
    date,
    amountCents: -cents,
    kind: "expense",
    categoryId: mercado
  });
}

beforeEach(() => {
  db = createTestDatabase();
  ledger = db.ledger;
  steylor = ledger.people.list()[0]!.id;
  checking = ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    openingBalanceCents: 100_000
  });
  savings = ledger.accounts.create({
    name: "BTG",
    kind: "checking",
    color: "#00f",
    personId: steylor,
    openingBalanceCents: 0
  });
  card = ledger.accounts.create({
    name: "Cartao",
    kind: "credit_card",
    color: "#f00",
    personId: steylor,
    closingDay: 30,
    dueDay: 8,
    creditLimitCents: 1_000_000,
    paymentAccountId: checking
  });
  mercado = ledger.categories.list().find((c) => c.name === "Mercado")!.id;
  salario = ledger.categories.list().find((c) => c.kind === "income")!.id;
});

describe("estorno", () => {
  it("estornar uma entrada tira o dinheiro da conta", () => {
    const id = income(checking, 5_000);
    expect(balance(checking)).toBe(105_000);
    ledger.refunds.create(id, { date: DAY });
    expect(balance(checking)).toBe(100_000);
  });

  it("estornar uma saida devolve o dinheiro", () => {
    const id = expense(checking, 5_000);
    ledger.refunds.create(id, { date: DAY, amountCents: 2_000 });
    expect(balance(checking)).toBe(97_000);
  });

  it("estorno avulso pela rota de lancamentos passa pela mesma regua", () => {
    const id = expense(checking, 100);
    expect(() =>
      ledger.entries.create({
        accountId: checking,
        date: DAY,
        amountCents: 999_999,
        kind: "expense",
        refundOfEntryId: id
      })
    ).toThrow(/Estornos passariam/);
  });

  it("compra parcelada so pode ser estornada uma vez", () => {
    const plan = ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: DAY,
      totalCents: 30_000,
      installmentCount: 3,
      categoryId: mercado
    });
    ledger.refunds.createForPlan(plan, { date: DAY });
    expect(() => ledger.refunds.createForPlan(plan, { date: DAY })).toThrow(/ja tem estorno/);
  });
});

describe("transferencia", () => {
  it("nao nasce como lancamento avulso, sem a outra ponta", () => {
    expect(() =>
      ledger.entries.create({
        accountId: checking,
        date: DAY,
        amountCents: -2_000,
        kind: "transfer"
      })
    ).toThrow(/origem e destino/);
  });

  it("saida editada para transferencia e recusada: o destino nunca recebia", () => {
    const id = expense(checking, 2_000);
    expect(() =>
      ledger.entries.update(id, {
        accountId: checking,
        date: DAY,
        amountCents: -2_000,
        kind: "transfer"
      })
    ).toThrow(/conta de destino/);
  });

  it("mudar o status em lote leva a outra ponta junto", () => {
    const { fromEntryId, toEntryId } = ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: DAY,
      amountCents: 3_000
    });
    ledger.entries.setStatus([fromEntryId], "pending");
    expect(ledger.entries.get(toEntryId)?.status).toBe("pending");
    expect(balance(checking) + balance(savings)).toBe(100_000);
  });
});

describe("caixinha de marcacao", () => {
  const earmark = () =>
    ledger.goals.create({
      name: "Viagem",
      mode: "earmark",
      accountId: checking,
      color: "#00a86b",
      personId: steylor
    } as Parameters<typeof ledger.goals.create>[0]);

  it("excluir a entrada que ancora a marcacao move a marcacao, nao zera a caixinha", () => {
    income(checking, 10_000, "2026-08-01");
    const anchor = income(checking, 20_000);
    const goal = earmark();
    ledger.goals.mark(goal, 15_000);
    ledger.entries.remove(anchor);
    expect(ledger.goals.progress(goal, DAY).balanceCents).toBe(15_000);
  });

  it("sem outra entrada na conta, recusa excluir em vez de perder o separado", () => {
    const anchor = income(checking, 20_000);
    const goal = earmark();
    ledger.goals.mark(goal, 15_000);
    expect(() => ledger.entries.remove(anchor)).toThrow(/caixinhas/);
    expect(ledger.goals.progress(goal, DAY).balanceCents).toBe(15_000);
  });

  it("caixinha arquivada nao continua tirando do saldo livre", () => {
    income(checking, 20_000);
    const goal = earmark();
    ledger.goals.mark(goal, 15_000);
    expect(ledger.goals.earmarkedByAccount().get(checking)).toBe(15_000);
    db.raw.prepare("UPDATE goals SET archived = 1 WHERE id = ?").run(goal);
    expect(ledger.goals.earmarkedByAccount().get(checking)).toBeUndefined();
  });
});

describe("parcelas", () => {
  it("uma parcela por fatura mesmo com fechamento no fim do mes", () => {
    const plan = ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-01-31",
      totalCents: 40_000,
      installmentCount: 4,
      categoryId: mercado
    });
    const months = ledger.installmentPlans.installments(plan).map((entry) => entry.statementMonth);
    expect(new Set(months).size).toBe(4);
  });
});

describe("categoria", () => {
  it("entrada nao aceita categoria de saida", () => {
    expect(() =>
      ledger.entries.create({
        accountId: checking,
        date: DAY,
        amountCents: 1_000,
        kind: "income",
        categoryId: mercado
      })
    ).toThrow(/categoria de entrada/);
  });
});
