import { readFileSync } from "node:fs";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { createLedgerImportService, type LedgerImportService } from "./ledger-import-service.js";

const NUBANK_CSV = readFileSync(new URL("./__fixtures__/csv/nubank-conta.csv", import.meta.url));

let db: AppDatabase;
let imports: LedgerImportService;
let accountId: number;
let savingsId: number;
let farmacia: number;
let entradas: number;

function upload(buffer: Buffer = NUBANK_CSV) {
  return imports.upload({ accountId, fileName: "NU_2026-09.csv", buffer });
}

function rowOf(view: ReturnType<typeof upload>, raw: string) {
  const row = view.rows.find((item) => item.rawDescription.includes(raw));
  if (!row) throw new Error(`linha ${raw} nao encontrada`);
  return row;
}

beforeEach(() => {
  db = createTestDatabase();
  imports = createLedgerImportService(db);
  const personId = db.ledger.people.list()[0]!.id;
  accountId = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId,
    openingBalanceCents: 0
  });
  savingsId = db.ledger.accounts.create({
    name: "Caixinha",
    kind: "goal",
    color: "#8a2be2",
    personId,
    openingBalanceCents: 0
  });
  farmacia = db.ledger.categories.create({ name: "Farmacia teste", kind: "expense", color: "#ff0000" });
  entradas = db.ledger.categories.create({ name: "Entradas teste", kind: "income", color: "#00ff00" });
});

