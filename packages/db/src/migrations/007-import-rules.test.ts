import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";
import { runMigrations, type MigrationDatabase } from "./runner.js";
import { migrations } from "./index.js";

/**
 * A 005 depende de `operations`, que pertence ao `migrate()` legado, então o
 * banco precisa nascer pelo caminho real de construção e não só pelo runner.
 */
function db() {
  return createTestDatabase().raw;
}

function indexNames(raw: MigrationDatabase, table: string) {
  return (raw.pragma(`index_list(${table})`) as { name: string }[]).map((row) => row.name);
}

/** O banco real já nasce com contas semeadas, então nenhum id é fixado aqui. */
function seed(raw: MigrationDatabase) {
  const accountId = Number(
    raw
      .prepare(
        `INSERT INTO accounts(person_id, name, kind, color, created_at)
           VALUES (1, 'Nubank importação', 'checking', '#820ad1', 'x')`
      )
      .run().lastInsertRowid
  );
  const batchId = Number(
    raw
      .prepare(
        `INSERT INTO import_batches(source, account_id, file_name, file_hash, imported_at)
           VALUES ('ofx', ?, 'extrato.ofx', 'abc', '2026-09-22T00:00:00.000Z')`
      )
      .run(accountId).lastInsertRowid
  );
  return { accountId, batchId };
}

describe("migração 007", () => {
  it("cria as tabelas de estágio, regras e identidades", () => {
    const raw = db();
    const tables = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "import_batches",
        "import_rows",
        "import_column_mappings",
        "account_identities",
        "rules",
        "rule_conditions",
        "rule_actions"
      ])
    );
  });

  it("preserva os índices de entries que as fases 3 e 5 acrescentaram", () => {
    const raw = db();
    // Escritos à mão o rebuild os teria perdido: nenhum está no documento da
    // fase 6.
    expect(indexNames(raw, "entries")).toEqual(
      expect.arrayContaining([
        "entries_account_external",
        "entries_account_statement",
        "entries_installment",
        "entries_installment_unique",
        "entries_refund_of",
        "entries_account_date"
      ])
    );
  });

  it("mantém a reimportação idempotente pelo índice único parcial", () => {
    const raw = db();
    const { accountId } = seed(raw);
    const insert = raw.prepare(
      `INSERT INTO entries(account_id, date, amount_cents, kind, external_id,
                           counts_toward_target, created_at, updated_at)
         VALUES (?, '2026-09-01', -1600, 'expense', ?, 1, 'x', 'x')`
    );
    insert.run(accountId, "fitid-1");
    expect(() => insert.run(accountId, "fitid-1")).toThrow(/UNIQUE/i);
    // Vários lançamentos manuais continuam convivendo: o índice é parcial.
    insert.run(accountId, null);
    insert.run(accountId, null);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n).toBe(3);
  });

  it("dá integridade real a entries.import_row_id", () => {
    const raw = db();
    const { accountId } = seed(raw);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO entries(account_id, date, amount_cents, kind, import_row_id,
                               counts_toward_target, created_at, updated_at)
             VALUES (?, '2026-09-01', -100, 'expense', 999, 1, 'x', 'x')`
        )
        .run(accountId)
    ).toThrow(/FOREIGN KEY/i);
  });

  it("apaga as linhas junto com o lote descartado", () => {
    const raw = db();
    const { batchId } = seed(raw);
    raw
      .prepare(
        `INSERT INTO import_rows(batch_id, line_no, raw_json, parsed_json, content_hash)
           VALUES (?, 1, '{}', '{}', 'h1'), (?, 2, '{}', '{}', 'h2')`
      )
      .run(batchId, batchId);
    raw.prepare("DELETE FROM import_batches WHERE id = ?").run(batchId);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM import_rows").get() as { n: number }).n).toBe(
      0
    );
  });

  it("recusa valor fora do CHECK em source, status e match_reason", () => {
    const raw = db();
    const { accountId, batchId } = seed(raw);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO import_batches(source, account_id, file_name, file_hash, imported_at)
             VALUES ('xlsx', ?, 'f', 'h', 'x')`
        )
        .run(accountId)
    ).toThrow(/CHECK/i);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO import_rows(batch_id, line_no, raw_json, parsed_json, content_hash, status)
             VALUES (?, 1, '{}', '{}', 'h', 'maybe')`
        )
        .run(batchId)
    ).toThrow(/CHECK/i);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO import_rows(batch_id, line_no, raw_json, parsed_json, content_hash,
                                   match_reason)
             VALUES (?, 1, '{}', '{}', 'h', 'vibes')`
        )
        .run(batchId)
    ).toThrow(/CHECK/i);
  });

  it("aceita 'needs_review' agora para a fase 8 não precisar de rebuild", () => {
    const raw = db();
    const { batchId } = seed(raw);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO import_rows(batch_id, line_no, raw_json, parsed_json, content_hash, status)
             VALUES (?, 1, '{}', '{}', 'h', 'needs_review')`
        )
        .run(batchId)
    ).not.toThrow();
  });

  it("não deixa a mesma identidade apontar para duas contas", () => {
    const raw = db();
    const { accountId } = seed(raw);
    const other = Number(
      raw
        .prepare(
          `INSERT INTO accounts(person_id, name, kind, color, created_at)
             VALUES (1, 'Conjunta', 'checking', '#0f0', 'x')`
        )
        .run().lastInsertRowid
    );
    const insert = raw.prepare(
      `INSERT INTO account_identities(account_id, kind, value, created_at)
         VALUES (?, 'bank_account', '0260:1:4705570592', 'x')`
    );
    insert.run(accountId);
    expect(() => insert.run(other)).toThrow(/UNIQUE/i);
  });

  it("semeia as regras pre uma única vez", () => {
    const raw = db();
    const count = () => (raw.prepare("SELECT COUNT(*) AS n FROM rules").get() as { n: number }).n;
    const seeded = count();
    expect(seeded).toBeGreaterThan(0);
    expect(
      (raw.prepare("SELECT COUNT(*) AS n FROM rules WHERE stage = 'pre'").get() as { n: number })
        .n
    ).toBe(seeded);
    // Rodar o runner de novo é o que acontece a cada abertura do app.
    runMigrations(raw, migrations);
    expect(count()).toBe(seeded);
  });

  it("não ressuscita regra que o usuário apagou", () => {
    const raw = db();
    raw.prepare("DELETE FROM rules").run();
    runMigrations(raw, migrations);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM rules").get() as { n: number }).n).toBe(0);
  });
});
