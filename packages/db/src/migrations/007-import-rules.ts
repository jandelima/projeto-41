import { rebuildTable, type Migration } from "./runner.js";

/**
 * Área de estágio da importação, motor de regras e identidades bancárias.
 *
 * **Duas divergências deliberadas da seção 4.4 do plano mestre**, ambas
 * mandadas pela fase 6, que é a fonte de verdade da fase:
 *
 * 1. `import_column_mappings` tem `account_id` como chave primária, e não
 *    `UNIQUE(account_id, source_label)`. Uma conta tem um mapeamento só; é o
 *    que faz a segunda importação do mesmo banco ser um clique.
 * 2. `match_reason` usa `'content_hash'` e `'fuzzy_amount_date'` no lugar de
 *    `'hash'` e `'fuzzy'` — o nome diz o que casou, que é o que a tela precisa
 *    explicar ao usuário.
 *
 * **`account_identities` não está em nenhum dos dois documentos.** Ela existe
 * porque o arquivo do banco identifica a *conta*, nunca o *dono*: o OFX do
 * Nubank traz `BANKID`/`BRANCHID`/`ACCTID` e nenhum nome ou CPF. Guardar essas
 * três coisas resolve dois problemas de uma vez — o arquivo se liga sozinho à
 * conta certa na segunda importação, e uma transferência cuja contraparte é
 * outra conta do próprio usuário (a conta conjunta, por exemplo) é reconhecida
 * como movimentação interna em vez de virar gasto.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL CHECK(source IN ('ofx','csv','pdf')),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    file_name TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'review'
      CHECK(status IN ('awaiting_mapping','review','committed','discarded')),
    row_count INTEGER NOT NULL DEFAULT 0,
    committed_count INTEGER NOT NULL DEFAULT 0,
    period_start TEXT,
    period_end TEXT,
    closing_balance_cents INTEGER
  );

  CREATE TABLE IF NOT EXISTS import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    raw_json TEXT NOT NULL,
    parsed_json TEXT NOT NULL,
    external_id TEXT,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new'
      CHECK(status IN ('new','duplicate','ignored','committed','needs_review')),
    entry_id INTEGER REFERENCES entries(id),
    suggested_place_id INTEGER REFERENCES places(id),
    suggested_category_id INTEGER REFERENCES categories(id),
    suggested_kind TEXT CHECK(suggested_kind IN ('expense','income','transfer')),
    counterparty_account_id INTEGER REFERENCES accounts(id),
    duplicate_of_entry_id INTEGER REFERENCES entries(id),
    match_reason TEXT CHECK(match_reason IN
      ('external_id','content_hash','fuzzy_amount_date'))
  );

  CREATE TABLE IF NOT EXISTS import_column_mappings (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    delimiter TEXT NOT NULL DEFAULT ',',
    encoding TEXT NOT NULL DEFAULT 'utf-8',
    skip_lines INTEGER NOT NULL DEFAULT 0,
    has_header INTEGER NOT NULL DEFAULT 1,
    date_format TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
    decimal_separator TEXT NOT NULL DEFAULT ',',
    sign_convention TEXT NOT NULL DEFAULT 'signed'
      CHECK(sign_convention IN ('signed','split_columns','debit_positive')),
    mapping_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS account_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('bank_account','document','pix_key')),
    value TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    -- Global, não por conta: uma identidade que apontasse para duas contas
    -- tornaria o reconhecimento ambíguo, e ambíguo aqui significa lançar
    -- dinheiro na conta errada.
    UNIQUE(kind, value)
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'default' CHECK(stage IN ('pre','default')),
    priority INTEGER NOT NULL DEFAULT 100,
    active INTEGER NOT NULL DEFAULT 1,
    mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','ask')),
    stop_processing INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rule_conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK(field IN
      ('description','raw_description','amount_cents','account_id','document')),
    op TEXT NOT NULL CHECK(op IN
      ('contains','equals','regex','amount_between','account_is')),
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rule_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN
      ('set_place','set_category','set_description','set_tag','set_person','ignore')),
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS import_rows_batch_status ON import_rows(batch_id, status);
  CREATE INDEX IF NOT EXISTS import_rows_content_hash ON import_rows(content_hash);
  CREATE INDEX IF NOT EXISTS import_batches_account ON import_batches(account_id);
  CREATE INDEX IF NOT EXISTS account_identities_account ON account_identities(account_id);
  CREATE INDEX IF NOT EXISTS rules_active_stage ON rules(active, stage, priority);
  CREATE INDEX IF NOT EXISTS rule_conditions_rule ON rule_conditions(rule_id);
  CREATE INDEX IF NOT EXISTS rule_actions_rule ON rule_actions(rule_id);
`;

/**
 * Idêntica à da 004 em tudo, menos a única razão desta reconstrução:
 * `import_row_id` deixa de ser INTEGER solto e vira chave estrangeira.
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
    import_row_id INTEGER REFERENCES import_rows(id),
    content_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(kind <> 'transfer' OR category_id IS NULL)
  )
`;

/**
 * Regras de estágio `pre` que valem para qualquer banco brasileiro: limpam o
 * prefixo de canal ou de adquirente antes que o usuário veja o descritor.
 * Semeadas só com `rules` vazia, senão reimportar a migração num banco já em
 * uso ressuscitaria regra que o usuário apagou de propósito.
 */