describe("importacao do extrato Nubank", () => {
  it("le o CSV e manda toda linha desconhecida para a revisao", () => {
    const view = upload();
    expect(view.batch.source).toBe("csv");
    expect(view.rows).toHaveLength(58);
    expect(view.counts.review).toBe(58);
    const pix = rowOf(view, "FARMACIA CENTRAL");
    expect(pix.payee).toMatchObject({ display: "Farmacia Central", document: "01669256742199" });
    expect(pix.paymentMethod).toBe("pix");
    expect(pix.suggestion).toMatchObject({ kind: "expense", placeName: "Farmacia Central", categoryId: null });
  });

  it("nao grava nada no livro antes da confirmacao", () => {
    upload();
    expect(db.ledger.entries.list({}).rows).toHaveLength(0);
  });

  it("confirmar com 'sempre automatico' tira da fila as outras linhas do destinatario", () => {
    const view = upload();
    const first = rowOf(view, "FARMACIA CENTRAL");
    const after = imports.confirm(view.batch.id, first.id, {
      action: "create",
      kind: "expense",
      categoryId: farmacia,
      placeName: "Farmácia Central",
      description: "Remédio",
      remember: "auto"
    });

    const pending = after.rows.filter((row) => row.payee.display === "Farmacia Central");
    const second = pending.find((row) => row.id !== first.id)!;
    expect(second.status).toBe("new");
    // A descricao foi daquele lancamento: o proximo do destinatario vem sem ela.
    expect(second.suggestion).toMatchObject({ categoryId: farmacia, description: null });
    expect(after.counts.review).toBe(56);
    expect(after.counts.ready).toBe(1);

    const entry = db.ledger.entries.get(after.rows.find((row) => row.id === first.id)!.entryId!)!;
    expect(entry).toMatchObject({ amountCents: -1600, categoryId: farmacia, description: "Remédio" });
    expect(entry.rawDescription).toContain("FARMACIA CENTRAL");
  });

  it("'sempre automatico' guarda o local digitado, mesmo diferente do destinatario", () => {
    const view = upload();
    const first = rowOf(view, "FARMACIA CENTRAL");
    const after = imports.confirm(view.batch.id, first.id, {
      action: "create",
      kind: "expense",
      categoryId: farmacia,
      placeName: "Drogaria do Bairro",
      remember: "auto"
    });
    const second = after.rows.find((row) => row.payee.display === "Farmacia Central" && row.id !== first.id)!;
    expect(second).toMatchObject({ status: "new", suggestion: { placeName: "Drogaria do Bairro" } });

    const committed = imports.commitReady(view.batch.id).rows.find((row) => row.id === second.id)!;
    const entry = db.ledger.entries.get(committed.entryId!)!;
    expect(db.ledger.places.get(entry.placeId!)!.name).toBe("Drogaria do Bairro");
  });

  it("'perguntar sempre' pre-preenche mas continua perguntando", () => {
    const view = upload();
    const first = rowOf(view, "FARMACIA CENTRAL");
    const after = imports.confirm(view.batch.id, first.id, {
      action: "create",
      kind: "expense",
      categoryId: farmacia,
      placeName: "Farmacia Central",
      remember: "ask"
    });
    const second = after.rows.find((row) => row.payee.display === "Farmacia Central" && row.id !== first.id)!;
    expect(second.status).toBe("needs_review");
    expect(second.rule).toMatchObject({ mode: "ask" });
    expect(second.suggestion.categoryId).toBe(farmacia);
  });

  it("a regra vale na importacao seguinte e o mesmo arquivo nao duplica", () => {
    const view = upload();
    const first = rowOf(view, "FARMACIA CENTRAL");
    imports.confirm(view.batch.id, first.id, {
      action: "create",
      kind: "expense",
      categoryId: farmacia,
      placeName: "Farmacia Central",
      remember: "auto"
    });
    imports.commitReady(view.batch.id);

    const again = upload();
    expect(again.previousImportAt).not.toBeNull();
    const farmaciaRows = again.rows.filter((row) => row.payee.display === "Farmacia Central");
    expect(farmaciaRows.map((row) => row.status)).toEqual(["duplicate", "duplicate"]);
    expect(farmaciaRows[0]!.duplicate?.reason).toBe("external_id");
  });

  it("saida e entrada do mesmo destinatario tem regras separadas", () => {
    const view = upload();
    const received = view.rows.find((row) => row.rawDescription.startsWith("Transferência Recebida - CASA CONJUNTA"))!;
    imports.confirm(view.batch.id, received.id, {
      action: "create",
      kind: "income",
      categoryId: entradas,
      remember: "auto"
    });
    const after = imports.view(view.batch.id);
    const sent = after.rows.filter((row) => row.rawDescription.startsWith("Transferência enviada pelo Pix - CASA CONJUNTA"));
    expect(sent.every((row) => row.status === "needs_review" && row.rule === null)).toBe(true);
  });

  it("'ignorar sempre' pula as linhas do destinatario", () => {
    const view = upload();
    const debit = view.rows.filter((row) => row.rawDescription === "Débito em conta");
    const after = imports.confirm(view.batch.id, debit[0]!.id, { action: "skip", remember: "ignore" });
    const statuses = after.rows.filter((row) => row.rawDescription === "Débito em conta").map((row) => row.status);
    expect(statuses).toEqual(["ignored", "ignored", "ignored"]);
  });

  it("linha que parece repetir um lancamento do livro pode ser vinculada sem duplicar", () => {
    const existing = db.ledger.entries.create({
      accountId,
      date: "2026-09-01",
      amountCents: -1900,
      kind: "expense",
      description: "Lanche lancado a mao"
    });
    const view = upload();
    const row = rowOf(view, "Zelia Almeida");
    expect(row.status).toBe("needs_review");
    expect(row.duplicate).toMatchObject({ entryId: existing, reason: "fuzzy_amount_date" });

    const after = imports.confirm(view.batch.id, row.id, { action: "link", remember: "none" });
    expect(after.rows.find((item) => item.id === row.id)).toMatchObject({ status: "committed", entryId: existing });
    expect(db.ledger.entries.list({}).rows).toHaveLength(1);
    expect(db.ledger.entries.get(existing)!.rawDescription).toContain("Zelia Almeida");
  });

  it("vincular ensina o destinatario com a categoria do lancamento existente", () => {
    db.ledger.entries.create({
      accountId,
      date: "2026-09-01",
      amountCents: -1900,
      kind: "expense",
      categoryId: farmacia,
      description: "Remedio da planilha"
    });
    const view = upload();
    const row = rowOf(view, "Zelia Almeida");
    imports.confirm(view.batch.id, row.id, { action: "link", remember: "auto" });

    const again = imports.upload({
      accountId,
      fileName: "outro.csv",
      buffer: Buffer.from(
        "Data,Valor,Identificador,Descrição\n" +
          "30/09/2026,-7.00,bbbb0000-0000-0000-0000-000000000001,Transferência enviada pelo Pix - Zelia Almeida - •••.231.783-•• - STONE IP S.A. (0197) Agência: 1 Conta: 81627688-7\n"
      )
    });
    expect(again.rows[0]).toMatchObject({ status: "new", suggestion: { categoryId: farmacia, description: null } });
  });

  it("transferencia vai para a outra conta com os dois lados", () => {
    const view = upload();
    const resgate = rowOf(view, "Resgate RDB");
    const after = imports.confirm(view.batch.id, resgate.id, {
      action: "create",
      kind: "transfer",
      toAccountId: savingsId,
      remember: "auto"
    });
    const entry = db.ledger.entries.get(after.rows.find((row) => row.id === resgate.id)!.entryId!)!;
    expect(entry).toMatchObject({ kind: "transfer", amountCents: 20039, accountId });
    // Transferencia nao vira regra.
    expect(after.rows.find((row) => row.id === resgate.id)!.rule).toBeNull();
  });

  it("recusa saida com valor positivo", () => {
    const view = upload();
    const received = rowOf(view, "Joao Ibrahim");
    expect(() =>
      imports.confirm(view.batch.id, received.id, { action: "create", kind: "expense" })
    ).toThrow(/entrada/);
  });

  it("descartar encerra o lote e mantem o que ja foi gravado", () => {
    const view = upload();
    const first = view.rows[0]!;
    imports.confirm(view.batch.id, first.id, { action: "create", kind: "expense" });
    const discarded = imports.discard(view.batch.id);
    expect(discarded.batch.status).toBe("discarded");
    expect(discarded.counts).toMatchObject({ committed: 1, ignored: 0 });
    expect(db.ledger.entries.list({}).rows).toHaveLength(1);
    expect(() =>
      imports.confirm(view.batch.id, view.rows[1]!.id, { action: "create", kind: "expense" })
    ).toThrow(/descartado/);
  });
});

