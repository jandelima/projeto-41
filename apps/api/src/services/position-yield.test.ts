import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { beforeEach, describe, expect, it } from "vitest";
import { depositToPosition } from "./investment-cash-service.js";
import {
  correctPosition,
  listPositionsWithYield,
  positionYield,
  recordPastContribution,
  syncPosition
} from "./position-yield.js";

let db: AppDatabase;

// Semana de 2026-06-01 (segunda) a 2026-06-05 (sexta), 0,05% ao dia útil.
const DAYS = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
const FRIDAY = "2026-06-05";

function seedRates(days: string[]) {
  db.raw.prepare("DELETE FROM cdi_rates WHERE date >= '2026-05-01' AND date <= '2026-06-30'").run();
  db.raw.prepare("DELETE FROM holidays WHERE date >= '2026-05-01' AND date <= '2026-06-30'").run();
  const insert = db.raw.prepare(
    "INSERT INTO cdi_rates(date, daily_factor, source, fetched_at) VALUES (?, 0.05, 'seed', '2026-06-06')"
  );
  for (const day of days) insert.run(day);
}

type Overrides = Partial<{
  cdiPercent: number | null;
  cdiSince: string | null;
  category: string;
  currency: string;
}>;

/** Posição com R$ 1.000 aportados no dia 1, sem passar por banco. */
function createPosition(values: Overrides = {}) {
  const id = db.positions.upsert({
    category: "fixed_income",
    name: "CDB",
    invested: 0,
    currentValue: 0,
    currency: "BRL",
    cdiPercent: 100,
    cdiSince: "2026-06-01",
    ...values
  } as never);
  recordPastContribution(db, id, { date: "2026-06-01", amount: 1000 }, "2026-06-01");
  return id;
}

const get = (id: number) => db.positions.get(id)!;
const kinds = (id: number) =>
  (
    db.raw
      .prepare("SELECT kind, amount FROM position_movements WHERE position_id = ? ORDER BY date, id")
      .all(id) as { kind: string; amount: number }[]
  ).map((row) => `${row.kind}:${row.amount}`);

beforeEach(() => {
  db = createTestDatabase();
  seedRates(DAYS);
});

describe("valor calculado pelo extrato", () => {
  it("o rendimento entra sozinho no extrato e no valor", () => {
    const id = createPosition();
    syncPosition(db, id, FRIDAY);
    // 1000 × 1,0005^5 − 1000 = 2,5025…
    expect(get(id).currentValue).toBe(1002.5);
    // Uma linha por apuração: o dia 1 na criação, os outros quatro agora.
    expect(kinds(id)).toEqual(["deposit:1000", "yield:0.5", "yield:2"]);
  });

  it("sincronizar de novo nao lanca o mesmo rendimento duas vezes", () => {
    const id = createPosition();
    syncPosition(db, id, FRIDAY);
    syncPosition(db, id, FRIDAY);
    expect(get(id).currentValue).toBe(1002.5);
  });

  it("aplica o percentual do CDI linearmente", () => {
    const id = createPosition({ cdiPercent: 200 });
    syncPosition(db, id, FRIDAY);
    expect(get(id).currentValue).toBe(1005.01);
  });

  it("aporte com data anterior chegando depois refaz o rendimento", () => {
    const id = createPosition();
    syncPosition(db, id, FRIDAY);
    recordPastContribution(db, id, { date: "2026-06-04", amount: 1000 }, FRIDAY);
    // 2,50 do primeiro aporte + 1000 × (1,0005² − 1) = 1,00
    expect(get(id).currentValue).toBe(2003.5);
  });

  it("aporte pelo banco tambem rende a partir do proprio dia", () => {
    const checking = db.ledger.accounts.create({
      name: "Nubank",
      kind: "checking",
      color: "#8a2be2",
      personId: db.ledger.people.list()[0]!.id,
      openingBalanceCents: 500_000
    });
    const id = createPosition();
    depositToPosition(db, { positionId: id, fromAccountId: checking, amountCents: 100_000, date: "2026-06-04" });
    syncPosition(db, id, FRIDAY);
    expect(get(id).currentValue).toBe(2003.5);
  });

  it("sem percentual, em dolar ou fora das categorias nao rende", () => {
    const none = createPosition({ cdiPercent: null });
    const usd = createPosition({ currency: "USD" });
    const dollar = createPosition({ category: "dollar" });
    for (const id of [none, usd, dollar]) {
      syncPosition(db, id, FRIDAY);
      expect(get(id).currentValue).toBe(1000);
      expect(positionYield(db, get(id), FRIDAY)).toBeNull();
    }
  });

  it("caixa e reserva em reais tambem rendem", () => {
    for (const category of ["cash", "reserve"]) {
      const id = createPosition({ category });
      syncPosition(db, id, FRIDAY);
      expect(get(id).currentValue).toBe(1002.5);
    }
  });
});

describe("correcao", () => {
  it("o valor real informado vale naquele dia e o rendimento segue dele", () => {
    const id = createPosition();
    correctPosition(db, id, { date: "2026-06-03", value: 2000 }, FRIDAY);
    // 2000 × (1,0005² − 1) = 2,0005 nos dias 4 e 5.
    expect(get(id).currentValue).toBe(2002);
  });

  it("aporte lancado depois com data antes da correcao nao conta duas vezes", () => {
    const id = createPosition();
    correctPosition(db, id, { date: "2026-06-03", value: 2000 }, FRIDAY);
    recordPastContribution(db, id, { date: "2026-06-02", amount: 500 }, FRIDAY);
    expect(get(id).currentValue).toBe(2002);
  });

  it("valor gravado direto (importacao) vira correcao em vez de sumir", () => {
    const id = db.positions.upsert({
      category: "cash",
      name: "Caixa",
      invested: 0,
      currentValue: 750,
      currency: "BRL"
    } as never);
    listPositionsWithYield(db, FRIDAY);
    expect(get(id).currentValue).toBe(750);
    expect(kinds(id)).toEqual(["adjust:750"]);
  });
});
