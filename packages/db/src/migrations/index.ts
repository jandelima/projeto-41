import { migration001Baseline } from "./001-baseline.js";
import { migration002LedgerCore } from "./002-ledger-core.js";
import { migration003BudgetTargets } from "./003-budget-targets.js";
import { migration004CreditCard } from "./004-credit-card.js";
import { migration005InvestmentLink } from "./005-investment-link.js";
import { migration006GoalsCdi } from "./006-goals-cdi.js";
import { migration007ImportRules } from "./007-import-rules.js";
import { migration008BudgetShareDiscounts } from "./008-budget-share-discounts.js";
import { migration009BrokerCash } from "./009-broker-cash.js";
import { migration010PositionCash } from "./010-position-cash.js";
import { migration011SimplerKinds } from "./011-simpler-kinds.js";
import { migration012ImportRowRelease } from "./012-import-row-release.js";
import { migration013EarmarkCdi } from "./013-earmark-cdi.js";
import { migration014PositionCdi } from "./014-position-cdi.js";
import { migration015GuidedYield } from "./015-guided-yield.js";
import { migration016GuidedYieldComplete } from "./016-guided-yield-complete.js";
import { migration017InvestmentAccounts } from "./017-investment-accounts.js";
import { migration018InvestmentAccountPerson } from "./018-investment-account-person.js";
import { migration019GoalParentAccount } from "./019-goal-parent-account.js";
import { migration020GoalProfitMode } from "./020-goal-profit-mode.js";
import { migration021PdfImport } from "./021-pdf-import.js";
import { migration022GoalProfitMarker } from "./022-goal-profit-marker.js";
import type { Migration } from "./runner.js";

/**
 * Ordem é a da lista. `runMigrations` valida sequência e duplicatas, então uma
 * migração nova sempre entra no fim com a próxima versão livre.
 */
export const migrations: Migration[] = [
  migration001Baseline,
  migration002LedgerCore,
  migration003BudgetTargets,
  migration004CreditCard,
  migration005InvestmentLink,
  migration006GoalsCdi,
  migration007ImportRules,
  migration008BudgetShareDiscounts,
  migration009BrokerCash,
  migration010PositionCash,
  migration011SimplerKinds,
  migration012ImportRowRelease,
  migration013EarmarkCdi,
  migration014PositionCdi,
  migration015GuidedYield,
  migration016GuidedYieldComplete,
  migration017InvestmentAccounts,
  migration018InvestmentAccountPerson,
  migration019GoalParentAccount,
  migration020GoalProfitMode,
  migration021PdfImport,
  migration022GoalProfitMarker
];

export * from "./runner.js";
export { migration009BrokerCash } from "./009-broker-cash.js";
export { migration010PositionCash } from "./010-position-cash.js";
