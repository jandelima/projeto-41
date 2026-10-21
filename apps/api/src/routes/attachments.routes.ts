import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AttachmentError } from "../attachments/attachment-service.js";
import type { RoutePlugin } from "./index.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

export const registerAttachmentsRoutes: RoutePlugin = (app, { attachmentService, db }) => {
  if (!attachmentService) return;

  app.post("/api/ledger/entries/:id/attachments", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!db.ledger.entries.get(id)) {
      return reply.status(404).send({ error: "Lancamento nao encontrado" });
    }

    // `request.file()` entrega o stream; `toBuffer()` e `attachFieldsToBody`
    // carregariam a imagem inteira na memoria.
    const part = await request.file();
    if (!part) return reply.status(400).send({ error: "Nenhuma foto enviada" });

    try {
      const stored = await attachmentService.store({
        entryId: id,
        stream: part.file,
        originalName: part.filename,
        isTruncated: () => part.file.truncated
      });
      return reply.status(201).send({ attachment: stored, entry: db.ledger.entries.get(id) });
    } catch (error) {
      if (error instanceof AttachmentError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "FST_REQ_FILE_TOO_LARGE"
      ) {
        return reply.status(413).send({ error: "Foto maior que o limite de 15 MB" });
      }
      throw error;
    }
  });

  async function sendImage(id: number, variant: "full" | "thumb", reply: FastifyReply) {
    const opened = attachmentService!.openStream(id, variant);
    if (!opened) return reply.status(404).send({ error: "Anexo nao encontrado" });
    // Content-Type vem do valor armazenado, nunca do cliente; o nome do arquivo
    // e o hash, entao o cache pode ser imutavel.
    reply.header("Content-Type", opened.mime);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(opened.stream);
  }

  app.get("/api/attachments/:id", async (request, reply) =>
    sendImage(idParam.parse(request.params).id, "full", reply)
  );

  app.get("/api/attachments/:id/thumb", async (request, reply) =>
    sendImage(idParam.parse(request.params).id, "thumb", reply)
  );

  app.delete("/api/attachments/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const removed = await attachmentService.remove(id);
    if (!removed) return reply.status(404).send({ error: "Anexo nao encontrado" });
    return { ok: true };
  });
};