describe("o que ja passou pelo sistema e reconhecido sozinho", () => {
  it("guarda a linha do arquivo inteira, com o nome de cada coluna", () => {
    const view = upload();
    const raw = db.raw
      .prepare("SELECT raw_json AS json FROM import_rows WHERE id = ?")
      .get(view.rows[0]!.id) as { json: string };
    expect(JSON.parse(raw.json)).toEqual({
      file: "NU_2026-09.csv",
      lineNo: 1,
      fields: {
        Data: "01/09/2026",
        Valor: "-16.00",
        Identificador: "62a63c47-eb71-40ea-6b26-ae28b8b0346a",
        "Descrição": expect.stringContaining("FARMACIA CENTRAL")
      }
    });
  });

  it("reenviar o arquivo nao pergunta de novo nada que ja foi decidido", () => {
    const first = upload();
    imports.confirm(first.batch.id, first.rows[0]!.id, { action: "create", kind: "expense" });
    imports.confirm(first.batch.id, first.rows[2]!.id, { action: "skip" });

    const again = upload();
    expect(again.rows[0]).toMatchObject({ status: "duplicate", skippedBefore: false });
    expect(again.rows[2]).toMatchObject({ status: "ignored", skippedBefore: true });
    // O resto nunca foi decidido: continua na fila.
    expect(again.counts.review).toBe(56);
  });

  it("apagar um lancamento importado funciona e a reimportacao o pula", () => {
    const first = upload();
    const after = imports.confirm(first.batch.id, first.rows[0]!.id, { action: "create", kind: "expense" });
    db.ledger.entries.remove(after.rows[0]!.entryId!);

    expect(imports.view(first.batch.id).rows[0]).toMatchObject({ status: "ignored", entryId: null });
    expect(upload().rows[0]).toMatchObject({ status: "ignored", skippedBefore: true });
  });

  it("encerrar o lote sem revisar nao faz a proxima importacao pular nada", () => {
    const first = upload();
    imports.discard(first.batch.id);
    expect(upload().counts.review).toBe(58);
  });
});

