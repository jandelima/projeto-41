import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type AppDatabase } from "../index.js";
import { convertEarmarkGoals, linkAccountGoals } from "./019-goal-parent-account.js";
import { backfillGoalProfit } from "./022-goal-profit-marker.js";

let db: AppDatabase;
let checking: number;

const balanceOf = (accountId: number) =>
  db.ledger.balances.forAccount(accountId, { asOf: "2026-10-10" })?.currentBalanceCents;

beforeEach(() => {
  db = createTestDatabase();
  checking = db.ledger.accounts.create({
    name: "BTG conjunta",
    kind: "checking",
    color: "#123456",
    personId: 3,
    openingBalanceCents: 0
  });
});

/** A 019 roda antes da 022 em produção; o banco de teste já nasce na 022. */
function convert() {
  convertEarmarkGoals(db.raw);
  backfillGoalProfit(db.raw);
}

/** Uma marcação como as versões antigas gravavam: alocações presas a entradas. */
function earmark(name: string, allocations: [string, number][], yieldCents = 0, through: string | null = null) {
  const id = Number(
    db.raw
      .prepare(
        `INSERT INTO goals(name, mode, account_id, cdi_percent, color, created_at,
                           cdi_yield_cents, cdi_accrued_through)
         VALUES (?, 'earmark', ?, ?, '#00a86b', 'x', ?, ?)`
      )
      .run(name, checking, yieldCents > 0 ? 81 : null, yieldCents, through).lastInsertRowid
  );
  for (const [date, cents] of allocations) {
    const entryId = db.ledger.entries.create({
      accountId: checking,
      date,
      amountCents: 1000_00,
      kind: "income"
    });
    db.raw
      .prepare("INSERT INTO goal_allocations(goal_id, entry_id, amount_cents) VALUES (?, ?, ?)")
      .run(id, entryId, cents);
  }
  return id;
}

describe("migração 019 — caixinha com conta atrelada", () => {
  it("a marcação vira caixinha com conta própria, sem tirar nada da conta atrelada", () => {
    // O rendimento separado já está nas alocações (R$ 0,25 + 0,25 + 0,61).
    const viagem = earmark(
      "Viagem",
      [
        ["2026-09-28", 300_00],
        ["2026-09-30", 25],
        ["2026-10-01", 25],
        ["2026-10-04", 61]
      ],
      111,
      "2026-10-08"
    );
    const gatos = earmark("Gatos", [["2026-09-28", 200_00]]);
    const before = balanceOf(checking);

    convert();

    // O saldo da conta atrelada é o que o banco mostra: a caixinha é separada.
    expect(balanceOf(checking)).toBe(before);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM goal_allocations").get()).toEqual({ n: 0 });

    const goal = db.ledger.goals.progress(viagem, "2026-10-08");
    expect(goal.mode).toBe("account");
    expect(goal.parentAccountId).toBe(checking);
    expect(goal.parentAccountName).toBe("BTG conjunta");
    expect(goal.balanceCents).toBe(301_11);
    // O "rendeu" do cartão continua o mesmo, e o colocado também.
    expect(goal.yieldCents).toBe(111);
    expect(goal.contributedCents).toBe(300_00);

    const account = db.ledger.accounts.get(goal.accountId!);
    expect(account?.kind).toBe("goal");
    expect(account?.name).toBe("Viagem");
    // A conta da caixinha é de quem é dono da conta atrelada.
    expect(account?.personId).toBe(3);

    expect(db.ledger.goals.progress(gatos, "2026-10-08").balanceCents).toBe(200_00);
    expect(db.ledger.goals.savedByParentAccount("2026-10-10").get(checking)).toBe(501_11);
  });

  it("o rendimento segue do dia seguinte ao último apurado, sem contar de novo", () => {
    const viagem = earmark("Viagem", [["2026-09-01", 300_00]], 111, "2026-09-10");
    convert();

    const result = db.ledger.goals.accrue(viagem, "2026-09-18");
    expect(result.cents).toBeGreaterThan(0);
    const accrued = db.ledger.entries.get(result.entryId!);
    expect(accrued?.description).toBe("Rendimento CDI · 2026-09-11 a 2026-09-18");
    expect(db.ledger.goals.progress(viagem, "2026-09-18").yieldCents).toBe(111 + result.cents);
  });

  it("caixinha com conta própria ganha como conta atrelada a que mais mandou dinheiro", () => {
    const other = db.ledger.accounts.create({ name: "Nubank", kind: "checking", color: "#8a2be2" });
    const id = db.ledger.goals.create({ name: "Casa", mode: "account", color: "#00a86b" });
    db.raw.prepare("UPDATE goals SET parent_account_id = NULL WHERE id = ?").run(id);
    const goalAccount = db.ledger.goals.get(id)!.accountId!;
    const send = (from: number) =>
      db.ledger.entries.createTransfer({
        fromAccountId: from,
        toAccountId: goalAccount,
        date: "2026-09-10",
        amountCents: 10_00
      });
    send(other);
    send(checking);
    send(checking);

    linkAccountGoals(db.raw);
    expect(db.ledger.goals.get(id)?.parentAccountId).toBe(checking);
  });
});
