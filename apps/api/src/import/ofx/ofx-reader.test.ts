import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { centsFromOfxAmount, parseOfxDate, readOfx } from "./ofx-reader.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../__fixtures__/ofx/${name}`, import.meta.url)));

const nubank = () => readOfx(fixture("nubank-conta.ofx"));

describe("centsFromOfxAmount", () => {
  it("converte pela string, sem passar por float", () => {
    expect(centsFromOfxAmount("-1234.56")).toBe(-123456);
    expect(centsFromOfxAmount("0.10")).toBe(10);
    expect(centsFromOfxAmount("16.00")).toBe(1600);
    expect(centsFromOfxAmount("-0.01")).toBe(-1);
    expect(centsFromOfxAmount("200.39")).toBe(20039);
    expect(centsFromOfxAmount("1000")).toBe(100000);
  });

  it("arredonda a terceira casa em vez de trunca-la", () => {
    // `parseFloat('1.005') * 100` da 100.49999999999999 e trunca para 100.
    expect(centsFromOfxAmount("1.005")).toBe(101);
    expect(centsFromOfxAmount("-1.005")).toBe(-101);
    expect(centsFromOfxAmount("1.004")).toBe(100);
  });

  it("recusa valor que nao e numero", () => {
    expect(() => centsFromOfxAmount("abc")).toThrow(/Valor invalido/);
    expect(() => centsFromOfxAmount("")).toThrow(/Valor invalido/);
  });
});

describe("parseOfxDate", () => {
  it("le a data como escrita, sem deslocar o dia pelo fuso", () => {
    // `new Date('20260901000000-03:00')` daria 2026-09-01T03:00Z, e a mesma
    // conta feita as 23h viraria o dia seguinte.
    expect(parseOfxDate("20260901000000[-3:BRT]")).toEqual({
      date: "2026-09-01",
      time: "00:00"
    });
    expect(parseOfxDate("20261231235900[-3:BRT]")).toEqual({
      date: "2026-12-31",
      time: "23:59"
    });
    expect(parseOfxDate("20260901")).toEqual({ date: "2026-09-01" });
  });

  it("recusa data truncada", () => {
    expect(() => parseOfxDate("2026")).toThrow(/Data invalida/);
  });
});

describe("readOfx no extrato do Nubank", () => {
  it("le o envelope de conta corrente e a identificacao da conta", () => {
    const statement = nubank();
    expect(statement.envelope).toBe("bank");
    expect(statement.currency).toBe("BRL");
    expect(statement.bankId).toBe("0260");
    expect(statement.branchId).toBe("1");
    expect(statement.accountId).toBe("12345678-9");
    expect(statement.accountType).toBe("CHECKING");
    expect(statement.institution).toBe("NU PAGAMENTOS S.A.");
  });

  it("nao traz nome nem documento do titular, porque o arquivo nao tem", () => {
    // Este teste existe como documentacao: e por isso que a importacao liga o
    // arquivo a uma conta ja cadastrada em vez de criar pessoa. Nenhuma das
    // tags que o OFX reserva para identificar o titular aparece.
    const raw = fixture("nubank-conta.ofx").toString("utf8");
    const tags = new Set(Array.from(raw.matchAll(/<(\w+)>/g), (match) => match[1]));
    for (const owner of ["USERID", "TAXID", "CPF", "CNPJ", "HOLDERNAME", "USERKEY"]) {
      expect(tags.has(owner)).toBe(false);
    }
  });

  it("le as 58 transacoes com FITID em todas", () => {
    const statement = nubank();
    expect(statement.transactions).toHaveLength(58);
    expect(statement.transactions.every((row) => row.externalId)).toBe(true);
    expect(new Set(statement.transactions.map((row) => row.externalId)).size).toBe(58);
  });

  it("le tag de folha sem fechamento, que e o que quebra parser de XML", () => {
    const first = nubank().transactions[0]!;
    expect(first.amountCents).toBe(-1600);
    expect(first.date).toBe("2026-09-01");
    expect(first.trnType).toBe("DEBIT");
    expect(first.rawDescription).toContain("Transferência enviada pelo Pix");
  });

  it("preserva acentos", () => {
    const statement = nubank();
    expect(
      statement.transactions.some((row) => row.rawDescription.includes("aproximação"))
    ).toBe(true);
  });

  it("le periodo e saldo final", () => {
    const statement = nubank();
    expect(statement.periodStart).toBe("2026-09-01");
    expect(statement.periodEnd).toBe("2026-09-22");
    expect(statement.closingBalanceCents).toBe(46266);
  });

  it("fecha a soma do periodo em centavos inteiros", () => {
    const total = nubank().transactions.reduce((sum, row) => sum + row.amountCents, 0);
    expect(total).toBe(1961);
  });

  it("extrai a contraparte quando o descritor a traz", () => {
    const joint = nubank().transactions.find((row) =>
      row.rawDescription.includes("CASA CONJUNTA")
    )!;
    expect(joint.counterparty).toMatchObject({
      name: "CASA CONJUNTA",
      document: "11222333000144",
      bankId: "0260",
      branchId: "1",
      accountNumber: "47055705-9"
    });
  });

  it("deixa a contraparte vazia quando o descritor nao tem nenhuma", () => {
    const plain = nubank().transactions.find(
      (row) => row.rawDescription === "Débito em conta"
    )!;
    expect(plain.counterparty).toBeUndefined();
  });
});

