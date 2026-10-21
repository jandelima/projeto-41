import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ReconciledLinkError,
  bridgeAccountId,
  depositToPosition,
  listOperationsWithLinks,
  moveBetweenPositions,
  registerOperation,
  removeOperation,
  removePosition,
  toLedgerCents,
  undoMovement,
  unlinkOperation,
  updateOperation,
  withdrawFromPosition
} from "./investment-cash-service.js";

let db: AppDatabase;
let checking: number;
let bridge: number;
let caixa: number;
let cdb: number;
let dolar: number;

const BUY = {
  portfolio: "crypto" as const,
  type: "buy" as const,
  asset: "BTC",
  date: "2026-05-10",
  quantity: 0.01,
  total: 5000,
  currency: "BRL" as const
};

function counts() {
  const one = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;
  return {
    operations: one("SELECT COUNT(*) AS n FROM operations"),
    entries: one("SELECT COUNT(*) AS n FROM entries"),
    transfers: one("SELECT COUNT(*) AS n FROM transfers"),
    links: one("SELECT COUNT(*) AS n FROM operation_transfers"),
    movements: one("SELECT COUNT(*) AS n FROM position_movements")
  };
}

const balanceOf = (id: number) =>
  db.ledger.balances.forAccount(id, { asOf: "2026-06-01" })?.currentBalanceCents ?? 0;
const valueOf = (id: number) => db.positions.get(id)!.currentValue;
const investedOf = (id: number) => db.positions.get(id)!.invested;

function setUsd(price: number) {
  db.prices.upsert({
    symbol: "USDBRL",
    currency: "BRL",
    price,
    provider: "test",
    marketTime: null,
    fetchedAt: "2026-05-10T12:00:00.000Z",
    error: null
  });
}

beforeEach(() => {
  db = createTestDatabase();
  checking = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: db.ledger.people.list()[0]!.id,
    openingBalanceCents: 1_000_00
  });
  bridge = bridgeAccountId(db);
  caixa = db.positions.upsert({ category: "cash", name: "Caixa BTG", invested: 0, currentValue: 0, currency: "BRL" });
  cdb = db.positions.upsert({ category: "fixed_income", name: "CDB", invested: 0, currentValue: 0, currency: "BRL" });
  dolar = db.positions.upsert({ category: "dollar", name: "Conta USD", invested: 0, currentValue: 0, currency: "USD" });
});

