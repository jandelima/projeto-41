import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";

/** Hoje fixo: os testes de fatura não podem depender do relógio. */
const TODAY = "2026-05-15";

let ledger: LedgerRepositories;
let steylor: number;
let checking: number;
let card: number;
let mercado: number;

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
  // Fecha dia 20, vence dia 27 do mesmo mês.
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
});

function cardExpense(date: string, amountCents: number, extra: object = {}) {
  return ledger.entries.create({
    accountId: card,
    date,
    amountCents: -Math.abs(amountCents),
    kind: "expense",
    categoryId: mercado,
    ...extra
  });
}

describe("statement_month na escrita", () => {
  it("calcula a fatura da compra no cartao", () => {
    const id = cardExpense("2026-05-10", 10000);
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-05");
  });

  it("compra na vespera e no dia do fechamento caem em faturas diferentes", () => {
    const onClosing = cardExpense("2026-05-20", 10000);
    const nextDay = cardExpense("2026-05-21", 10000);
    expect(ledger.entries.get(onClosing)?.statementMonth).toBe("2026-05");
    expect(ledger.entries.get(nextDay)?.statementMonth).toBe("2026-06");
  });

  it("respeita o statementMonth informado pelo chamador", () => {
    // É este respeito que faz a antecipação funcionar (6.2).
    const id = cardExpense("2026-05-10", 10000, { statementMonth: "2026-08" });
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-08");
  });

  it("recalcula ao mudar a data, quando o chamador nao informa o mes", () => {
    const id = cardExpense("2026-05-10", 10000);
    ledger.entries.update(id, {
      accountId: card,
      date: "2026-05-25",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-06");
  });

  it("zera o statement_month ao mover para conta comum, e preenche ao voltar", () => {
    const id = cardExpense("2026-05-10", 10000);
    ledger.entries.update(id, {
      accountId: checking,
      date: "2026-05-10",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
    expect(ledger.entries.get(id)?.statementMonth).toBeNull();

    ledger.entries.update(id, {
      accountId: card,
      date: "2026-05-10",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-05");
  });

  it("lancamento em cartao nasce com forma de pagamento 'credit'", () => {
    expect(ledger.entries.get(cardExpense("2026-05-10", 10000))?.paymentMethod).toBe("credit");
  });
});

describe("os dois numeros do cartao (6.1)", () => {
  it("fatura atual e total devido sao DIFERENTES quando existe parcela futura", () => {
    // O teste mais importante da fase: colapsar os dois num só esconde dinheiro
    // já comprometido.
    ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });

    const summary = ledger.cards.summary(card, TODAY);
    expect(summary.currentStatementMonth).toBe("2026-05");
    expect(summary.currentStatementCents).toBe(10000);
    expect(summary.totalOwedCents).toBe(30000);
    expect(summary.currentStatementCents).not.toBe(summary.totalOwedCents);
  });

  it("limite considera lancamento pendente e parcela futura", () => {
    cardExpense("2026-05-10", 20000, { status: "pending" });
    const summary = ledger.cards.summary(card, TODAY);
    expect(summary.usedCents).toBe(20000);
    expect(summary.availableCents).toBe(480000);
  });

  it("disponivel fica negativo quando o limite estoura, sem truncar", () => {
    cardExpense("2026-05-10", 600000);
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(-100000);
  });

  it("devolve disponivel nulo quando o cartao nao tem limite cadastrado", () => {
    const noLimit = ledger.accounts.create({
      name: "Sem limite",
      kind: "credit_card",
      color: "#0f0",
      personId: steylor,
      closingDay: 5,
      dueDay: 15
    });
    expect(ledger.cards.summary(noLimit, TODAY).availableCents).toBeNull();
  });

  it("o limite volta ao estornar", () => {
    const id = cardExpense("2026-05-10", 20000);
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(480000);
    ledger.refunds.create(id, { date: "2026-05-12" });
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(500000);
  });

  it("o cartao fica fora do saldo consolidado (6.1)", () => {
    cardExpense("2026-05-10", 20000);
    const balances = ledger.balances.consolidated({ asOf: TODAY });
    expect(balances.consolidatedCents).toBe(500000);
    expect(balances.creditCardDueCents).toBe(20000);
  });
});

describe("fatura derivada", () => {
  it("lista faturas futuras que contem parcela", () => {
    ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const months = ledger.statements.list(card, { asOf: TODAY }).map((s) => s.month);
    expect(months).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(ledger.statements.list(card, { asOf: TODAY }).find((s) => s.month === "2026-07")
      ?.isFuture).toBe(true);
  });

  it("não pula meses sem compra entre a primeira e a última fatura", () => {
    // Uma compra antiga e a fatura corrente: os meses do meio aparecem zerados,
    // para as setas da tela andarem mês a mês.
    cardExpense("2026-02-10", 5000);
    const statements = ledger.statements.list(card, { asOf: TODAY });
    expect(statements.map((s) => s.month)).toEqual(["2026-02", "2026-03", "2026-04", "2026-05"]);
    expect(statements.find((s) => s.month === "2026-03")?.totalCents).toBe(0);
  });

  it("a fatura corrente aparece mesmo vazia", () => {
    expect(ledger.statements.list(card, { asOf: TODAY }).map((s) => s.month)).toEqual(["2026-05"]);
  });

  it("percorre open, closed, overdue e paid", () => {
    cardExpense("2026-05-10", 10000);
    const statusAt = (asOf: string) =>
      ledger.statements.list(card, { asOf }).find((s) => s.month === "2026-05")?.status;

    expect(statusAt("2026-05-15")).toBe("open");
    expect(statusAt("2026-05-21")).toBe("closed");
    expect(statusAt("2026-05-28")).toBe("overdue");

    ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 10000 });
    expect(statusAt("2026-05-28")).toBe("paid");
  });
});

describe("pagamento de fatura", () => {
  beforeEach(() => {
    cardExpense("2026-05-10", 10000);
  });

  it("cria duas linhas sem categoria e zera a fatura", () => {
    const result = ledger.statements.pay(card, "2026-05", {
      date: "2026-05-27",
      amountCents: 10000
    });
    const from = ledger.entries.get(result.fromEntryId)!;
    const to = ledger.entries.get(result.toEntryId)!;
    expect(from.categoryId).toBeNull();
    expect(to.categoryId).toBeNull();
    expect(from.transferPurpose).toBe("invoice_payment");

    const statement = ledger.statements.get(card, "2026-05", "2026-05-28");
    expect(statement.totalCents).toBe(0);
    expect(statement.payments).toHaveLength(1);
    expect(statement.purchases).toHaveLength(1);
  });

  it("nao aparece em nenhum relatorio de despesa (D21)", () => {
    ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 10000 });
    const totals = ledger.reports.totalsByCategory({ from: "2026-05-01", to: "2026-05-31" });
    expect(totals.reduce((sum, row) => sum + row.totalCents, 0)).toBe(10000);
  });

  it("fica na fatura paga, nao na do mes em que a data cai", () => {
    // 27/05 é depois do fechamento de 20/05, então o cálculo natural jogaria o
    // pagamento na fatura de junho.
    const result = ledger.statements.pay(card, "2026-05", {
      date: "2026-05-27",
      amountCents: 10000
    });
    expect(ledger.entries.get(result.toEntryId)?.statementMonth).toBe("2026-05");
  });

  it("recusa pagamento parcial (D12)", () => {
    expect(() =>
      ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 5000 })
    ).toThrow(/parcial/i);
  });

  it("recusa pagar o cartao com outro cartao ou com ele mesmo", () => {
    expect(() =>
      ledger.statements.pay(card, "2026-05", {
        date: "2026-05-27",
        amountCents: 10000,
        fromAccountId: card
      })
    ).toThrow();
  });

  it("desfazer devolve o saldo devedor e o limite", () => {
    const result = ledger.statements.pay(card, "2026-05", {
      date: "2026-05-27",
      amountCents: 10000
    });
    const transferId = ledger.entries.get(result.fromEntryId)!.transferId!;
    ledger.statements.undoPayment(transferId);

    expect(ledger.statements.get(card, "2026-05", TODAY).totalCents).toBe(10000);
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(490000);
  });
});

