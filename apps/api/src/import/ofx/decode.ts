/**
 * Decodificacao dos bytes do arquivo do banco.
 *
 * O cabecalho do OFX 1.x costuma declarar `ENCODING:USASCII` com
 * `CHARSET:1252`, mas os bytes sao cp1252 de verdade. Sem honrar isso, todo
 * nome acentuado de estabelecimento vira lixo — e o nome do estabelecimento e
 * justamente a chave do mapeamento de destinatario.
 *
 * `TextDecoder('windows-1252')` vem embutido no Node; nenhuma dependencia nova.
 */

const BOM = [0xef, 0xbb, 0xbf];

export type Encoding = "utf-8" | "windows-1252";

function hasUtf8Bom(buffer: Buffer) {
  return BOM.every((byte, index) => buffer[index] === byte);
}

/** Decodifica em UTF-8 estrito; devolve `null` quando os bytes nao sao UTF-8. */
function tryStrictUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Le a codificacao declarada no cabecalho do OFX 1.x.
 *
 * O cabecalho e ASCII puro, entao interpreta-lo como latin1 e sempre seguro,
 * mesmo quando o corpo do arquivo nao e.
 */
export function declaredEncoding(buffer: Buffer): Encoding | null {
  const header = buffer.subarray(0, 512).toString("latin1").toUpperCase();
  if (/CHARSET\s*[:=]\s*"?(1252|WINDOWS-1252|CP1252)/.test(header)) return "windows-1252";
  if (/ENCODING\s*[:=]\s*"?UTF-8/.test(header)) return "utf-8";
  // `ENCODING:USASCII` sozinho nao decide: o corpo ainda pode trazer acento em
  // cp1252. Quem decide nesse caso e o teste de validade UTF-8 abaixo.
  return null;
}

/**
 * Bytes -> texto, escolhendo a codificacao pela ordem: BOM, cabecalho, e por
 * fim o teste de validade UTF-8. Texto cp1252 quase nunca forma sequencia
 * UTF-8 valida, entao o ultimo degrau acerta na pratica.
 */
export function decodeStatement(buffer: Buffer): { text: string; encoding: Encoding } {
  if (hasUtf8Bom(buffer)) {
    return { text: buffer.subarray(BOM.length).toString("utf8"), encoding: "utf-8" };
  }

  const declared = declaredEncoding(buffer);
  if (declared === "windows-1252") {
    return { text: new TextDecoder("windows-1252").decode(buffer), encoding: "windows-1252" };
  }

  const strict = tryStrictUtf8(buffer);
  if (strict !== null) return { text: strict, encoding: "utf-8" };

  return { text: new TextDecoder("windows-1252").decode(buffer), encoding: "windows-1252" };
}
