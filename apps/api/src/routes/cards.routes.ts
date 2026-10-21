import {
  anticipationSchema,
  changePlanAccountSchema,
  createInstallmentPlanSchema,
  invoicePaymentSchema,
  periodSchema,
  refundSchema,
  restoreNaturalSchema,
  setInstallmentAmountSchema,
  updateInstallmentPlanSchema
} from "@projeto41/contracts";
import { z } from "zod";
import type { RoutePlugin } from "./index.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const monthParam = z.object({
  id: z.coerce.number().int().positive(),
  month: periodSchema
});

/**
 * Cartao, fatura, parcelamento e estorno.
 *
 * O cadastro do cartao **nao ganha rota nova**: cartao e uma linha de
 * `accounts` (D04) e continua sendo criado por `POST /api/ledger/accounts`.
 */
export const registerCardsRoutes: RoutePlugin = (app, { db }) => {
  const ledger = db.ledger;
  const balances = () => ledger.balances.consolidated();

  app.get("/api/ledger/cards", async () => ledger.cards.list());

  app.get("/api/ledger/cards/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    return ledger.cards.summary(id);
  });

  app.get("/api/ledger/cards/:id/statements", async (request) => {
    const { id } = idParam.parse(request.params);
    const query = z
      .object({ from: periodSchema.optional(), to: periodSchema.optional() })
      .parse(request.query);
    return ledger.statements.list(id, query);
  });

  app.get("/api/ledger/cards/:id/statements/:month", async (request) => {
    const { id, month } = monthParam.parse(request.params);
    return ledger.statements.get(id, month);
  });

  app.post("/api/ledger/cards/:id/statements/:month/payment", async (request, reply) => {
    const { id, month } = monthParam.parse(request.params);
    const payment = ledger.statements.pay(id, month, invoicePaymentSchema.parse(request.body));
    return reply.status(201).send({
      ok: true,
      payment,
      card: ledger.cards.summary(id),
      balances: balances()
    });
  });

  app.delete("/api/ledger/cards/:id/statements/:month/payment/:transferId", async (request) => {
    const { id } = monthParam.parse(request.params);
    const { transferId } = z
      .object({ transferId: z.coerce.number().int().positive() })
      .parse(request.params);
    ledger.statements.undoPayment(transferId);
    return { ok: true, card: ledger.cards.summary(id), balances: balances() };
  });

  app.post("/api/ledger/cards/:id/anticipate", async (request) => {
    const { id } = idParam.parse(request.params);
    const moved = ledger.statements.anticipate(id, anticipationSchema.parse(request.body));
    return { ok: true, moved, card: ledger.cards.summary(id) };
  });

  app.post("/api/ledger/cards/:id/anticipate/undo", async (request) => {
    const { id } = idParam.parse(request.params);
    const { entryIds } = restoreNaturalSchema.parse(request.body);
    const moved = ledger.statements.restoreNatural(entryIds);
    return { ok: true, moved, card: ledger.cards.summary(id) };
  });

  // Parcelamento -------------------------------------------------------------

  app.get("/api/ledger/installment-plans", async (request) => {
    const query = z
      .object({
        accountId: z.coerce.number().int().positive().optional(),
        activeOnly: z
          .enum(["true", "false", "1", "0"])
          .transform((value) => value === "true" || value === "1")
          .optional()
      })
      .parse(request.query);
    return ledger.installmentPlans.list(query);
  });

  app.get("/api/ledger/installment-plans/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const plan = ledger.installmentPlans.get(id);
    if (!plan) return reply.status(404).send({ error: "Plano nao encontrado" });
    return { plan, installments: ledger.installmentPlans.installments(id) };
  });

  app.post("/api/ledger/installment-plans", async (request, reply) => {
    const id = ledger.installmentPlans.create(createInstallmentPlanSchema.parse(request.body));
    const plan = ledger.installmentPlans.get(id)!;
    return reply.status(201).send({
      id,
      plan,
      installments: ledger.installmentPlans.installments(id),
      card: ledger.cards.summary(plan.accountId),
      balances: balances()
    });
  });

  app.put("/api/ledger/installment-plans/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.installmentPlans.get(id)) {
      return reply.status(404).send({ error: "Plano nao encontrado" });
    }
    // Total e numero de parcelas nem chegam ao repositorio: o contrato os omite,
    // e o repositorio recusa caso apareçam por outro caminho (6.3).
    ledger.installmentPlans.update(id, updateInstallmentPlanSchema.parse(request.body));
    return { ok: true, plan: ledger.installmentPlans.get(id) };
  });

  app.put("/api/ledger/installment-plans/:id/account", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.installmentPlans.get(id)) {
      return reply.status(404).send({ error: "Plano nao encontrado" });
    }
    const { accountId } = changePlanAccountSchema.parse(request.body);
    ledger.installmentPlans.changeAccount(id, accountId);
    return {
      ok: true,
      plan: ledger.installmentPlans.get(id),
      installments: ledger.installmentPlans.installments(id),
      card: ledger.cards.summary(accountId)
    };
  });

  app.put("/api/ledger/installment-plans/:id/installments/:number", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { number } = z
      .object({ number: z.coerce.number().int().positive() })
      .parse(request.params);
    if (!ledger.installmentPlans.get(id)) {
      return reply.status(404).send({ error: "Plano nao encontrado" });
    }
    const { amountCents } = setInstallmentAmountSchema.parse(request.body);
    const result = ledger.installmentPlans.setInstallmentAmount(id, number, amountCents);
    return {
      ...result,
      plan: ledger.installmentPlans.get(id),
      installments: ledger.installmentPlans.installments(id),
      balances: balances()
    };
  });

  app.delete("/api/ledger/installment-plans/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const plan = ledger.installmentPlans.get(id);
    if (!plan) return reply.status(404).send({ error: "Plano nao encontrado" });
    const result = ledger.installmentPlans.remove(id);
    return { ok: true, ...result, balances: balances() };
  });

  // Estorno ------------------------------------------------------------------

  app.post("/api/ledger/entries/:id/refund", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.entries.get(id)) {
      return reply.status(404).send({ error: "Lancamento nao encontrado" });
    }
    const refundId = ledger.refunds.create(id, refundSchema.parse(request.body));
    return reply.status(201).send({
      id: refundId,
      entry: ledger.entries.get(refundId),
      balances: balances()
    });
  });

  app.post("/api/ledger/installment-plans/:id/refund", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const plan = ledger.installmentPlans.get(id);
    if (!plan) return reply.status(404).send({ error: "Plano nao encontrado" });
    const refundId = ledger.refunds.createForPlan(id, refundSchema.parse(request.body));
    return reply.status(201).send({
      id: refundId,
      entry: ledger.entries.get(refundId),
      card: ledger.cards.summary(plan.accountId),
      balances: balances()
    });
  });
};