describe("aporte, resgate e movimento", () => {
  it("aporte tira do banco e poe no caixa, sem contar como gasto", () => {
    depositToPosition(db, { positionId: caixa, fromAccountId: checking, amountCents: 400_00, date: "2026-05-01" });
    expect(balanceOf(checking)).toBe(1_000_00 - 400_00);
    expect(valueOf(caixa)).toBe(400);
    expect(balanceOf(bridge)).toBe(400_00);

    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    expect(entry.transferPurpose).toBe("investment");
    const month = db.ledger.reports.monthSummary({ from: "2026-05-01", to: "2026-05-31" });
    expect(month.expenseCents).toBe(0);
  });

  it("gasto lançado por engano vira aporte: sai do livro e o saldo não cai duas vezes", () => {
    const spent = db.ledger.entries.create({
      accountId: checking,
      date: "2026-05-01",
      amountCents: -250_00,
      kind: "expense",
      status: "cleared",
      tagIds: []
    });
    depositToPosition(db, {
      positionId: cdb,
      fromAccountId: checking,
      amountCents: 250_00,
      date: "2026-05-01",
      replacesEntryId: spent
    });
    expect(db.ledger.entries.get(spent)).toBeUndefined();
    expect(balanceOf(checking)).toBe(1_000_00 - 250_00);
    expect(valueOf(cdb)).toBe(250);
    const month = db.ledger.reports.monthSummary({ from: "2026-05-01", to: "2026-05-31" });
    expect(month.expenseCents).toBe(0);
  });

  it("só uma saída da mesma conta pode virar aporte, e nada muda se recusar", () => {
    const other = db.ledger.accounts.create({
      name: "Outra",
      kind: "checking",
      color: "#111111",
      openingBalanceCents: 0
    });
    const spent = db.ledger.entries.create({
      accountId: other,
      date: "2026-05-01",
      amountCents: -100_00,
      kind: "expense",
      status: "cleared",
      tagIds: []
    });
    const before = counts();
    expect(() =>
      depositToPosition(db, {
        positionId: cdb,
        fromAccountId: checking,
        amountCents: 100_00,
        date: "2026-05-01",
        replacesEntryId: spent
      })
    ).toThrow(/mesma conta/);
    expect(counts()).toEqual(before);
    expect(valueOf(cdb)).toBe(0);
  });

  it("aporte e resgate pelo livro aparecem nos aportes do ano; movimento entre posições não", () => {
    db.contributions.create({ date: "2026-01-10", amount: 100 });
    depositToPosition(db, { positionId: caixa, fromAccountId: checking, amountCents: 400_00, date: "2026-05-01" });
    moveBetweenPositions(db, { fromPositionId: caixa, toPositionId: cdb, amount: 100, date: "2026-05-02" });
    withdrawFromPosition(db, { positionId: caixa, toAccountId: checking, amountCents: 50_00, date: "2026-05-03" });

    const all = db.contributions.all();
    expect(all.map((item) => [item.date, item.amount, item.source])).toEqual([
      ["2026-01-10", 100, "manual"],
      ["2026-05-01", 400, "ledger"],
      ["2026-05-03", -50, "ledger"]
    ]);
    expect(all[1]!.accountName).toBe("Nubank");
  });

  it("aporte direto na renda fixa soma ao investido", () => {
    depositToPosition(db, { positionId: cdb, fromAccountId: checking, amountCents: 300_00, date: "2026-05-01" });
    expect(valueOf(cdb)).toBe(300);
    expect(investedOf(cdb)).toBe(300);
  });

  it("aporte numa posicao em dolar converte pela cotacao", () => {
    setUsd(5);
    depositToPosition(db, { positionId: dolar, fromAccountId: checking, amountCents: 500_00, date: "2026-05-01" });
    expect(valueOf(dolar)).toBe(100);
    expect(balanceOf(checking)).toBe(1_000_00 - 500_00);
  });

  it("resgate devolve ao banco e recusa mais do que a posicao tem", () => {
    depositToPosition(db, { positionId: caixa, fromAccountId: checking, amountCents: 400_00, date: "2026-05-01" });
    withdrawFromPosition(db, { positionId: caixa, toAccountId: checking, amountCents: 150_00, date: "2026-05-02" });
    expect(valueOf(caixa)).toBe(250);
    expect(balanceOf(checking)).toBe(1_000_00 - 250_00);
    expect(() =>
      withdrawFromPosition(db, { positionId: caixa, toAccountId: checking, amountCents: 999_00, date: "2026-05-03" })
    ).toThrow(/nao cobre/);
    expect(valueOf(caixa)).toBe(250);
  });

  it("mover do caixa para a renda fixa nao passa pelo banco", () => {
    depositToPosition(db, { positionId: caixa, fromAccountId: checking, amountCents: 400_00, date: "2026-05-01" });
    moveBetweenPositions(db, { fromPositionId: caixa, toPositionId: cdb, amount: 250, date: "2026-05-02" });
    expect(valueOf(caixa)).toBe(150);
    expect(valueOf(cdb)).toBe(250);
    expect(investedOf(cdb)).toBe(250);
    expect(balanceOf(checking)).toBe(1_000_00 - 400_00);
  });

  it("resgatar parte da renda fixa leva a mesma parte do investido", () => {
    db.positions.upsert({ id: cdb, category: "fixed_income", name: "CDB", invested: 1000, currentValue: 1200, currency: "BRL" });
    withdrawFromPosition(db, { positionId: cdb, toAccountId: checking, amountCents: 600_00, date: "2026-05-02" });
    expect(valueOf(cdb)).toBe(600);
    expect(investedOf(cdb)).toBe(500);
  });

  it("desfazer aporte devolve banco e posicao; desfazer movimento devolve as duas pontas", () => {
    const { movementId } = depositToPosition(db, {
      positionId: caixa,
      fromAccountId: checking,
      amountCents: 400_00,
      date: "2026-05-01"
    });
    const move = moveBetweenPositions(db, { fromPositionId: caixa, toPositionId: cdb, amount: 100, date: "2026-05-02" });
    undoMovement(db, move.movementId);
    expect(valueOf(caixa)).toBe(400);
    expect(valueOf(cdb)).toBe(0);

    undoMovement(db, movementId);
    expect(valueOf(caixa)).toBe(0);
    expect(balanceOf(checking)).toBe(1_000_00);
    expect(counts()).toMatchObject({ entries: 0, transfers: 0, movements: 0 });
  });

  it("o livro nao apaga sozinho a ponta de um aporte", () => {
    depositToPosition(db, { positionId: caixa, fromAccountId: checking, amountCents: 400_00, date: "2026-05-01" });
    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    expect(() => db.ledger.entries.remove(entry.id)).toThrow(/Em caixa/);
  });

  it("transferencia avulsa para a ponte e recusada: sumiria do patrimonio", () => {
    expect(() =>
      db.ledger.entries.createTransfer({
        fromAccountId: checking,
        toAccountId: bridge,
        date: "2026-05-01",
        amountCents: 100
      })
    ).toThrow(/Aportar/);
  });

  it("posicao com aporte nao se exclui; sem movimento ligado, sim", () => {
    depositToPosition(db, { positionId: caixa, fromAccountId: checking, amountCents: 400_00, date: "2026-05-01" });
    expect(() => removePosition(db, caixa)).toThrow(/Resgate ou desfaca/);
    removePosition(db, cdb);
    expect(db.positions.get(cdb)).toBeUndefined();
  });
});

