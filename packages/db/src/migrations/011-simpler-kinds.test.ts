import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migration011SimplerKinds } from "./011-simpler-kinds.js";

describe("migração 011", () => {
  it("poupança vira conta corrente e pix/débito viram dinheiro", () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, kind TEXT);
      CREATE TABLE entries (id INTEGER PRIMARY KEY, payment_method TEXT);
      INSERT INTO accounts VALUES (1, 'savings'), (2, 'credit_card');
      INSERT INTO entries VALUES (1, 'pix'), (2, 'debit'), (3, 'credit'), (4, NULL);
    `);
    migration011SimplerKinds.up(raw);

    const kinds = raw.prepare("SELECT kind FROM accounts ORDER BY id").all() as { kind: string }[];
    expect(kinds.map((row) => row.kind)).toEqual(["checking", "credit_card"]);
    const methods = raw.prepare("SELECT payment_method AS m FROM entries ORDER BY id").all() as {
      m: string | null;
    }[];
    expect(methods.map((row) => row.m)).toEqual(["cash", "cash", "credit", null]);
  });
});
