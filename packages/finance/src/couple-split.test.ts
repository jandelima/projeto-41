import { describe, expect, it } from "vitest";
import { computeCoupleSplit, type CoupleSplitPerson } from "./couple-split.js";

const person = (
  id: number,
  incomeCents: number,
  personalTargetCents: number | null = null
): CoupleSplitPerson => ({ id, name: `P${id}`, color: "#000", incomeCents, personalTargetCents });

describe("computeCoupleSplit", () => {
  it("reparte o teto conjunto na proporção da renda", () => {
    const split = computeCoupleSplit({
      splitMode: "income_proportional",
      people: [person(1, 600000, 100000), person(2, 400000, 80000)],
      jointTargetCents: 450000
    });
    expect(split.missing).toBeNull();
    expect(split.rows.map((row) => row.depositCents)).toEqual([270000, 180000]);
    expect(split.rows.map((row) => row.sharePerMille)).toEqual([600, 400]);
    expect(split.rows.map((row) => row.leftoverCents)).toEqual([230000, 140000]);
    expect(split.jointInflowCents).toBe(450000);
  });

  it("fecha no centavo quando a divisão não é exata", () => {
    const split = computeCoupleSplit({
      splitMode: "income_proportional",
      people: [person(1, 100), person(2, 200)],
      jointTargetCents: 100001
    });
    expect(split.jointInflowCents).toBe(100001);
  });

  it("sem renda registrada divide igual", () => {
    const split = computeCoupleSplit({
      splitMode: "income_proportional",
      people: [person(1, 0), person(2, 0)],
      jointTargetCents: 300000
    });
    expect(split.rows.map((row) => row.depositCents)).toEqual([150000, 150000]);
  });

  it("pede o teto conjunto quando ele falta", () => {
    const split = computeCoupleSplit({
      splitMode: "income_proportional",
      people: [person(1, 500000)],
      jointTargetCents: null
    });
    expect(split.missing).toMatch(/teto dos gastos conjuntos/);
    expect(split.rows[0]?.depositCents).toBe(0);
  });

  it("no bolo comum cada um deposita tudo menos a parte pessoal", () => {
    const split = computeCoupleSplit({
      splitMode: "pooled",
      people: [person(1, 700000, 150000), person(2, 100000, 150000)],
      jointTargetCents: 500000
    });
    // Quem ganha menos que a parte pessoal recebe a diferença da conjunta.
    expect(split.rows.map((row) => row.depositCents)).toEqual([550000, -50000]);
    expect(split.jointInflowCents).toBe(500000);
    expect(split.rows.map((row) => row.leftoverCents)).toEqual([0, 0]);
  });

  it("sem divisão não calcula depósito", () => {
    const split = computeCoupleSplit({
      splitMode: "none",
      people: [person(1, 500000)],
      jointTargetCents: 100000
    });
    expect(split.missing).not.toBeNull();
  });
});
