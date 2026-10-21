import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";
import { today } from "./shared.js";

function setup() {
  return createTestDatabase().ledger;
}

const YESTERDAY = "2020-01-01";
const FUTURE = "2999-01-01";

let ledger: LedgerRepositories;
let steylor: number;
let checking: number;
let savings: number;
let mercado: number;
let salario: number;

beforeEach(() => {
  ledger = setup();
  steylor = ledger.people.list()[0]!.id;
  checking = ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    openingBalanceCents: 100_00,
    includeInNetWorth: true,
    archived: false,
    sortOrder: 0
  });
  savings = ledger.accounts.create({
    name: "Poupanca",
    kind: "cash",
    color: "#00a86b",
    personId: steylor,
    openingBalanceCents: 0,
    includeInNetWorth: true,
    archived: false,
    sortOrder: 1
  });
  mercado = ledger.categories.list({ kind: "expense" }).find((c) => c.name === "Mercado")!.id;
  salario = ledger.categories.list({ kind: "income" }).find((c) => c.name === "Salário")!.id;
});

function expense(overrides: Record<string, unknown> = {}) {
  return ledger.entries.create({
    accountId: checking,
    date: YESTERDAY,
    amountCents: -50_00,
    kind: "expense",
    status: "cleared",
    categoryId: mercado,
    tagIds: [],
    ...overrides
  });
}

describe("entries.create", () => {
  it("herda a pessoa da conta quando nao informada (D01)", () => {
    const id = expense();
    expect(ledger.entries.get(id)?.personId).toBe(steylor);
  });

  it("aceita sobrescrever a pessoa da conta", () => {
    const bianca = ledger.people.list()[1]!.id;
    const id = expense({ personId: bianca });
    expect(ledger.entries.get(id)?.personId).toBe(bianca);
  });

  it("normaliza o sinal pelo tipo", () => {
    const out = expense({ amountCents: 50_00 });
    expect(ledger.entries.get(out)?.amountCents).toBe(-5000);
    const inbound = ledger.entries.create({
      accountId: checking,
      date: YESTERDAY,
      amountCents: -3000,
      kind: "income",
      status: "cleared",
      categoryId: salario,
      tagIds: []
    });
    expect(ledger.entries.get(inbound)?.amountCents).toBe(3000);
  });

  it("preserva o sinal positivo de um estorno de despesa (6.6)", () => {
    const original = expense();
    const refund = ledger.entries.create({
      accountId: checking,
      date: YESTERDAY,
      amountCents: 2000,
      kind: "expense",
      status: "cleared",
      categoryId: mercado,
      refundOfEntryId: original,
      tagIds: []
    });
    expect(ledger.entries.get(refund)?.amountCents).toBe(2000);
  });

  it("vincula etiquetas", () => {
    const tag = ledger.tags.create({ name: "viagem", color: "#ffffff" });
    const id = expense({ tagIds: [tag] });
    expect(ledger.entries.get(id)?.tags.map((t) => t.name)).toEqual(["viagem"]);
  });
});

describe("saldos (plano mestre 6.1)", () => {
  it("ignora lancamento futuro no saldo atual", () => {
    expense({ date: FUTURE, status: "cleared" });
    expect(ledger.balances.forAccount(checking)?.currentBalanceCents).toBe(100_00);
  });

  it("ignora pendente no saldo e nao inventa saldo previsto", () => {
    expense({ status: "pending" });
    const account = ledger.balances.forAccount(checking)!;
    expect(account.currentBalanceCents).toBe(100_00);
    expect(account).not.toHaveProperty("projectedBalanceCents");
  });

  it("soma lancamento liquidado ao saldo atual", () => {
    expense();
    expect(ledger.balances.forAccount(checking)?.currentBalanceCents).toBe(50_00);
  });

  it("transferencia nao altera o consolidado", () => {
    const before = ledger.balances.consolidated().consolidatedCents;
    ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: YESTERDAY,
      amountCents: 30_00,
      purpose: "generic",
      status: "cleared"
    });
    const after = ledger.balances.consolidated();
    expect(after.consolidatedCents).toBe(before);
    expect(after.accounts.find((a) => a.id === checking)?.currentBalanceCents).toBe(70_00);
    expect(after.accounts.find((a) => a.id === savings)?.currentBalanceCents).toBe(30_00);
  });

  it("exclui do consolidado a conta fora do patrimonio", () => {
    ledger.accounts.create({
      name: "VR",
      kind: "meal_voucher",
      color: "#ff8800",
      personId: steylor,
      openingBalanceCents: 500_00,
      includeInNetWorth: false,
      archived: false,
      sortOrder: 2
    });
    expect(ledger.balances.consolidated().consolidatedCents).toBe(100_00);
  });
});

