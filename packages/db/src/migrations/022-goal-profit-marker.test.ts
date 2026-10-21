import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";
import { migration022GoalProfitMarker } from "./022-goal-profit-marker.js";

describe("migração 022: marca de lucro da caixinha", () => {
  it("marca só os textos exatos que o sistema grava, e só na conta da caixinha", () => {
    const db = createTestDatabase();
    const person = db.ledger.people.list()[0]!.id;
    const checking = db.ledger.accounts.create({
      name: "Conta",
      kind: "checking",
      color: "#000000",
      personId: person
    });
    const goalId = db.ledger.goals.create({
      name: "Viagem",
      mode: "account",
      color: "#00a86b",
      personId: person,
      parentAccountId: checking
    });
    const goalAccount = db.ledger.goals.get(goalId)!.accountId!;

    const insert = (accountId: number, kind: string, description: string) =>
      Number(
        db.raw
          .prepare(
            `INSERT INTO entries (account_id, date, amount_cents, kind, status, description,
                                  counts_toward_target, created_at, updated_at)
             VALUES (?, '2026-09-01', 100, ?, 'cleared', ?, 0, 'agora', 'agora')`
          )
          .run(accountId, kind, description).lastInsertRowid
      );
    const ids = {
      yield: insert(goalAccount, "income", "Rendimento CDI · até 2026-08-31"),
      profit: insert(goalAccount, "income", "Lucro · app"),
      launched: insert(goalAccount, "income", "Lucro lançado"),
      adjust: insert(goalAccount, "adjustment", "Ajuste de lucro"),
      handwritten: insert(goalAccount, "income", "lucro da venda"),
      bank: insert(checking, "income", "Rendimento CDI do banco")
    };
    // Simula o banco antigo: apaga a marca e roda o preenchimento de novo.
    db.raw.exec("ALTER TABLE entries DROP COLUMN goal_profit");
    migration022GoalProfitMarker.up(db.raw);

    const marker = (id: number) =>
      (db.raw.prepare("SELECT goal_profit AS m FROM entries WHERE id = ?").get(id) as { m: string | null }).m;
    expect(marker(ids.yield)).toBe("yield");
    expect(marker(ids.profit)).toBe("profit");
    expect(marker(ids.launched)).toBe("profit");
    expect(marker(ids.adjust)).toBe("profit_adjust");
    expect(marker(ids.handwritten)).toBeNull();
    expect(marker(ids.bank)).toBeNull();
  });
});
