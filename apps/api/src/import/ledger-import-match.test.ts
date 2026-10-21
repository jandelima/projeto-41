import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createLedgerImportService, type LedgerImportService } from "./ledger-import-service.js";

/**
 * O que o livro ja tem e o arquivo repete: o sistema pareia sozinho e manda
 * para a revisao, onde o usuario ve os dois lados. Nunca vincula sem perguntar.
 */

let db: AppDatabase;
let imports: LedgerImportService;
let bankId: number;
let otherBankId: number;
let cardId: number;

const ZELIA = (date: string, cents: string, id: string) =>
  `${date},${cents},${id},Transferência enviada pelo Pix - Zelia Almeida - •••.231.783-•• - STONE IP S.A. (0197) Agência: 1 Conta: 81627688-7`;

const statement = (...lines: string[]) =>
  Buffer.from(["Data,Valor,Identificador,Descrição", ...lines].join("\n") + "\n");

const upload = (lines: string[], accountId = bankId) =>
  imports.upload({ accountId, fileName: "extrato.csv", buffer: statement(...lines), kind: "bank" });

const invoice = (...lines: string[]) =>
  Buffer.from(["date,title,amount", ...lines].join("\n") + "\n");

beforeEach(() => {
  db = createTestDatabase();
  imports = createLedgerImportService(db);
  const personId = db.ledger.people.list()[0]!.id;
  bankId = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId,
    openingBalanceCents: 0
  });
  otherBankId = db.ledger.accounts.create({
    name: "BTG",
    kind: "checking",
    color: "#003366",
    personId,
    openingBalanceCents: 0
  });
  cardId = db.ledger.accounts.create({
    name: "Cartao",
    kind: "credit_card",
    color: "#8a2be2",
    personId,
    openingBalanceCents: 0,
    closingDay: 31,
    dueDay: 8,
    paymentAccountId: bankId
  });
});

const entry = (overrides: Record<string, unknown>) =>
  db.ledger.entries.create({
    accountId: bankId,
    date: "2026-09-01",
    amountCents: -1900,
    kind: "expense",
    description: "Lanche",
    ...overrides
  } as never);

