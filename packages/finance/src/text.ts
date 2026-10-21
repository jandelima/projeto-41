/**
 * Normalizacao de texto compartilhada entre o cache de icones, o cadastro de
 * locais e a importacao.
 *
 * "Assai", "assaí" e "ASSAI." precisam colapsar na mesma chave: e ela que evita
 * o mesmo estabelecimento virar tres registros (D06) e e a ponte com o motor de
 * regras da fase 6 (D25).
 */

const DIACRITICS = /[̀-ͯ]/g;

/** Minusculo, sem acento, sem pontuacao, separado por hifen. */
export function slugify(value: string, maxLength = 48): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength);
}

/**
 * Chave de deduplicacao de local: igual ao slug, mas com espaco em vez de hifen
 * e sem corte de tamanho, porque nomes de estabelecimento sao longos.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
