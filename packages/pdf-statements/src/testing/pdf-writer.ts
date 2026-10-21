import { createHash } from "node:crypto";

/**
 * Gerador minimo de PDF, so para teste e para montar fixtures sinteticas.
 *
 * Escreve texto em Helvetica nas coordenadas pedidas e, opcionalmente, cifra
 * com senha de usuario (Standard Security Handler, revisao 2, RC4 de 40 bits —
 * o mais simples que o PDF.js abre). Nao e um escritor de PDF de uso geral:
 * existe para que fixture de banco possa ser **gerada** com dado ficticio, em
 * vez de commitar extrato real anonimizado a mao.
 */

export type WriterItem = {
  text: string;
  x: number;
  /** Distancia do topo da pagina, como na camada de texto. */
  yTop: number;
  size?: number;
  bold?: boolean;
  /** `right`: `x` e a borda direita do texto, como valor em extrato. */
  align?: "left" | "right";
};

export type WriterPage = {
  items: WriterItem[];
  /** Pagina sem texto, so com um retangulo desenhado: simula digitalizacao. */
  imageOnly?: boolean;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** Larguras da Helvetica (1/1000 em) para o que aparece em valor monetario. */
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278,
  ",": 278,
  ".": 278,
  "-": 333,
  $: 556,
  R: 722
};

function textWidth(text: string, size: number) {
  let units = 0;
  for (const char of text) units += HELVETICA_WIDTHS[char] ?? 556;
  return (units * size) / 1000;
}

function escapePdfString(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function contentStream(page: WriterPage): Buffer {
  if (page.imageOnly) {
    return Buffer.from("0.8 g 50 400 495 300 re f\n", "latin1");
  }
  const lines = page.items.map((item) => {
    const size = item.size ?? 8;
    const x = item.align === "right" ? item.x - textWidth(item.text, size) : item.x;
    const y = PAGE_HEIGHT - item.yTop;
    return `BT /${item.bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(item.text)}) Tj ET`;
  });
  // WinAnsi cobre os acentos do portugues byte a byte.
  return Buffer.from(`${lines.join("\n")}\n`, "latin1");
}

// RC4 e o Standard Security Handler (PDF 1.7, 7.6.3) -------------------------

const PAD = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex"
);

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[index] = data[index]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function padded(password: string) {
  return Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);
}

function md5(...parts: Buffer[]) {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

type Encryption = { fileKey: Buffer; owner: Buffer; user: Buffer; permissions: number; id: Buffer };

function encryptionFor(password: string): Encryption {
  const id = md5(Buffer.from(`fixture:${password}`));
  const permissions = -44;
  const owner = rc4(md5(padded(`${password}-owner`)).subarray(0, 5), padded(password));
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const fileKey = md5(padded(password), owner, p, id).subarray(0, 5);
  return { fileKey, owner, user: rc4(fileKey, PAD), permissions, id };
}

function objectKey(fileKey: Buffer, objectNumber: number) {
  const suffix = Buffer.from([
    objectNumber & 0xff,
    (objectNumber >> 8) & 0xff,
    (objectNumber >> 16) & 0xff,
    0,
    0
  ]);
  return md5(fileKey, suffix).subarray(0, fileKey.length + 5);
}

// Montagem ---------------------------------------------------------------------

export function writePdf(pages: WriterPage[], options: { password?: string } = {}): Buffer {
  const encryption = options.password ? encryptionFor(options.password) : null;
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objects.length;
  };

  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PLACEHOLDER");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const pageIds: number[] = [];
  for (const page of pages) {
    const contentId = objects.length + 1;
    let stream = contentStream(page);
    if (encryption) stream = rc4(objectKey(encryption.fileKey, contentId), stream);
    add(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("\nendstream", "latin1")
      ])
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    "latin1"
  );

  const encryptId = encryption
    ? add(
        `<< /Filter /Standard /V 1 /R 2 /O <${encryption.owner.toString("hex")}> ` +
          `/U <${encryption.user.toString("hex")}> /P ${encryption.permissions} >>`
      )
    : null;

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1")
    ]);
    chunks.push(chunk);
    length += chunk.length;
  });

  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
  ].join("\n");
  const id = encryption ? encryption.id.toString("hex") : md5(Buffer.concat(objects)).toString("hex");
  const trailer =
    `<< /Size ${objects.length + 1} /Root 1 0 R /ID [<${id}> <${id}>]` +
    (encryptId ? ` /Encrypt ${encryptId} 0 R` : "") +
    " >>";
  chunks.push(Buffer.from(`${xref}\ntrailer\n${trailer}\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