describe("readOfx em arquivos problematicos", () => {
  const header = [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:UTF-8",
    "CHARSET:NONE",
    ""
  ].join("\n");

  const envelope = (body: string) =>
    Buffer.from(
      `${header}<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL\n` +
        `<BANKACCTFROM><BANKID>0001<ACCTID>1-1<ACCTTYPE>CHECKING</BANKACCTFROM>\n` +
        `${body}</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`,
      "utf8"
    );

  it("devolve lista vazia quando o periodo nao teve movimento", () => {
    const statement = readOfx(
      envelope("<BANKTRANLIST><DTSTART>20260901<DTEND>20260930</BANKTRANLIST>")
    );
    expect(statement.transactions).toEqual([]);
    expect(statement.periodStart).toBe("2026-09-01");
  });

  it("le um envelope com uma transacao so, que nao vem como lista", () => {
    const statement = readOfx(
      envelope(
        "<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260901000000[-3:BRT]" +
          "<TRNAMT>-10.00<FITID>abc<MEMO>Padaria</STMTTRN></BANKTRANLIST>"
      )
    );
    expect(statement.transactions).toHaveLength(1);
    expect(statement.transactions[0]!.amountCents).toBe(-1000);
  });

  it("recusa extrato que nao esta em reais", () => {
    const usd = Buffer.from(
      `${header}<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD\n` +
        "<BANKTRANLIST></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
      "utf8"
    );
    expect(() => readOfx(usd)).toThrow(/reais/);
  });

  it("recusa arquivo que nao e OFX com mensagem clara", () => {
    expect(() => readOfx(Buffer.from("Data,Valor\n01/09/2026,-16.00", "utf8"))).toThrow(
      /nao parece um OFX/
    );
  });

  it("recusa OFX bem formado mas sem extrato dentro", () => {
    const withoutStatement = Buffer.from(
      `${header}<OFX><SIGNONMSGSRSV1><SONRS><CODE>0</SONRS></SIGNONMSGSRSV1></OFX>`,
      "utf8"
    );
    expect(() => readOfx(withoutStatement)).toThrow(/sem extrato/);
  });

  it("explica em vez de estourar quando o arquivo esta truncado", () => {
    const truncated = Buffer.from(`${header}<OFX><BANKMSGSRSV1><STMTTRNRS>`, "utf8");
    expect(() => readOfx(truncated)).toThrow(/Nao foi possivel ler o OFX/);
  });

  it("reconhece o envelope de cartao de credito", () => {
    const card = Buffer.from(
      `${header}<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL\n` +
        "<CCACCTFROM><ACCTID>5555</CCACCTFROM>\n" +
        "<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260901120000[-3:BRT]" +
        "<TRNAMT>-89.90<FITID>c1<MEMO>Livraria</STMTTRN></BANKTRANLIST>" +
        "</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>",
      "utf8"
    );
    const statement = readOfx(card);
    expect(statement.envelope).toBe("credit_card");
    expect(statement.accountId).toBe("5555");
    expect(statement.transactions[0]!.time).toBe("12:00");
  });
});
