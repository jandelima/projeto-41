import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { inspectCsv, readCsv } from "../csv/csv-reader.js";
import { looksLikeSpreadsheet, spreadsheetToCsv } from "./spreadsheet-reader.js";

type Cell = string | number | null;

/**
 * O layout do extrato em Excel do BTG (JasperReports), com dados ficticios:
 * cabecalho do relatorio antes da tabela, colunas mescladas deixando buracos,
 * data com hora, saldo do dia no meio, cabecalho repetido na quebra de pagina
 * e rodape no fim.
 */
const BTG_LAYOUT: Cell[][] = [
  [null, "Extrato de conta corrente", null, null, null, null, null, null, null, 46313.79],
  [],
  [null, "Cliente:", "Fulano de Tal"],
  [null, "Conta:", "0000000-0"],
  [null, "Período do extrato:", "18/09/2026 a 18/10/2026"],
  [],
  [null, "Lançamentos:", null, null, null, null, null, "Saldo atual:", null, 2074.46],
  [],
  [null, "Data e hora", "Categoria", "Transação", null, null, "Descrição", null, null, null, "Valor"],
  [null, "28/09/2026 11:27", "Transferência", "Pix recebido", null, null, "Fulana; Silva", null, null, null, 160],
  [null, "28/09/2026 11:34", "Cuidados Pessoais", "Pix enviado", null, null, "Academia", null, null, null, -80],
  [],
  [null, "28/09/2026 12:15", "Transferência", "Pix recebido", null, null, "Corretora", null, null, null, 2212.8],
  [null, "28/09/2026 23:59", null, null, null, null, "Saldo Diário", null, null, null, 2292.8],
  [null, "Extrato de conta corrente", null, null, null, null, null, null, null, 46313.79],
  [null, "Data e hora", "Categoria", "Transação", null, null, "Descrição", null, null, null, "Valor"],
  [null, "29/09/2026 11:05", "Transporte", "Pix enviado", null, null, "Uber", null, null, null, -7.13],
  [null, "29/09/2026 20:30", "Alimentação", "Pix enviado", null, null, "Sorveteria", null, null, null, 0.1 + 0.2 - 0.3 - 211.21],
  [null, "29/09/2026 23:59", null, null, null, null, "Saldo Diário", null, null, null, 2074.46],
  [],
  [null, null, null, null, null, "Ouvidoria: 0800 000 0000"]
];

function workbook(rows: Cell[][], bookType: "xls" | "xlsx"): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Extrato");
  return XLSX.write(book, { type: "buffer", bookType: bookType === "xls" ? "biff8" : "xlsx" });
}

function transactionsOf(buffer: Buffer) {
  const csv = spreadsheetToCsv(buffer);
  return readCsv(csv, inspectCsv(csv).mapping);
}

describe("looksLikeSpreadsheet", () => {
  it("reconhece .xls e .xlsx pelos bytes, e nao confunde com texto", () => {
    expect(looksLikeSpreadsheet(workbook(BTG_LAYOUT, "xls"))).toBe(true);
    expect(looksLikeSpreadsheet(workbook(BTG_LAYOUT, "xlsx"))).toBe(true);
    expect(looksLikeSpreadsheet(Buffer.from("Data,Valor,Descricao\n"))).toBe(false);
    expect(looksLikeSpreadsheet(Buffer.from("OFXHEADER:100\n"))).toBe(false);
  });
});

describe.each(["xls", "xlsx"] as const)("extrato do BTG em .%s", (bookType) => {
  const buffer = workbook(BTG_LAYOUT, bookType);

  it("pula o cabecalho do relatorio e as colunas vazias das celulas mescladas", () => {
    const shape = inspectCsv(spreadsheetToCsv(buffer));
    expect(shape.header).toEqual(["Data e hora", "Categoria", "Transação", "Descrição", "Valor"]);
    expect(shape.mapping.columns).toEqual({
      "0": "date",
      "1": "ignore",
      "2": "type",
      "3": "description",
      "4": "amount"
    });
    expect(shape.mapping.dateFormat).toBe("dd/MM/yyyy");
  });

  it("le so os lancamentos: sem saldo do dia, sem cabecalho repetido, sem rodape", () => {
    const rows = transactionsOf(buffer);
    expect(rows.map((row) => [row.date, row.amountCents, row.rawDescription])).toEqual([
      ["2026-09-28", 16000, "Fulana; Silva"],
      ["2026-09-28", -8000, "Academia"],
      ["2026-09-28", 221280, "Corretora"],
      ["2026-09-29", -713, "Uber"],
      ["2026-09-29", -21121, "Sorveteria"]
    ]);
    // A soma bate com o saldo que o proprio extrato declara.
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(207446);
    expect(rows[0]!.trnType).toBe("Pix recebido");
  });
});

describe("spreadsheetToCsv", () => {
  it("le data gravada como data do Excel sem deslocar o dia pelo fuso", () => {
    // Serial do Excel direto, com hora: 46053 e 31/01/2026, e 0.9 sao 21h36,
    // a hora em que um deslocamento de fuso jogaria o dia para a frente.
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Data", "Descrição", "Valor"],
      [{ t: "n", v: 46053.9, z: "dd/mm/yyyy hh:mm" }, "Mercado", -12.5]
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Plan1");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const [row] = transactionsOf(buffer);
    expect(row).toMatchObject({ date: "2026-01-31", amountCents: -1250, rawDescription: "Mercado" });
  });

  it("procura a tabela na aba seguinte quando a primeira nao tem", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Resumo"], ["Total", 10]]), "Capa");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(BTG_LAYOUT), "Extrato");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(transactionsOf(buffer)).toHaveLength(5);
  });

  it("recusa planilha sem cabecalho de extrato, dizendo o que falta", () => {
    expect(() => spreadsheetToCsv(workbook([["Nome", "Idade"], ["Ana", 30]], "xlsx"))).toThrow(
      /cabecalho com Data/
    );
  });
});
