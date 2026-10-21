import type Database from "better-sqlite3";

export type MigrationDatabase = Database.Database;

/**
 * Uma migração é somente de ida. O app roda local e o caminho de volta é
 * restaurar backup, então `down` não existe por decisão (D26).
 */
export type Migration = {
  version: number;
  name: string;
  up: (db: MigrationDatabase) => void;
};

const CONTROL_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`;

export function ensureMigrationTable(db: MigrationDatabase) {
  db.exec(CONTROL_TABLE);
}

export function appliedVersions(db: MigrationDatabase): number[] {
  ensureMigrationTable(db);
  return (
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
      version: number;
    }[]
  ).map((row) => row.version);
}

/**
 * Valida que a lista de migrações é uma sequência 1..N sem buracos nem
 * duplicatas. Um buraco significa migração perdida num merge; uma duplicata
 * significa que duas branches escolheram o mesmo número.
 */
export function assertMigrationSequence(migrations: Migration[]) {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((migration, index) => {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Migração com versão inválida: ${migration.version} (${migration.name})`);
    }
    const previous = sorted[index - 1];
    if (previous && previous.version === migration.version) {
      throw new Error(
        `Versão de migração duplicada: ${migration.version} ` +
          `("${previous.name}" e "${migration.name}")`
      );
    }
    if (migration.version !== index + 1) {
      throw new Error(
        `Buraco na sequência de migrações: esperava versão ${index + 1}, ` +
          `encontrou ${migration.version} ("${migration.name}")`
      );
    }
  });
  return sorted;
}

function readPragma(db: MigrationDatabase, name: string): number {
  return Number(db.pragma(`${name}`, { simple: true }));
}

/**
 * Aplica as migrações pendentes, cada uma numa transação própria.
 *
 * `foreign_keys` é desligado durante a execução e religado no fim. Isso não é
 * folga: `rebuildTable` precisa derrubar e recriar tabelas referenciadas, e
 * `PRAGMA foreign_keys` é ignorado dentro de uma transação — `defer_foreign_keys`
 * não serve porque o contador de violações adiado é incrementado pelo DROP e
 * não é zerado ao recriar a tabela. Ao final rodamos `foreign_key_check` para
 * garantir que nenhuma migração deixou referência órfã.
 */
export function runMigrations(db: MigrationDatabase, migrations: Migration[]) {
  const sorted = assertMigrationSequence(migrations);
  ensureMigrationTable(db);
  const already = new Set(appliedVersions(db));
  const pending = sorted.filter((migration) => !already.has(migration.version));
  if (pending.length === 0) return [];

  const insert = db.prepare(
    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)"
  );
  const applied: Migration[] = [];
  const foreignKeysWereOn = readPragma(db, "foreign_keys") === 1;
  if (foreignKeysWereOn) db.pragma("foreign_keys = OFF");

  try {
    for (const migration of pending) {
      // A migração e o registro da versão precisam ser atômicos: se o `up`
      // falhar no meio, o banco volta ao estado anterior e a versão não é gravada.
      const apply = db.transaction(() => {
        migration.up(db);
        insert.run(migration.version, migration.name, new Date().toISOString());
      });
      try {
        apply();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Falha na migração ${migration.version} ("${migration.name}"): ${reason}`,
          { cause: error }
        );
      }
      applied.push(migration);
    }

    const violations = db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `Migrações deixaram ${violations.length} referência(s) órfã(s): ` +
          JSON.stringify(violations.slice(0, 5))
      );
    }
  } finally {
    if (foreignKeysWereOn) db.pragma("foreign_keys = ON");
  }

  return applied;
}

export type RebuildTableOptions = {
  table: string;
  /** DDL completo da tabela nova, já nomeando `<table>__new`. */
  createSql: string;
  /** Colunas copiadas da tabela antiga, na mesma ordem nos dois lados. */
  columns: string[];
  /** Índices e triggers recriados depois do rename. */
  indexes?: string[];
};

/**
 * Troca `CHECK`, remove coluna ou muda tipo — o que `ALTER TABLE ADD COLUMN`
 * não cobre (R-01).
 *
 * **Precisa rodar dentro da transação da migração e com `foreign_keys` OFF.**
 * `runMigrations` garante as duas coisas; chamar este helper por fora deixa a
 * tabela pela metade se algo falhar, ou esbarra na FK no DROP.
 */
export function rebuildTable(db: MigrationDatabase, options: RebuildTableOptions) {
  const { table, createSql, columns, indexes = [] } = options;
  const columnList = columns.join(", ");
  // Sem `legacy_alter_table`, o RENAME reescreve cláusulas REFERENCES de outras
  // tabelas — exatamente o que o procedimento oficial de 12 passos evita.
  db.pragma("legacy_alter_table = ON");
  try {
    db.exec(createSql);
    db.exec(`INSERT INTO ${table}__new (${columnList}) SELECT ${columnList} FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}__new RENAME TO ${table}`);
    for (const index of indexes) db.exec(index);
  } finally {
    db.pragma("legacy_alter_table = OFF");
  }
}
