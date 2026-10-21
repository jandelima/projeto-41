import type { RoutePlugin } from "./index.js";

/**
 * Contas do módulo de investimentos: uma por pessoa do módulo de finanças. A
 * escolhida chega em cada requisição pelo cabeçalho `x-investment-account`
 * (ver `app.ts`); aqui só se lista, já acertada com as pessoas.
 */
export const registerInvestmentAccountsRoutes: RoutePlugin = (app, { db }) => {
  app.get("/api/investment-accounts", async () => {
    // Pessoa criada ou renomeada no módulo de finanças aparece aqui.
    db.investmentAccounts.sync();
    return db.investmentAccounts.list();
  });
};