describe("possivel duplicata em dias proximos", () => {
  it("mesmo valor no dia seguinte aparece como possivel, para o usuario decidir", () => {
    const existing = db.ledger.entries.create({
      accountId,
      date: "2026-09-02",
      amountCents: -1900,
      kind: "expense",
      description: "Outro lanche, no dia seguinte"
    });
    const row = rowOf(upload(), "Zelia Almeida");
    expect(row.status).toBe("needs_review");
    expect(row.duplicate).toMatchObject({ entryId: existing, confidence: "possible", dayDistance: 1 });
  });

  it("alem de tres dias nao e duplicata", () => {
    db.ledger.entries.create({
      accountId,
      date: "2026-09-08",
      amountCents: -1900,
      kind: "expense",
      description: "Outro lanche, na semana seguinte"
    });
    expect(rowOf(upload(), "Zelia Almeida").duplicate).toBeNull();
  });
});

describe("extrato em planilha", () => {
  /** Extrato no formato do BTG, com dados ficticios. */
  function btgWorkbook(bookType: "biff8" | "xlsx"): Buffer {
    const sheet = XLSX.utils.aoa_to_sheet([
      [null, "Extrato de conta corrente"],
      [null, "Cliente:", "Fulano de Tal"],
      [],
      [null, "Data e hora", "Categoria", "Transação", null, "Descrição", null, "Valor"],
      [null, "28/09/2026 11:27", "Transferência", "Pix recebido", null, "Fulana Silva", null, 160],
      [null, "28/09/2026 11:34", "Saúde", "Pix enviado", null, "Farmacia do Bairro", null, -42.9],
      [null, "28/09/2026 23:59", null, null, null, "Saldo Diário", null, 117.1]
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Extrato");
    return XLSX.write(book, { type: "buffer", bookType });
  }

  it.each([
    ["Extrato.xls", "biff8"],
    ["Extrato.xlsx", "xlsx"]
  ] as const)("%s entra na mesma revisao do CSV, sem a linha de saldo", (fileName, bookType) => {
    const view = imports.upload({ accountId, fileName, buffer: btgWorkbook(bookType) });
    expect(view.rows.map((row) => [row.date, row.amountCents, row.rawDescription])).toEqual([
      ["2026-09-28", 16000, "Fulana Silva"],
      ["2026-09-28", -4290, "Farmacia do Bairro"]
    ]);
    expect(db.raw.prepare("SELECT count(*) AS n FROM entries").get()).toEqual({ n: 0 });
  });

  it("reenviar a mesma planilha nao duplica o que ja foi gravado", () => {
    const first = imports.upload({ accountId, fileName: "Extrato.xls", buffer: btgWorkbook("biff8") });
    imports.confirm(first.batch.id, first.rows[1]!.id, {
      action: "create",
      kind: "expense",
      categoryId: farmacia
    });
    const again = imports.upload({ accountId, fileName: "Extrato.xls", buffer: btgWorkbook("biff8") });
    expect(again.rows[1]).toMatchObject({ status: "duplicate" });
  });

  it("planilha que nao e extrato e recusada com o motivo", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Nome"], ["Ana"]]), "Plan1");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(() => imports.upload({ accountId, fileName: "lista.xlsx", buffer })).toThrow(
      /tabela de lancamentos/
    );
  });
});