describe("reconhecimento do que ja existe", () => {
  it("mesmo valor no mesmo dia: provavel, com os dois lados para comparar", () => {
    const id = entry({ description: "Lanche lancado a mao" });
    const row = upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!;
    expect(row.status).toBe("needs_review");
    expect(row.duplicate).toMatchObject({
      entryId: id,
      confidence: "likely",
      dayDistance: 0,
      date: "2026-09-01",
      amountCents: -1900,
      description: "Lanche lancado a mao",
      status: "cleared",
      blocked: null
    });
    expect(row.alternatives).toEqual([]);
  });

  it("valor igual dias depois ainda aparece, so que como possivel", () => {
    const id = entry({ date: "2026-09-03" });
    const row = upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!;
    expect(row.status).toBe("needs_review");
    expect(row.duplicate).toMatchObject({ entryId: id, confidence: "possible", dayDistance: 2 });
  });

  it("mais de tres dias de distancia nao e candidato", () => {
    entry({ date: "2026-09-05" });
    const row = upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!;
    expect(row.duplicate).toBeNull();
  });

  it("o nome do lancamento reforca: valor igual e nome igual, dois dias depois, e provavel", () => {
    const id = entry({ date: "2026-09-03", description: "Pix para Zelia" });
    const row = upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!;
    expect(row.duplicate).toMatchObject({ entryId: id, confidence: "likely" });
  });

  it("valor quase igual so conta se o nome bate", () => {
    entry({ amountCents: -1890, description: "Pix para Zelia" });
    entry({ amountCents: -1890, description: "Mercado", date: "2026-09-01" });
    const row = upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!;
    expect(row.duplicate?.description).toBe("Pix para Zelia");
    expect(row.alternatives).toEqual([]);
  });

  it("sinal diferente nunca casa", () => {
    entry({ amountCents: 1900, kind: "income", categoryId: db.ledger.categories.list().find((c) => c.kind === "income")!.id });
    expect(upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!.duplicate).toBeNull();
  });

  it("o par mais parecido fica com a linha e o outro vira alternativa", () => {
    const sameDay = entry({ description: "no dia" });
    const nextDay = entry({ date: "2026-09-02", description: "no dia seguinte" });
    const row = upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!;
    expect(row.duplicate?.entryId).toBe(sameDay);
    expect(row.alternatives.map((item) => item.entryId)).toEqual([nextDay]);
  });

  it("cada lancamento e par de uma linha so", () => {
    const id = entry({});
    const view = upload([
      ZELIA("01/09/2026", "-19.00", "a1"),
      ZELIA("01/09/2026", "-19.00", "a2")
    ]);
    const withMatch = view.rows.filter((row) => row.duplicate);
    expect(withMatch).toHaveLength(1);
    expect(withMatch[0]!.duplicate!.entryId).toBe(id);
  });

  it("a linha com par certo nao perde o par para o 'mais ou menos' de outra", () => {
    const id = entry({ description: "Zelia" });
    const view = upload([
      ZELIA("02/09/2026", "-19.00", "a1"),
      ZELIA("01/09/2026", "-19.00", "a2")
    ]);
    const [nextDay, sameDay] = view.rows;
    expect(sameDay!.duplicate?.entryId).toBe(id);
    expect(nextDay!.duplicate).toBeNull();
  });

  it("regra 'sempre automatico' nao impede a pergunta quando ha candidato", () => {
    const first = upload([ZELIA("15/08/2026", "-19.00", "z0")]);
    imports.confirm(first.batch.id, first.rows[0]!.id, { action: "create", kind: "expense", remember: "auto" });
    entry({ date: "2026-09-01", description: "digitado a mao" });
    const row = upload([ZELIA("01/09/2026", "-19.00", "z1")]).rows[0]!;
    expect(row.rule).toMatchObject({ mode: "auto" });
    expect(row.status).toBe("needs_review");
    expect(row.duplicate).not.toBeNull();
  });

  it("lancamento que ja veio de uma linha importada nao serve de par para outra", () => {
    const first = upload([ZELIA("01/09/2026", "-19.00", "a1")]);
    imports.confirm(first.batch.id, first.rows[0]!.id, { action: "create", kind: "expense" });
    const again = upload([
      "01/09/2026,-19.00,a2,Transferência enviada pelo Pix - Outra Pessoa - •••.999.999-•• - STONE IP S.A. (0197) Agência: 1 Conta: 1-1"
    ]);
    // Outra pessoa, mesmo valor e dia: o unico lancamento ja e de outra linha, entao e compra nova.
    expect(again.rows[0]!.duplicate).toBeNull();
  });

  it("o mesmo arquivo reenviado continua sendo 'ja importado', sem pergunta", () => {
    const first = upload([ZELIA("01/09/2026", "-19.00", "a1")]);
    imports.confirm(first.batch.id, first.rows[0]!.id, { action: "create", kind: "expense" });
    const again = upload([ZELIA("01/09/2026", "-19.00", "a1")]);
    expect(again.rows[0]).toMatchObject({ status: "duplicate", duplicate: { confidence: "certain" } });
  });
});