describe("antecipacao de parcelas", () => {
  let planId: number;
  let installments: ReturnType<LedgerRepositories["installmentPlans"]["installments"]>;

  beforeEach(() => {
    planId = ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    installments = ledger.installmentPlans.installments(planId);
  });

  it("move so o statement_month, deixando a data intacta", () => {
    const last = installments.find((row) => row.installmentNumber === 3)!;
    expect(last.statementMonth).toBe("2026-07");

    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });
    const moved = ledger.entries.get(last.id)!;
    expect(moved.statementMonth).toBe("2026-05");
    expect(moved.date).toBe(last.date);
  });

  it("nao cria nem destroi dinheiro: sai da origem, entra no destino, total igual", () => {
    const before = ledger.cards.summary(card, TODAY).totalOwedCents;
    const last = installments.find((row) => row.installmentNumber === 3)!;

    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });

    const statements = ledger.statements.list(card, { asOf: TODAY });
    expect(statements.find((s) => s.month === "2026-05")?.totalCents).toBe(20000);
    expect(statements.find((s) => s.month === "2026-07")?.totalCents ?? 0).toBe(0);
    expect(ledger.cards.summary(card, TODAY).totalOwedCents).toBe(before);
  });

  it("antecipar e restaurar devolve exatamente o estado original", () => {
    const last = installments.find((row) => row.installmentNumber === 3)!;
    const original = ledger.entries.get(last.id)!;

    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });
    expect(ledger.statements.isAnticipated(last.id)).toBe(true);

    ledger.statements.restoreNatural([last.id]);
    const restored = ledger.entries.get(last.id)!;
    expect(restored.statementMonth).toBe(original.statementMonth);
    expect(restored.date).toBe(original.date);
    expect(ledger.statements.isAnticipated(last.id)).toBe(false);
  });

  it("abate o desconto na fatura de destino e no total devido", () => {
    const two = installments.find((row) => row.installmentNumber === 2)!;
    const three = installments.find((row) => row.installmentNumber === 3)!;
    const before = ledger.cards.summary(card, TODAY).totalOwedCents;

    ledger.statements.anticipate(card, {
      entryIds: [two.id, three.id],
      targetMonth: "2026-05",
      discount: { mode: "percent", scope: "total", value: 1000 },
      date: TODAY
    });

    // As duas parcelas de 100,00 somam 200,00; 10% de desconto e 20,00.
    const may = ledger.statements.list(card, { asOf: TODAY }).find((s) => s.month === "2026-05");
    expect(may?.totalCents).toBe(30000 - 2000);
    expect(ledger.cards.summary(card, TODAY).totalOwedCents).toBe(before - 2000);
  });

  it("o desconto abate a categoria, como um estorno, e nao vira receita", () => {
    const three = installments.find((row) => row.installmentNumber === 3)!;
    ledger.statements.anticipate(card, {
      entryIds: [three.id],
      targetMonth: "2026-05",
      discount: { mode: "amount", scope: "each", value: 1500 },
      date: TODAY
    });
    const rows = ledger.entries.list({ accountId: card, pageSize: 50 }).rows;
    const discount = rows.find((row) => row.refundOfEntryId === three.id)!;
    expect(discount.kind).toBe("expense");
    expect(discount.amountCents).toBe(1500);
    expect(discount.categoryId).toBe(mercado);
    expect(discount.statementMonth).toBe("2026-05");
  });

  it("restaurar a parcela apaga o desconto junto", () => {
    const three = installments.find((row) => row.installmentNumber === 3)!;
    const before = ledger.cards.summary(card, TODAY).totalOwedCents;
    ledger.statements.anticipate(card, {
      entryIds: [three.id],
      targetMonth: "2026-05",
      discount: { mode: "amount", scope: "total", value: 1000 },
      date: TODAY
    });
    ledger.statements.restoreNatural([three.id]);

    const rows = ledger.entries.list({ accountId: card, pageSize: 50 }).rows;
    expect(rows.some((row) => row.refundOfEntryId === three.id)).toBe(false);
    expect(ledger.cards.summary(card, TODAY).totalOwedCents).toBe(before);
  });

  it("nao deixa restaurar o desconto sozinho", () => {
    const three = installments.find((row) => row.installmentNumber === 3)!;
    ledger.statements.anticipate(card, {
      entryIds: [three.id],
      targetMonth: "2026-05",
      discount: { mode: "amount", scope: "each", value: 500 },
      date: TODAY
    });
    const discount = ledger.entries
      .list({ accountId: card, pageSize: 50 })
      .rows.find((row) => row.refundOfEntryId === three.id)!;
    expect(() => ledger.statements.restoreNatural([discount.id])).toThrow(/desconto/);
  });

  it("recusa desconto maior que a parcela sem mover nada", () => {
    const three = installments.find((row) => row.installmentNumber === 3)!;
    expect(() =>
      ledger.statements.anticipate(card, {
        entryIds: [three.id],
        targetMonth: "2026-05",
        discount: { mode: "amount", scope: "each", value: 20000 },
        date: TODAY
      })
    ).toThrow(/passa do valor/);
    // A transacao inteira volta: a parcela continua na fatura natural.
    expect(ledger.entries.get(three.id)?.statementMonth).toBe("2026-07");
  });

  it("recusa antecipar para uma fatura ja paga", () => {
    ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 10000 });
    const last = installments.find((row) => row.installmentNumber === 3)!;
    expect(() =>
      ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" })
    ).toThrow(/ja paga/i);
  });

  it("recusa antecipar lancamento de outro cartao", () => {
    const other = ledger.entries.create({
      accountId: checking,
      date: "2026-05-10",
      amountCents: -1000,
      kind: "expense"
    });
    expect(() =>
      ledger.statements.anticipate(card, { entryIds: [other], targetMonth: "2026-05" })
    ).toThrow(/nao pertence/i);
  });

  it("restaurar depois de mudar o ciclo leva ao novo natural, nao ao antigo", () => {
    // Escolha documentada: o mês natural é derivado da configuração ATUAL.
    const last = installments.find((row) => row.installmentNumber === 3)!;
    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });

    ledger.accounts.update(card, {
      name: "Cartao",
      kind: "credit_card",
      color: "#f00",
      personId: steylor,
      closingDay: 5,
      dueDay: 15,
      creditLimitCents: 500000,
      paymentAccountId: checking
    });
    ledger.statements.restoreNatural([last.id]);
    // Com fechamento 05 e vencimento 15, 10/07 fecha em 05/08 e vence em 15/08.
    expect(ledger.entries.get(last.id)?.statementMonth).toBe("2026-08");
  });
});

