import type {
  CreateInstallmentPlanInput,
  InstallmentPlanRecord,
  UpdateInstallmentPlanInput
} from "@projeto41/contracts";
import { installmentDates, installmentStatementMonth, splitCents } from "@projeto41/finance";
import { createCardsRepository } from "./cards.js";
import { createEntriesRepository } from "./entries.js";
import { LedgerError, notFound, nowIso, type Db } from "./shared.js";

/**
 * Parcelamento: um plano mais N lancamentos reais (D23).
 *
 * O vinculo parcela→plano e **persistido** em `installment_plan_id`. Nada no
 * sistema pode reconstruir a serie por descricao, valor ou data — e a falha
 * documentada do SolverFin #662, em que a interface tentou remontar a relacao e
 * corrompeu os dados. Se um dia parecer que a coluna e redundante, ela nao e.
 */

const SELECT_PLAN = `
  SELECT p.id, p.account_id AS accountId, a.name AS accountName, p.description,
         p.purchase_date AS purchaseDate, p.total_cents AS totalCents,
         p.installment_count AS installmentCount, p.place_id AS placeId,
         p.category_id AS categoryId, c.name AS categoryName
  FROM installment_plans p
  JOIN accounts a ON a.id = p.account_id
  LEFT JOIN categories c ON c.id = p.category_id
`;

/**
 * A parcela ja aconteceu: foi liquidada (a mao ou pelo extrato importado) ou
 * esta numa fatura que ja recebeu pagamento. Pagar a fatura nao muda o status
 * da parcela, entao `pending` sozinho nao quer dizer "futura" — tratar assim
 * apagava ou movia parcelas de faturas ja pagas.
 */
const SETTLED_SQL = `(e.status IN ('cleared','reconciled') OR EXISTS (
  SELECT 1 FROM entries pe JOIN transfers t ON t.to_entry_id = pe.id
  WHERE t.purpose = 'invoice_payment' AND pe.account_id = e.account_id
    AND pe.statement_month = e.statement_month))`;

type PlanRow = Omit<
  InstallmentPlanRecord,
  "paidCount" | "remainingCount" | "remainingCents" | "lastStatementMonth" | "sumCents" | "sumMatchesTotal"
>;

