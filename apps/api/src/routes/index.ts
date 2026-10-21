import type { AppDatabase } from "@projeto41/db";
import type { FastifyInstance } from "fastify";
import type { IconService } from "../icons/icon-service.js";
import type { AttachmentService } from "../attachments/attachment-service.js";
import type { CdiService } from "../cdi/cdi-service.js";

export type CryptoSearchHit = { id: string; symbol: string; name: string; rank: number | null };
export type B3SearchHit = { symbol: string; name: string; price: number; currency: string };

export type PriceService = {
  runAll(): Promise<unknown>;
  ensureCryptoPrice?(symbol: string): Promise<boolean>;
  searchCrypto?(query: string): Promise<CryptoSearchHit[]>;
  searchB3?(query: string): Promise<B3SearchHit[]>;
};

/**
 * Tudo que um plugin de rotas pode usar. Passado por parametro em vez de
 * decorado no Fastify para o tipo continuar explicito em cada arquivo.
 */
export type RouteDeps = {
  db: AppDatabase;
  priceService: PriceService;
  iconService?: IconService;
  attachmentService?: AttachmentService;
  cdiService?: CdiService;
  databaseFile?: string;
};

export type RoutePlugin = (app: FastifyInstance, deps: RouteDeps) => void;

export { registerPortfolioRoutes } from "./portfolio.routes.js";
export { registerOperationsRoutes } from "./operations.routes.js";
export { registerPositionsRoutes } from "./positions.routes.js";
export { registerPricesRoutes } from "./prices.routes.js";
export { registerIconsRoutes } from "./icons.routes.js";
export { registerImportExportRoutes } from "./import-export.routes.js";
export { registerLedgerRoutes } from "./ledger.routes.js";
export { registerLedgerReportsRoutes } from "./ledger-reports.routes.js";
export { registerCardsRoutes } from "./cards.routes.js";
export { registerInvestmentCashRoutes } from "./investment-cash.routes.js";
export { registerInvestmentAccountsRoutes } from "./investment-accounts.routes.js";
export { registerCdiRoutes } from "./cdi.routes.js";
export { registerGoalsRoutes } from "./goals.routes.js";
export { registerAttachmentsRoutes } from "./attachments.routes.js";
export { registerLedgerImportRoutes } from "./ledger-import.routes.js";
