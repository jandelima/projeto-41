import { rebuildTable, type Migration } from "./runner.js";

/**
 * Cartao de credito: plano de parcelamento e os indices da fatura.
 *
 * **Nao existe tabela `invoices` nem `statements`** (D22). A fatura e derivada
 * por consulta sobre `entries.statement_month`; a unica coisa armazenada e o
 * proprio `statement_month`, e ele e armazenado exatamente porque a antecipacao
 * de parcelas o sobrescreve (6.2).
 *
 * **`accounts` nao e tocada.** A migracao 002 ja criou o CHECK de `kind` com os
 * sete valores e as quatro colunas de cartao; esta fase so liga a interface ao
 * que ja existe. Reconstruir `accounts` aqui seria bug, nao zelo.
 */

const ENTRIES_COLUMNS = [
  "id",
  "account_id",
  "person_id",
  "date",
  "amount_cents",
  "kind",
  "status",
  "category_id",
  "place_id",
  "description",
  "notes",
  "raw_description",
  "payment_method",
  "statement_month",
  "installment_plan_id",
  "installment_number",
  "parent_entry_id",
  "refund_of_entry_id",
  "counts_toward_target",
  "external_id",
  "import_row_id",
  "content_hash",
  "created_at",
  "updated_at"
];

/**
 * DDL identico ao da migracao 002, com uma unica diferenca: `installment_plan_id`
 * deixa de ser INTEGER solto e ganha a FK. Todo CHECK e copiado palavra por
 * palavra — perder um deles aqui e uma regressao silenciosa.
 *
 * `import_row_id` continua solto de proposito: quem lhe da integridade e a
 * fase 6, quando `import_rows` existir.
 */
const ENTRIES_NEW = `
  CREATE TABLE entries__new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    person_id INTEGER REFERENCES people(id),
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('expense','income','transfer','adjustment')),
    status TEXT NOT NULL DEFAULT 'cleared'
      CHECK(status IN ('pending','cleared','reconciled')),
    category_id INTEGER REFERENCES categories(id),
    place_id INTEGER REFERENCES places(id),
    description TEXT,
    notes TEXT,
    raw_description TEXT,
    payment_method TEXT CHECK(payment_method IN
      ('cash','debit','pix','credit','voucher','other')),
    statement_month TEXT,
    installment_plan_id INTEGER REFERENCES installment_plans(id),
    installment_number INTEGER,
    parent_entry_id INTEGER REFERENCES entries(id),
    refund_of_entry_id INTEGER REFERENCES entries(id),
    counts_toward_target INTEGER NOT NULL DEFAULT 1,
    external_id TEXT,
    import_row_id INTEGER,
    content_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(kind <> 'transfer' OR category_id IS NULL)
  )
`;

/** Os indices da 002, recriados palavra por palavra, mais os desta fase. */
const ENTRIES_INDEXES = [
  "CREATE INDEX IF NOT EXISTS entries_account_date ON entries(account_id, date)",
  "CREATE INDEX IF NOT EXISTS entries_date ON entries(date)",
  "CREATE INDEX IF NOT EXISTS entries_category_date ON entries(category_id, date)",
  "CREATE INDEX IF NOT EXISTS entries_person_date ON entries(person_id, date)",
  `CREATE UNIQUE INDEX IF NOT EXISTS entries_account_external
     ON entries(account_id, external_id) WHERE external_id IS NOT NULL`,
  // Novos: tela de fatura, navegacao da serie e estorno.
  "CREATE INDEX IF NOT EXISTS entries_account_statement ON entries(account_id, statement_month)",
  `CREATE INDEX IF NOT EXISTS entries_installment
     ON entries(installment_plan_id, installment_number)`,
  "CREATE INDEX IF NOT EXISTS entries_refund_of ON entries(refund_of_entry_id)",
  // Duas parcelas "3/7" no mesmo plano sao corrupcao de dados, nao caso de uso.
  `CREATE UNIQUE INDEX IF NOT EXISTS entries_installment_unique
     ON entries(installment_plan_id, installment_number)
     WHERE installment_plan_id IS NOT NULL`
];

const REQUIRED_ACCOUNT_COLUMNS = [
  "closing_day",
  "due_day",
  "credit_limit_cents",
  "payment_account_id"
];

export const migration004CreditCard: Migration = {
  version: 4,
  name: "credit-card",
  up: (db) => {
    // Se estas colunas nao existirem, a migracao 002 divergiu do plano mestre e
    // seguir daqui produziria um cartao sem ciclo.
    const columns = (db.pragma("table_info(accounts)") as { name: string }[]).map(
      (column) => column.name
    );
    const missing = REQUIRED_ACCOUNT_COLUMNS.filter((column) => !columns.includes(column));
    if (missing.length > 0) {
      throw new Error(
        `accounts sem as colunas de cartao: ${missing.join(", ")}. ` +
          "A migracao 002 divergiu da secao 4.1 do plano mestre."
      );
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS installment_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        description TEXT,
        purchase_date TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        installment_count INTEGER NOT NULL CHECK(installment_count >= 1),
        place_id INTEGER REFERENCES places(id),
        category_id INTEGER REFERENCES categories(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS installment_plans_account ON installment_plans(account_id);
    `);

    // Um unico rebuild, so para dar integridade a `installment_plan_id`.
    rebuildTable(db, {
      table: "entries",
      createSql: ENTRIES_NEW,
      columns: ENTRIES_COLUMNS,
      indexes: ENTRIES_INDEXES
    });
  }
};