describe("transferencias (D20, D21)", () => {
  it("cria duas pontas ligadas, sem categoria", () => {
    const { fromEntryId, toEntryId } = ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: YESTERDAY,
      amountCents: 25_00,
      purpose: "generic",
      status: "cleared"
    });
    const from = ledger.entries.get(fromEntryId)!;
    const to = ledger.entries.get(toEntryId)!;
    expect(from.amountCents).toBe(-2500);
    expect(to.amountCents).toBe(2500);
    expect(from.categoryId).toBeNull();
    expect(to.categoryId).toBeNull();
    expect(from.counterpartAccountId).toBe(savings);
    expect(to.counterpartAccountId).toBe(checking);
  });

  it("rejeita origem igual a destino", () => {
    expect(() =>
      ledger.entries.createTransfer({
        fromAccountId: checking,
        toAccountId: checking,
        date: YESTERDAY,
        amountCents: 100,
        purpose: "generic",
        status: "cleared"
      })
    ).toThrow(/diferentes/);
  });

  it("remover uma ponta remove a outra", () => {
    const { fromEntryId, toEntryId } = ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: YESTERDAY,
      amountCents: 25_00,
      purpose: "generic",
      status: "cleared"
    });
    ledger.entries.remove(fromEntryId);
    expect(ledger.entries.get(fromEntryId)).toBeUndefined();
    expect(ledger.entries.get(toEntryId)).toBeUndefined();
  });

  it("deposito em caixinha conta no alvo, investimento nao (6.4)", () => {
    const goal = ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: YESTERDAY,
      amountCents: 1000,
      purpose: "goal_deposit",
      status: "cleared"
    });
    const invest = ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: YESTERDAY,
      amountCents: 1000,
      purpose: "investment",
      status: "cleared"
    });
    expect(ledger.entries.get(goal.fromEntryId)?.countsTowardTarget).toBe(true);
    expect(ledger.entries.get(invest.fromEntryId)?.countsTowardTarget).toBe(false);
  });
});

describe("entries.list", () => {
  beforeEach(() => {
    expense({ date: "2026-01-10", amountCents: -1000, description: "Assai" });
    expense({ date: "2026-02-10", amountCents: -2000, description: "Padaria" });
    ledger.entries.create({
      accountId: checking,
      date: "2026-02-15",
      amountCents: 5000,
      kind: "income",
      status: "cleared",
      categoryId: salario,
      tagIds: []
    });
  });

  it("filtra por periodo e soma o total do filtro, nao da pagina", () => {
    const result = ledger.entries.list({ from: "2026-02-01", to: "2026-02-28" });
    expect(result.total).toBe(2);
    expect(result.totals.expenseCents).toBe(-2000);
    expect(result.totals.incomeCents).toBe(5000);
    expect(result.totals.netCents).toBe(3000);
  });

  it("filtra por categoria", () => {
    expect(ledger.entries.list({ categoryId: [salario] }).total).toBe(1);
  });

  it("busca por texto na descricao", () => {
    const result = ledger.entries.list({ search: "assa" });
    expect(result.total).toBe(1);
    expect(result.rows[0]?.description).toBe("Assai");
  });

  it("ordena do mais recente para o mais antigo e pagina", () => {
    const page = ledger.entries.list({ page: 1, pageSize: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.rows[0]?.date).toBe("2026-02-15");
  });

  it("esconde transferencia quando pedido", () => {
    ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      date: "2026-02-20",
      amountCents: 100,
      purpose: "generic",
      status: "cleared"
    });
    expect(ledger.entries.list({}).total).toBe(5);
    expect(ledger.entries.list({ includeTransfers: false }).total).toBe(3);
  });
});

