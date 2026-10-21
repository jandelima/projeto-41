import type { Counterparty } from "@projeto41/contracts";
import { normalizeName } from "@projeto41/finance";

/**
 * Extracao da contraparte a partir do descritor do banco.
 *
 * O arquivo identifica a **conta**, nunca o **dono**: o OFX do Nubank traz
 * `BANKID`/`BRANCHID`/`ACCTID` e nenhum nome ou CPF do titular. Mas o descritor
 * de cada transacao quase sempre diz com **quem** ela foi feita, e e dali que
 * saem as duas coisas de que a fase precisa: a chave do mapeamento
 * destinatario -> local e o reconhecimento de transferencia interna.
 *
 * Forma tipica do Nubank:
 *
 * ```
 * Transferencia enviada pelo Pix - NOME - 12.345.678/0001-90 - BANCO (0260) Agencia: 1 Conta: 12345-6
 * Compra no debito - NOME DO ESTABELECIMENTO
 * Debito em conta
 * ```
 */

const CNPJ = /\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/;
const CPF = /\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/;
/** Raiz de CNPJ que o Nubank imprime antes da razao social. */
const CNPJ_ROOT_PREFIX = /^\d{2}\.\d{3}\.\d{3}\s+/;
const BANK_CODE = /\((\d{3,4})\)/;
const BRANCH = /Ag[eê]ncia:\s*([\w-]+)/i;
const ACCOUNT = /Conta:\s*([\d-]+)/i;

/**
 * Prefixos de canal. O que vem depois do primeiro ` - ` e a contraparte; o
 * proprio prefixo nunca e nome de ninguem.
 */
const CHANNELS = [
  "Transferência enviada pelo Pix",
  "Transferência recebida pelo Pix",
  "Transferência Recebida",
  "Transferência enviada",
  "Compra no débito",
  "Pagamento de boleto efetuado",
  "Depósito recebido",
  "Reembolso recebido"
];

function digits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Documento so conta quando vem inteiro. O banco mascara CPF de pessoa fisica
 * (`***.175.624-**`), e casar por mascara juntaria duas pessoas diferentes que
 * por acaso compartilham seis digitos do meio.
 */
function findDocument(raw: string): string | null {
  const cnpj = CNPJ.exec(raw);
  if (cnpj) return digits(cnpj[0]);
  const cpf = CPF.exec(raw);
  if (cpf) return digits(cpf[0]);
  return null;
}

function findName(raw: string): string | null {
  const channel = CHANNELS.find((prefix) => raw.startsWith(prefix));
  const rest = channel ? raw.slice(channel.length) : raw;
  // A contraparte so existe depois do separador. Sem ele o descritor inteiro e
  // canal — "Debito em conta", "Resgate RDB", "Pix por aproximacao" — e o Pix
  // por aproximacao e o caso que mais engana: comeca com um canal conhecido e
  // mesmo assim nao diz para quem foi.
  if (!rest.startsWith(" - ")) return null;
  const body = rest;
  const parts = body
    .split(" - ")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return null;

  const candidate = parts[0]!.replace(CNPJ_ROOT_PREFIX, "").trim();
  // Um segmento que so tem documento, agencia ou conta nao e nome.
  if (candidate === "" || /^[\d.\-/•]+$/.test(candidate)) return null;
  if (BRANCH.test(candidate) && !channel) return null;
  return candidate.replace(/\s{2,}/g, " ");
}

/** Nome do banco: o que antecede `(codigo)` ou `Agencia:` no ultimo segmento. */
function findBankName(raw: string): string | null {
  const anchor = raw.search(BRANCH);
  if (anchor < 0) return null;
  const before = raw.slice(0, anchor);
  const segment = before.split(" - ").pop()?.trim() ?? "";
  const withoutCode = segment.replace(BANK_CODE, "").trim();
  return withoutCode === "" ? null : withoutCode;
}

export function parseCounterparty(raw: string): Counterparty | null {
  if (!raw || raw.trim() === "") return null;

  const name = findName(raw);
  const document = findDocument(raw);
  const bankId = BANK_CODE.exec(raw)?.[1] ?? null;
  const branchId = BRANCH.exec(raw)?.[1] ?? null;
  const accountNumber = ACCOUNT.exec(raw)?.[1] ?? null;
  const bankName = findBankName(raw);

  // Descritor sem contraparte alguma ("Debito em conta", "Resgate RDB") nao
  // vira uma contraparte vazia: o resto do pipeline distingue "nao ha" de
  // "nao reconheci".
  if (!name && !document && !accountNumber) return null;

  return { name, document, bankId, branchId, accountNumber, bankName };
}

/**
 * Chave canonica de uma conta bancaria: `banco:agencia:conta`, so digitos.
 *
 * E a mesma forma gravada em `account_identities.value`, e e o que faz uma
 * transferencia para a conta conjunta ser reconhecida como movimentacao
 * interna em vez de virar gasto.
 */
export function bankAccountKey(
  bankId: string | null,
  branchId: string | null,
  accountNumber: string | null
): string | null {
  if (!bankId || !accountNumber) return null;
  const bank = digits(bankId).padStart(4, "0");
  // A agencia aparece como "1" num arquivo e "0001" no seguinte; sem tirar os
  // zeros a esquerda a mesma conta conjunta viraria duas identidades.
  const branch = digits(branchId ?? "").replace(/^0+/, "") || "0";
  const account = digits(accountNumber);
  if (account === "") return null;
  return `${bank}:${branch}:${account}`;
}

/** Chave do destinatario para o motor de regras e para `places`. */
export function payeeKey(counterparty: Counterparty | null, rawDescription: string): string {
  if (counterparty?.document) return `doc:${counterparty.document}`;
  if (counterparty?.name) return `name:${normalizeName(counterparty.name)}`;
  return `raw:${normalizeName(rawDescription)}`;
}
