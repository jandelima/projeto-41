import { describe, expect, it } from "vitest";
import { computeTargets, type TargetInput, type TargetPerson } from "./targets.js";

const STEYLOR: TargetPerson = {
  id: 1,
  name: "Steylor",
  kind: "individual",
  color: "#4f9cf9",
  active: true
};
const BIANCA: TargetPerson = {
  id: 2,
  name: "Bianca",
  kind: "individual",
  color: "#f97ab0",
  active: true
};
const CONJUNTO: TargetPerson = {
  id: 3,
  name: "Conjunto",
  kind: "joint",
  color: "#7c5cff",
  active: true
};

const base = (overrides: Partial<TargetInput> = {}): TargetInput => ({
  splitMode: "none",
  people: [STEYLOR, BIANCA, CONJUNTO],
  incomeByPerson: {},
  realizedByPerson: {},
  ...overrides
});

const targetOf = (result: ReturnType<typeof computeTargets>, name: string) =>
  result.bars.find((bar) => bar.name === name)?.targetCents;

describe("modo none", () => {
  it("devolve uma barra so, com o alvo total e o realizado total", () => {
    const result = computeTargets(
      base({
        totalExpenseTargetCents: 400000,
        realizedByPerson: { 1: 150000, 2: 100000 }
      })
    );
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]?.targetCents).toBe(400000);
    expect(result.bars[0]?.realizedCents).toBe(250000);
    expect(result.bars[0]?.ratioPerMille).toBe(625);
    expect(result.bars[0]?.over).toBe(false);
  });

  it("cai na soma dos orcamentos de categoria quando nao ha alvo configurado (6.5)", () => {
    const result = computeTargets(base({ categoryBudgetSumCents: 300000 }));
    expect(result.totalTargetCents).toBe(300000);
  });

  it("fica sem alvo quando nao ha nem configuracao nem orcamento", () => {
    const result = computeTargets(base({ realizedByPerson: { 1: 5000 } }));
    expect(result.totalTargetCents).toBeNull();
    expect(result.bars[0]?.targetCents).toBeNull();
    expect(result.bars[0]?.ratioPerMille).toBeNull();
    expect(result.bars[0]?.realizedCents).toBe(5000);
  });

  it("marca estouro quando o realizado passa do alvo", () => {
    const result = computeTargets(
      base({ totalExpenseTargetCents: 100000, realizedByPerson: { 1: 100001 } })
    );
    expect(result.bars[0]?.over).toBe(true);
  });
});

describe("modo income_proportional", () => {
  it("reproduz o exemplo do plano mestre: 33,3% e 66,7%", () => {
    const result = computeTargets(
      base({
        splitMode: "income_proportional",
        totalExpenseTargetCents: 400000,
        incomeByPerson: { 1: 250000, 2: 500000 }
      })
    );
    // 400.000 repartidos em 1/3 e 2/3, fechando exatamente no total.
    expect(targetOf(result, "Steylor")).toBe(133333);
    expect(targetOf(result, "Bianca")).toBe(266667);
    expect((targetOf(result, "Steylor") ?? 0) + (targetOf(result, "Bianca") ?? 0)).toBe(400000);
  });

  it("fecha no total mesmo com resto impar em centavos", () => {
    const result = computeTargets(
      base({
        splitMode: "income_proportional",
        totalExpenseTargetCents: 100001,
        incomeByPerson: { 1: 1, 2: 2 }
      })
    );
    const sum = (targetOf(result, "Steylor") ?? 0) + (targetOf(result, "Bianca") ?? 0);
    expect(sum).toBe(100001);
  });

  it("reserva o teto conjunto antes de repartir o restante", () => {
    const result = computeTargets(
      base({
        splitMode: "income_proportional",
        totalExpenseTargetCents: 500000,
        jointExpenseTargetCents: 200000,
        incomeByPerson: { 1: 250000, 2: 250000 }
      })
    );
    expect(targetOf(result, "Conjunto")).toBe(200000);
    expect(targetOf(result, "Steylor")).toBe(150000);
    expect(targetOf(result, "Bianca")).toBe(150000);
  });

  it("divide igualmente e avisa quando nao ha renda no periodo", () => {
    const result = computeTargets(
      base({ splitMode: "income_proportional", totalExpenseTargetCents: 100000 })
    );
    expect(targetOf(result, "Steylor")).toBe(50000);
    expect(targetOf(result, "Bianca")).toBe(50000);
    expect(result.warnings.join(" ")).toMatch(/Sem renda/);
  });

  it("override de renda vence o apurado, inclusive quando e zero", () => {
    const result = computeTargets(
      base({
        splitMode: "income_proportional",
        totalExpenseTargetCents: 100000,
        incomeByPerson: { 1: 500000, 2: 500000 },
        incomeOverrides: { 1: 0 }
      })
    );
    expect(targetOf(result, "Steylor")).toBe(0);
    expect(targetOf(result, "Bianca")).toBe(100000);
  });

  it("override de alvo vence e o restante e repartido entre quem nao tem", () => {
    const result = computeTargets(
      base({
        splitMode: "income_proportional",
        totalExpenseTargetCents: 100000,
        incomeByPerson: { 1: 100000, 2: 100000 },
        targetOverrides: { 1: 70000 }
      })
    );
    expect(targetOf(result, "Steylor")).toBe(70000);
    expect(targetOf(result, "Bianca")).toBe(30000);
  });

  it("avisa, sem ajustar ninguem, quando todos tem override e a soma nao fecha", () => {
    const result = computeTargets(
      base({
        splitMode: "income_proportional",
        totalExpenseTargetCents: 100000,
        targetOverrides: { 1: 30000, 2: 30000 }
      })
    );
    expect(targetOf(result, "Steylor")).toBe(30000);
    expect(targetOf(result, "Bianca")).toBe(30000);
    expect(result.warnings.join(" ")).toMatch(/não fecham/);
  });
});

