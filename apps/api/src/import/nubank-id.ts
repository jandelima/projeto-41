/**
 * Hora de uma transacao do Nubank a partir do `Identificador`.
 *
 * O CSV do extrato nao tem coluna de hora, mas a maioria dos identificadores
 * comeca com o instante da transacao: os 8 primeiros hexadecimais sao segundos
 * desde 1970, como num ObjectId (`6a96ea0a-...` e 01/09/2026 12:06). Outros
 * identificadores sao UUID comuns (o do "Pix por aproximacao", por exemplo) e
 * decodificam para uma data sem sentido.
 *
 * Por isso a hora so vale quando a data decodificada **e a mesma** da linha:
 * sem essa prova, nao ha hora — inventar precisao que o arquivo nao tem e pior
 * que nao ter.
 *
 * Horario de Brasilia fixo em UTC-3: o Brasil nao tem horario de verao desde
 * 2019, e o extrato e de conta brasileira.
 */
const BRT_OFFSET_SECONDS = -3 * 3600;

export function timeFromNubankId(externalId: string | null | undefined, date: string): string | null {
  if (!externalId || !/^[0-9a-f]{8}-/i.test(externalId)) return null;
  const seconds = parseInt(externalId.slice(0, 8), 16);
  const local = new Date((seconds + BRT_OFFSET_SECONDS) * 1000).toISOString();
  if (local.slice(0, 10) !== date) return null;
  return local.slice(11, 16);
}
