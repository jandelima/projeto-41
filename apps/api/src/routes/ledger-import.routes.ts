import { statementKindSchema, type StatementKind } from "@projeto41/contracts";
import { looksLikePdf, PdfParseError, type PdfErrorCode } from "@projeto41/pdf-statements";
import { z } from "zod";
import {
  createLedgerImportService,
  STATEMENT_MAX_BYTES
} from "../import/ledger-import-service.js";
import { readPdfStatement, type PdfStatement } from "../import/pdf/pdf-import-service.js";
import type { RoutePlugin } from "./index.js";

/** Senha ausente ou errada e 401, para a interface pedir a senha; o resto e arquivo ruim. */
const PDF_STATUS: Record<PdfErrorCode, number> = {
  pdf_password_required: 401,
  pdf_password_incorrect: 401,
  pdf_scanned: 422,
  pdf_layout_unknown: 422,
  pdf_unreadable: 422,
  pdf_parse_failed: 422
};

const idParam = z.object({ id: z.coerce.number().int().positive() });
const rowParam = idParam.extend({ rowId: z.coerce.number().int().positive() });

/**
 * Importacao de extrato (CSV do Nubank, OFX, Excel, PDF), revisada linha a linha.
 *
 * O arquivo enviado nao e guardado: ficam o nome, o hash e as linhas lidas em
 * `import_rows`. O nome vindo do cliente nunca vira caminho em disco.
 */
export const registerLedgerImportRoutes: RoutePlugin = (app, { db }) => {
  const imports = createLedgerImportService(db);
  const balances = () => db.ledger.balances.consolidated();

  app.get("/api/ledger/imports", async () => imports.list());

  app.post("/api/ledger/imports", async (request, reply) => {
    let accountId: number | null = null;
    let kind: StatementKind | undefined;
    let upload: { fileName: string; buffer: Buffer } | null = null;
    // A senha do PDF vive so nesta requisicao: nao e gravada nem logada.
    let password: string | undefined;

    try {
      for await (const part of request.parts({ limits: { fileSize: STATEMENT_MAX_BYTES } })) {
        if (part.type === "field" && part.fieldname === "accountId") {
          accountId = Number(part.value);
        } else if (part.type === "field" && part.fieldname === "password") {
          password = String(part.value) || undefined;
        } else if (part.type === "field" && part.fieldname === "kind") {
          kind = statementKindSchema.parse(part.value);
        } else if (part.type === "file") {
          const buffer = await part.toBuffer();
          if (part.file.truncated) {
            return reply.status(413).send({ error: "Extrato maior que o limite de 10 MB" });
          }
          upload = { fileName: part.filename || "extrato", buffer };
        }
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({ error: "Extrato maior que o limite de 10 MB" });
      }
      throw error;
    }

    if (!upload) return reply.status(400).send({ error: "Nenhum arquivo enviado" });
    if (!accountId || !Number.isInteger(accountId) || accountId <= 0) {
      return reply.status(400).send({ error: "Escolha a conta do extrato" });
    }
    // Quem decide é o usuário: uma fatura lida como extrato (ou o contrário)
    // grava o dinheiro no lugar errado, e não dá para adivinhar só pela conta.
    if (!kind) {
      return reply
        .status(400)
        .send({ error: "Diga se o arquivo é o extrato da conta ou a fatura do cartão" });
    }
    let pdf: PdfStatement | undefined;
    if (looksLikePdf(upload.buffer)) {
      try {
        pdf = await readPdfStatement(upload.buffer, password ? { password } : {});
      } catch (error) {
        if (error instanceof PdfParseError) {
          return reply.status(PDF_STATUS[error.code]).send({ error: error.message, code: error.code });
        }
        throw error;
      }
    }
    return reply.status(201).send(imports.upload({ accountId, kind, ...upload, ...(pdf ? { pdf } : {}) }));
  });

  app.get("/api/ledger/imports/:id", async (request) => imports.view(idParam.parse(request.params).id));

  app.post("/api/ledger/imports/:id/rows/:rowId/confirm", async (request) => {
    const { id, rowId } = rowParam.parse(request.params);
    const view = imports.confirm(id, rowId, request.body as never);
    return { ...view, balances: balances() };
  });

  app.post("/api/ledger/imports/:id/rows/:rowId/reopen", async (request) => {
    const { id, rowId } = rowParam.parse(request.params);
    return imports.reopen(id, rowId);
  });

  app.post("/api/ledger/imports/:id/commit-ready", async (request) => {
    const view = imports.commitReady(idParam.parse(request.params).id);
    return { ...view, balances: balances() };
  });

  app.post("/api/ledger/imports/:id/discard", async (request) =>
    imports.discard(idParam.parse(request.params).id)
  );
};
