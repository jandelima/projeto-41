import { contributionSchema, operationSchema } from "@projeto41/contracts";
import { z } from "zod";
import { buildPortfolios } from "../services/portfolio-service.js";
import {
  clearOperations,
  listOperationsWithLinks,
  registerOperation,
  removeOperation,
  unlinkOperation,
  updateOperation
} from "../services/investment-cash-service.js";
import type { RoutePlugin } from "./index.js";

const cryptoAssetSchema = z.object({
  slug: z.string().trim().optional(),
  name: z.string().trim().optional()
});

export const registerOperationsRoutes: RoutePlugin = (app, { db, priceService }) => {
  function rememberCryptoAsset(
    operation: { portfolio: "crypto" | "b3"; asset: string },
    body: unknown
  ) {
    if (operation.portfolio !== "crypto") return;
    const { slug, name } = cryptoAssetSchema.parse(body);
    if (!slug) return;
    db.cryptoAssets.upsert({ symbol: operation.asset, slug, name: name || operation.asset });
  }

  /** Devolve o estado do vinculo junto: a interface nao precisa adivinhar. */
  app.get("/api/operations", async (request) => {
    const query = z.object({ portfolio: z.enum(["crypto", "b3"]).optional() }).parse(request.query);
    return listOperationsWithLinks(db, query.portfolio);
  });

  app.get("/api/crypto/search", async (request) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(request.query);
    if (!priceService.searchCrypto) return [];
    return priceService.searchCrypto(q);
  });

  app.get("/api/b3/search", async (request) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(request.query);
    if (!priceService.searchB3) return [];
    return priceService.searchB3(q);
  });

  app.post("/api/operations", async (request, reply) => {
    const operation = operationSchema.parse(request.body);
    rememberCryptoAsset(operation, request.body);
    const { id } = registerOperation(db, operation);
    if (operation.portfolio === "crypto" && priceService.ensureCryptoPrice) {
      await priceService.ensureCryptoPrice(operation.asset);
    }
    // Mutacao devolve o agregado recalculado; com o debito automatico, o saldo
    // da conta muda junto, entao `balances` vai junto de `portfolios`.
    return reply
      .status(201)
      .send({ id, portfolios: buildPortfolios(db), balances: db.ledger.balances.consolidated() });
  });

  app.put("/api/operations/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const operation = operationSchema.parse(request.body);
    rememberCryptoAsset(operation, request.body);
    updateOperation(db, id, operation);
    return {
      ok: true,
      portfolios: buildPortfolios(db),
      balances: db.ledger.balances.consolidated()
    };
  });

  app.post("/api/operations/:id/link", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { accountId } = z.object({ accountId: z.number().int().positive() }).parse(request.body);
    const operation = db.operations.list().find((item) => item.id === id);
    if (!operation) throw Object.assign(new Error("Operacao nao encontrada"), { statusCode: 404 });
    updateOperation(db, id, { ...operation, accountId });
    return {
      ok: true,
      portfolios: buildPortfolios(db),
      balances: db.ledger.balances.consolidated()
    };
  });

  app.delete("/api/operations/:id/link", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    unlinkOperation(db, id);
    return {
      ok: true,
      portfolios: buildPortfolios(db),
      balances: db.ledger.balances.consolidated()
    };
  });

  app.delete("/api/operations/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    removeOperation(db, id);
    return {
      ok: true,
      portfolios: buildPortfolios(db),
      balances: db.ledger.balances.consolidated()
    };
  });

  app.delete("/api/operations", async (request) => {
    const { portfolio } = z
      .object({ portfolio: z.enum(["crypto", "b3"]).optional() })
      .parse(request.query);
    const removed = clearOperations(db, portfolio);
    return {
      ok: true,
      removed,
      portfolios: buildPortfolios(db),
      balances: db.ledger.balances.consolidated()
    };
  });

  app.get("/api/dividends", async () => db.dividends.list());
  app.put("/api/dividends/:asset", async (request) => {
    const { asset } = z.object({ asset: z.string().min(1) }).parse(request.params);
    const { amount } = z.object({ amount: z.number().nonnegative() }).parse(request.body);
    db.dividends.set(asset.toUpperCase(), amount);
    return { ok: true };
  });

  // Os digitados e os que passaram pelo livro (aporte e resgate pela conta).
  app.get("/api/contributions", async () => db.contributions.all());
  app.post("/api/contributions", async (request, reply) => {
    const id = db.contributions.create(contributionSchema.parse(request.body));
    return reply.status(201).send({ id });
  });
  app.put("/api/contributions/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    db.contributions.update(id, contributionSchema.parse(request.body));
    return { ok: true };
  });
  app.delete("/api/contributions/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    db.contributions.remove(id);
    return { ok: true };
  });
};