describe("operacao paga por um caixa", () => {
  beforeEach(() => {
    depositToPosition(db, { positionId: caixa, fromAccountId: checking, amountCents: 800_00, date: "2026-05-01" });
  });

  it("compra sai do caixa e nao toca no banco", () => {
    const { transferId } = registerOperation(db, { ...BUY, total: 300, positionId: caixa });
    expect(transferId).toBeNull();
    expect(valueOf(caixa)).toBe(500);
    expect(balanceOf(checking)).toBe(1_000_00 - 800_00);
    expect(db.operations.list()[0]?.accountId).toBeNull();
  });

  it("compra em dolar paga por caixa em reais converte", () => {
    setUsd(5);
    registerOperation(db, { ...BUY, currency: "USD", total: 100, positionId: caixa });
    expect(valueOf(caixa)).toBe(300);
  });

  it("venda volta para o caixa", () => {
    registerOperation(db, { ...BUY, type: "sell", total: 200, positionId: caixa });
    expect(valueOf(caixa)).toBe(1000);
  });

  it("compra que o caixa nao cobre e recusada sem gravar nada", () => {
    const before = counts();
    expect(() => registerOperation(db, { ...BUY, total: 5000, positionId: caixa })).toThrow(/nao cobre/);
    expect(counts()).toEqual(before);
    expect(valueOf(caixa)).toBe(800);
  });

  it("editar do caixa para o banco devolve o caixa", () => {
    const { id } = registerOperation(db, { ...BUY, total: 300, positionId: caixa });
    updateOperation(db, id, { ...BUY, total: 300, accountId: checking, positionId: null });
    expect(valueOf(caixa)).toBe(800);
    expect(balanceOf(checking)).toBe(1_000_00 - 800_00 - 300_00);
  });

  it("excluir a operacao devolve o caixa; o movimento nao se desfaz sozinho", () => {
    const { id } = registerOperation(db, { ...BUY, total: 300, positionId: caixa });
    const movement = db.positionMovements.byOperation(id)!;
    expect(() => undoMovement(db, movement.id)).toThrow(/pela operacao/);
    removeOperation(db, id);
    expect(valueOf(caixa)).toBe(800);
  });

  it("a listagem diz de qual caixa veio o dinheiro", () => {
    registerOperation(db, { ...BUY, total: 300, positionId: caixa });
    const row = listOperationsWithLinks(db, "crypto")[0]!;
    expect(row.cashSource).toBe("position");
    expect(row.accountName).toBe("Caixa BTG");
    expect(row.positionId).toBe(caixa);
  });
});

