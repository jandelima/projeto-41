import type { Migration } from "./runner.js";

/**
 * A conta de investimento passa a ser de uma pessoa do módulo de finanças.
 *
 * `person_id` liga a conta à pessoa que a usa (Steylor, Bianca…). O nome da
 * conta acompanha o da pessoa, e a lista de contas é mantida pela
 * sincronização com as pessoas — ninguém cria conta de investimento à mão.
 */
export const migration018InvestmentAccountPerson: Migration = {
  version: 18,
  name: "investment-account-person",
  up: (db) => {
    db.exec("ALTER TABLE investment_accounts ADD COLUMN person_id INTEGER REFERENCES people(id)");
  }
};
