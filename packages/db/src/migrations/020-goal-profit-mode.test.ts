import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type AppDatabase } from "../index.js";

let db: AppDatabase;

beforeEach(() => {
  db = createTestDatabase();
});

const insert = (name: string, cdiPercent: number | null, profitMode?: string) =>
  Number(
    db.raw
      .prepare(
        `INSERT INTO goals(name, mode, cdi_percent, color, created_at ${profitMode ? ", profit_mode" : ""})
         VALUES (?, 'earmark', ?, '#00a86b', 'x' ${profitMode ? ", ?" : ""})`
      )
      .run(...(profitMode ? [name, cdiPercent, profitMode] : [name, cdiPercent])).lastInsertRowid
  );

const modeOf = (id: number) =>
  (db.raw.prepare("SELECT profit_mode AS m FROM goals WHERE id = ?").get(id) as { m: string }).m;

describe("migração 020: modo do lucro", () => {
  it("o padrão do esquema é automático", () => {
    expect(modeOf(insert("Viagem", 100))).toBe("auto");
  });

  it("recusa modo fora de auto e manual", () => {
    expect(() => insert("Carro", null, "quando-eu-quiser")).toThrow(/CHECK/);
  });

  it("a conversão das caixinhas antigas: sem % do CDI vira manual, com % continua automática", () => {
    const withCdi = insert("Rende", 81);
    const without = insert("Parada", null);
    // O mesmo UPDATE da migração, sobre as linhas que existiam antes dela.
    db.raw.exec("UPDATE goals SET profit_mode = 'manual' WHERE cdi_percent IS NULL");
    expect(modeOf(withCdi)).toBe("auto");
    expect(modeOf(without)).toBe("manual");
  });

  it("o repositório deriva o modo quando ninguém informa", () => {
    const person = db.ledger.people.list()[0]!.id;
    const checking = db.ledger.accounts.create({
      name: "BTG",
      kind: "checking",
      color: "#123456",
      personId: person,
      openingBalanceCents: 0
    });
    const base = { name: "X", color: "#00a86b", mode: "account" as const, parentAccountId: checking };
    expect(db.ledger.goals.get(db.ledger.goals.create(base))!.profitMode).toBe("manual");
    expect(db.ledger.goals.get(db.ledger.goals.create({ ...base, name: "Y", cdiPercent: 100 }))!.profitMode).toBe("auto");
  });
});
