import { parseSync } from "ofx-js";
import type { OfxStatement, ParsedTransaction } from "@projeto41/contracts";
import { decodeStatement } from "./decode.js";
import { parseCounterparty } from "../payee.js";

/**
 * Leitor de OFX brasileiro.
 *
 * **Os bancos brasileiros entregam OFX 1.x, que e SGML, nao XML.** As tags de
 * folha vem sem fechamento — `<TRNAMT>-123.45` e nada de `</TRNAMT>` —, entao
 * um parser XML generico falha. O `fast-xml-parser` ja esta nas dependencias
 * de `apps/api`, usado pelo leitor de xlsx, e e justamente o que nao pode ser
 * usado aqui.
 *
 * Nenhum detalhe do `ofx-js` escapa deste arquivo: trocar de biblioteca depois
 * nao pode respingar no resto do codigo.
 */

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : null;
}

function text(node: Node | null, key: string): string | null {
  if (!node) return null;
  const value = node[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Um envelope com uma unica transacao vem como objeto, nao como lista. */
function asList(value: unknown): Node[] {
  if (Array.isArray(value)) return value.filter((item): item is Node => asNode(item) !== null);
  const node = asNode(value);
  return node ? [node] : [];
}

/**
 * `-1234.56` -> `-123456`, sem passar por float.
 *
 * `parseFloat(x) * 100` erra em valores como `1.005` e e exatamente o tipo de
 * erro que corrompe hash de deduplicacao: a linha entra duas vezes porque o
 * centavo mudou.
 */
export function centsFromOfxAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  const match = /^([-+]?)(\d*)(?:\.(\d+))?$/.exec(cleaned);
  if (!match || (match[2] === "" && match[3] === undefined)) {
    throw new Error(`Valor invalido no OFX: "${raw}"`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] === "" ? "0" : match[2];
  const rawFraction = match[3] ?? "";
  // Duas casas exatas. Mais que isso o OFX permite, e arredondar meio-para-cima
  // no valor absoluto mantem a simetria que `toCents` ja garante no resto.
  const fraction = `${rawFraction}000`.slice(0, 3);
  const base = Number(`${whole}${fraction.slice(0, 2)}`);
  const carry = Number(fraction[2]) >= 5 ? 1 : 0;
  return sign * (base + carry);
}

/**
 * `20260901000000[-3:BRT]` -> `{ date: '2026-09-01', time: '00:00' }`.
 *
 * Lido por fatia de string, nunca por `new Date(...)`: converter para UTC
 * mudaria o dia de toda compra feita a noite, e o extrato fala da data local
 * que o banco imprimiu.
 */
export function parseOfxDate(raw: string): { date: string; time?: string } {
  const digits = raw.trim().replace(/\[.*$/, "");
  if (!/^\d{8}/.test(digits)) {
    throw new Error(`Data invalida no OFX: "${raw}"`);
  }
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (digits.length < 12) return { date };
  return { date, time: `${digits.slice(8, 10)}:${digits.slice(10, 12)}` };
}

/** `MEMO` e `NAME` juntos quando os dois existem e dizem coisas diferentes. */
function describe(node: Node): string {
  const memo = text(node, "MEMO");
  const name = text(node, "NAME");
  if (memo && name && memo !== name) return `${name} - ${memo}`;
  return memo ?? name ?? "";
}

function readTransaction(node: Node, lineNo: number): ParsedTransaction {
  const amount = text(node, "TRNAMT");
  const posted = text(node, "DTPOSTED");
  if (amount === null) throw new Error(`Transacao ${lineNo} do OFX sem TRNAMT.`);
  if (posted === null) throw new Error(`Transacao ${lineNo} do OFX sem DTPOSTED.`);

  const { date, time } = parseOfxDate(posted);
  const rawDescription = describe(node);
  const externalId = text(node, "FITID");
  const trnType = text(node, "TRNTYPE");
  const checkNum = text(node, "CHECKNUM");
  const counterparty = parseCounterparty(rawDescription);
  // Toda tag de folha da transacao, como veio: e o registro do que o banco
  // mandou, antes de qualquer interpretacao.
  const source = Object.fromEntries(
    Object.entries(node).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );

  return {
    lineNo,
    date,
    source,
    ...(time ? { time } : {}),
    amountCents: centsFromOfxAmount(amount),
    rawDescription,
    ...(externalId ? { externalId } : {}),
    ...(trnType ? { trnType } : {}),
    ...(checkNum ? { checkNum } : {}),
    ...(counterparty ? { counterparty } : {})
  };
}

/** O primeiro `STMTRS`/`CCSTMTRS` do arquivo, com o envelope de onde ele veio. */
function locateStatement(root: Node): { node: Node; envelope: "bank" | "credit_card" } {
  const bank = asNode(root.BANKMSGSRSV1);
  const bankStatement = asList(asNode(bank?.STMTTRNRS)?.STMTRS)[0];
  if (bankStatement) return { node: bankStatement, envelope: "bank" };

  const card = asNode(root.CREDITCARDMSGSRSV1);
  const cardStatement = asList(asNode(card?.CCSTMTTRNRS)?.CCSTMTRS)[0];
  if (cardStatement) return { node: cardStatement, envelope: "credit_card" };

  throw new Error(
    "OFX sem extrato: nenhum STMTRS nem CCSTMTRS. O arquivo pode estar " +
      "truncado ou nao ser um extrato."
  );
}

export function readOfx(buffer: Buffer): OfxStatement {
  const { text: content } = decodeStatement(buffer);
  if (!/<OFX>/i.test(content)) {
    throw new Error("Arquivo nao parece um OFX: nao ha tag <OFX>.");
  }

  let parsed;
  try {
    parsed = parseSync(content);
  } catch (error) {
    throw new Error(
      `Nao foi possivel ler o OFX: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const root = asNode(parsed.OFX);
  if (!root) throw new Error("OFX sem corpo: a tag <OFX> esta vazia ou truncada.");

  const { node: statement, envelope } = locateStatement(root);

  const currency = text(statement, "CURDEF") ?? "BRL";
  if (currency !== "BRL") {
    throw new Error(
      `Extrato em ${currency}. O modulo de financas trabalha em reais (D19); ` +
        "importe um arquivo em BRL."
    );
  }

  const account = asNode(statement.BANKACCTFROM) ?? asNode(statement.CCACCTFROM);
  const institution = text(asNode(asNode(asNode(root.SIGNONMSGSRSV1)?.SONRS)?.FI), "ORG");

  const list = asNode(statement.BANKTRANLIST);
  // Extrato de periodo sem movimento e normal: lista vazia, nunca erro.
  const transactions = asList(list?.STMTTRN).map((node, index) => readTransaction(node, index + 1));

  const start = text(list, "DTSTART");
  const end = text(list, "DTEND");
  const balance = asNode(statement.LEDGERBAL);
  const balanceAmount = text(balance, "BALAMT");

  return {
    envelope,
    currency,
    accountId: text(account, "ACCTID"),
    bankId: text(account, "BANKID"),
    branchId: text(account, "BRANCHID"),
    accountType: text(account, "ACCTTYPE"),
    institution,
    periodStart: start ? parseOfxDate(start).date : null,
    periodEnd: end ? parseOfxDate(end).date : null,
    closingBalanceCents: balanceAmount === null ? null : centsFromOfxAmount(balanceAmount),
    transactions
  };
}
