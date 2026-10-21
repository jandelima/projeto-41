import type { Migration } from "./runner.js";

/**
 * Liga as operacoes de investimento ao livro-caixa.
 *
 * **Em `operations` so entra coluna** (R-02). A coluna `portfolio` tem
 * `CHECK(portfolio IN ('crypto','b3'))` e amplia-la exigiria `rebuildTable` da
 * tabela que e o coracao do modulo antigo — nenhuma fase faz isso, e ha teste
 * afirmando que o CHECK continua identico.
 */
export const migration005InvestmentLink: Migration = {
  version: 5,
  name: "investment-link",
  up: (db) => {
    const columns = (db.pragma("table_info(operations)") as { name: string }[]).map(
      (column) => column.name
    );
    if (!columns.includes("account_id")) {
      // O SQLite aceita REFERENCES num ADD COLUMN porque o default e NULL.
      db.exec("ALTER TABLE operations ADD COLUMN account_id INTEGER REFERENCES accounts(id)");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_operations_account ON operations(account_id)");

    // Tabela separada em vez de coluna em `transfers`: o livro novo nao precisa
    // conhecer o modulo antigo, e a cardinalidade 1-1 fica declarada pelas duas
    // chaves unicas em vez de por convencao.
    db.exec(`
      CREATE TABLE IF NOT EXISTS operation_transfers (
        operation_id INTEGER PRIMARY KEY REFERENCES operations(id),
        transfer_id INTEGER NOT NULL UNIQUE REFERENCES transfers(id),
        created_at TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    const joint = db.prepare("SELECT id FROM people WHERE kind = 'joint' LIMIT 1").get() as
      | { id: number }
      | undefined;

    /** Semeadura idempotente: so cria a conta se ela ainda nao existir. */
    function ensureAccount(name: string, color: string): number {
      const existing = db
        .prepare("SELECT id FROM accounts WHERE name = ? AND kind = 'investment'")
        .get(name) as { id: number } | undefined;
      if (existing) return existing.id;
      return Number(
        db
          .prepare(
            `INSERT INTO accounts
             (person_id, name, kind, color, opening_balance_cents, include_in_net_worth,
              archived, sort_order, created_at)
             VALUES (?, ?, 'investment', ?, 0, 0, 0, 90, ?)`
          )
          .run(joint?.id ?? null, name, color, now).lastInsertRowid
      );
    }

    const cryptoAccount = ensureAccount("Corretora cripto", "#f5a742");
    const b3Account = ensureAccount("Corretora B3", "#4f8ff7");

    // Prefixo `investment.` para nao colidir com as chaves de planejamento que
    // ja moram em `settings`.
    const setDefault = db.prepare(
      "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
    );
    setDefault.run("investment.auto_debit", "1");
    setDefault.run("investment.default_account_id", "");
    setDefault.run("investment.crypto_account_id", String(cryptoAccount));
    setDefault.run("investment.b3_account_id", String(b3Account));
  }
};
