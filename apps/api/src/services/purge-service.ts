import type { AppDatabase } from "@projeto41/db";
import { bridgeAccountId } from "./investment-cash-service.js";

/**
 * Excluir de vez o que o usuário cadastrou.
 *
 * O `DELETE` comum arquiva quando o cadastro está em uso: é o padrão seguro.
 * Aqui é a porta explícita, sempre atrás de uma confirmação na tela, que
 * apaga o cadastro e resolve cada vínculo em vez de recusar:
 *
 * - **Conta ou cartão:** some com os lançamentos dela (e com os cartões que ela
 *   paga). A outra ponta de uma transferência, em outra conta, vira ajuste:
 *   o dinheiro saiu de lá de verdade, então o saldo daquela conta não muda.
 * - **Categoria e pessoa:** os lançamentos ficam, sem a categoria ou a pessoa.
 * - **Caixinha:** a própria conta dela vai junto, como uma conta qualquer.
 *
 * O que mexe em posição de investimento fica de fora: desfazer um aporte
 * devolve dinheiro à posição, e isso é da tela de Investimentos.
 */

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

export type AccountUsage = {
  entries: number;
  cards: number;
  goals: number;
  /** Transferências com a outra ponta fora: a ponta de lá vira ajuste. */
  transfersOut: number;
  /** Aportes, resgates e compras de investimento: bloqueiam a exclusão. */
  investmentLinks: number;
};

/** A conta e os cartões que ela paga: os cartões vivem dentro do banco. */
function accountFamily(db: AppDatabase, id: number): number[] {
  const cards = db.raw
    .prepare("SELECT id FROM accounts WHERE payment_account_id = ? AND id <> ?")
    .all(id, id) as { id: number }[];
  return [id, ...cards.map((card) => card.id)];
}

const inList = (ids: number[]) => ids.map(() => "?").join(",");

export function accountUsage(db: AppDatabase, id: number): AccountUsage {
  const exists = db.raw.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id);
  if (!exists) throw fail("Conta nao encontrada", 404);
  const family = accountFamily(db, id);
  const list = inList(family);
  const count = (sql: string, ...params: unknown[]) =>
    (db.raw.prepare(sql).get(...params) as { n: number }).n;
  return {
    entries: count(`SELECT COUNT(*) AS n FROM entries WHERE account_id IN (${list})`, ...family),
    cards: family.length - 1,
    goals: count(`SELECT COUNT(*) AS n FROM goals WHERE account_id IN (${list})`, ...family),
    transfersOut: count(
      `SELECT COUNT(*) AS n FROM transfers t
       JOIN entries f ON f.id = t.from_entry_id
       JOIN entries o ON o.id = t.to_entry_id
       WHERE (f.account_id IN (${list})) <> (o.account_id IN (${list}))`,
      ...family,
      ...family
    ),
    investmentLinks:
      count(
        `SELECT COUNT(*) AS n FROM transfers t
         JOIN entries f ON f.id = t.from_entry_id
         JOIN entries o ON o.id = t.to_entry_id
         WHERE (f.account_id IN (${list}) OR o.account_id IN (${list}))
           AND (t.id IN (SELECT transfer_id FROM position_movements WHERE transfer_id IS NOT NULL)
                OR t.id IN (SELECT transfer_id FROM operation_transfers))`,
        ...family,
        ...family
      ) + count(`SELECT COUNT(*) AS n FROM operations WHERE account_id IN (${list})`, ...family)
  };
}

/** Anexos dos lançamentos que a exclusão da conta leva: a rota apaga os arquivos antes. */
export function accountAttachmentIds(db: AppDatabase, id: number): number[] {
  const family = accountFamily(db, id);
  return (
    db.raw
      .prepare(
        `SELECT a.id FROM attachments a JOIN entries e ON e.id = a.entry_id
         WHERE e.account_id IN (${inList(family)})`
      )
      .all(...family) as { id: number }[]
  ).map((row) => row.id);
}

export function assertAccountPurgeable(db: AppDatabase, id: number): AccountUsage {
  const usage = accountUsage(db, id);
  if (id === bridgeAccountId(db)) {
    throw fail("A conta Investimentos liga o livro aos investimentos e nao pode ser excluida", 409);
  }
  if (usage.investmentLinks > 0) {
    throw fail(
      `Esta conta tem ${usage.investmentLinks} aporte(s), resgate(s) ou compra(s) de investimento. ` +
        "Desfaca em Investimentos antes de excluir.",
      409
    );
  }
  return usage;
}

