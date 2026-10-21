import { readFileSync } from "node:fs";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createLedgerImportService, type LedgerImportService } from "./ledger-import-service.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/csv/${name}`, import.meta.url));
const INVOICE = fixture("nubank-fatura.csv");
const STATEMENT = fixture("nubank-conta.csv");

let db: AppDatabase;
let imports: LedgerImportService;
let bankId: number;
let cardId: number;
let casa: number;

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
  // Nubank "fecha dia 1": no app, o ultimo dia que entra e o 31.
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
  casa = db.ledger.categories.create({ name: "Casa teste", kind: "expense", color: "#123456" });
});

const upload = (accountId: number, buffer: Buffer, kind?: "bank" | "card") =>
  imports.upload({ accountId, fileName: "fatura.csv", buffer, kind });

describe("fatura do cartao em CSV", () => {
  it("le compra positiva como saida e cai na fatura certa", () => {
    const view = upload(cardId, INVOICE, "card");
    expect(view.batch.statementKind).toBe("card");
    const padaria = view.rows.find((row) => row.rawDescription === "Padaria Sao Joao")!;
    expect(padaria).toMatchObject({ amountCents: -2350, statementMonth: "2026-10" });
    expect(padaria.suggestion).toMatchObject({ kind: "expense", placeName: "Padaria Sao Joao" });
    const total = view.rows
      .filter((row) => row.status !== "ignored")
      .reduce((sum, row) => sum + row.amountCents, 0);
    expect(total).toBe(-52585);
  });

  it("pula o pagamento recebido, que ja existe como pagamento da fatura", () => {
    const view = upload(cardId, INVOICE, "card");
    const payment = view.rows.find((row) => /pagamento recebido/i.test(row.rawDescription))!;
    expect(payment.status).toBe("ignored");
    expect(view.counts.review).toBe(7);
  });

  it("parcela nao muda o destinatario: a regra vale para as proximas parcelas", () => {
    const view = upload(cardId, INVOICE, "card");
    const loja = view.rows.find((row) => row.rawDescription.startsWith("Loja Magazine"))!;
    expect(loja.installment).toEqual({ number: 2, total: 4 });
    expect(loja.payee.display).toBe("Loja Magazine*Loja");
    imports.confirm(view.batch.id, loja.id, {
      action: "create",
      kind: "expense",
      categoryId: casa,
      remember: "auto"
    });

    const next = upload(
      cardId,
      Buffer.from('date,title,amount\n2026-10-02,Loja Magazine*Loja - Parcela 3/4,"59,17"\n'),
      "card"
    );
    expect(next.rows[0]).toMatchObject({
      status: "new",
      installment: { number: 3, total: 4 },
      suggestion: { categoryId: casa }
    });
  });

  it("tira o numero longo do adquirente do nome", () => {
    const view = upload(cardId, INVOICE, "card");
    expect(view.rows.map((row) => row.payee.display)).toContain("Clinica Sorriso");
  });

  it("recusa arquivo e conta trocados", () => {
    expect(() => upload(bankId, INVOICE, "bank")).toThrow(/fatura do cartao/);
    expect(() => upload(cardId, STATEMENT, "card")).toThrow(/extrato da conta/);
    expect(() => upload(bankId, INVOICE, "card")).toThrow(/escolha a conta do cartao/);
    expect(() => upload(cardId, INVOICE, "bank")).toThrow(/nao um cartao/);
  });

  it("confirmar grava no cartao, na fatura do vencimento", () => {
    const view = upload(cardId, INVOICE, "card");
    const posto = view.rows.find((row) => row.rawDescription === "Posto Estrela")!;
    const after = imports.confirm(view.batch.id, posto.id, { action: "create", kind: "expense" });
    const entry = db.ledger.entries.get(after.rows.find((row) => row.id === posto.id)!.entryId!)!;
    expect(entry).toMatchObject({ accountId: cardId, amountCents: -15000, statementMonth: "2026-10" });
  });
});
