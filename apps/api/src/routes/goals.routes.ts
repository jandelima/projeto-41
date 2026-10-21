import {
  entryFilterSchema,
  goalAccrueSchema,
  goalAllocationSchema,
  goalCorrectionSchema,
  goalCreateSchema,
  goalDepositSchema,
  goalMarkSchema,
  goalProfitAdjustSchema,
  goalProfitSchema,
  goalUpdateSchema,
  goalWithdrawalSchema
} from "@projeto41/contracts";
import { z } from "zod";
import { purgeGoal } from "../services/purge-service.js";
import type { RoutePlugin } from "./index.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Ordem das caixinhas na tela, escolhida pelo usuário. Fica em `settings`
 * como lista de ids: caixinha fora da lista (nova) vai para o fim.
 */
const ORDER_KEY = "goals.order";
const orderSchema = z.object({
  ids: z.array(z.number().int().positive()).max(500)
});

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Caixinhas.
 *
 * Toda resposta com rendimento traz **quatro números distintos e rotulados** —
 * realizado, até quando, projetado e até quando. Não existe campo único de
 * "rendimento": se existisse, alguém somaria projeção com realizado na primeira
 * refatoração.
 */
export const registerGoalsRoutes: RoutePlugin = (app, { db, cdiService }) => {
  const ledger = db.ledger;
  const balances = () => ledger.balances.consolidated();

  /**
   * Mantém a série quente sem transformar a rota em refém da rede: o serviço
   * nunca lança e tem limite de 15 minutos.
   */
  async function warmCdi() {
    if (!cdiService) return;
    await cdiService.ensureRange("2018-01-01", today()).catch(() => undefined);
  }

  function savedOrder(): number[] {
    try {
      const parsed = orderSchema.shape.ids.safeParse(
        JSON.parse(db.settings.get(ORDER_KEY) ?? "[]")
      );
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  app.get("/api/ledger/goals", async (request) => {
    const { includeArchived } = z
      .object({
        includeArchived: z
          .enum(["true", "false", "1", "0"])
          .transform((value) => value === "true" || value === "1")
          .optional()
      })
      .parse(request.query);
    await warmCdi();
    const position = new Map(savedOrder().map((id, index) => [id, index]));
    const rank = (id: number) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
    const goals = ledger.goals.list(includeArchived);
    // O rendimento entra sozinho: cada leitura deixa as caixinhas em dia.
    for (const goal of goals) if (!goal.archived) ledger.goals.accrue(goal.id, today());
    return goals
      .sort((a, b) => rank(a.id) - rank(b.id) || a.id - b.id)
      .map((goal) => ledger.goals.progress(goal.id, today()));
  });

  /** Grava a ordem da tela. Ids que não são caixinha são ignorados. */
  app.put("/api/ledger/goals/order", async (request) => {
    const { ids } = orderSchema.parse(request.body);
    const known = new Set(ledger.goals.list(true).map((goal) => goal.id));
    const clean = [...new Set(ids)].filter((id) => known.has(id));
    db.settings.set(ORDER_KEY, JSON.stringify(clean));
    return { ok: true, ids: clean };
  });

  app.get("/api/ledger/goals/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    await warmCdi();
    if (!goal.archived) ledger.goals.accrue(id, today());
    return {
      goal: ledger.goals.progress(id, today()),
      cdi: cdiService ? await cdiService.status() : null
    };
  });

  /** Mesmo formato de `GET /api/ledger/entries`, para reaproveitar a tabela. */
  app.get("/api/ledger/goals/:id/entries", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const filter = entryFilterSchema.parse(request.query);
    return ledger.entries.list({
      ...filter,
      goalId: id,
      accountId: goal.accountId ?? undefined
    });
  });

  app.post("/api/ledger/goals", async (request, reply) => {
    const id = ledger.goals.create(goalCreateSchema.parse(request.body));
    return reply.status(201).send({
      id,
      goal: ledger.goals.progress(id, today()),
      balances: balances()
    });
  });

  app.put("/api/ledger/goals/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    // O contrato não tem `mode`, e o repositório o ignora mesmo que chegue.
    ledger.goals.update(id, goalUpdateSchema.parse(request.body));
    return { ok: true, goal: ledger.goals.progress(id, today()) };
  });

  app.delete("/api/ledger/goals/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    // `?purge=1`: exclui de vez, com a conta e os lançamentos da caixinha.
    const { purge } = z.object({ purge: z.enum(["1", "true"]).optional() }).parse(request.query);
    if (purge) {
      purgeGoal(db, id);
      return { ok: true, archived: false, balances: balances() };
    }
    const result = ledger.goals.remove(id);
    return { ok: true, archived: !result.removed, balances: balances() };
  });

  app.post("/api/ledger/goals/:id/deposit", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    ledger.goals.deposit(id, goalDepositSchema.parse(request.body));
    return reply.status(201).send({
      ok: true,
      goal: ledger.goals.progress(id, today()),
      balances: balances()
    });
  });

  app.post("/api/ledger/goals/:id/withdraw", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    ledger.goals.withdraw(id, goalWithdrawalSchema.parse(request.body));
    return reply.status(201).send({
      ok: true,
      goal: ledger.goals.progress(id, today()),
      balances: balances()
    });
  });

  /**
   * Lucro lançado pelo usuário, quando quiser. Vale em qualquer modo: no
   * automático ele soma ao rendimento do CDI; no manual é a única forma de o
   * lucro entrar.
   */
  app.post("/api/ledger/goals/:id/profit", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    ledger.goals.addProfit(id, goalProfitSchema.parse(request.body));
    return reply.status(201).send({
      ok: true,
      goal: ledger.goals.progress(id, today()),
      balances: balances()
    });
  });

  /** "O lucro total é X": lança a diferença como ajuste de lucro. */
  app.post("/api/ledger/goals/:id/profit/adjust", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const result = ledger.goals.adjustProfit(id, goalProfitAdjustSchema.parse(request.body), today());
    return {
      ok: true,
      ...result,
      goal: ledger.goals.progress(id, today()),
      balances: balances()
    };
  });

  app.post("/api/ledger/goals/:id/allocate", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    if (goal.mode !== "earmark") {
      return reply.status(400).send({ error: "Alocacao so existe em caixinha de marcacao" });
    }
    const body = goalAllocationSchema.parse(request.body);
    const result = ledger.goals.allocate(id, body.entryId, body.amountCents);
    return { ...result, goal: ledger.goals.progress(id, today()) };
  });

  /** Marcação por valor, sem escolher lançamento: o "Movimentar" da marcação. */
  app.post("/api/ledger/goals/:id/mark", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const { amountCents } = goalMarkSchema.parse(request.body);
    const result = ledger.goals.mark(id, amountCents);
    return {
      ...result,
      goal: ledger.goals.progress(id, today()),
      balances: balances()
    };
  });

  app.post("/api/ledger/goals/:id/deallocate", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    if (goal.mode !== "earmark") {
      return reply.status(400).send({ error: "Alocacao so existe em caixinha de marcacao" });
    }
    const { entryId } = z.object({ entryId: z.number().int().positive() }).parse(request.body);
    ledger.goals.deallocate(id, entryId);
    return { ok: true, goal: ledger.goals.progress(id, today()) };
  });

  app.post("/api/ledger/goals/:id/accrue", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const { through } = goalAccrueSchema.parse(request.body ?? {});
    await warmCdi();
    const result = ledger.goals.accrue(id, through ?? today());
    return { ok: true, ...result, goal: ledger.goals.progress(id, today()) };
  });

  app.post("/api/ledger/goals/:id/correct", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const body = goalCorrectionSchema.parse(request.body);
    await warmCdi();
    return { ok: true, goal: ledger.goals.correct(id, body, today()) };
  });
};
