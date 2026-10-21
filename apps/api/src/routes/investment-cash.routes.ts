import { z } from "zod";
import {
  depositToPosition,
  moveBetweenPositions,
  readCashSettings,
  undoMovement,
  withdrawFromPosition,
  writeCashSettings
} from "../services/investment-cash-service.js";
import type { RoutePlugin } from "./index.js";

const id = z.number().int().positive();
const settingsSchema = z.object({
  autoDebit: z.boolean(),
  defaultAccountId: id.nullable(),
  defaultPositionId: id.nullable()
});
const date = z.string().date();
const cents = z.number().int().positive();

/**
 * O dinheiro entre o banco e as posições de investimento (migração 010).
 * Toda mutação devolve as posições e os saldos de novo: as duas telas que
 * mostram esse dinheiro mudam juntas.
 */
export const registerInvestmentCashRoutes: RoutePlugin = (app, { db }) => {
  const snapshot = () => ({
    positions: db.positions.list(),
    balances: db.ledger.balances.consolidated()
  });

  const kindOf = (accountId: number | null) =>
    accountId == null
      ? null
      : ((db.raw.prepare("SELECT kind FROM accounts WHERE id = ?").get(accountId) as
          | { kind: string }
          | undefined)?.kind ?? null);

  app.get("/api/investments/cash-settings", async () => readCashSettings(db));

  app.put("/api/investments/cash-settings", async (request, reply) => {
    const settings = settingsSchema.parse(request.body);
    // Comprar acao no cartao nao e um caso que este app modela.
    const kind = kindOf(settings.defaultAccountId);
    if (kind === "credit_card" || kind === "investment") {
      return reply
        .status(400)
        .send({ error: "A conta padrao precisa ser uma conta bancaria, nao cartao nem investimento" });
    }
    if (settings.defaultPositionId != null && !db.positions.get(settings.defaultPositionId)) {
      return reply.status(400).send({ error: "Caixa padrao nao encontrado" });
    }
    writeCashSettings(db, settings);
    return { ok: true, settings: readCashSettings(db) };
  });

  app.get("/api/investments/movements", async (request) => {
    const query = z
      .object({
        positionId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(500).optional()
      })
      .parse(request.query);
    return db.positionMovements.list(query);
  });

  app.post("/api/investments/deposit", async (request, reply) => {
    const input = z
      .object({
        positionId: id,
        fromAccountId: id,
        amountCents: cents,
        date,
        replacesEntryId: id.nullable().optional()
      })
      .parse(request.body);
    const result = depositToPosition(db, input);
    return reply.status(201).send({ ...result, ...snapshot() });
  });

  app.post("/api/investments/withdraw", async (request, reply) => {
    const input = z
      .object({ positionId: id, toAccountId: id, amountCents: cents, date })
      .parse(request.body);
    const result = withdrawFromPosition(db, input);
    return reply.status(201).send({ ...result, ...snapshot() });
  });

  app.post("/api/investments/move", async (request, reply) => {
    const input = z
      .object({ fromPositionId: id, toPositionId: id, amount: z.number().positive(), date })
      .parse(request.body);
    const result = moveBetweenPositions(db, input);
    return reply.status(201).send({ ...result, ...snapshot() });
  });

  /**
   * Desfaz pelo livro: o aporte ou resgate que aparece como lançamento é
   * achado pela transferência e desfeito como na tela Em caixa, devolvendo a
   * posição junto.
   */
  app.delete("/api/investments/transfers/:transferId", async (request, reply) => {
    const { transferId } = z
      .object({ transferId: z.coerce.number().int().positive() })
      .parse(request.params);
    const movement = db.raw
      .prepare("SELECT id FROM position_movements WHERE transfer_id = ?")
      .get(transferId) as { id: number } | undefined;
    if (!movement) {
      return reply.status(404).send({
        error: "Movimento de investimento nao encontrado. Se for compra ou venda, exclua pela carteira."
      });
    }
    undoMovement(db, movement.id);
    return { ok: true, ...snapshot() };
  });

  app.delete("/api/investments/movements/:id", async (request) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    undoMovement(db, params.id);
    return { ok: true, ...snapshot() };
  });
};
