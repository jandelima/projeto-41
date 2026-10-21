import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appliedVersions,
  assertMigrationSequence,
  rebuildTable,
  runMigrations,
  type Migration,
  type MigrationDatabase
} from "./runner.js";

function memoryDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

describe("runMigrations", () => {
  let db: MigrationDatabase;

  beforeEach(() => {
    db = memoryDb();
  });

  it("aplica as pendentes na ordem da versão", () => {
    const order: number[] = [];
    const migrations: Migration[] = [
      { version: 2, name: "b", up: () => order.push(2) },
      { version: 1, name: "a", up: () => order.push(1) },
      { version: 3, name: "c", up: () => order.push(3) }
    ];
    runMigrations(db, migrations);
    expect(order).toEqual([1, 2, 3]);
    expect(appliedVersions(db)).toEqual([1, 2, 3]);
  });

  it("não reaplica o que já rodou", () => {
    let runs = 0;
    const migrations: Migration[] = [{ version: 1, name: "a", up: () => (runs += 1) }];
    runMigrations(db, migrations);
    const applied = runMigrations(db, migrations);
    expect(runs).toBe(1);
    expect(applied).toHaveLength(0);
  });

  it("faz rollback e não grava a versão quando a migração falha", () => {
    const migrations: Migration[] = [
      {
        version: 1,
        name: "cria",
        up: (database) => database.exec("CREATE TABLE ok (id INTEGER PRIMARY KEY)")
      },
      {
        version: 2,
        name: "quebra",
        up: (database) => {
          database.exec("CREATE TABLE parcial (id INTEGER PRIMARY KEY)");
          throw new Error("boom");
        }
      }
    ];
    expect(() => runMigrations(db, migrations)).toThrow(/Falha na migração 2 \("quebra"\): boom/);
    expect(appliedVersions(db)).toEqual([1]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toContain("ok");
    expect(tables.map((row) => row.name)).not.toContain("parcial");
  });

  it("rejeita versão duplicada", () => {
    expect(() =>
      assertMigrationSequence([
        { version: 1, name: "a", up: () => {} },
        { version: 1, name: "b", up: () => {} }
      ])
    ).toThrow(/duplicada/);
  });

  it("rejeita buraco na sequência", () => {
    expect(() =>
      assertMigrationSequence([
        { version: 1, name: "a", up: () => {} },
        { version: 3, name: "c", up: () => {} }
      ])
    ).toThrow(/Buraco/);
  });
});

describe("rebuildTable", () => {
  it("troca um CHECK preservando dados e índices", () => {
    const db = memoryDb();
    db.exec(`
      CREATE TABLE conta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('checking'))
      );
      CREATE INDEX conta_nome ON conta(nome);
      INSERT INTO conta(nome, kind) VALUES ('Nubank', 'checking');
    `);
    expect(() => db.prepare("INSERT INTO conta(nome, kind) VALUES (?,?)").run("VR", "meal_voucher"))
      .toThrow();

    runMigrations(db, [
      {
        version: 1,
        name: "amplia kind",
        up: (database) =>
          rebuildTable(database, {
            table: "conta",
            createSql: `
              CREATE TABLE conta__new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('checking','meal_voucher'))
              )
            `,
            columns: ["id", "nome", "kind"],
            indexes: ["CREATE INDEX conta_nome ON conta(nome)"]
          })
      }
    ]);

    const rows = db.prepare("SELECT id, nome, kind FROM conta").all();
    expect(rows).toEqual([{ id: 1, nome: "Nubank", kind: "checking" }]);
    db.prepare("INSERT INTO conta(nome, kind) VALUES (?,?)").run("VR", "meal_voucher");
    expect(db.prepare("SELECT COUNT(*) AS n FROM conta").get()).toEqual({ n: 2 });
    const indexes = db.prepare("PRAGMA index_list(conta)").all() as { name: string }[];
    expect(indexes.map((row) => row.name)).toContain("conta_nome");
  });

  it("mantém as chaves estrangeiras de outras tabelas apontando para a tabela reconstruída", () => {
    const db = memoryDb();
    db.exec(`
      CREATE TABLE conta (id INTEGER PRIMARY KEY, nome TEXT NOT NULL);
      CREATE TABLE lancamento (
        id INTEGER PRIMARY KEY,
        conta_id INTEGER NOT NULL REFERENCES conta(id)
      );
      INSERT INTO conta(id, nome) VALUES (1, 'Nubank');
      INSERT INTO lancamento(id, conta_id) VALUES (1, 1);
    `);

    runMigrations(db, [
      {
        version: 1,
        name: "amplia conta",
        up: (database) =>
          rebuildTable(database, {
            table: "conta",
            createSql: `CREATE TABLE conta__new (
              id INTEGER PRIMARY KEY,
              nome TEXT NOT NULL,
              cor TEXT NOT NULL DEFAULT '#000'
            )`,
            columns: ["id", "nome"]
          })
      }
    ]);

    expect(db.prepare("SELECT COUNT(*) AS n FROM lancamento").get()).toEqual({ n: 1 });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    const sql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name='lancamento'").get() as { sql: string }
    ).sql;
    expect(sql).toContain("REFERENCES conta(id)");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
