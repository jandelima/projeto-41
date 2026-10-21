import type {
  ManualPositionRecord,
  PositionHistory,
  PositionRecord,
  PositionYield
} from "@projeto41/contracts";
import type { AppDatabase } from "@projeto41/db";
import { accrueLots, addDays, fromCents, toCents, type CdiRate, type Lot } from "@projeto41/finance";

/**
 * Posições guiadas pelo extrato: o valor é o que entrou, quando entrou e
 * quanto rendeu — o sistema calcula, ninguém digita o valor atual.
 *
 * - Cada aporte, resgate, movimento entre posições e compra paga pelo caixa é
 *   uma linha do extrato (`position_movements`).
 * - Quem rende CDI ganha uma linha `yield` por apuração, lançada sozinha a
 *   cada leitura, até o último dia com taxa publicada. Dia sem taxa é só
 *   projeção e nunca vira linha.
 * - A correção (`adjust`) é a verdade do usuário: "o valor real era X no fim
 *   do dia D". Ela guarda X (`target_value`) e a diferença é recalculada
 *   sempre, então um aporte lançado depois com data anterior não conta duas
 *   vezes. O rendimento recomeça no dia seguinte à correção.
 * - `current_value` é só a soma do extrato, refeita a cada sincronização.
 */

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

/**
 * Rende quem guarda reais: renda fixa e os caixas (Caixa BR e Reserva), que
 * costumam ficar numa conta que paga CDI. Precisa de percentual e data.
 */
const CDI_CATEGORIES = new Set(["fixed_income", "cash", "reserve"]);
const earns = (position: ManualPositionRecord) =>
  CDI_CATEGORIES.has(position.category) &&
  position.currency === "BRL" &&
  position.cdiPercent != null &&
  position.cdiSince != null;

type Movement = {
  id: number;
  date: string;
  kind: string;
  amount: number;
  targetValue: number | null;
};

function movementsOf(db: AppDatabase, positionId: number): Movement[] {
  return db.raw
    .prepare(
      `SELECT id, date, kind, amount, target_value AS targetValue
       FROM position_movements WHERE position_id = ? ORDER BY date, id`
    )
    .all(positionId) as Movement[];
}

const isFlow = (movement: Movement) => movement.kind !== "yield" && movement.kind !== "adjust";

/** Entradas viram lotes; saídas consomem os mais antigos primeiro. */
function lotsOf(movements: Movement[]): Lot[] {
  let lots: Lot[] = [];
  for (const movement of movements) {
    const cents = toCents(movement.amount);
    if (cents > 0) {
      lots.push({ principalCents: cents, startDate: movement.date });
      continue;
    }
    let remaining = -cents;
    const next: Lot[] = [];
    for (const lot of lots) {
      if (remaining <= 0) next.push(lot);
      else if (lot.principalCents <= remaining) remaining -= lot.principalCents;
      else {
        next.push({ ...lot, principalCents: lot.principalCents - remaining });
        remaining = 0;
      }
    }
    lots = next;
  }
  return lots;
}

/**
 * A partir de que dia ainda falta apurar: depois da data de início, do último
 * rendimento lançado e da última correção (que já inclui o que rendeu até ela).
 */
function accrualFrom(position: ManualPositionRecord, movements: Movement[]): string {
  let from = position.cdiSince as string;
  for (const movement of movements) {
    if (movement.kind !== "yield" && movement.kind !== "adjust") continue;
    const next = addDays(movement.date, 1);
    if (next > from) from = next;
  }
  return from;
}

function accrue(db: AppDatabase, position: ManualPositionRecord, movements: Movement[], asOf: string) {
  if (!earns(position)) return null;
  const from = accrualFrom(position, movements);
  if (from > asOf) return null;
  const rates = db.raw
    .prepare(
      `SELECT date, daily_factor AS dailyRatePercent FROM cdi_rates
       WHERE date >= ? AND date <= ? ORDER BY date`
    )
    .all(from, asOf) as CdiRate[];
  const holidays = new Set(
    (db.raw.prepare("SELECT date FROM holidays").all() as { date: string }[]).map((row) => row.date)
  );
  return accrueLots({
    lots: lotsOf(movements),
    rates,
    cdiPercent: position.cdiPercent as number,
    from,
    to: asOf,
    holidays
  });
}

