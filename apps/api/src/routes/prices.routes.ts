import type { RoutePlugin } from "./index.js";

export const registerPricesRoutes: RoutePlugin = (app, { db, priceService }) => {
  app.get("/api/prices", async () => db.prices.list());
  app.post("/api/prices/refresh", async () => {
    try {
      return { results: await priceService.runAll(), errors: [] };
    } catch (error) {
      return {
        results: [],
        errors: [error instanceof Error ? error.message : "Falha ao atualizar precos"]
      };
    }
  });
};