describe("modo pooled", () => {
  const pooled = () =>
    computeTargets(
      base({
        splitMode: "pooled",
        pooledIncomeCents: 750000,
        jointExpenseTargetCents: 400000
      })
    );

  it("reproduz o exemplo do plano mestre: 4.000 / 1.750 / 1.750", () => {
    const result = pooled();
    expect(targetOf(result, "Conjunto")).toBe(400000);
    expect(targetOf(result, "Steylor")).toBe(175000);
    expect(targetOf(result, "Bianca")).toBe(175000);
  });

  it("a sobra zera todo mes: dois meses iguais produzem tetos iguais", () => {
    // O que "sobrou" no primeiro mes nao existe como parametro, entao nao tem
    // como vazar para o segundo. Os realizados diferentes nao movem os tetos.
    const first = computeTargets(
      base({
        splitMode: "pooled",
        pooledIncomeCents: 750000,
        jointExpenseTargetCents: 400000,
        realizedByPerson: { 1: 10000, 2: 20000, 3: 100000 }
      })
    );
    const second = computeTargets(
      base({
        splitMode: "pooled",
        pooledIncomeCents: 750000,
        jointExpenseTargetCents: 400000,
        realizedByPerson: { 1: 170000, 2: 174000, 3: 399000 }
      })
    );
    expect(first.bars.map((b) => b.targetCents)).toEqual(second.bars.map((b) => b.targetCents));
  });

  it("o centavo impar vai para a primeira pessoa por people.id", () => {
    const result = computeTargets(
      base({
        splitMode: "pooled",
        pooledIncomeCents: 100001,
        jointExpenseTargetCents: 0
      })
    );
    expect(targetOf(result, "Steylor")).toBe(50001);
    expect(targetOf(result, "Bianca")).toBe(50000);
  });

  it("soma a renda de todos quando o bolo nao foi informado", () => {
    const result = computeTargets(
      base({
        splitMode: "pooled",
        jointExpenseTargetCents: 100000,
        incomeByPerson: { 1: 250000, 2: 500000, 3: 50000 }
      })
    );
    expect(result.totalTargetCents).toBe(800000);
    expect(targetOf(result, "Steylor")).toBe(350000);
  });

  it("bolo nao informado deixa de fora a renda de pessoa inativa", () => {
    const result = computeTargets(
      base({
        splitMode: "pooled",
        people: [STEYLOR, { ...BIANCA, active: false }, CONJUNTO],
        jointExpenseTargetCents: 100000,
        incomeByPerson: { 1: 250000, 2: 500000, 3: 50000 }
      })
    );
    expect(result.totalTargetCents).toBe(300000);
    expect(targetOf(result, "Steylor")).toBe(200000);
  });

  it("nao gera alvo negativo quando o teto conjunto passa do bolo", () => {
    const result = computeTargets(
      base({
        splitMode: "pooled",
        pooledIncomeCents: 100000,
        jointExpenseTargetCents: 400000
      })
    );
    expect(targetOf(result, "Steylor")).toBe(0);
    expect(targetOf(result, "Bianca")).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/teto conjunto/i);
  });

  it("ignora pessoa inativa na repartição", () => {
    const result = computeTargets(
      base({
        splitMode: "pooled",
        people: [STEYLOR, { ...BIANCA, active: false }, CONJUNTO],
        pooledIncomeCents: 300000,
        jointExpenseTargetCents: 100000
      })
    );
    expect(targetOf(result, "Steylor")).toBe(200000);
    expect(result.bars.map((b) => b.name)).not.toContain("Bianca");
  });
});

describe("realizado", () => {
  it("devolve realizado negativo como esta, sem zerar", () => {
    const result = computeTargets(
      base({ totalExpenseTargetCents: 100000, realizedByPerson: { 1: -5000 } })
    );
    expect(result.bars[0]?.realizedCents).toBe(-5000);
    expect(result.bars[0]?.over).toBe(false);
  });
});