/**
 * Deixa o extrato de uma posição em dia:
 * 1. rendimento apurado antes de um movimento que chegou depois com data
 *    anterior foi calculado sobre o valor errado: sai para ser refeito;
 * 2. cada correção volta a fechar no valor real informado;
 * 3. o rendimento realizado que falta vira linha `yield`;
 * 4. `current_value` passa a ser a soma do extrato.
 */
export function syncPosition(db: AppDatabase, id: number, asOf: string) {
  return db.transaction(() => {
    const position = db.positions.get(id);
    if (!position) throw fail("Posicao nao encontrada", 404);
    let movements = movementsOf(db, id);

    // Valor gravado direto (importação da planilha, dados de demonstração,
    // versões antigas) sem linha no extrato: vira a correção de hoje, para a
    // soma do extrato não apagar o número.
    const listed = movements.reduce((sum, movement) => sum + toCents(movement.amount), 0);
    if (Math.abs(toCents(position.currentValue) - listed) >= 1) {
      db.raw
        .prepare(
          `INSERT INTO position_movements
           (position_id, date, kind, amount, invested_delta, description, created_at, target_value)
           VALUES (?, ?, 'adjust', ?, 0, 'Valor informado', ?, ?)`
        )
        .run(id, asOf, fromCents(toCents(position.currentValue) - listed), new Date().toISOString(), position.currentValue);
      movements = movementsOf(db, id);
    }

    // "Chegou depois" é a ordem de gravação, e o id (AUTOINCREMENT) a guarda
    // sem empate: dois `created_at` no mesmo milissegundo não diziam quem veio
    // antes, e o aporte atrasado passava sem refazer o rendimento.
    const yields = movements.filter((movement) => movement.kind === "yield");
    const lateFlows = movements.filter(
      (movement) =>
        isFlow(movement) && yields.some((y) => y.date >= movement.date && y.id < movement.id)
    );
    if (lateFlows.length > 0) {
      const since = lateFlows.reduce((min, movement) => (movement.date < min ? movement.date : min), lateFlows[0]!.date);
      db.raw
        .prepare("DELETE FROM position_movements WHERE position_id = ? AND kind = 'yield' AND date >= ?")
        .run(id, since);
      movements = movementsOf(db, id);
    }

    const setAmount = db.raw.prepare("UPDATE position_movements SET amount = ? WHERE id = ?");
    for (const adjust of movements.filter((movement) => movement.targetValue != null)) {
      const before = movements
        .filter((movement) => movement.id !== adjust.id && movement.date <= adjust.date)
        .reduce((sum, movement) => sum + toCents(movement.amount), 0);
      const amount = fromCents(toCents(adjust.targetValue as number) - before);
      if (amount !== adjust.amount) {
        setAmount.run(amount, adjust.id);
        adjust.amount = amount;
      }
    }

    const result = accrue(db, position, movements, asOf);
    if (result && result.realizedYieldCents > 0 && result.realizedThroughDate) {
      db.raw
        .prepare(
          `INSERT INTO position_movements
           (position_id, date, kind, amount, invested_delta, description, created_at)
           VALUES (?, ?, 'yield', ?, 0, ?, ?)`
        )
        .run(
          id,
          result.realizedThroughDate,
          fromCents(result.realizedYieldCents),
          `Rendimento ${position.cdiPercent}% do CDI`,
          new Date().toISOString()
        );
    }

    const total = (
      db.raw
        .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM position_movements WHERE position_id = ?")
        .get(id) as { total: number }
    ).total;
    db.raw
      .prepare("UPDATE manual_positions SET current_value = ? WHERE id = ?")
      .run(Math.max(0, fromCents(toCents(total))), id);
    return { yieldAdded: result ? fromCents(result.realizedYieldCents) : 0 };
  });
}

function historyOf(movements: Movement[]): PositionHistory {
  const sum = (pick: (movement: Movement) => boolean) =>
    fromCents(movements.filter(pick).reduce((total, movement) => total + toCents(movement.amount), 0));
  return {
    contributed: sum(isFlow),
    yieldTotal: sum((movement) => movement.kind === "yield"),
    adjustTotal: sum((movement) => movement.kind === "adjust"),
    lastYieldDate:
      movements.filter((movement) => movement.kind === "yield").at(-1)?.date ?? null,
    lastAdjust: (() => {
      const last = movements.filter((movement) => movement.kind === "adjust").at(-1);
      return last ? { date: last.date, value: last.targetValue } : null;
    })()
  };
}