describe("operacao paga direto pelo banco", () => {
  it("debita o banco pelo valor exato, contra a conta-ponte", () => {
    const { id, transferId } = registerOperation(db, { ...BUY, accountId: checking });
    expect(transferId).not.toBeNull();
    expect(counts()).toMatchObject({ operations: 1, entries: 2, transfers: 1, links: 1 });
    expect(balanceOf(checking)).toBe(1_000_00 - 500_000);
    expect(balanceOf(bridge)).toBe(500_000);

    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    expect(entry.transferPurpose).toBe("investment");
    expect(entry.categoryId).toBeNull();
    expect(entry.description).toBe("Compra BTC 0,01");
    expect(db.operationLinks.get(id)?.transferId).toBe(transferId);
  });

  it("venda credita o banco de volta", () => {
    registerOperation(db, { ...BUY, type: "sell", total: 200, accountId: checking });
    expect(balanceOf(checking)).toBe(1_000_00 + 20_000);
  });

  it("converte USD pela cotacao e registra a cotacao na nota", () => {
    setUsd(5.4321);
    registerOperation(db, { ...BUY, currency: "USD", total: 1000, accountId: checking });
    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    // 1000 USD × 5,4321 = R$ 5.432,10
    expect(entry.amountCents).toBe(-543_210);
    expect(entry.notes).toBe("USDBRL 5,4321 em 2026-05-10");
  });

  it("recusa operacao em USD sem cotacao, sem gravar nada", () => {
    expect(() =>
      registerOperation(db, { ...BUY, currency: "USD", total: 1000, accountId: checking })
    ).toThrow(/cotacao/i);
    expect(counts()).toMatchObject({ operations: 0, entries: 0, transfers: 0, links: 0 });
  });

  it("com o debito desligado, a operacao pela conta nasce sem lancamento", () => {
    db.settings.set("investment.auto_debit", "0");
    const { transferId } = registerOperation(db, { ...BUY, accountId: checking });
    expect(transferId).toBeNull();
    expect(counts()).toMatchObject({ operations: 1, entries: 0 });
  });

  it("sem conta nem caixa, nao movimenta dinheiro", () => {
    registerOperation(db, BUY);
    expect(counts().entries).toBe(0);
  });

  it("editar o total ajusta o debito", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    updateOperation(db, id, { ...BUY, total: 3000, accountId: checking });
    expect(balanceOf(checking)).toBe(1_000_00 - 300_000);
    expect(counts().entries).toBe(2);
  });

  it("desvincular mantem a operacao e devolve o saldo", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    unlinkOperation(db, id);
    expect(counts()).toMatchObject({ operations: 1, entries: 0, transfers: 0, links: 0 });
    expect(balanceOf(checking)).toBe(1_000_00);
    expect(db.operations.list()[0]?.accountId).toBeNull();
  });

  it("recusa excluir com ponta conciliada, sem apagar NADA", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    db.ledger.entries.setStatus([entry.id], "reconciled");
    const before = counts();
    expect(() => removeOperation(db, id)).toThrow(ReconciledLinkError);
    expect(counts()).toEqual(before);
  });

  it("a listagem distingue operacao com e sem movimento", () => {
    registerOperation(db, { ...BUY, accountId: checking });
    registerOperation(db, { ...BUY, asset: "ETH", date: "2026-05-11" });
    const rows = listOperationsWithLinks(db, "crypto");
    expect(rows.find((row) => row.asset === "BTC")).toMatchObject({ cashSource: "bank", accountName: "Nubank" });
    expect(rows.find((row) => row.asset === "ETH")).toMatchObject({ cashSource: null, accountName: null });
  });
});

describe("toLedgerCents", () => {
  it("arredonda meio centavo para cima", () => {
    expect(toLedgerCents(db, { ...BUY, total: 10.005 }).cents).toBe(1001);
  });
});

describe("edicao de operacao em dolar", () => {
  // O débito no banco foi feito na cotação do dia da compra. Editar a nota ou
  // a quantidade semanas depois não pode refazer a conta com o dólar de hoje.
  it("mantem o valor em reais quando o dinheiro da operacao nao mudou", () => {
    setUsd(5);
    const usdBuy = { ...BUY, total: 100, currency: "USD" as const, accountId: checking };
    const { id } = registerOperation(db, usdBuy);
    expect(balanceOf(checking)).toBe(1_000_00 - 500_00);

    setUsd(6);
    updateOperation(db, id, { ...usdBuy, quantity: 0.02, notes: "conferido" });
    expect(balanceOf(checking)).toBe(1_000_00 - 500_00);

    updateOperation(db, id, { ...usdBuy, total: 50 });
    expect(balanceOf(checking)).toBe(1_000_00 - 300_00);
  });
});
