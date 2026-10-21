import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";

let ledger: LedgerRepositories;
let steylor: number;
let checking: number;
let card: number;
let otherCard: number;
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
    personId: steylor
  });
  card = ledger.accounts.create({
    name: "Cartao A",
    kind: "credit_card",
    color: "#f00",
    personId: steylor,
    closingDay: 20,
    dueDay: 27,
    paymentAccountId: checking
  });
  // Ciclo propositalmente diferente, para a troca de cartão ter o que recalcular.
  otherCard = ledger.accounts.create({
    name: "Cartao B",
    kind: "credit_card",
    color: "#00f",
    personId: steylor,
    closingDay: 5,
    dueDay: 15,
    paymentAccountId: checking
  });
  mercado = ledger.categories.list().find((c) => c.name === "Mercado")!.id;
});

const plan = (overrides: object = {}) =>
  ledger.installmentPlans.create({
    accountId: card,
    purchaseDate: "2026-05-10",
    totalCents: 10000,
    installmentCount: 3,
    categoryId: mercado,
    description: "Fone",
    ...overrides
  });

describe("criacao do plano", () => {
  it("gera 3334 / 3333 / 3333 com o resto na primeira (6.3)", () => {
    const rows = ledger.installmentPlans.installments(plan());
    expect(rows.map((row) => -row.amountCents)).toEqual([3334, 3333, 3333]);
  });

  it("a soma das parcelas fecha no total para 1 a 24 parcelas", () => {
    for (let count = 1; count <= 24; count += 1) {
      const id = plan({ totalCents: 123457, installmentCount: count });
      const record = ledger.installmentPlans.get(id)!;
      expect(record.sumCents).toBe(123457);
      expect(record.sumMatchesTotal).toBe(true);
    }
  });

  it("numera as parcelas de 1 a N e persiste o vinculo", () => {
    const id = plan();
    const rows = ledger.installmentPlans.installments(id);
    expect(rows.map((row) => row.installmentNumber)).toEqual([1, 2, 3]);
    expect(rows.every((row) => row.installmentPlanId === id)).toBe(true);
    expect(rows.every((row) => row.installmentCount === 3)).toBe(true);
  });

  it("compra em 31 de janeiro ancora fevereiro no dia 28 e marco no 31", () => {
    const rows = ledger.installmentPlans.installments(
      plan({ purchaseDate: "2026-01-31", installmentCount: 3 })
    );
    expect(rows.map((row) => row.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("cada parcela cai na fatura certa, atravessando o ano", () => {
    const rows = ledger.installmentPlans.installments(
      plan({ purchaseDate: "2026-11-25", installmentCount: 4 })
    );
    // Fecha 20, vence 27: compra em 25/11 já é da fatura de dezembro.
    expect(rows.map((row) => row.statementMonth)).toEqual([
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03"
    ]);
  });
});

describe("edicao", () => {
  it("rejeita mudar total ou numero de parcelas (6.3)", () => {
    const id = plan();
    expect(() => ledger.installmentPlans.update(id, { totalCents: 20000 } as never)).toThrow(
      /nao podem ser alterados/i
    );
    expect(() =>
      ledger.installmentPlans.update(id, { installmentCount: 6 } as never)
    ).toThrow(/nao podem ser alterados/i);
  });

  it("propaga descricao e categoria para a serie inteira", () => {
    const id = plan();
    const lazer = ledger.categories.list().find((c) => c.name === "Lazer")!.id;
    ledger.installmentPlans.update(id, { description: "Fone bluetooth", categoryId: lazer });
    const rows = ledger.installmentPlans.installments(id);
    expect(rows.every((row) => row.description === "Fone bluetooth")).toBe(true);
    expect(rows.every((row) => row.categoryId === lazer)).toBe(true);
  });

  it("editar uma parcela avisa da diferenca e nao altera as outras", () => {
    const id = plan();
    const result = ledger.installmentPlans.setInstallmentAmount(id, 2, 5000);
    expect(result.sumMatchesTotal).toBe(false);
    expect(result.differenceCents).toBe(1667);

    const rows = ledger.installmentPlans.installments(id);
    expect(rows.map((row) => -row.amountCents)).toEqual([3334, 5000, 3333]);
  });

  it("o vinculo sobrevive a editar a descricao de uma parcela", () => {
    const id = plan();
    const [first] = ledger.installmentPlans.installments(id);
    ledger.entries.update(first!.id, {
      accountId: card,
      date: first!.date,
      amountCents: first!.amountCents,
      kind: "expense",
      categoryId: mercado,
      description: "Outra coisa"
    });
    expect(ledger.installmentPlans.installments(id)).toHaveLength(3);
  });
});

describe("troca de cartao", () => {
  it("move plano e parcelas futuras, recalculando o statement_month do novo ciclo", () => {
    const id = plan();
    ledger.installmentPlans.changeAccount(id, otherCard);

    const rows = ledger.installmentPlans.installments(id);
    expect(rows.every((row) => row.accountId === otherCard)).toBe(true);
    // Cartão B fecha 05 e vence 15: 10/05 fecha 05/06 e vence 15/06.
    expect(rows.map((row) => row.statementMonth)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(ledger.installmentPlans.get(id)?.accountId).toBe(otherCard);
  });

  it("deixa a parcela ja paga no cartao antigo, onde foi cobrada", () => {
    const id = plan();
    const [first] = ledger.installmentPlans.installments(id);
    ledger.entries.setStatus([first!.id], "cleared");

    ledger.installmentPlans.changeAccount(id, otherCard);
    const rows = ledger.installmentPlans.installments(id);
    expect(rows.find((row) => row.installmentNumber === 1)?.accountId).toBe(card);
    expect(rows.find((row) => row.installmentNumber === 2)?.accountId).toBe(otherCard);
  });

  it("e atomica: falha no meio nao move nem o plano nem as parcelas", () => {
    const id = plan();
    // Uma conta que não é cartão faz `cards.cycle` rejeitar antes de escrever.
    expect(() => ledger.installmentPlans.changeAccount(id, checking)).toThrow();
    expect(ledger.installmentPlans.get(id)?.accountId).toBe(card);
    expect(
      ledger.installmentPlans.installments(id).every((row) => row.accountId === card)
    ).toBe(true);
  });
});

describe("exclusao", () => {
  it("apaga as pendentes e preserva as conciliadas, soltando o vinculo", () => {
    const id = plan();
    const [first] = ledger.installmentPlans.installments(id);
    ledger.entries.setStatus([first!.id], "reconciled");

    const result = ledger.installmentPlans.remove(id);
    expect(result.removed).toBe(2);
    expect(result.kept).toBe(1);

    const survivor = ledger.entries.get(first!.id)!;
    expect(survivor.installmentPlanId).toBeNull();
    expect(ledger.installmentPlans.get(id)).toBeUndefined();
  });
});

describe("listagem", () => {
  it("resume pagas, restantes e a ultima fatura da serie", () => {
    const id = plan();
    const [first] = ledger.installmentPlans.installments(id);
    ledger.entries.setStatus([first!.id], "cleared");

    const record = ledger.installmentPlans.get(id)!;
    expect(record.paidCount).toBe(1);
    expect(record.remainingCount).toBe(2);
    expect(record.remainingCents).toBe(6666);
    expect(record.lastStatementMonth).toBe("2026-07");
  });

  it("activeOnly esconde plano totalmente quitado", () => {
    const id = plan();
    ledger.entries.setStatus(
      ledger.installmentPlans.installments(id).map((row) => row.id),
      "cleared"
    );
    expect(ledger.installmentPlans.list({ activeOnly: true })).toHaveLength(0);
    expect(ledger.installmentPlans.list()).toHaveLength(1);
  });
});

describe("parcela de fatura ja paga", () => {
  // 10/05 no Cartao A (fecha 20, vence 27): parcelas em mai, jun e jul.
  const payMay = () =>
    ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 3334 });

  it("excluir o plano preserva a parcela da fatura paga, mesmo pendente", () => {
    const id = plan();
    payMay();

    const result = ledger.installmentPlans.remove(id);
    expect(result).toEqual({ removed: 2, kept: 1 });
    // A fatura paga continua fechando em zero, e nao vira credito.
    expect(ledger.statements.get(card, "2026-05", "2026-06-01").totalCents).toBe(0);
  });

  it("trocar de cartao deixa a parcela da fatura paga onde foi cobrada", () => {
    const id = plan();
    payMay();

    ledger.installmentPlans.changeAccount(id, otherCard);
    const rows = ledger.installmentPlans.installments(id);
    expect(rows.find((row) => row.installmentNumber === 1)?.accountId).toBe(card);
    expect(rows.find((row) => row.installmentNumber === 2)?.accountId).toBe(otherCard);
  });

  it("conta a parcela da fatura paga como paga no resumo do plano", () => {
    const id = plan();
    payMay();
    expect(ledger.installmentPlans.get(id)).toMatchObject({
      paidCount: 1,
      remainingCount: 2,
      remainingCents: 6666
    });
  });
});

describe("fechamento no fim do mes", () => {
  let lateCard: number;
  beforeEach(() => {
    lateCard = ledger.accounts.create({
      name: "Cartao C",
      kind: "credit_card",
      color: "#0f0",
      personId: steylor,
      closingDay: 29,
      dueDay: 7,
      paymentAccountId: checking
    });
  });

  // 31/01 fecha em 28/02: parcelas em mar, abr e mai. A 2a (28/02) cairia em
  // marco pela propria data.
  const latePlan = () =>
    ledger.installmentPlans.create({
      accountId: lateCard,
      purchaseDate: "2026-01-31",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado,
      description: "Sofa"
    });

  it("parcela na fatura da serie nao aparece como antecipada", () => {
    const id = latePlan();
    const second = ledger.installmentPlans.installments(id)[1]!;
    expect(second.statementMonth).toBe("2026-04");
    expect(ledger.statements.isAnticipated(second.id)).toBe(false);
    expect(ledger.statements.get(lateCard, "2026-04", "2026-02-01").anticipatedIds).toEqual([]);
  });

  it("restaurar devolve a parcela antecipada para a fatura da serie", () => {
    const id = latePlan();
    const third = ledger.installmentPlans.installments(id)[2]!;
    ledger.statements.anticipate(lateCard, { entryIds: [third.id], targetMonth: "2026-04" });
    expect(ledger.statements.isAnticipated(third.id)).toBe(true);

    ledger.statements.restoreNatural([third.id]);
    expect(ledger.entries.get(third.id)?.statementMonth).toBe("2026-05");
  });

  it("trocar de cartao mantem uma parcela por fatura", () => {
    const id = latePlan();
    const sameCycle = ledger.accounts.create({
      name: "Cartao D",
      kind: "credit_card",
      color: "#ff0",
      personId: steylor,
      closingDay: 29,
      dueDay: 7,
      paymentAccountId: checking
    });
    ledger.installmentPlans.changeAccount(id, sameCycle);
    expect(ledger.installmentPlans.installments(id).map((row) => row.statementMonth)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05"
    ]);
  });
});
