import type { ParsedTransaction, RuleMode } from "@projeto41/contracts";
import { normalizeName } from "@projeto41/finance";
import { parseCounterparty, payeeKey } from "./payee.js";

/**
 * Regra de destinatario: "o que fazer com as linhas deste destinatario".
 *
 * Mora nas tabelas genericas de `rules` (estagio `default`) com uma forma fixa:
 *
 * - condicao de chave: `document equals <digitos>` quando o banco mostra o
 *   CNPJ/CPF inteiro, senao `description equals <nome normalizado>`;
 * - condicao de sentido: `amount_cents amount_between ..-1` (saida) ou `1..`
 *   (entrada). Mandar dinheiro para a Paula e receber da Paula sao coisas
 *   diferentes, e uma categoria de saida nao serve para uma entrada;
 * - acoes: `set_place`, `set_category`, `set_description`, `set_person`, ou so
 *   `ignore`.
 *
 * Regra que nao tem essa forma (as de estagio `pre` semeadas pela 007, ou uma
 * que o usuario escrever na futura tela de regras) e ignorada aqui.
 */

export type Direction = "out" | "in";

export type PayeeRule = {
  id: number;
  mode: RuleMode;
  key: string;
  direction: Direction;
  ignore: boolean;
  placeId: number | null;
  categoryId: number | null;
  description: string | null;
  personId: number | null;
};

export type PayeeIdentity = {
  key: string;
  display: string;
  document: string | null;
};

export const directionOf = (amountCents: number): Direction => (amountCents < 0 ? "out" : "in");

const DIRECTION_RANGE: Record<Direction, string> = { out: "..-1", in: "1.." };

const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "em", "na", "no"]);

/**
 * `FARMACIA CENTRAL` -> `Farmacia Central`. So mexe no que veio todo em
 * maiusculo: `Zelia Almeida` ja chega como a pessoa escreveu o proprio nome.
 */
export function titleCasePtBr(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && LOWER_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/** Quem esta do outro lado da linha, na chave que as regras usam. */
/** Sufixo de parcela da fatura do Nubank: `Loja - Parcela 2/4`. */
const INSTALLMENT_SUFFIX = /\s*-\s*Parcela\s+(\d{1,2})\/(\d{1,2})\s*$/i;

/** `Loja - Parcela 2/4` -> `{ 2, 4 }`; `null` quando nao e parcela. */
export function installmentOf(rawDescription: string): { number: number; total: number } | null {
  const match = INSTALLMENT_SUFFIX.exec(rawDescription);
  if (!match) return null;
  const number = Number(match[1]);
  const total = Number(match[2]);
  return number >= 1 && number <= total ? { number, total } : null;
}

/**
 * O nome do estabelecimento como a fatura imprime, sem o que muda de uma
 * cobranca para outra: o sufixo de parcela (senao cada parcela seria um
 * destinatario diferente e a regra nunca se repetiria) e o numero longo que
 * alguns adquirentes colam no fim (`Dental Go0000675328`).
 */
export function merchantOf(rawDescription: string): string {
  return rawDescription
    .replace(INSTALLMENT_SUFFIX, "")
    .replace(/\d{5,}\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function payeeOf(parsed: ParsedTransaction): PayeeIdentity {
  const counterparty = parsed.counterparty ?? parseCounterparty(parsed.rawDescription);
  if (counterparty?.name || counterparty?.document) {
    const key = payeeKey(counterparty, parsed.rawDescription);
    const display = counterparty.name
      ? titleCasePtBr(counterparty.name)
      : parsed.rawDescription.trim();
    return { key, display, document: counterparty.document ?? null };
  }
  // Sem contraparte (fatura do cartao, "Debito em conta"): o texto e o
  // destinatario, limpo do que varia entre cobrancas.
  const merchant = merchantOf(parsed.rawDescription) || parsed.rawDescription.trim();
  return { key: `raw:${normalizeName(merchant)}`, display: merchant, document: null };
}

/** O canal do Nubank diz a forma de pagamento; o resto fica em branco. */
export function paymentMethodOf(rawDescription: string): "pix" | "debit" | null {
  if (/pelo pix/i.test(rawDescription)) return "pix";
  if (/^compra no d[eé]bito/i.test(rawDescription)) return "debit";
  return null;
}

/** Condicoes gravadas para uma chave de destinatario e um sentido. */
export function conditionsFor(key: string, direction: Direction) {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  return [
    kind === "doc"
      ? { field: "document" as const, op: "equals" as const, value }
      : { field: "description" as const, op: "equals" as const, value },
    { field: "amount_cents" as const, op: "amount_between" as const, value: DIRECTION_RANGE[direction] }
  ];
}

type StoredRule = {
  id: number;
  mode: RuleMode;
  active: boolean;
  conditions: { field: string; op: string; value: string }[];
  actions: { action: string; value: string | null }[];
};

/**
 * Le uma regra das tabelas e devolve a forma de destinatario, ou `null` se ela
 * nao tiver essa forma.
 */
export function toPayeeRule(stored: StoredRule): PayeeRule | null {
  if (!stored.active || stored.conditions.length !== 2) return null;
  const keyCondition = stored.conditions.find((c) => c.op === "equals");
  const rangeCondition = stored.conditions.find((c) => c.op === "amount_between");
  if (!keyCondition || !rangeCondition) return null;

  let key: string;
  if (keyCondition.field === "document") key = `doc:${keyCondition.value}`;
  else if (keyCondition.field === "description") {
    // `name:` e `raw:` gravam a mesma coisa: o texto normalizado. A chave de
    // comparacao sai de `matchKeyOf`, que tambem tira o prefixo.
    key = `text:${keyCondition.value}`;
  } else return null;

  const direction = (Object.keys(DIRECTION_RANGE) as Direction[]).find(
    (candidate) => DIRECTION_RANGE[candidate] === rangeCondition.value
  );
  if (!direction) return null;

  const numberOf = (action: string) => {
    const raw = stored.actions.find((item) => item.action === action)?.value;
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };
  return {
    id: stored.id,
    mode: stored.mode,
    key,
    direction,
    ignore: stored.actions.some((item) => item.action === "ignore"),
    placeId: numberOf("set_place"),
    categoryId: numberOf("set_category"),
    description: stored.actions.find((item) => item.action === "set_description")?.value ?? null,
    personId: numberOf("set_person")
  };
}

/** `name:x` e `raw:x` comparam pelo texto; documento compara pelos digitos. */
function matchKeyOf(key: string): string {
  if (key.startsWith("doc:")) return key;
  return `text:${normalizeName(key.replace(/^(name|raw|text):/, ""))}`;
}

/** A regra que vale para esta linha, ou `null`. Empate: a mais nova vence. */
export function findPayeeRule(
  rules: PayeeRule[],
  payee: PayeeIdentity,
  amountCents: number
): PayeeRule | null {
  const direction = directionOf(amountCents);
  const wanted = matchKeyOf(payee.key);
  const hits = rules.filter(
    (rule) => rule.direction === direction && matchKeyOf(rule.key) === wanted
  );
  return hits.sort((a, b) => b.id - a.id)[0] ?? null;
}
