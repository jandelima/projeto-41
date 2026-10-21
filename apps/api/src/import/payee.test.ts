import { describe, expect, it } from "vitest";
import { bankAccountKey, parseCounterparty, payeeKey } from "./payee.js";

describe("parseCounterparty", () => {
  it("le nome, documento, banco, agencia e conta de um Pix enviado", () => {
    expect(
      parseCounterparty(
        "Transferência enviada pelo Pix - PADARIA AURORA - 12.345.678/0001-90 - " +
          "BCO BRADESCO S.A. (0237) Agência: 5785 Conta: 8950-8"
      )
    ).toEqual({
      name: "PADARIA AURORA",
      document: "12345678000190",
      bankId: "0237",
      branchId: "5785",
      accountNumber: "8950-8",
      bankName: "BCO BRADESCO S.A."
    });
  });

  it("descarta a raiz de CNPJ que o Nubank imprime antes da razao social", () => {
    const parsed = parseCounterparty(
      "Transferência enviada pelo Pix - 65.848.948 MERCEARIA BOA VISTA - " +
        "65.848.948/0001-47 - MERCADO PAGO IP LTDA. (0323) Agência: 1 Conta: 319074-8"
    );
    expect(parsed?.name).toBe("MERCEARIA BOA VISTA");
  });

  it("nao aceita CPF mascarado como documento", () => {
    // `***.175.624-**` casaria com qualquer pessoa que compartilhe seis
    // digitos do meio, e casar errado aqui significa lancar na conta de outro.
    const parsed = parseCounterparty(
      "Transferência enviada pelo Pix - Zelia Almeida - •••.175.624-•• - " +
        "STONE IP S.A. (0197) Agência: 1 Conta: 16276764-4"
    );
    expect(parsed?.document).toBeNull();
    expect(parsed?.name).toBe("Zelia Almeida");
    expect(parsed?.accountNumber).toBe("16276764-4");
  });

  it("sobrevive a nome de banco que contem o proprio separador", () => {
    const parsed = parseCounterparty(
      "Transferência enviada pelo Pix - O BILOZAO - 22.871.132/0001-21 - " +
        "CCLA DA PARAÍBA - SICOOB PARAÍBA Agência: 4480 Conta: 4272-2"
    );
    expect(parsed?.name).toBe("O BILOZAO");
    expect(parsed?.bankName).toBe("SICOOB PARAÍBA");
  });

  it("le o estabelecimento de uma compra no debito", () => {
    expect(parseCounterparty("Compra no débito - HW FOOD LTDA")).toMatchObject({
      name: "HW FOOD LTDA",
      document: null,
      accountNumber: null
    });
  });

  it("devolve nulo quando o descritor nao tem contraparte", () => {
    expect(parseCounterparty("Débito em conta")).toBeNull();
    expect(parseCounterparty("Resgate RDB")).toBeNull();
    expect(parseCounterparty("Transferência enviada pelo Pix por aproximação")).toBeNull();
    expect(parseCounterparty("")).toBeNull();
  });

  it("colapsa o espaco extra que o banco deixa em razao social", () => {
    const parsed = parseCounterparty(
      "Transferência enviada pelo Pix - CENTRO DIAGNOSTICO LTDA          - " +
        "41.210.568/0001-14 - ITAÚ UNIBANCO S.A. (0341) Agência: 8497 Conta: 17070-7"
    );
    expect(parsed?.name).toBe("CENTRO DIAGNOSTICO LTDA");
  });
});

describe("bankAccountKey", () => {
  it("normaliza banco, agencia e conta para uma chave so", () => {
    expect(bankAccountKey("0260", "1", "470557059-2")).toBe("0260:1:4705570592");
    // O mesmo banco escrito de tres formas precisa dar a mesma chave, senao a
    // conta conjunta deixa de ser reconhecida quando o banco muda o formato.
    expect(bankAccountKey("260", "0001", "4705570592")).toBe("0260:1:4705570592");
  });

  it("nao inventa chave sem banco ou sem conta", () => {
    expect(bankAccountKey(null, "1", "12345-6")).toBeNull();
    expect(bankAccountKey("0260", "1", null)).toBeNull();
    expect(bankAccountKey("0260", "1", "-")).toBeNull();
  });
});

describe("payeeKey", () => {
  it("prefere o documento, que e estavel, ao nome, que o banco reescreve", () => {
    const withDocument = parseCounterparty(
      "Transferência enviada pelo Pix - Govlite - 60.976.411/0001-49 - " +
        "NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 470557059-2"
    );
    expect(payeeKey(withDocument, "x")).toBe("doc:60976411000149");
  });

  it("cai no nome normalizado e, sem nome, no descritor inteiro", () => {
    expect(payeeKey(parseCounterparty("Compra no débito - AÇAÍ DA PRAÇA"), "x")).toBe(
      "name:acai da praca"
    );
    expect(payeeKey(null, "Débito em conta")).toBe("raw:debito em conta");
  });
});