describe("uma unica definicao de fatura atual", () => {
  it("balances e cards concordam, usando o ciclo do cartao e nao o mes-calendario", () => {
    // Compra em 05/09 cai na fatura de setembro (fecha 20/09); em 25/09 cai na
    // de outubro. Em 22/09, a fatura ABERTA é a de outubro.
    cardExpense("2026-09-05", 10000);
    cardExpense("2026-09-25", 30000);
    const asOf = "2026-09-22";

    const fromCards = ledger.cards.summary(card, asOf);
    const fromBalances = ledger.balances.forAccount(card, { asOf });

    expect(fromCards.currentStatementMonth).toBe("2026-10");
    expect(fromCards.currentStatementCents).toBe(30000);
    expect(fromBalances?.currentStatementCents).toBe(fromCards.currentStatementCents);
    expect(fromBalances?.totalDueCents).toBe(fromCards.totalOwedCents);
  });
});

describe("editar sem perder o que o formulario nao conhece", () => {
  /** O corpo que o drawer de lancamento envia: sem fatura nem vinculo de estorno. */
  const edit = (id: number, patch: Record<string, unknown> = {}) => {
    const entry = ledger.entries.get(id)!;
    ledger.entries.update(id, {
      accountId: entry.accountId,
      date: entry.date,
      amountCents: entry.amountCents,
      kind: entry.kind,
      categoryId: entry.categoryId,
      description: "descricao nova",
      tagIds: [],
      ...patch
    });
    return ledger.entries.get(id)!;
  };

  it("parcela antecipada continua antecipada", () => {
    const planId = ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const last = ledger.installmentPlans.installments(planId).find((r) => r.installmentNumber === 3)!;
    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });

    expect(edit(last.id).statementMonth).toBe("2026-05");
  });

  it("compra na fatura natural acompanha a data nova", () => {
    const id = cardExpense("2026-05-10", 10000);
    expect(edit(id, { date: "2026-05-25" }).statementMonth).toBe("2026-06");
  });

  it("pagamento continua na fatura que pagou", () => {
    cardExpense("2026-05-10", 10000);
    const result = ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 10000 });
    expect(edit(result.toEntryId).statementMonth).toBe("2026-05");
  });

  it("estorno continua estorno, positivo e ligado ao original", () => {
    const original = cardExpense("2026-05-10", 10000);
    const refundId = ledger.refunds.create(original, { date: "2026-05-12", amountCents: 4000 });
    const edited = edit(refundId, { amountCents: 3000 });
    expect(edited.refundOfEntryId).toBe(original);
    expect(edited.amountCents).toBe(3000);
    expect(() => edit(refundId, { amountCents: 12000 })).toThrow(/passariam/);
  });

  it("desconto de antecipacao nao se edita", () => {
    const planId = ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const last = ledger.installmentPlans.installments(planId).find((r) => r.installmentNumber === 3)!;
    ledger.statements.anticipate(card, {
      entryIds: [last.id],
      targetMonth: "2026-05",
      discount: { mode: "amount", scope: "total", value: 500 },
      date: TODAY
    });
    const discount = ledger.entries
      .listAll({ accountId: card })
      .find((row) => row.refundOfEntryId === last.id)!;
    expect(() => edit(discount.id)).toThrow(/restaure a parcela/);
  });
});

describe("proposito da transferencia avulsa", () => {
  it("recusa transferencia generica para o cartao", () => {
    expect(() =>
      ledger.entries.createTransfer({
        fromAccountId: checking,
        toAccountId: card,
        date: "2026-05-10",
        amountCents: 1000
      })
    ).toThrow(/Pagar fatura/);
  });

  it("entrar numa caixinha e deposito; sair dela e saque", () => {
    const goal = ledger.accounts.create({
      name: "Viagem",
      kind: "goal",
      color: "#0f0",
      personId: steylor,
      openingBalanceCents: 0
    });
    const deposit = ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: goal,
      date: "2026-05-10",
      amountCents: 1000
    });
    const withdrawal = ledger.entries.createTransfer({
      fromAccountId: goal,
      toAccountId: checking,
      date: "2026-05-11",
      amountCents: 500
    });
    expect(ledger.entries.get(deposit.fromEntryId)?.transferPurpose).toBe("goal_deposit");
    expect(ledger.entries.get(deposit.fromEntryId)?.countsTowardTarget).toBe(true);
    expect(ledger.entries.get(withdrawal.fromEntryId)?.transferPurpose).toBe("goal_withdrawal");
  });
});
