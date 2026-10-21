import { createEntriesRepository } from "./entries.js";
import { LedgerError, notFound, type Db } from "./shared.js";

/**
 * Estorno (plano mestre 6.6).
 *
 * Um estorno e um lancamento de **sinal oposto** com `refund_of_entry_id`
 * apontando para o original. Nao e receita, nao e transferencia e nao tem
 * tabela propria: ele abate a despesa por soma natural, o que e exatamente o
 * que faz uma categoria poder ficar negativa no mes — e isso e correto, nao e
 * bug a ser escondido.
 */
export function createRefundsRepository(db: Db) {
  const entries = createEntriesRepository(db);

  function originalOf(entryId: number) {
    const row = db
      .prepare(
        `SELECT id, account_id AS accountId, person_id AS personId, category_id AS categoryId,
                place_id AS placeId, amount_cents AS amountCents, kind, description,
                refund_of_entry_id AS refundOfEntryId, installment_plan_id AS installmentPlanId,
                counts_toward_target AS countsTowardTarget
         FROM entries WHERE id = ?`
      )
      .get(entryId) as
      | {
          id: number;
          accountId: number;
          personId: number | null;
          categoryId: number | null;
          placeId: number | null;
          amountCents: number;
          kind: "expense" | "income" | "transfer" | "adjustment";
          description: string | null;
          refundOfEntryId: number | null;
          installmentPlanId: number | null;
          countsTowardTarget: number;
        }
      | undefined;
    if (!row) throw notFound("Lancamento");
    if (row.kind === "transfer") {
      throw new LedgerError("Transferencia nao tem estorno");
    }
    if (row.refundOfEntryId != null) {
      throw new LedgerError("Nao da para estornar um estorno");
    }
    return row;
  }

  /** Total da compra parcelada e o que ja foi devolvido de qualquer parcela dela. */
  function planRefunds(planId: number) {
    return db
      .prepare(
        `SELECT p.total_cents AS totalCents,
                (SELECT COALESCE(SUM(r.amount_cents), 0) FROM entries r
                 JOIN entries o ON o.id = r.refund_of_entry_id
                 WHERE o.installment_plan_id = p.id) AS refundedCents
         FROM installment_plans p WHERE p.id = ?`
      )
      .get(planId) as { totalCents: number; refundedCents: number };
  }

  const repository = {
    /** Soma ja estornada de um lancamento, para não estornar mais que o total. */
    refundedCents: (entryId: number): number =>
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total
             FROM entries WHERE refund_of_entry_id = ?`
          )
          .get(entryId) as { total: number }
      ).total,

    create: (
      entryId: number,
      input: {
        amountCents?: number;
        date: string;
        description?: string | null;
      }
    ): number => {
      const original = originalOf(entryId);
      const magnitude = Math.abs(original.amountCents);
      // O estorno tem o sinal contrário do original: devolve uma saída (+) ou
      // desfaz uma entrada (−). Sempre positivo, estornar uma receita somava
      // dinheiro na conta em vez de tirar.
      const direction = original.amountCents < 0 ? 1 : -1;
      const amountCents = direction * Math.abs(input.amountCents ?? magnitude);
      const already = Math.abs(repository.refundedCents(entryId));

      if (already + Math.abs(amountCents) > magnitude) {
        throw new LedgerError("O estorno passa do valor do lancamento original");
      }
      // Numa parcela, o teto tambem e o da compra inteira: o estorno integral
      // do plano fica preso a primeira parcela, mas devolve todas.
      if (original.installmentPlanId != null) {
        const plan = planRefunds(original.installmentPlanId);
        if (plan.refundedCents + Math.abs(amountCents) > plan.totalCents) {
          throw new LedgerError("O estorno passa do valor da compra parcelada");
        }
      }

      // `kind` continua o do original: estorno de despesa e `expense` com valor
      // positivo, e e assim que ele abate a categoria em vez de virar receita.
      return entries.createInternal({
        accountId: original.accountId,
        personId: original.personId,
        date: input.date,
        amountCents,
        kind: original.kind,
        status: "cleared",
        categoryId: original.categoryId,
        placeId: original.placeId,
        description: input.description ?? `Estorno · ${original.description ?? "lançamento"}`,
        refundOfEntryId: entryId,
        // O mesmo flag do original, para abater o realizado do alvo pela soma
        // natural (6.4).
        countsTowardTarget: original.countsTowardTarget === 1,
        tagIds: []
      });
    },

    /**
     * Estorno integral de uma compra parcelada.
     *
     * Chega **de uma vez** na fatura da data do estorno, enquanto as parcelas
     * seguem correndo (6.6). Nao cancela, nao apaga e nao redistribui parcela
     * nenhuma — a fatura real do banco faz exatamente isso.
     */
    createForPlan: (
      planId: number,
      input: { date: string; description?: string | null }
    ): number => {
      const plan = db
        .prepare(
          `SELECT id, account_id AS accountId, total_cents AS totalCents,
                  category_id AS categoryId, place_id AS placeId, description
           FROM installment_plans WHERE id = ?`
        )
        .get(planId) as
        | {
            id: number;
            accountId: number;
            totalCents: number;
            categoryId: number | null;
            placeId: number | null;
            description: string | null;
          }
        | undefined;
      if (!plan) throw notFound("Plano");

      const first = db
        .prepare(
          `SELECT id, person_id AS personId FROM entries
           WHERE installment_plan_id = ? ORDER BY installment_number LIMIT 1`
        )
        .get(planId) as { id: number; personId: number | null } | undefined;
      if (!first) throw notFound("Parcela");
      if (planRefunds(planId).refundedCents > 0) {
        throw new LedgerError(
          "Esta compra parcelada ja tem estorno: o total ja foi devolvido em parte ou por inteiro"
        );
      }

      return entries.createInternal({
        accountId: plan.accountId,
        // A pessoa da compra, nao a dona do cartao: e do realizado dela que o
        // estorno abate no alvo.
        personId: first.personId,
        date: input.date,
        amountCents: plan.totalCents,
        kind: "expense",
        status: "cleared",
        categoryId: plan.categoryId,
        placeId: plan.placeId,
        description: input.description ?? `Estorno · ${plan.description ?? "compra parcelada"}`,
        // Aponta para a primeira parcela, que é o âncora da série; as demais
        // continuam existindo e sendo cobradas.
        refundOfEntryId: first.id,
        countsTowardTarget: true,
        tagIds: []
      });
    },

    /** Excluir o original com estorno vivo e bloqueado: some o vinculo. */
    assertRemovable: (entryId: number) => {
      const count = (
        db
          .prepare("SELECT COUNT(*) AS n FROM entries WHERE refund_of_entry_id = ?")
          .get(entryId) as { n: number }
      ).n;
      if (count > 0) {
        throw new LedgerError("Remova antes o estorno deste lancamento");
      }
    }
  };

  return repository;
}
