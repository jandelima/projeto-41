import { beforeEach, describe, expect, it } from "vitest";
import { categoryTotals, topSlices } from "@projeto41/finance";
import { createTestDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";

const MAY = { from: "2026-05-01", to: "2026-05-31" };
const TODAY = "2026-05-15";

let ledger: LedgerRepositories;
let steylor: number;
let checking: number;
let card: number;
let mercado: number;
let lazer: number;

beforeEach(() => {
  // `createDatabase` é o caminho real: roda o `migrate()` legado e, em seguida,
  // o runner versionado. Montar só o runner produz um banco que não existe em
  // produção — sem `operations`, por exemplo.
  ledger = createTestDatabase().ledger;

  steylor = ledger.people.list()[0]!.id;
  checking = ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    openingBalanceCents: 500000
  });
  card = ledger.accounts.create({
    name: "Cartao",
    kind: "credit_card",
    color: "#f00",
    personId: steylor,
    closingDay: 20,
    dueDay: 27,
    creditLimitCents: 500000,
    paymentAccountId: checking
  });
  mercado = ledger.categories.list().find((c) => c.name === "Mercado")!.id;
  lazer = ledger.categories.list().find((c) => c.name === "Lazer")!.id;
});

const expense = (amountCents: number, categoryId = mercado, accountId = checking) =>
  ledger.entries.create({
    accountId,
    date: "2026-05-10",
    amountCents: -Math.abs(amountCents),
    kind: "expense",
    categoryId
  });

describe("estorno", () => {
  it("abate a categoria e nao aparece como receita (6.6)", () => {
    const id = expense(50000);
    ledger.refunds.create(id, { amountCents: 20000, date: "2026-05-12" });

    const totals = ledger.reports.totalsByCategory(MAY);
    expect(totals.find((row) => row.name === "Mercado")?.totalCents).toBe(30000);

    const income = ledger.reports.totalsByCategory(MAY, { kind: "income" });
    expect(income).toHaveLength(0);
    expect(ledger.entries.list({ kind: "income" }).total).toBe(0);
  });

  it("mantem kind='expense' com valor positivo", () => {
    const id = expense(50000);
    const refundId = ledger.refunds.create(id, { date: "2026-05-12" });
    const refund = ledger.entries.get(refundId)!;
    expect(refund.kind).toBe("expense");
    expect(refund.amountCents).toBe(50000);
    expect(refund.refundOfEntryId).toBe(id);
  });

  it("devolve limite do cartao na hora", () => {
    const id = expense(20000, mercado, card);
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(480000);
    ledger.refunds.create(id, { date: "2026-05-12" });
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(500000);
  });

  it("recusa estorno de estorno e estorno de transferencia", () => {
    const id = expense(50000);
    const refundId = ledger.refunds.create(id, { date: "2026-05-12" });
    expect(() => ledger.refunds.create(refundId, { date: "2026-05-13" })).toThrow(/estorno/i);

    const transfer = ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: card,
      date: "2026-05-10",
      amountCents: 1000,
      // Transferencia avulsa para o cartao e recusada: so pagamento de fatura.
      purpose: "invoice_payment"
    });
    expect(() => ledger.refunds.create(transfer.fromEntryId, { date: "2026-05-13" })).toThrow(
      /transferencia/i
    );
  });

  it("recusa estornar mais do que o valor original", () => {
    const id = expense(50000);
    ledger.refunds.create(id, { amountCents: 30000, date: "2026-05-12" });
    expect(() => ledger.refunds.create(id, { amountCents: 30000, date: "2026-05-13" })).toThrow(
      /passa do valor/i
    );
  });

  it("bloqueia excluir o original enquanto o estorno existir", () => {
    const id = expense(50000);
    const refundId = ledger.refunds.create(id, { date: "2026-05-12" });
    expect(() => ledger.entries.remove(id)).toThrow(/Remova antes o estorno/i);

    ledger.entries.remove(refundId);
    expect(() => ledger.entries.remove(id)).not.toThrow();
  });
});