export function createInstallmentPlansRepository(db: Db) {
  const cards = createCardsRepository(db);
  const entries = createEntriesRepository(db);

  function stats(planId: number) {
    return db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN ${SETTLED_SQL} THEN 1 ELSE 0 END), 0) AS paidCount,
           COALESCE(SUM(CASE WHEN ${SETTLED_SQL} THEN 0 ELSE 1 END), 0) AS remainingCount,
           -COALESCE(SUM(CASE WHEN ${SETTLED_SQL} THEN 0 ELSE e.amount_cents END), 0)
             AS remainingCents,
           -COALESCE(SUM(e.amount_cents), 0) AS sumCents,
           MAX(e.statement_month) AS lastStatementMonth
         FROM entries e WHERE e.installment_plan_id = ?`
      )
      .get(planId) as {
      paidCount: number;
      remainingCount: number;
      remainingCents: number;
      sumCents: number;
      lastStatementMonth: string | null;
    };
  }

  function hydrate(row: PlanRow): InstallmentPlanRecord {
    const info = stats(row.id);
    return {
      ...row,
      paidCount: info.paidCount,
      remainingCount: info.remainingCount,
      remainingCents: info.remainingCents,
      lastStatementMonth: info.lastStatementMonth,
      sumCents: info.sumCents,
      sumMatchesTotal: info.sumCents === row.totalCents
    };
  }

  const repository = {
    list: (options: { accountId?: number; activeOnly?: boolean } = {}): InstallmentPlanRecord[] => {
      const where: string[] = [];
      if (options.accountId) where.push(`p.account_id = ${Number(options.accountId)}`);
      const rows = db
        .prepare(`${SELECT_PLAN} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                  ORDER BY p.purchase_date DESC, p.id DESC`)
        .all() as PlanRow[];
      const plans = rows.map(hydrate);
      return options.activeOnly ? plans.filter((plan) => plan.remainingCount > 0) : plans;
    },

    get: (id: number): InstallmentPlanRecord | undefined => {
      const row = db.prepare(`${SELECT_PLAN} WHERE p.id = ?`).get(id) as PlanRow | undefined;
      return row ? hydrate(row) : undefined;
    },

    /**
     * A serie sai em ordem de parcela, nao na ordem do livro (`date DESC`):
     * ninguem le "3/3, 2/3, 1/3".
     */
    installments: (planId: number) =>
      entries
        .listAll({ installmentPlanId: planId, pageSize: 500 })
        .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0)),

    /** Plano e N parcelas numa transacao so (D23). */
    create: (input: CreateInstallmentPlanInput): number =>
      db.transaction(() => {
        const cycle = cards.cycle(input.accountId);
        const count = input.installmentCount;
        // A divisao vem de `splitCents`: partes iguais com todo o resto na
        // primeira parcela (6.3). Nao reimplementar aqui.
        const amounts = splitCents(input.totalCents, count);
        const dates = installmentDates(input.purchaseDate, count);
        // Uma parcela por fatura, a partir da fatura da compra: nunca pela
        // data de cada parcela (ver `installmentStatementMonth`).
        const months = dates.map((_, index) =>
          installmentStatementMonth(input.purchaseDate, index + 1, cycle.closingDay, cycle.dueDay)
        );

        const planId = Number(
          db
            .prepare(
              `INSERT INTO installment_plans
               (account_id, description, purchase_date, total_cents, installment_count,
                place_id, category_id, created_at)
               VALUES (@accountId, @description, @purchaseDate, @totalCents, @installmentCount,
                       @placeId, @categoryId, @createdAt)`
            )
            .run({
              accountId: input.accountId,
              description: input.description ?? null,
              purchaseDate: input.purchaseDate,
              totalCents: input.totalCents,
              installmentCount: count,
              placeId: input.placeId ?? null,
              categoryId: input.categoryId ?? null,
              createdAt: nowIso()
            }).lastInsertRowid
        );

        for (let index = 0; index < count; index += 1) {
          entries.createInternal({
            accountId: input.accountId,
            personId: input.personId ?? null,
            date: dates[index]!,
            amountCents: -(amounts[index] ?? 0),
            kind: "expense",
            // Parcela futura nasce pendente; a primeira segue a data da compra.
            status: "pending",
            categoryId: input.categoryId ?? null,
            placeId: input.placeId ?? null,
            description: input.description ?? null,
            paymentMethod: "credit",
            installmentPlanId: planId,
            installmentNumber: index + 1,
            // Parcela nao e excecao da regra de fatura: cada uma passa pelo
            // caminho normal, com o ciclo deste cartao.
            statementMonth: months[index]!,
            tagIds: []
          });
        }
        return planId;
      })(),

    /** Total e numero de parcelas sao somente-leitura depois de criados (6.3). */
    update: (id: number, patch: UpdateInstallmentPlanInput & Record<string, unknown>): number => {
      if ("totalCents" in patch || "installmentCount" in patch) {
        throw new LedgerError(
          "Total e numero de parcelas nao podem ser alterados: exclua o plano e recrie"
        );
      }
      const plan = repository.get(id);
      if (!plan) throw notFound("Plano");

      return db.transaction(() => {
        db.prepare(
          `UPDATE installment_plans SET description=@description, place_id=@placeId,
           category_id=@categoryId WHERE id=@id`
        ).run({
          id,
          description: patch.description ?? plan.description,
          placeId: patch.placeId ?? plan.placeId,
          categoryId: patch.categoryId ?? plan.categoryId
        });

        // Os campos nao monetarios descem para a serie inteira; valor, nunca.
        db.prepare(
          `UPDATE entries SET description=@description, place_id=@placeId,
           category_id=@categoryId, person_id=COALESCE(@personId, person_id), updated_at=@now
           WHERE installment_plan_id=@id`
        ).run({
          id,
          description: patch.description ?? plan.description,
          placeId: patch.placeId ?? plan.placeId,
          categoryId: patch.categoryId ?? plan.categoryId,
          personId: patch.personId ?? null,
          now: nowIso()
        });
        return 1;
      })();
    },

    /**
     * Move o plano e as parcelas **futuras** para outro cartao, atomicamente
     * (6.3). Parcelas ja pagas ficam no cartao antigo, onde de fato foram
     * cobradas. Plano num cartao e parcelas em outro e o estado corrompido que
     * esta transacao existe para impedir.
     */
    changeAccount: (id: number, newAccountId: number): number => {
      const plan = repository.get(id);
      if (!plan) throw notFound("Plano");
      const cycle = cards.cycle(newAccountId);

      return db.transaction(() => {
        db.prepare("UPDATE installment_plans SET account_id = ? WHERE id = ?").run(
          newAccountId,
          id
        );
        const pending = db
          .prepare(
            `SELECT e.id, e.installment_number AS installmentNumber FROM entries e
             WHERE e.installment_plan_id = ? AND NOT ${SETTLED_SQL}`
          )
          .all(id) as { id: number; installmentNumber: number | null }[];

        const update = db.prepare(
          `UPDATE entries SET account_id = ?, statement_month = ?, updated_at = ? WHERE id = ?`
        );
        for (const row of pending) {
          // O ciclo do cartao de destino quase nunca e o mesmo, entao cada
          // parcela precisa de `statement_month` recalculado — pela mesma
          // regra da criacao, uma por fatura a partir da compra.
          update.run(
            newAccountId,
            installmentStatementMonth(
              plan.purchaseDate,
              row.installmentNumber ?? 1,
              cycle.closingDay,
              cycle.dueDay
            ),
            nowIso(),
            row.id
          );
        }
        return pending.length;
      })();
    },

    /**
     * Edita **uma** parcela. O sistema nao redistribui sozinho (6.3): isso
     * apagaria o ajuste manual que o usuario acabou de fazer. Ele avisa.
     */
    setInstallmentAmount: (planId: number, number: number, amountCents: number) => {
      const plan = repository.get(planId);
      if (!plan) throw notFound("Plano");
      const changes = db
        .prepare(
          `UPDATE entries SET amount_cents = ?, updated_at = ?
           WHERE installment_plan_id = ? AND installment_number = ?`
        )
        .run(-Math.abs(amountCents), nowIso(), planId, number).changes;
      if (changes === 0) throw notFound("Parcela");

      const info = stats(planId);
      return {
        ok: true as const,
        sumMatchesTotal: info.sumCents === plan.totalCents,
        differenceCents: info.sumCents - plan.totalCents
      };
    },

    /**
     * Exclui o plano e as parcelas **que ainda nao aconteceram**. Parcela
     * liquidada ou numa fatura ja paga sobrevive sem o vinculo: nunca apagar
     * historico cobrado.
     */
    remove: (id: number) => {
      const plan = repository.get(id);
      if (!plan) throw notFound("Plano");

      return db.transaction(() => {
        const removed = db
          .prepare(`DELETE FROM entries AS e WHERE e.installment_plan_id = ? AND NOT ${SETTLED_SQL}`)
          .run(id).changes;
        const kept = db
          .prepare(
            `UPDATE entries SET installment_plan_id = NULL, installment_number = NULL,
             updated_at = ? WHERE installment_plan_id = ?`
          )
          .run(nowIso(), id).changes;
        db.prepare("DELETE FROM installment_plans WHERE id = ?").run(id);
        return { removed, kept };
      })();
    }
  };

  return repository;
}