describe("cadastros", () => {
  it("findOrCreate de local ignora acento e caixa (D06)", () => {
    const first = ledger.places.findOrCreate("Assaí");
    const second = ledger.places.findOrCreate("ASSAI");
    expect(second).toBe(first);
    expect(ledger.places.list()).toHaveLength(1);
  });

  it("arquiva em vez de excluir cadastro em uso", () => {
    const place = ledger.places.findOrCreate("Padaria");
    expense({ placeId: place });
    expect(ledger.places.remove(place)).toBe(0);
    expect(ledger.places.get(place)).toBeDefined();

    expect(ledger.categories.remove(mercado)).toBe(0);
    expect(ledger.categories.get(mercado)?.archived).toBe(true);

    expect(ledger.accounts.remove(checking)).toBe(0);
    expect(ledger.accounts.get(checking, { includeArchived: true })?.archived).toBe(true);
  });

  it("exclui de verdade cadastro nunca usado", () => {
    const tag = ledger.tags.create({ name: "temp", color: "#ffffff" });
    expect(ledger.tags.remove(tag)).toBe(1);
    const place = ledger.places.findOrCreate("Nunca usado");
    expect(ledger.places.remove(place)).toBe(1);
  });

  it("conta arquivada some da listagem padrao", () => {
    ledger.accounts.archive(savings);
    expect(ledger.accounts.list().map((a) => a.id)).not.toContain(savings);
    expect(ledger.accounts.list({ includeArchived: true }).map((a) => a.id)).toContain(savings);
  });
});

describe("contas em uso e arquivadas", () => {
  const card = () =>
    ledger.accounts.create({
      name: "Cartao",
      kind: "credit_card",
      color: "#f00",
      personId: steylor,
      closingDay: 20,
      dueDay: 27,
      paymentAccountId: savings
    });

  it("conta que paga um cartao e arquivada, nao esbarra na chave estrangeira", () => {
    card();
    expect(ledger.accounts.remove(savings)).toBe(0);
    expect(ledger.accounts.get(savings, { includeArchived: true })?.archived).toBe(true);
  });

  it("conta sem uso nenhum e apagada de verdade", () => {
    expect(ledger.accounts.remove(savings)).toBe(1);
  });

  it("o consolidado deixa de fora a conta arquivada, como o patrimonio", () => {
    const before = ledger.balances.consolidated().consolidatedCents;
    const extra = ledger.accounts.create({
      name: "Antiga",
      kind: "checking",
      color: "#000",
      personId: steylor,
      openingBalanceCents: 70_00
    });
    expect(ledger.balances.consolidated().consolidatedCents).toBe(before + 70_00);
    ledger.accounts.archive(extra);
    expect(ledger.balances.consolidated().consolidatedCents).toBe(before);
    expect(ledger.balances.byKind().checking).toBe(before);
  });

  it("conta com lancamentos nao vira cartao", () => {
    expense();
    const account = ledger.accounts.get(checking)!;
    expect(() =>
      ledger.accounts.update(checking, {
        ...account,
        kind: "credit_card",
        closingDay: 20,
        dueDay: 27
      })
    ).toThrow(/nao vira cartao/);
    // Mudar entre tipos que nao sao cartao continua livre.
    expect(ledger.accounts.update(checking, { ...account, kind: "cash" })).toBe(1);
  });
});

describe("transferencia de operacao de investimento", () => {
  it("nao se exclui pelo livro", () => {
    const database = createTestDatabase();
    const books = database.ledger;
    const person = books.people.list()[0]!.id;
    const from = books.accounts.create({ name: "A", kind: "checking", color: "#000", personId: person });
    const to = books.accounts.create({ name: "B", kind: "investment", color: "#111", personId: person });
    const transfer = books.entries.createTransfer({
      fromAccountId: from,
      toAccountId: to,
      date: YESTERDAY,
      amountCents: 1000,
      purpose: "investment"
    });
    const transferId = (
      database.raw.prepare("SELECT id FROM transfers WHERE from_entry_id = ?").get(transfer.fromEntryId) as {
        id: number;
      }
    ).id;
    database.raw.pragma("foreign_keys = OFF");
    database.raw
      .prepare("INSERT INTO operation_transfers(operation_id, transfer_id, created_at) VALUES (?, ?, ?)")
      .run(999, transferId, "2026-01-01T00:00:00Z");
    database.raw.pragma("foreign_keys = ON");

    expect(() => books.entries.remove(transfer.fromEntryId)).toThrow(/operacao de investimento/);
    expect(books.entries.get(transfer.fromEntryId)).toBeDefined();
  });
});

describe("today", () => {
  it("devolve a data local em ISO", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
