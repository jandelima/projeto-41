import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { AppDatabase } from "@projeto41/db";
import sharp from "sharp";

/**
 * Fotos de recibo (D29).
 *
 * O original nunca e guardado: entra em streaming num arquivo temporario, e
 * reencodado para WebP com miniatura e some. 5.000 recibos ocupam ~1,15 GB em
 * vez de ~21,6 GB, e o reencode descarta de quebra o EXIF com GPS.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const FULL_SIZE = 1600;
const THUMB_SIZE = 320;
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export class AttachmentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AttachmentError";
    this.statusCode = statusCode;
  }
}

export type StoredAttachment = {
  id: number;
  entryId: number;
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  createdAt: string;
};

export type AttachmentService = ReturnType<typeof createAttachmentService>;

export function createAttachmentService({
  db,
  attachmentDir
}: {
  db: AppDatabase;
  attachmentDir: string;
}) {
  const root = resolve(attachmentDir);

  /**
   * Fanout de dois niveis pelo hash. Um diretorio plano com dezenas de milhares
   * de arquivos degrada NTFS, o Explorer e o antivirus.
   */
  function pathsFor(hash: string) {
    const relativeDir = join(hash.slice(0, 2), hash.slice(2, 4));
    return {
      relativeDir,
      full: join(relativeDir, `${hash}.webp`),
      thumb: join(relativeDir, `${hash}_thumb.webp`)
    };
  }

  /** Resolve sempre a partir do banco e confere o prefixo: caminho nunca vem da URL. */
  function absolute(relativePath: string) {
    const target = resolve(root, relativePath);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new AttachmentError("Caminho de anexo invalido", 400);
    }
    return target;
  }

  async function detectMime(filePath: string): Promise<string | undefined> {
    // `file-type` e ESM puro; o import dinamico evita prender o resto do bundle.
    const { fileTypeFromFile } = await import("file-type");
    const detected = await fileTypeFromFile(filePath);
    return detected?.mime;
  }

  /**
   * Recebe o stream do upload, valida, reencoda e grava enderecado por conteudo.
   *
   * O arquivo temporario e sempre removido no `finally`, inclusive quando o
   * upload e truncado por exceder o limite (R-06).
   */
  async function store({
    entryId,
    stream,
    originalName,
    isTruncated
  }: {
    entryId: number;
    stream: NodeJS.ReadableStream;
    originalName?: string | null;
    isTruncated: () => boolean;
  }): Promise<StoredAttachment> {
    const temporary = join(tmpdir(), `projeto41-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      await pipeline(stream, createWriteStream(temporary));
      if (isTruncated()) {
        throw new AttachmentError("Foto maior que o limite de 15 MB", 413);
      }

      const info = await stat(temporary);
      if (info.size === 0) throw new AttachmentError("Arquivo vazio");
      if (info.size > MAX_BYTES) throw new AttachmentError("Foto maior que o limite de 15 MB", 413);

      // Magic bytes primeiro; a validacao definitiva e o proprio reencode.
      const mime = await detectMime(temporary);
      if (!mime || !ACCEPTED_MIME.has(mime)) {
        throw new AttachmentError("Formato de imagem nao suportado");
      }

      // autoOrient ANTES do resize: senao a foto de celular sai deitada e
      // redimensionada pelo lado errado.
      const processed = await sharp(temporary)
        .autoOrient()
        .resize(FULL_SIZE, FULL_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });

      const thumb = await sharp(temporary)
        .autoOrient()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer();

      const hash = createHash("sha256").update(processed.data).digest("hex");
      const paths = pathsFor(hash);
      await mkdir(resolve(root, paths.relativeDir), { recursive: true });

      // Mesmo conteudo enviado duas vezes reaproveita o arquivo em disco; so a
      // linha em `attachments` e nova, porque ela pertence a outro lancamento.
      const { writeFile } = await import("node:fs/promises");
      await writeFile(absolute(paths.full), processed.data);
      await writeFile(absolute(paths.thumb), thumb);

      const createdAt = new Date().toISOString();
      const id = Number(
        db.raw
          .prepare(
            `INSERT INTO attachments
             (entry_id, file_path, thumb_path, content_hash, mime, byte_size,
              width, height, original_name, created_at)
             VALUES (@entryId, @filePath, @thumbPath, @contentHash, @mime, @byteSize,
                     @width, @height, @originalName, @createdAt)`
          )
          .run({
            entryId,
            filePath: paths.full,
            thumbPath: paths.thumb,
            contentHash: hash,
            mime: "image/webp",
            byteSize: processed.data.byteLength,
            width: processed.info.width,
            height: processed.info.height,
            // O nome do cliente nunca compoe caminho (`../`, `C:\`, `a.jpg:evil`,
            // `CON`): fica so como rotulo numa coluna.
            originalName: originalName ? originalName.slice(0, 200) : null,
            createdAt
          }).lastInsertRowid
      );

      return {
        id,
        entryId,
        mime: "image/webp",
        byteSize: processed.data.byteLength,
        width: processed.info.width,
        height: processed.info.height,
        originalName: originalName ?? null,
        createdAt
      };
    } catch (error) {
      if (error instanceof AttachmentError) throw error;
      if (error instanceof Error && error.message.includes("unsupported image format")) {
        throw new AttachmentError("Formato de imagem nao suportado");
      }
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  function row(id: number) {
    return db.raw
      .prepare(
        `SELECT id, entry_id AS entryId, file_path AS filePath, thumb_path AS thumbPath,
                content_hash AS contentHash, mime, byte_size AS byteSize, width, height,
                original_name AS originalName, created_at AS createdAt
         FROM attachments WHERE id = ?`
      )
      .get(id) as
      | {
          id: number;
          entryId: number;
          filePath: string;
          thumbPath: string;
          contentHash: string;
          mime: string;
          byteSize: number;
          width: number | null;
          height: number | null;
          originalName: string | null;
          createdAt: string;
        }
      | undefined;
  }

  return {
    store,
    get: row,

    listForEntry: (entryId: number): StoredAttachment[] =>
      db.raw
        .prepare(
          `SELECT id, entry_id AS entryId, mime, byte_size AS byteSize, width, height,
                  original_name AS originalName, created_at AS createdAt
           FROM attachments WHERE entry_id = ? ORDER BY id`
        )
        .all(entryId) as StoredAttachment[],

    /** Abre o arquivo pelo caminho gravado no banco, nunca por um vindo da URL. */
    openStream: (id: number, variant: "full" | "thumb") => {
      const record = row(id);
      if (!record) return undefined;
      const relativePath = variant === "thumb" ? record.thumbPath : record.filePath;
      return { stream: createReadStream(absolute(relativePath)), mime: record.mime };
    },

    /**
     * Remove a linha e, so quando nenhuma outra apontar para o mesmo hash,
     * tambem os arquivos. Dois lancamentos podem compartilhar a mesma foto.
     */
    remove: async (id: number): Promise<boolean> => {
      const record = row(id);
      if (!record) return false;
      db.raw.prepare("DELETE FROM attachments WHERE id = ?").run(id);

      const remaining = (
        db.raw
          .prepare("SELECT COUNT(*) AS n FROM attachments WHERE content_hash = ?")
          .get(record.contentHash) as { n: number }
      ).n;
      if (remaining === 0) {
        await unlink(absolute(record.filePath)).catch(() => {});
        await unlink(absolute(record.thumbPath)).catch(() => {});
      }
      return true;
    },

    maxBytes: MAX_BYTES
  };
}
