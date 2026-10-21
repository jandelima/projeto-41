import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import { withInvestmentAccount, type AppDatabase } from "@projeto41/db";
import { z } from "zod";
import type { IconService } from "./icons/icon-service.js";
import type { AttachmentService } from "./attachments/attachment-service.js";
import type { CdiService } from "./cdi/cdi-service.js";
import {
  registerAttachmentsRoutes,
  registerCardsRoutes,
  registerCdiRoutes,
  registerGoalsRoutes,
  registerInvestmentAccountsRoutes,
  registerInvestmentCashRoutes,
  registerIconsRoutes,
  registerImportExportRoutes,
  registerLedgerReportsRoutes,
  registerLedgerImportRoutes,
  registerLedgerRoutes,
  registerOperationsRoutes,
  registerPortfolioRoutes,
  registerPositionsRoutes,
  registerPricesRoutes,
  type PriceService,
  type RouteDeps
} from "./routes/index.js";

export type { PriceService } from "./routes/index.js";

/**
 * Monta a aplicacao: infraestrutura aqui, rotas nos plugins por recurso.
 *
 * Nenhuma rota vive neste arquivo alem do health check — ele cuida de CORS,
 * parsers, upload, error handler, estaticos e registro dos plugins (D27).
 */
export function buildApp({
  db,
  priceService,
  iconService,
  attachmentService,
  cdiService,
  webRoot,
  databaseFile
}: {
  db: AppDatabase;
  priceService: PriceService;
  iconService?: IconService;
  attachmentService?: AttachmentService;
  cdiService?: CdiService;
  webRoot?: string;
  databaseFile?: string;
}) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: /^http:\/\/127\.0\.0\.1(?::\d+)?$/ });
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });
  // O limite padrao de 1 MiB corta foto de celular silenciosamente (R-06).
  app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  if (webRoot) {
    app.register(staticPlugin, {
      root: webRoot,
      index: ["index.html"]
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Dados invalidos", details: error.flatten() });
    }
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    // Restrição do banco é regra de negócio violada, não falha do servidor:
    // devolve 409 com uma mensagem que diz o que aconteceu.
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return reply.status(409).send({ error: "Ja existe um registro com esses dados" });
    }
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return reply
        .status(409)
        .send({ error: "Registro ligado a outro que nao existe ou ainda esta em uso" });
    }
    if (code === "SQLITE_CONSTRAINT_CHECK" || code === "SQLITE_CONSTRAINT_NOTNULL") {
      return reply.status(400).send({ error: "Dados invalidos para o banco" });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "Erro interno" });
  });

  // Conta do módulo de investimentos escolhida na tela. Ausente ou "all":
  // todas (é o que o patrimônio do módulo de finanças pede). No preHandler,
  // depois do corpo lido, para o escopo valer até o fim do handler.
  app.addHook("preHandler", (request, reply, done) => {
    const header = request.headers["x-investment-account"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (raw == null || raw === "" || raw === "all") {
      withInvestmentAccount(null, done);
      return;
    }
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || !db.investmentAccounts.get(id)) {
      void reply.status(400).send({ error: "Conta de investimento invalida" });
      return;
    }
    withInvestmentAccount(id, done);
  });

  app.get("/api/health", async () => ({ ok: true }));

  const deps: RouteDeps = {
    db,
    priceService,
    iconService,
    attachmentService,
    cdiService,
    databaseFile
  };
  registerIconsRoutes(app, deps);
  registerPortfolioRoutes(app, deps);
  registerOperationsRoutes(app, deps);
  registerPositionsRoutes(app, deps);
  registerPricesRoutes(app, deps);
  registerLedgerRoutes(app, deps);
  registerLedgerReportsRoutes(app, deps);
  registerCardsRoutes(app, deps);
  registerInvestmentCashRoutes(app, deps);
  registerInvestmentAccountsRoutes(app, deps);
  registerCdiRoutes(app, deps);
  registerGoalsRoutes(app, deps);
  registerAttachmentsRoutes(app, deps);
  registerLedgerImportRoutes(app, deps);
  registerImportExportRoutes(app, deps);

  return app;
}