const SEED_RULES: [string, string][] = [
  ["Pix enviado", "Transferência enviada pelo Pix"],
  ["Pix recebido", "Transferência recebida pelo Pix"],
  ["Transferência recebida", "Transferência Recebida"],
  ["Compra no débito", "Compra no débito"],
  ["Débito automático", "DEB AUTOMATICO"],
  ["Compra com cartão", "COMPRA CARTAO"],
  ["TED", "TED "],
  ["DOC", "DOC "],
  ["Adquirente PAG", "PAG*"],
  ["Adquirente PG", "PG*"]
];

export const migration007ImportRules: Migration = {
  version: 7,
  name: "import-rules",
  up: (db) => {
    db.exec(SCHEMA);

    // Ler os índices de `entries` do catálogo em vez de listá-los aqui: as
    // fases 3 e 5 acrescentaram índices que a fase 6 não conhece, e o parcial
    // `UNIQUE(account_id, external_id)` é o que dá a reimportação idempotente
    // de graça. Perdê-lo num rebuild seria perder a fase inteira em silêncio.
    const indexes = (
      db
        .prepare(
          `SELECT sql FROM sqlite_master
             WHERE type = 'index' AND tbl_name = 'entries' AND sql IS NOT NULL`
        )
        .all() as { sql: string }[]
    ).map((row) => row.sql);

    if (!indexes.some((sql) => /entries_account_external/i.test(sql))) {
      throw new Error(
        "entries sem o índice único parcial de external_id. A migração 002 " +
          "divergiu da seção 4.2 do plano mestre e a importação não seria idempotente."
      );
    }

    const columns = (db.pragma("table_info(entries)") as { name: string }[]).map(
      (column) => column.name
    );

    rebuildTable(db, {
      table: "entries",
      createSql: ENTRIES_NEW,
      columns,
      indexes
    });

    const existing = db.prepare("SELECT COUNT(*) AS total FROM rules").get() as {
      total: number;
    };
    if (existing.total === 0) {
      const now = new Date().toISOString();
      const insertRule = db.prepare(
        `INSERT INTO rules (name, stage, priority, active, mode, stop_processing, created_at)
           VALUES (?, 'pre', ?, 1, 'auto', 0, ?)`
      );
      const insertCondition = db.prepare(
        `INSERT INTO rule_conditions (rule_id, field, op, value)
           VALUES (?, 'raw_description', 'contains', ?)`
      );
      const insertAction = db.prepare(
        `INSERT INTO rule_actions (rule_id, action, value) VALUES (?, 'set_description', ?)`
      );
      SEED_RULES.forEach(([name, needle], position) => {
        const result = insertRule.run(name, (position + 1) * 10, now);
        const ruleId = Number(result.lastInsertRowid);
        insertCondition.run(ruleId, needle);
        insertAction.run(ruleId, needle);
      });
    }
  }
};
