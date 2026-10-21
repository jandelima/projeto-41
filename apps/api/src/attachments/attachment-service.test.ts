import { mkdtempSync, rmSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttachmentError, createAttachmentService } from "./attachment-service.js";

let db: AppDatabase;
let dir: string;
let service: ReturnType<typeof createAttachmentService>;
let entryId: number;

/** JPEG com EXIF de orientacao 6 (girado 90 graus) — o caso da foto de celular. */
async function rotatedJpeg() {
  return sharp({
    create: { width: 40, height: 20, channels: 3, background: "#336699" }
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

async function plainPng(size = 24) {
  return sharp({ create: { width: size, height: size, channels: 3, background: "#aa3344" } })
    .png()
    .toBuffer();
}

function store(buffer: Buffer, originalName = "foto.jpg", truncated = false) {
  return service.store({
    entryId,
    stream: Readable.from(buffer),
    originalName,
    isTruncated: () => truncated
  });
}

async function countFiles(root: string): Promise<number> {
  let total = 0;
  for (const item of await readdir(root, { withFileTypes: true })) {
    const full = join(root, item.name);
    total += item.isDirectory() ? await countFiles(full) : 1;
  }
  return total;
}

beforeEach(() => {
  db = createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), "projeto41-attachments-"));
  service = createAttachmentService({ db, attachmentDir: dir });

  const personId = db.ledger.people.list()[0]!.id;
  const accountId = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId
  });
  entryId = db.ledger.entries.create({
    accountId,
    date: "2026-03-10",
    amountCents: -1000,
    kind: "expense",
    status: "cleared",
    tagIds: []
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("createAttachmentService", () => {
  it("gera webp e miniatura, descartando o original", async () => {
    const stored = await store(await plainPng(400));
    expect(stored.mime).toBe("image/webp");
    expect(stored.byteSize).toBeGreaterThan(0);

    const full = service.openStream(stored.id, "full");
    const thumb = service.openStream(stored.id, "thumb");
    expect(full?.mime).toBe("image/webp");
    expect(thumb).toBeDefined();
    expect(await countFiles(dir)).toBe(2);
  });

  it("aplica a orientacao do EXIF e nao carrega os metadados adiante", async () => {
    const stored = await store(await rotatedJpeg());
    // Orientacao 6 gira 90 graus: a imagem 40x20 vira 20x40.
    expect(stored.width).toBe(20);
    expect(stored.height).toBe(40);

    const record = service.get(stored.id)!;
    // Lido como buffer: no Windows o sharp mantem o arquivo travado se aberto
    // por caminho, e a limpeza do teste falha com EBUSY.
    const processed = await sharp(await readFile(join(dir, record.filePath))).metadata();
    expect(processed.exif).toBeUndefined();
    expect(processed.orientation).toBeUndefined();
  });

  it("nao passa de 1600px no lado maior", async () => {
    const stored = await store(await plainPng(2400));
    expect(Math.max(stored.width ?? 0, stored.height ?? 0)).toBe(1600);
  });

  it("reaproveita o arquivo quando o mesmo conteudo e enviado duas vezes", async () => {
    const image = await plainPng(120);
    const first = await store(image);
    const second = await store(image);
    expect(second.id).not.toBe(first.id);
    // Duas linhas em `attachments`, mas ainda os mesmos dois arquivos em disco.
    expect(await countFiles(dir)).toBe(2);
    expect(service.listForEntry(entryId)).toHaveLength(2);
  });

  it("rejeita SVG e responde com erro de formato", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    await expect(store(svg, "evil.svg")).rejects.toBeInstanceOf(AttachmentError);
    expect(await countFiles(dir)).toBe(0);
  });

  it("nao deixa lixo em disco quando o upload e truncado", async () => {
    await expect(store(await plainPng(), "grande.jpg", true)).rejects.toMatchObject({
      statusCode: 413
    });
    expect(await countFiles(dir)).toBe(0);
  });

  it("guarda o nome do cliente so como rotulo, nunca como caminho", async () => {
    const stored = await store(await plainPng(), "../../../etc/passwd");
    expect(stored.originalName).toBe("../../../etc/passwd");
    const record = service.get(stored.id)!;
    expect(record.filePath).toMatch(/^[0-9a-f]{2}[\\/][0-9a-f]{2}[\\/][0-9a-f]{64}\.webp$/);
    // Tudo continua dentro do diretorio de anexos.
    await expect(stat(join(dir, record.filePath))).resolves.toBeDefined();
  });

  it("so apaga o arquivo quando nenhuma outra linha usa o mesmo hash", async () => {
    const image = await plainPng(120);
    const first = await store(image);
    const second = await store(image);

    await service.remove(first.id);
    expect(await countFiles(dir)).toBe(2);

    await service.remove(second.id);
    expect(await countFiles(dir)).toBe(0);
  });

  it("some junto com o lancamento apagado", async () => {
    await store(await plainPng());
    db.ledger.entries.remove(entryId);
    expect(service.listForEntry(entryId)).toHaveLength(0);
  });
});
