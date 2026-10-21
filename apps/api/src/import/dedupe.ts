import { createHash } from "node:crypto";
import type { MatchReason } from "@projeto41/contracts";
import { normalizeName } from "@projeto41/finance";

/**
 * Reconhecimento do que a linha do arquivo ja tem no livro (secao 6.7), como
 * funcao pura sobre memoria.
 *
 * Nao confundir com a tabela `imports` (fingerprint de arquivo inteiro), que
 * serve ao importador da planilha e nao tem nada a ver com isto.
 *
 * Dois degraus:
 *
 * 1. **Exato** — id do banco ou hash de conteudo. E certeza: a linha ja passou
 *    por uma importacao, e o sistema nao pergunta de novo.
 * 2. **Provavel** — lancamento digitado a mao (ou vindo da planilha) que o
 *    arquivo repete. Vale a pontuacao de `scoreCandidate`: valor, dia e o nome
 *    do outro lado. O sistema **nunca** vincula sozinho: marca o par e o
 *    usuario decide, vendo os dois lados.
 */

/**
 * Hash de conteudo: so o que o arquivo traz e nunca muda.
 *
 * **Nunca** incluir id resolvido de local, categoria ou pessoa. E o bug #4124
 * do Firefly III: o hash carregava um id que ainda nao existia na primeira
 * importacao, e a mesma linha entrava duas vezes.
 */
export function contentHash(
  accountId: number,
  date: string,
  amountCents: number,
  rawDescription: string
): string {
  return createHash("sha256")
    .update(`${accountId}|${date}|${amountCents}|${normalizeName(rawDescription)}`)
    .digest("hex");
}

export type MatchConfidence = "certain" | "likely" | "possible";

export type DedupeRow = {
  key: number;
  date: string;
  amountCents: number;
  externalId: string | null;
  contentHash: string;
  /** O outro lado da linha (destinatario ou estabelecimento), para comparar nomes. */
  text?: string;
  /** `Parcela 2/4` da fatura. */
  installment?: { number: number; total: number } | null;
};

export type DedupeCandidate = {
  id: number;
  date: string;
  amountCents: number;
  externalId: string | null;
  contentHash: string | null;
  /** Descricao, local e descritor do lancamento: o que se compara com `DedupeRow.text`. */
  text?: string;
  /** Ja ligado a uma linha importada: so serve aos degraus exatos. */
  linked?: boolean;
  /** Numero da parcela, quando o lancamento e parcela de um plano. */
  installmentNumber?: number | null;
};

export type DedupeMatch = {
  entryId: number;
  reason: MatchReason;
  confidence: MatchConfidence;
  score: number;
  dayDistance: number;
  textMatch: number;
};

/**
 * Quantos dias de diferenca ainda contam como "o mesmo lancamento": quem
 * digita a mao erra o dia, e o Pix de hoje cai amanha no outro banco. Parcela
 * prevista tem uma janela maior, porque o dia dela vem do plano e nao da compra.
 */
export const MATCH_WINDOW_DAYS = 3;
export const INSTALLMENT_WINDOW_DAYS = 7;

/** Nota minima para o par aparecer: valor igual e no maximo tres dias de distancia. */
export const MIN_SCORE = 68;

const SCORE_AMOUNT_EXACT = 60;
const SCORE_AMOUNT_NEAR = 30;
const SCORE_DAY = [30, 22, 14, 8, 4, 4, 4, 4];
const SCORE_TEXT_MAX = 25;
const SCORE_INSTALLMENT = 10;

function dayDistance(a: string, b: string): number {
  return Math.round(
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
  );
}

/** Palavras que aparecem em qualquer descritor do banco e nao dizem quem e. */
const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "com", "para", "pelo", "pela", "via",
  "pix", "ltda", "sa", "eireli", "mei", "me", "epp", "cia",
  "transferencia", "enviada", "enviado", "recebida", "recebido", "compra", "debito",
  "credito", "pagamento", "parcela", "conta", "agencia", "nupay", "nu", "ip",
  "banco", "bco", "brasil", "aproximacao"
]);

function tokensOf(text: string): string[] {
  return normalizeName(text)
    .split(" ")
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
}

/**
 * Quanto do nome da linha aparece no texto do lancamento, de 0 a 1.
 * Casa palavra inteira ou o comeco dela ("cantalice" em "cantalices").
 */
export function textSimilarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  const left = tokensOf(a);
  const right = tokensOf(b);
  if (left.length === 0 || right.length === 0) return 0;
  const hits = left.filter((token) =>
    right.some(
      (other) =>
        other === token ||
        (token.length >= 4 && other.length >= 4 && (token.startsWith(other) || other.startsWith(token)))
    )
  ).length;
  return hits / Math.min(left.length, right.length);
}

/** Valor "quase igual": ate R$ 1,00 ou 2%, o que for maior (arredondamento da parcela, gorjeta). */
function nearAmount(a: number, b: number): boolean {
  if (Math.sign(a) !== Math.sign(b)) return false;
  return Math.abs(a - b) <= Math.max(100, Math.round(Math.abs(a) * 0.02));
}

