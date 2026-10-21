import { manualPositionSchema } from "@projeto41/contracts";
import { investmentSettingKey } from "@projeto41/db";
import { z } from "zod";
import { removePosition } from "../services/investment-cash-service.js";
import {
  correctPosition,
  incorporateYield,
  listPositionsWithYield,
  positionStatement,
  recordPastContribution,
  syncPosition
} from "../services/position-yield.js";
import type { RoutePlugin } from "./index.js";

/** Posicoes manuais, metas de alocacao e planejamento: tudo cadastro do usuario. */
const idParam = z.object({ id: z.coerce.number().int().positive() });

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export const registerPositionsRoutes: RoutePlugin = (app, { db, cdiService }) => {
  /** Série do CDI em dia antes de render; o serviço nunca lança. */
  async function warmCdi() {
    if (!cdiService) return;
    await cdiService.ensureRange("2018-01-01", today()).catch(() => undefined);
  }

  app.get("/api/positions", async () => {
    await warmCdi();
    return listPositionsWithYield(db, today());
  });
  /** Soma o rendimento realizado ao valor atual da posição. */
  app.post("/api/positions/:id/accrue", async (request) => {
    const { id } = idParam.parse(request.params);
    await warmCdi();
    return incorporateYield(db, id, today());
  });
  app.post("/api/positions", async (request, reply) => {
    const input = manualPositionSchema.parse(request.body);
    // O valor digitado na criação é o saldo de hoje: entra como correção, e
    // o extrato fecha nele.
    const id = db.positions.upsert({ ...input, currentValue: 0 });
    if (input.currentValue > 0) correctPosition(db, id, { date: today(), value: input.currentValue }, today());
    return reply.status(201).send({ id });
  });
  app.put("/api/positions/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const input = manualPositionSchema.parse(request.body);
    const before = db.positions.get(id);
    if (!before) throw Object.assign(new Error("Posicao nao encontrada"), { statusCode: 404 });
    // O valor atual não se sobrescreve: ele é a soma do extrato. Um valor
    // diferente digitado aqui é uma correção de hoje.
    db.positions.upsert({ ...input, id, currentValue: before.currentValue });
    // Mudar o percentual ou o início refaz o rendimento dali em diante.
    if (before.cdiSince !== (input.cdiSince ?? null) || before.cdiPercent !== (input.cdiPercent ?? null)) {
      const dates = [before.cdiSince, input.cdiSince].filter((date): date is string => date != null);
      if (dates.length > 0) {
        const since = dates.sort()[0]!;
        db.raw
          .prepare("DELETE FROM position_movements WHERE position_id = ? AND kind = 'yield' AND date >= ?")
          .run(id, since);
      }
    }
    if (Math.abs(input.currentValue - before.currentValue) >= 0.005) {
      correctPosition(db, id, { date: today(), value: input.currentValue }, today());
    } else {
      syncPosition(db, id, today());
    }
    return { ok: true };
  });
  /** "O valor real era X no fim do dia D": o sistema recalcula dali em diante. */
  app.post("/api/positions/:id/correct", async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ date: z.string().date(), value: z.number().nonnegative() }).parse(request.body);
    await warmCdi();
    return correctPosition(db, id, body, today());
  });
  /** Aporte que aconteceu antes do app, sem passar por uma conta dele. */
  app.post("/api/positions/:id/history", async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ date: z.string().date(), amount: z.number().refine((value) => value !== 0) })
      .parse(request.body);
    await warmCdi();
    return recordPastContribution(db, id, body, today());
  });
  app.get("/api/positions/:id/statement", async (request) => {
    const { id } = idParam.parse(request.params);
    return positionStatement(db, id);
  });
  app.delete("/api/positions/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    removePosition(db, id);
    return { ok: true };
  });

  app.get("/api/allocation", async () => db.targets.list());
  app.put("/api/allocation/:category", async (request) => {
    const { category } = z.object({ category: z.string().min(1) }).parse(request.params);
    const { weight } = z.object({ weight: z.number().min(0).max(1) }).parse(request.body);
    db.targets.set(category, weight);
    return { ok: true };
  });

  app.get("/api/planning", async () => ({
    initialCapital: Number(db.settings.get(investmentSettingKey("initialCapital")) ?? 0),
    monthlyContribution: Number(db.settings.get(investmentSettingKey("monthlyContribution")) ?? 0),
    monthlyReturnPercent: Number(db.settings.get(investmentSettingKey("monthlyReturnPercent")) ?? 0),
    months: Number(db.settings.get(investmentSettingKey("months")) ?? 120),
    annualInflationPercent: Number(db.settings.get(investmentSettingKey("annualInflationPercent")) ?? 0),
    initialYear: Number(db.settings.get(investmentSettingKey("initialYear")) ?? new Date().getFullYear())
  }));
  app.put("/api/planning", async (request) => {
    const values = z
      .object({
        initialCapital: z.number().nonnegative(),
        monthlyContribution: z.number().nonnegative(),
        monthlyReturnPercent: z.number(),
        months: z.number().int().positive(),
        annualInflationPercent: z.number(),
        initialYear: z.number().int()
      })
      .parse(request.body);
    // O planejamento é de cada conta de investimento.
    for (const [key, value] of Object.entries(values)) {
      db.settings.set(investmentSettingKey(key), String(value));
    }
    return { ok: true };
  });

  app.get("/api/history", async () => db.snapshots.list());
};
