import type { Migration } from "./runner.js";

/**
 * Esquema do livro-caixa (plano mestre 4.1 e 4.2).
 *
 * Todo valor monetário é INTEGER em centavos e a coluna termina em `_cents`
 * (D19). Colunas que só as fases seguintes preenchem já nascem aqui para evitar
 * `ALTER TABLE` depois; `installment_plan_id` e `import_row_id` ficam como
 * INTEGER solto porque as tabelas-alvo ainda não existem — a integridade entra
 * nas fases 3 e 6 via `rebuildTable`.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('individual','joint')),
    color TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
    color TEXT NOT NULL,
    icon TEXT,
    monthly_budget_cents INTEGER,
    archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(name, kind)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER REFERENCES people(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN
      ('checking','savings','cash','meal_voucher','credit_card','investment','goal')),
    institution TEXT,
    color TEXT NOT NULL,
    icon TEXT,
    opening_balance_cents INTEGER NOT NULL DEFAULT 0,
    opening_date TEXT,
    closing_day INTEGER,
    due_day INTEGER,
    credit_limit_cents INTEGER,
    payment_account_id INTEGER REFERENCES accounts(id),
    include_in_net_worth INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    default_category_id INTEGER REFERENCES categories(id),
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
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
    installment_plan_id INTEGER,
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
  );

  CREATE INDEX IF NOT EXISTS entries_account_date ON entries(account_id, date);
  CREATE INDEX IF NOT EXISTS entries_date ON entries(date);
  CREATE INDEX IF NOT EXISTS entries_category_date ON entries(category_id, date);
  CREATE INDEX IF NOT EXISTS entries_person_date ON entries(person_id, date);
  CREATE UNIQUE INDEX IF NOT EXISTS entries_account_external
    ON entries(account_id, external_id) WHERE external_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE,
    to_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL DEFAULT 'generic' CHECK(purpose IN
      ('generic','invoice_payment','investment','goal_deposit','goal_withdrawal','settlement')),
    created_at TEXT NOT NULL,
    CHECK(from_entry_id <> to_entry_id)
  );

  CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY(entry_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    thumb_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    mime TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    original_name TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS attachments_entry ON attachments(entry_id);
  CREATE INDEX IF NOT EXISTS attachments_hash ON attachments(content_hash);
`;

const SEED_EXPENSE_CATEGORIES: [string, string][] = [
  ["Mercado", "#3fb950"],
  ["Restaurante", "#f0883e"],
  ["Transporte", "#58a6ff"],
  ["Moradia", "#a371f7"],
  ["Saúde", "#f85149"],
  ["Lazer", "#ffb454"],
  ["Assinaturas", "#39c5cf"],
  ["Educação", "#6cb6ff"],
  ["Vestuário", "#db6d94"],
  ["Presentes", "#d2a8ff"],
  ["Outros", "#8b949e"]
];

const SEED_INCOME_CATEGORIES: [string, string][] = [
  ["Salário", "#3fb950"],
  ["Freelance", "#58a6ff"],
  ["Reembolso", "#39c5cf"],
  ["Rendimentos", "#a371f7"],
  ["Outros", "#8b949e"]
];

export const migration002LedgerCore: Migration = {
  version: 2,
  name: "ledger-core",
  up: (db) => {
    db.exec(SCHEMA);
    const now = new Date().toISOString();

    // Pessoas não são semeadas: o módulo começa sem ninguém e o usuário cria
    // quem usa o sistema antes de criar as contas (a migração 008 limpa as
    // pessoas que versões antigas semeavam e nunca foram usadas). A semeadura
    // de categorias só roda em tabela vazia, para não duplicar cadastro.
    const categoryCount = (
      db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }
    ).n;
    if (categoryCount === 0) {
      const insert = db.prepare(
        `INSERT INTO categories(name, kind, color, sort_order, created_at)
         VALUES (?,?,?,?,?)`
      );
      SEED_EXPENSE_CATEGORIES.forEach(([name, color], index) => {
        insert.run(name, "expense", color, index, now);
      });
      SEED_INCOME_CATEGORIES.forEach(([name, color], index) => {
        insert.run(name, "income", color, index, now);
      });
    }
  }
};
