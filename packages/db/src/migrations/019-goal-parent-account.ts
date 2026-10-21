import type { Migration, MigrationDatabase } from "./runner.js";

type EarmarkGoal = {
  id: number;
  name: string;
  color: string;
  archived: number;
  parentId: number | null;
  personId: number | null;
  yieldCents: number;
  accruedThrough: string | null;
};

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
};

/**
 * Toda caixinha tem saldo próprio e fica atrelada a uma conta.
 *
 * `parent_account_id` é a conta de onde o dinheiro sai ao guardar e para onde
 * volta ao resgatar. A caixinha continua tendo a própria conta `kind='goal'`
 * em `account_id`: o saldo dela não está dentro do saldo da conta atrelada,
 * como no banco.
 *
 * As marcações viram caixinhas com conta própria. No banco, o dinheiro da
 * caixinha já não estava no saldo da conta (o usuário conferiu: é separado),
 * então o saldo marcado entra na caixinha nova como saldo inicial, sem tirar
 * nada da conta atrelada. O rendimento já separado vira o lançamento
 * "Rendimento CDI" até o último dia apurado, para a apuração seguir de onde
 * parou e o "rendeu" do cartão continuar o mesmo.
 *
 * Caixinha com conta própria que já existia ganha como conta atrelada a que
 * mais mandou dinheiro para ela; sem nenhuma, fica para o usuário escolher.
 */
export const migration019GoalParentAccount: Migration = {
  version: 19,
  name: "goal-parent-account",
  up: (db) => {
    db.exec("ALTER TABLE goals ADD COLUMN parent_account_id INTEGER REFERENCES accounts(id)");
    linkAccountGoals(db);
    convertEarmarkGoals(db);
  }
};

/** Caixinha com conta própria: a conta atrelada é a que mais mandou dinheiro para ela. */
export function linkAccountGoals(db: MigrationDatabase) {
  db.prepare(
    `UPDATE goals SET parent_account_id = (
       SELECT o.account_id FROM transfers t
       JOIN entries f ON f.id = t.from_entry_id
       JOIN entries d ON d.id = t.to_entry_id
       JOIN entries o ON o.id = CASE WHEN f.account_id = goals.account_id THEN d.id ELSE f.id END
       JOIN accounts oa ON oa.id = o.account_id
       WHERE goals.account_id IN (f.account_id, d.account_id)
         AND o.account_id <> goals.account_id
         AND oa.kind NOT IN ('goal', 'credit_card', 'investment')
       GROUP BY o.account_id ORDER BY COUNT(*) DESC, MAX(t.id) DESC LIMIT 1
     )
     WHERE mode = 'account' AND parent_account_id IS NULL`
  ).run();
}

/** Cada marcação vira caixinha com conta própria, atrelada à conta que ela marcava. */
export function convertEarmarkGoals(db: MigrationDatabase) {
  const now = new Date().toISOString();
  const earmarks = db
    .prepare(
      `SELECT g.id, g.name, g.color, g.archived, g.account_id AS parentId,
              a.person_id AS personId, g.cdi_yield_cents AS yieldCents,
              g.cdi_accrued_through AS accruedThrough
       FROM goals g LEFT JOIN accounts a ON a.id = g.account_id
       WHERE g.mode = 'earmark'`
    )
    .all() as EarmarkGoal[];

  const rendimentos = (
    db.prepare("SELECT id FROM categories WHERE name = 'Rendimentos' AND kind = 'income'").get() as
      | { id: number }
      | undefined
  )?.id ?? null;

  const insertAccount = db.prepare(
    `INSERT INTO accounts
     (person_id, name, kind, color, opening_balance_cents, include_in_net_worth,
      archived, sort_order, created_at)
     VALUES (?, ?, 'goal', ?, 0, 1, ?, 50, ?)`
  );
  const insertEntry = db.prepare(
    `INSERT INTO entries
     (account_id, date, amount_cents, kind, status, category_id, description,
      counts_toward_target, created_at, updated_at)
     VALUES (@accountId, @date, @amountCents, @kind, 'cleared', @categoryId, @description,
             0, @now, @now)`
  );

  for (const goal of earmarks) {
    const allocated = db
      .prepare(
        `SELECT COALESCE(SUM(ga.amount_cents), 0) AS total, MIN(e.date) AS firstDate
         FROM goal_allocations ga JOIN entries e ON e.id = ga.entry_id
         WHERE ga.goal_id = ?`
      )
      .get(goal.id) as { total: number; firstDate: string | null };

    const accountId = Number(
      insertAccount.run(goal.personId, goal.name, goal.color, goal.archived, now).lastInsertRowid
    );

    const yieldCents = Math.min(goal.yieldCents, Math.max(allocated.total, 0));
    const contributed = allocated.total - yieldCents;
    if (contributed !== 0) {
      insertEntry.run({
        accountId,
        date: allocated.firstDate ?? today(),
        amountCents: contributed,
        kind: "adjustment",
        categoryId: null,
        description: "Saldo da caixinha",
        now
      });
    }
    if (yieldCents > 0) {
      const through = goal.accruedThrough ?? today();
      insertEntry.run({
        accountId,
        date: through,
        amountCents: yieldCents,
        kind: "income",
        categoryId: rendimentos,
        description: `Rendimento CDI · até ${through}`,
        now
      });
    }

    db.prepare("DELETE FROM goal_allocations WHERE goal_id = ?").run(goal.id);
    db.prepare(
      `UPDATE goals SET mode = 'account', account_id = ?, parent_account_id = ?,
              cdi_accrued_through = NULL, cdi_yield_cents = 0
       WHERE id = ?`
    ).run(accountId, goal.parentId, goal.id);
  }
}
