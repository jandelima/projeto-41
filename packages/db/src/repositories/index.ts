import { createAccountsRepository } from "./accounts.js";
import { createBalancesRepository } from "./balances.js";
import { createBudgetPeriodsRepository } from "./budget-periods.js";
import { createCardsRepository } from "./cards.js";
import { createGoalsRepository } from "./goals.js";
import { createInstallmentPlansRepository } from "./installment-plans.js";
import { createRefundsRepository } from "./refunds.js";
import { createStatementsRepository } from "./statements.js";
import { createCategoriesRepository } from "./categories.js";
import { createEntriesRepository } from "./entries.js";
import { createPeopleRepository } from "./people.js";
import { createPlacesRepository } from "./places.js";
import { createReportsRepository } from "./reports.js";
import { createTagsRepository } from "./tags.js";
import type { Db } from "./shared.js";

/**
 * Repositorios do modulo de financas, agrupados sob `db.ledger` para nao
 * misturar com as tabelas legadas de investimento, que seguem no nivel de cima.
 */
export function createLedgerRepositories(db: Db) {
  return {
    people: createPeopleRepository(db),
    accounts: createAccountsRepository(db),
    categories: createCategoriesRepository(db),
    tags: createTagsRepository(db),
    places: createPlacesRepository(db),
    entries: createEntriesRepository(db),
    balances: createBalancesRepository(db),
    reports: createReportsRepository(db),
    budgetPeriods: createBudgetPeriodsRepository(db),
    cards: createCardsRepository(db),
    statements: createStatementsRepository(db),
    installmentPlans: createInstallmentPlansRepository(db),
    refunds: createRefundsRepository(db),
    goals: createGoalsRepository(db)
  };
}

export type LedgerRepositories = ReturnType<typeof createLedgerRepositories>;

export * from "./shared.js";
export type { BalanceOptions } from "./balances.js";
