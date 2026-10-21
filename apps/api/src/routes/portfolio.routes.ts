import type { RoutePlugin } from "./index.js";
import { buildDashboard, buildPortfolios } from "../services/portfolio-service.js";

export const registerPortfolioRoutes: RoutePlugin = (app, { db }) => {
  app.get("/api/dashboard", async () => buildDashboard(db));
  app.get("/api/portfolios", async () => buildPortfolios(db));
};