describe("estorno de compra parcelada", () => {
  it("chega integral e as parcelas futuras continuam existindo (6.6)", () => {
    const planId = ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const before = ledger.cards.summary(card, TODAY).totalOwedCents;
    expect(before).toBe(30000);

    ledger.refunds.createForPlan(planId, { date: "2026-05-12" });

    // As parcelas seguem correndo: a fatura real do banco faz exatamente isso.
    expect(ledger.installmentPlans.installments(planId)).toHaveLength(3);
    expect(ledger.cards.summary(card, TODAY).totalOwedCents).toBe(0);
  });
});

describe("categoria negativa no mes", () => {
  it("a agregacao devolve o numero negativo sem quebrar", () => {
    // O estorno de uma compra parcelada chega inteiro antes das parcelas.
    const id = expense(10000, lazer);
    ledger.refunds.create(id, { amountCents: 10000, date: "2026-05-12" });
    const second = expense(5000, lazer);
    ledger.refunds.create(second, { amountCents: 5000, date: "2026-05-13" });
    // Mais um estorno de um gasto de abril, caindo em maio.
    const april = ledger.entries.create({
      accountId: checking,
      date: "2026-04-10",
      amountCents: -8000,
      kind: "expense",
      categoryId: lazer
    });
    ledger.refunds.create(april, { amountCents: 8000, date: "2026-05-14" });

    const rows = ledger.reports.totalsByCategory(MAY);
    const totals = categoryTotals(rows, { range: MAY });
    const negative = totals.find((row) => row.name === "Lazer");
    expect(negative?.spentCents).toBe(-8000);
    expect(negative?.overBudget).toBe(false);
  });

  it("a rosca omite a categoria negativa e a tabela a mantem", () => {
    const id = expense(10000, lazer);
    ledger.refunds.create(id, { amountCents: 10000, date: "2026-05-12" });
    const april = ledger.entries.create({
      accountId: checking,
      date: "2026-04-10",
      amountCents: -8000,
      kind: "expense",
      categoryId: lazer
    });
    ledger.refunds.create(april, { amountCents: 8000, date: "2026-05-14" });
    expense(20000, mercado);

    const totals = categoryTotals(ledger.reports.totalsByCategory(MAY), { range: MAY });
    // Fatia negativa em pizza não significa nada; na tabela, significa.
    expect(topSlices(totals).map((slice) => slice.name)).toEqual(["Mercado"]);
    expect(totals.map((row) => row.name)).toContain("Lazer");
  });
});

describe("teto do estorno numa compra parcelada", () => {
  const purchase = (personId: number | null = null) =>
    ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado,
      personId,
      description: "TV"
    });

  it("depois do estorno integral, nenhuma parcela aceita estorno avulso", () => {
    const planId = purchase();
    ledger.refunds.createForPlan(planId, { date: "2026-05-12" });
    const second = ledger.installmentPlans.installments(planId)[1]!;

    expect(() => ledger.refunds.create(second.id, { date: "2026-05-13" })).toThrow(
      /compra parcelada/
    );
  });

  it("estornos avulsos de parcelas somam no teto da compra", () => {
    const planId = purchase();
    const [first, second] = ledger.installmentPlans.installments(planId);
    ledger.refunds.create(first!.id, { date: "2026-05-12" });
    ledger.refunds.create(second!.id, { date: "2026-05-12" });
    expect(ledger.refunds.refundedCents(first!.id) + ledger.refunds.refundedCents(second!.id)).toBe(
      20000
    );
  });

  it("o estorno integral vai para a pessoa da compra, nao para a dona do cartao", () => {
    const other = ledger.people.create({ name: "Outra", kind: "individual", color: "#0af" });
    const planId = purchase(other);
    const refundId = ledger.refunds.createForPlan(planId, { date: "2026-05-12" });
    expect(ledger.entries.get(refundId)?.personId).toBe(other);
  });
});