describe("vincular", () => {
  it("assume o valor e o dia do arquivo, e o previsto vira confirmado", () => {
    const id = entry({ date: "2026-09-03", amountCents: -1890, status: "pending", description: "Pix para Zelia" });
    const view = upload([ZELIA("01/09/2026", "-19.00", "a1")]);
    const after = imports.confirm(view.batch.id, view.rows[0]!.id, {
      action: "link",
      linkEntryId: id,
      remember: "none"
    });
    expect(after.rows[0]).toMatchObject({ status: "committed", entryId: id });
    expect(db.ledger.entries.get(id)).toMatchObject({
      date: "2026-09-01",
      amountCents: -1900,
      status: "cleared",
      description: "Pix para Zelia"
    });
    expect(db.ledger.entries.list({}).rows).toHaveLength(1);
  });

  it("vincula ao candidato escolhido, nao ao primeiro", () => {
    entry({ description: "no dia" });
    const other = entry({ date: "2026-09-02", description: "no dia seguinte" });
    const view = upload([ZELIA("01/09/2026", "-19.00", "a1")]);
    imports.confirm(view.batch.id, view.rows[0]!.id, { action: "link", linkEntryId: other, remember: "none" });
    expect(db.ledger.entries.get(other)!.rawDescription).toContain("Zelia Almeida");
    expect(db.ledger.entries.list({}).rows).toHaveLength(2);
  });

  it("transferencia ja lancada na outra conta: as duas pontas vão para o dia do arquivo", () => {
    const { fromEntryId, toEntryId } = db.ledger.entries.createTransfer({
      fromAccountId: otherBankId,
      toAccountId: bankId,
      date: "2026-09-03",
      amountCents: 1900
    });
    const view = upload(["01/09/2026,19.00,t1,Transferência recebida pelo Pix - BTG - •••.111.111-•• - BTG PACTUAL (0208) Agência: 20 Conta: 1-1"]);
    expect(view.rows[0]!.duplicate).toMatchObject({ entryId: toEntryId, kind: "transfer", transferWith: "BTG" });
    imports.confirm(view.batch.id, view.rows[0]!.id, { action: "link", remember: "none" });
    expect(db.ledger.entries.get(toEntryId)!.date).toBe("2026-09-01");
    expect(db.ledger.entries.get(fromEntryId)!.date).toBe("2026-09-01");
  });

  it("transferencia com valor diferente nao vincula: o motivo vem junto do candidato", () => {
    const { toEntryId } = db.ledger.entries.createTransfer({
      fromAccountId: otherBankId,
      toAccountId: bankId,
      date: "2026-09-01",
      amountCents: 1900
    });
    // Nao e candidato por valor diferente; forcando o vinculo, a regra barra.
    const view = upload(["01/09/2026,20.00,t1,Transferência recebida pelo Pix - BTG - •••.111.111-•• - BTG PACTUAL (0208) Agência: 20 Conta: 1-1"]);
    expect(view.rows[0]!.duplicate).toBeNull();
    expect(() =>
      imports.confirm(view.batch.id, view.rows[0]!.id, { action: "link", linkEntryId: toEntryId, remember: "none" })
    ).toThrow(/valor do arquivo/);
  });

  it("lancamento conciliado aparece, mas bloqueado", () => {
    const id = entry({});
    db.ledger.entries.setStatus([id], "reconciled");
    const row = upload([ZELIA("01/09/2026", "-19.00", "a1")]).rows[0]!;
    expect(row.duplicate).toMatchObject({ entryId: id, reconciled: true });
    expect(row.duplicate!.blocked).toMatch(/conciliado/);
  });
});

describe("fatura: parcela prevista", () => {
  it("reconhece a parcela pelo numero e pelo nome, mesmo com o dia do plano diferente", () => {
    const plan = db.ledger.installmentPlans.create({
      accountId: cardId,
      purchaseDate: "2026-08-01",
      totalCents: 23668,
      installmentCount: 4,
      description: "Frigideira"
    });
    const parcels = db.ledger.installmentPlans.installments(plan);
    const third = parcels.find((item) => item.installmentNumber === 3)!;
    db.ledger.entries.setStatus([third.id], "pending");
    const buffer = invoice('2026-10-03,Mercadolivre*Mercadol - Parcela 3/4,"59,17"');
    const view = imports.upload({ accountId: cardId, fileName: "fatura.csv", buffer, kind: "card" });
    const row = view.rows[0]!;
    expect(row.duplicate).toMatchObject({
      entryId: third.id,
      installment: { number: 3, total: 4 },
      status: "pending"
    });
    imports.confirm(view.batch.id, row.id, { action: "link", remember: "none" });
    expect(db.ledger.entries.get(third.id)).toMatchObject({ status: "cleared", date: third.date });
  });
});