export function purgeAccount(db: AppDatabase, id: number) {
  assertAccountPurgeable(db, id);
  const family = accountFamily(db, id);
  const list = inList(family);
  const raw = db.raw;
  return db.transaction(() => {
    const doomed = `SELECT id FROM entries WHERE account_id IN (${list})`;

    // A ponta de fora de cada transferência vira ajuste, com o mesmo valor.
    raw
      .prepare(
        `UPDATE entries SET kind = 'adjustment', category_id = NULL,
           notes = TRIM(COALESCE(notes, '') || ' (a outra ponta estava numa conta excluida)')
         WHERE account_id NOT IN (${list}) AND id IN (
           SELECT CASE WHEN f.account_id IN (${list}) THEN t.to_entry_id ELSE t.from_entry_id END
           FROM transfers t
           JOIN entries f ON f.id = t.from_entry_id
           JOIN entries o ON o.id = t.to_entry_id
           WHERE (f.account_id IN (${list})) <> (o.account_id IN (${list})))`
      )
      .run(...family, ...family, ...family, ...family);
    raw
      .prepare(
        `DELETE FROM transfers WHERE from_entry_id IN (${doomed}) OR to_entry_id IN (${doomed})`
      )
      .run(...family, ...family);

    // Quem aponta para os lançamentos que saem perde o vínculo, não a linha.
    raw
      .prepare(
        `UPDATE entries SET refund_of_entry_id = NULL
         WHERE refund_of_entry_id IN (${doomed}) AND account_id NOT IN (${list})`
      )
      .run(...family, ...family);
    raw
      .prepare(
        `UPDATE entries SET parent_entry_id = NULL
         WHERE parent_entry_id IN (${doomed}) AND account_id NOT IN (${list})`
      )
      .run(...family, ...family);
    raw.prepare(`UPDATE import_rows SET entry_id = NULL WHERE entry_id IN (${doomed})`).run(...family);
    raw
      .prepare(`UPDATE import_rows SET duplicate_of_entry_id = NULL WHERE duplicate_of_entry_id IN (${doomed})`)
      .run(...family);
    raw
      .prepare(`UPDATE import_rows SET counterparty_account_id = NULL WHERE counterparty_account_id IN (${list})`)
      .run(...family);

    // Os extratos importados da conta vão junto com ela.
    const batches = `SELECT id FROM import_batches WHERE account_id IN (${list})`;
    raw
      .prepare(
        `UPDATE entries SET import_row_id = NULL
         WHERE import_row_id IN (SELECT id FROM import_rows WHERE batch_id IN (${batches}))`
      )
      .run(...family);
    raw.prepare(`DELETE FROM import_rows WHERE batch_id IN (${batches})`).run(...family);
    raw.prepare(`DELETE FROM import_batches WHERE account_id IN (${list})`).run(...family);

    // Regra que só vale para esta conta ficaria valendo para todas.
    raw
      .prepare(
        `DELETE FROM rules WHERE id IN (
           SELECT rule_id FROM rule_conditions
           WHERE op = 'account_is' AND CAST(value AS INTEGER) IN (${list}))`
      )
      .run(...family);

    const removedEntries = raw
      .prepare(
        `UPDATE entries SET refund_of_entry_id = NULL, parent_entry_id = NULL
         WHERE account_id IN (${list})`
      )
      .run(...family).changes;
    raw.prepare(`DELETE FROM entries WHERE account_id IN (${list})`).run(...family);
    raw.prepare(`DELETE FROM installment_plans WHERE account_id IN (${list})`).run(...family);
    raw.prepare(`DELETE FROM goals WHERE account_id IN (${list})`).run(...family);
    // A caixinha atrelada a esta conta continua com o saldo dela, à espera de
    // outra conta.
    raw.prepare(`UPDATE goals SET parent_account_id = NULL WHERE parent_account_id IN (${list})`).run(...family);
    // Cartões antes do banco: eles apontam para ele.
    for (const cardId of family.slice(1)) raw.prepare("DELETE FROM accounts WHERE id = ?").run(cardId);
    raw.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    return { entries: removedEntries, cards: family.length - 1 };
  });
}

export function purgeCategory(db: AppDatabase, id: number) {
  const raw = db.raw;
  if (!raw.prepare("SELECT 1 FROM categories WHERE id = ?").get(id)) {
    throw fail("Categoria nao encontrada", 404);
  }
  return db.transaction(() => {
    const entries = raw.prepare("UPDATE entries SET category_id = NULL WHERE category_id = ?").run(id).changes;
    raw.prepare("UPDATE installment_plans SET category_id = NULL WHERE category_id = ?").run(id);
    raw.prepare("UPDATE places SET default_category_id = NULL WHERE default_category_id = ?").run(id);
    raw.prepare("UPDATE import_rows SET suggested_category_id = NULL WHERE suggested_category_id = ?").run(id);
    raw
      .prepare("DELETE FROM rule_actions WHERE action = 'set_category' AND CAST(value AS INTEGER) = ?")
      .run(id);
    raw.prepare("DELETE FROM categories WHERE id = ?").run(id);
    return { entries };
  });
}

export function purgePerson(db: AppDatabase, id: number) {
  const raw = db.raw;
  if (!raw.prepare("SELECT 1 FROM people WHERE id = ?").get(id)) {
    throw fail("Pessoa nao encontrada", 404);
  }
  return db.transaction(() => {
    const entries = raw.prepare("UPDATE entries SET person_id = NULL WHERE person_id = ?").run(id).changes;
    const accounts = raw.prepare("UPDATE accounts SET person_id = NULL WHERE person_id = ?").run(id).changes;
    raw.prepare("DELETE FROM person_period_budgets WHERE person_id = ?").run(id);
    raw
      .prepare("DELETE FROM rule_actions WHERE action = 'set_person' AND CAST(value AS INTEGER) = ?")
      .run(id);
    raw.prepare("DELETE FROM people WHERE id = ?").run(id);
    return { entries, accounts };
  });
}

/** Caixinha com conta própria vai com a conta; a de marcação só solta os lançamentos. */
export function purgeGoal(db: AppDatabase, id: number) {
  const goal = db.raw.prepare("SELECT id, mode, account_id AS accountId FROM goals WHERE id = ?").get(id) as
    | { id: number; mode: string; accountId: number | null }
    | undefined;
  if (!goal) throw fail("Caixinha nao encontrada", 404);
  if (goal.mode === "account" && goal.accountId != null) {
    return purgeAccount(db, goal.accountId);
  }
  return db.transaction(() => {
    db.raw.prepare("DELETE FROM goal_allocations WHERE goal_id = ?").run(id);
    db.raw.prepare("DELETE FROM goals WHERE id = ?").run(id);
    return { entries: 0, cards: 0 };
  });
}
