import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ColumnMapping } from "@projeto41/contracts";
import { readOfx } from "../ofx/ofx-reader.js";
import { centsFromCsvAmount, headerMatches, inspectCsv, isoDateFromCsv, readCsv } from "./csv-reader.js";

const fixture = (folder: string, name: string) =>
  readFileSync(fileURLToPath(new URL(`../__fixtures__/${folder}/${name}`, import.meta.url)));

const nubankCsv = () => fixture("csv", "nubank-conta.csv");

/** Monta um CSV em cp1252 de verdade, byte a byte. */
function cp1252(lines: string[]): Buffer {
  const text = lines.join("\n");
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

describe("centsFromCsvAmount", () => {
  it("converte pela string, nas duas convencoes de decimal", () => {
    expect(centsFromCsvAmount("1.234,56", ",")).toBe(123456);
    expect(centsFromCsvAmount("-16.00", ".")).toBe(-1600);
    expect(centsFromCsvAmount("R$ 1.234,56", ",")).toBe(123456);
    expect(centsFromCsvAmount("0,10", ",")).toBe(10);
    expect(centsFromCsvAmount("(12,34)", ",")).toBe(-1234);
    expect(centsFromCsvAmount("1234", ",")).toBe(123400);
  });

  it("devolve nulo no que nao e numero, em vez de inventar zero", () => {
    expect(centsFromCsvAmount("", ",")).toBeNull();
    expect(centsFromCsvAmount("-", ",")).toBeNull();
    expect(centsFromCsvAmount("abc", ",")).toBeNull();
  });
});

describe("isoDateFromCsv", () => {
  it("le os tres formatos", () => {
    expect(isoDateFromCsv("01/09/2026", "dd/MM/yyyy")).toBe("2026-09-01");
    expect(isoDateFromCsv("01/09/26", "dd/MM/yy")).toBe("2026-09-01");
    expect(isoDateFromCsv("2026-09-01", "yyyy-MM-dd")).toBe("2026-09-01");
    expect(isoDateFromCsv("2026-09-01", "dd/MM/yyyy")).toBeNull();
  });
});

describe("inspectCsv no extrato do Nubank", () => {
  it("propoe delimitador, formato e papeis das colunas", () => {
    const shape = inspectCsv(nubankCsv());
    expect(shape.header).toEqual(["Data", "Valor", "Identificador", "Descrição"]);
    expect(shape.mapping.delimiter).toBe(",");
    expect(shape.mapping.encoding).toBe("utf-8");
    expect(shape.mapping.dateFormat).toBe("dd/MM/yyyy");
    expect(shape.mapping.decimalSeparator).toBe(".");
    expect(shape.mapping.signConvention).toBe("signed");
    expect(shape.mapping.columns).toEqual({
      "0": "date",
      "1": "amount",
      "2": "document",
      "3": "description"
    });
  });
});

describe("readCsv no extrato do Nubank", () => {
  const mapping = () => inspectCsv(nubankCsv()).mapping;

  it("le as 58 linhas e fecha a mesma soma do OFX", () => {
    const rows = readCsv(nubankCsv(), mapping());
    expect(rows).toHaveLength(58);
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(1961);
  });

  it("chega exatamente no mesmo resultado que o OFX do mesmo periodo", () => {
    // Os dois arquivos sao o mesmo extrato exportado em formatos diferentes.
    // Se eles divergirem aqui, um dos dois leitores esta errado.
    const fromCsv = readCsv(nubankCsv(), mapping());
    const fromOfx = readOfx(fixture("ofx", "nubank-conta.ofx")).transactions;
    const shape = (row: { date: string; amountCents: number; externalId?: string }) => ({
      date: row.date,
      amountCents: row.amountCents,
      externalId: row.externalId
    });
    expect(fromCsv.map(shape)).toEqual(fromOfx.map(shape));
  });

  it("aproveita a coluna Identificador como external id", () => {
    // E o mesmo UUID do FITID: reimportar o CSV depois do OFX nao duplica nada.
    const rows = readCsv(nubankCsv(), mapping());
    expect(rows.every((row) => row.externalId)).toBe(true);
    expect(new Set(rows.map((row) => row.externalId)).size).toBe(58);
  });

  it("extrai a contraparte do descritor, como no OFX", () => {
    const joint = readCsv(nubankCsv(), mapping()).find((row) =>
      row.rawDescription.includes("CASA CONJUNTA")
    )!;
    expect(joint.counterparty?.document).toBe("11222333000144");
  });
});

describe("readCsv em outros bancos", () => {
  it("descarta o preambulo que o Inter imprime antes do cabecalho", () => {
    const inter = cp1252([
      "Extrato Conta Corrente",
      "Titular: Fulano de Tal",
      "Período: 01/09/2026 a 30/09/2026",
      "Data Lançamento;Descrição;Valor;Saldo",
      "01/09/2026;PADARIA SÃO JOÃO;-12,50;1.000,00",
      "02/09/2026;SALÁRIO;3.500,00;4.500,00",
      ""
    ]);
    const shape = inspectCsv(inter);
    expect(shape.mapping.delimiter).toBe(";");
    expect(shape.mapping.encoding).toBe("windows-1252");
    expect(shape.mapping.skipLines).toBe(3);
    expect(shape.header).toEqual(["Data Lançamento", "Descrição", "Valor", "Saldo"]);
    // A coluna de saldo nao e um lancamento e nao pode virar valor.
    expect(shape.mapping.columns["3"]).toBe("ignore");

    const rows = readCsv(inter, { ...shape.mapping, skipLines: 3 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-09-01",
      amountCents: -1250,
      rawDescription: "PADARIA SÃO JOÃO"
    });
    expect(rows[1]!.amountCents).toBe(350000);
  });

  it("le debito e credito em colunas separadas com os sinais certos", () => {
    const bb = cp1252([
      "Data;Histórico;Débito;Crédito",
      "03/09/2026;COMPRA CARTAO;150,00;",
      "04/09/2026;DEPOSITO;;2.000,00",
      ""
    ]);
    const shape = inspectCsv(bb);
    expect(shape.mapping.signConvention).toBe("split_columns");
    const rows = readCsv(bb, shape.mapping);
    expect(rows[0]!.amountCents).toBe(-15000);
    expect(rows[1]!.amountCents).toBe(200000);
  });

  it("nao usa como external id uma coluna de documento que repete", () => {
    // "Documento" em muito banco e numero de lote ou de cheque, e repete. Usar
    // isso como external id faria o indice unico recusar a importacao inteira,
    // ou pior, engoliria lancamento legitimo como duplicata.
    const repeated = Buffer.from(
      [
        "Data,Documento,Descricao,Valor",
        "01/09/2026,001,PADARIA,-10.00",
        "01/09/2026,001,MERCADO,-20.00",
        ""
      ].join("\n"),
      "utf8"
    );
    const shape = inspectCsv(repeated);
    const rows = readCsv(repeated, { ...shape.mapping, decimalSeparator: "." });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.externalId === undefined)).toBe(true);
  });

  it("inverte o sinal quando o banco escreve debito positivo", () => {
    const file = Buffer.from("Data,Descricao,Valor\n01/09/2026,SAQUE,50.00\n", "utf8");
    const shape = inspectCsv(file);
    const rows = readCsv(file, {
      ...shape.mapping,
      decimalSeparator: ".",
      signConvention: "debit_positive"
    });
    expect(rows[0]!.amountCents).toBe(-5000);
  });

  it("explica qual linha esta errada em vez de gravar valor torto", () => {
    const file = Buffer.from("Data,Descricao,Valor\n28/02/2026,X,abc\n", "utf8");
    const shape = inspectCsv(file);
    expect(() => readCsv(file, shape.mapping)).toThrow(/Linha 1: valor/);
  });

  it("recusa data que nao existe no calendario", () => {
    const file = Buffer.from("Data,Descricao,Valor\n31/02/2026,X,10\n", "utf8");
    const shape = inspectCsv(file);
    expect(() => readCsv(file, shape.mapping)).toThrow(/Linha 1/);
  });

  it("recusa mapeamento sem coluna de data dizendo o que falta", () => {
    const file = Buffer.from("Descricao,Valor\nX,10\n", "utf8");
    const mapping = {
      delimiter: ",",
      encoding: "utf-8",
      skipLines: 0,
      hasHeader: true,
      dateFormat: "dd/MM/yyyy",
      decimalSeparator: ",",
      signConvention: "signed",
      columns: { "0": "description", "1": "amount" }
    } as ColumnMapping;
    expect(() => readCsv(file, mapping)).toThrow(/sem coluna de data/);
  });
});

describe("headerMatches", () => {
  it("derruba o mapeamento salvo quando o banco muda o layout", () => {
    const saved = inspectCsv(nubankCsv()).mapping;
    expect(headerMatches(saved, ["Data", "Valor", "Identificador", "Descrição"])).toBe(true);
    expect(headerMatches(saved, ["Data", "Valor", "Descrição"])).toBe(false);
  });
});