/**
 * Nota de 0 a ~125 de quanto `candidate` parece ser o mesmo lancamento de `row`.
 * `null` quando nem chega a ser candidato (sinal diferente, longe demais, valor
 * diferente e nome sem relacao).
 */
export function scoreCandidate(row: DedupeRow, candidate: DedupeCandidate): DedupeMatch | null {
  if (Math.sign(row.amountCents) !== Math.sign(candidate.amountCents)) return null;
  const days = dayDistance(candidate.date, row.date);
  const isInstallment = candidate.installmentNumber != null || row.installment != null;
  const window = isInstallment ? INSTALLMENT_WINDOW_DAYS : MATCH_WINDOW_DAYS;
  if (days > window) return null;
  // Dois ids do banco diferentes sao prova de transacoes diferentes.
  if (row.externalId && candidate.externalId && row.externalId !== candidate.externalId) return null;

  const text = textSimilarity(row.text, candidate.text);
  const sameInstallment =
    row.installment != null &&
    candidate.installmentNumber != null &&
    row.installment.number === candidate.installmentNumber;

  let score: number;
  if (row.amountCents === candidate.amountCents) {
    score = SCORE_AMOUNT_EXACT;
  } else if (nearAmount(row.amountCents, candidate.amountCents) && (text >= 0.5 || sameInstallment)) {
    score = SCORE_AMOUNT_NEAR;
  } else {
    return null;
  }
  score += SCORE_DAY[Math.min(days, SCORE_DAY.length - 1)]! + Math.round(SCORE_TEXT_MAX * text);
  if (sameInstallment) score += SCORE_INSTALLMENT;
  if (score < MIN_SCORE) return null;

  const likely = score >= 90 || (score >= 80 && text >= 0.4);
  return {
    entryId: candidate.id,
    reason: "fuzzy_amount_date",
    confidence: likely ? "likely" : "possible",
    score,
    dayDistance: days,
    textMatch: text
  };
}

/** Os candidatos de uma linha, do mais parecido para o menos. Sem exclusividade. */
export function rankCandidates(
  row: DedupeRow,
  candidates: DedupeCandidate[],
  exclude: ReadonlySet<number> = new Set()
): DedupeMatch[] {
  const ranked: DedupeMatch[] = [];
  for (const candidate of candidates) {
    if (candidate.linked || exclude.has(candidate.id)) continue;
    const match = scoreCandidate(row, candidate);
    if (match) ranked.push(match);
  }
  return ranked.sort(
    (a, b) => b.score - a.score || a.dayDistance - b.dayDistance || a.entryId - b.entryId
  );
}

/**
 * Pareia as linhas com um lancamento cada, do par mais certo para o menos, e
 * nao na ordem do arquivo: a linha que tem um par exato nao perde o dela para o
 * "mais ou menos" de outra.
 *
 * - Contagem por multiconjunto: cada lancamento serve de par para uma linha so.
 *   Tres estacionamentos iguais contra um no livro dao uma duplicata e duas
 *   linhas novas.
 * - `exactOnly` para o primeiro degrau, no upload; sem ele, so o provavel (as
 *   linhas ja pareadas por id ou hash ficam fora de `rows`).
 */
export function findDuplicates(
  rows: DedupeRow[],
  candidates: DedupeCandidate[],
  options: { exactOnly?: boolean; fuzzyOnly?: boolean } = {}
): Map<number, DedupeMatch> {
  const result = new Map<number, DedupeMatch>();
  const used = new Set<number>();

  if (!options.fuzzyOnly) {
    const take = (
      row: DedupeRow,
      pick: (candidate: DedupeCandidate) => boolean,
      reason: MatchReason
    ) => {
      const hit = candidates.find((candidate) => !used.has(candidate.id) && pick(candidate));
      if (!hit) return false;
      used.add(hit.id);
      result.set(row.key, {
        entryId: hit.id,
        reason,
        confidence: "certain",
        score: 100,
        dayDistance: dayDistance(hit.date, row.date),
        textMatch: 1
      });
      return true;
    };
    for (const row of rows) {
      if (row.externalId && take(row, (c) => c.externalId === row.externalId, "external_id")) continue;
      take(row, (c) => c.contentHash === row.contentHash, "content_hash");
    }
  }
  if (options.exactOnly) return result;

  const pairs: { row: DedupeRow; match: DedupeMatch }[] = [];
  for (const row of rows) {
    if (result.has(row.key)) continue;
    for (const match of rankCandidates(row, candidates, used)) pairs.push({ row, match });
  }
  pairs.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      a.match.dayDistance - b.match.dayDistance ||
      a.match.entryId - b.match.entryId ||
      a.row.key - b.row.key
  );
  const taken = new Set<number>();
  for (const { row, match } of pairs) {
    if (result.has(row.key) || taken.has(match.entryId)) continue;
    taken.add(match.entryId);
    result.set(row.key, match);
  }
  return result;
}
