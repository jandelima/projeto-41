import type { RoutePlugin } from "./index.js";

export const registerCdiRoutes: RoutePlugin = (app, { cdiService }) => {
  if (!cdiService) return;

  /** Fonte do selo "dados até <data>" na interface. */
  app.get("/api/cdi/status", async () => cdiService.status());

  /** `force` existe para o botao de atualizar funcionar logo apos uma falha. */
  app.post("/api/cdi/refresh", async (request) => {
    const { force } = (request.query ?? {}) as { force?: string };
    const result = await cdiService.refresh({ force: force === "1" || force === "true" });
    return { ...result, status: await cdiService.status() };
  });
};
