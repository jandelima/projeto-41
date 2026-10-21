import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";

const columnsOf = (table: string) => {
  const db = createTestDatabase();
  return (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string; dflt_value: string | null }[])
    .map((column) => [column.name, column.dflt_value]);
};

describe("migração 021: importação de PDF", () => {
  it("o lote guarda adapter, layout e conciliação", () => {
    const names = columnsOf("import_batches").map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining(["adapter_id", "layout_version", "reconciliation_status", "reconciliation_json"])
    );
  });

  it("a linha guarda confiança e origem; linha antiga conta como sinal conhecido", () => {
    const columns = Object.fromEntries(columnsOf("import_rows"));
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(["confidence", "sign_known", "source_page", "source_line", "warnings_json"])
    );
    expect(columns.sign_known).toBe("1");
  });

  it("recusa status de conciliação desconhecido", () => {
    const db = createTestDatabase();
    const personId = db.ledger.people.list()[0]!.id;
    const accountId = db.ledger.accounts.create({
      name: "Conta",
      kind: "checking",
      color: "#000000",
      personId,
      openingBalanceCents: 0
    });
    const insert = (status: string) =>
      db.raw
        .prepare(
          `INSERT INTO import_batches (source, account_id, file_name, file_hash, imported_at, reconciliation_status)
           VALUES ('pdf', ?, 'x.pdf', 'h', 'agora', ?)`
        )
        .run(accountId, status);
    expect(() => insert("match")).not.toThrow();
    expect(() => insert("quase")).toThrow(/CHECK/);
  });
});