export function positionYield(
  db: AppDatabase,
  position: ManualPositionRecord,
  asOf: string
): PositionYield | null {
  const result = accrue(db, position, movementsOf(db, position.id), asOf);
  if (!earns(position)) return null;
  return {
    pendingYield: result ? fromCents(result.realizedYieldCents) : 0,
    realizedThroughDate: result?.realizedThroughDate ?? null,
    projectedYield: result ? fromCents(result.projectedYieldCents) : 0,
    projectedThroughDate: result?.projectedThroughDate ?? null
  };
}

/** Sincroniza todas e devolve cada posição com o extrato resumido. */
export function listPositionsWithYield(db: AppDatabase, asOf: string): PositionRecord[] {
  for (const position of db.positions.list()) syncPosition(db, position.id, asOf);
  return db.positions.list().map((position) => ({
    ...position,
    yield: positionYield(db, position, asOf),
    history: historyOf(movementsOf(db, position.id))
  }));
}

/** Compatível com a rota antiga: agora só sincroniza. */
export function incorporateYield(db: AppDatabase, id: number, asOf: string) {
  const position = db.positions.get(id);
  if (!position) throw fail("Posicao nao encontrada", 404);
  if (!earns(position)) throw fail("Esta posicao nao rende CDI");
  return { amount: syncPosition(db, id, asOf).yieldAdded };
}

/**
 * "O valor real era X no fim do dia D." Uma correção por dia: corrigir de novo
 * o mesmo dia troca o valor. O rendimento depois de D é refeito a partir de X.
 */
export function correctPosition(
  db: AppDatabase,
  id: number,
  input: { date: string; value: number },
  asOf: string
) {
  if (input.date > asOf) throw fail("A correcao e do valor de um dia que ja passou ou de hoje");
  if (!(input.value >= 0)) throw fail("Informe o valor real da posicao");
  return db.transaction(() => {
    if (!db.positions.get(id)) throw fail("Posicao nao encontrada", 404);
    db.raw
      .prepare("DELETE FROM position_movements WHERE position_id = ? AND kind = 'yield' AND date > ?")
      .run(id, input.date);
    db.raw
      .prepare(
        "DELETE FROM position_movements WHERE position_id = ? AND kind = 'adjust' AND date = ? AND target_value IS NOT NULL"
      )
      .run(id, input.date);
    db.raw
      .prepare(
        `INSERT INTO position_movements
         (position_id, date, kind, amount, invested_delta, description, created_at, target_value)
         VALUES (?, ?, 'adjust', 0, 0, 'Correção: valor conferido', ?, ?)`
      )
      .run(id, input.date, new Date().toISOString(), input.value);
    syncPosition(db, id, asOf);
    return { ok: true as const };
  });
}

/**
 * Aporte que não passou pelo banco do app: dinheiro que já estava aplicado
 * antes de você usar o sistema. Entra no extrato com a data real, para render
 * a partir dela.
 */
export function recordPastContribution(
  db: AppDatabase,
  id: number,
  input: { date: string; amount: number },
  asOf: string
) {
  if (input.date > asOf) throw fail("Aporte com data futura: registre quando acontecer");
  if (input.amount === 0) throw fail("Informe o valor do aporte");
  return db.transaction(() => {
    const position = db.positions.get(id);
    if (!position) throw fail("Posicao nao encontrada", 404);
    const tracks = position.category === "fixed_income" || position.category === "global";
    db.positionMovements.create({
      positionId: id,
      date: input.date,
      kind: input.amount > 0 ? "deposit" : "withdrawal",
      amount: input.amount,
      investedDelta: tracks ? input.amount : 0,
      transferId: null,
      operationId: null,
      pairId: null,
      description: input.amount > 0 ? "Aporte anterior ao app" : "Resgate anterior ao app"
    });
    // O valor guardado acompanha o extrato desde já: a sincronização trata
    // qualquer diferença como valor gravado direto.
    db.positions.applyDelta(id, input.amount, tracks ? input.amount : 0);
    syncPosition(db, id, asOf);
    return { ok: true as const };
  });
}

/** Linhas do extrato de uma posição, da mais recente para a mais antiga. */
export function positionStatement(db: AppDatabase, id: number) {
  return db.raw
    .prepare(
      `SELECT id, date, kind, amount, target_value AS targetValue, description,
              transfer_id AS transferId, operation_id AS operationId
       FROM position_movements WHERE position_id = ? ORDER BY date DESC, id DESC LIMIT 200`
    )
    .all(id);
}
