import { describe, expect, it } from "vitest";
import {
  categoryTotals,
  comparePeriods,
  distributeShares,
  partialPeriod,
  previousRange,
  previousRangeToDate,
  topSlices,
  wholeMonthsIn,
  type CategoryRow,
  type CategoryTotal
} from "./reporting.js";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("distributeShares", () => {
  it("fecha exatamente em 1000 com tres fatias iguais", () => {
    const shares = distributeShares([100, 100, 100]);
    expect(shares).toEqual([334, 333, 333]);
    expect(sum(shares)).toBe(1000);
  });

  it("fecha em 1000 com sete fatias de um setimo", () => {
    expect(sum(distributeShares(Array.from({ length: 7 }, () => 1)))).toBe(1000);
  });

  it("fecha em 1000 com treze fatias desiguais", () => {
    const values = [900, 812, 733, 611, 540, 498, 421, 388, 300, 271, 190, 120, 77];
    expect(values).toHaveLength(13);
    expect(sum(distributeShares(values))).toBe(1000);
  });

  it("devolve tudo zero quando o total e zero", () => {
    expect(distributeShares([0, 0, 0])).toEqual([0, 0, 0]);
    expect(distributeShares([])).toEqual([]);
  });

  it("desempata pelo maior valor absoluto e depois pelo menor indice", () => {
    // Dois restos fracionarios idênticos: o de maior valor leva o milesimo.
    const shares = distributeShares([100, 100, 100]);
    expect(shares[0]).toBe(334);
  });
});

describe("wholeMonthsIn", () => {
  it("conta meses inteiros", () => {
    expect(wholeMonthsIn({ from: "2026-03-01", to: "2026-03-31" })).toBe(1);
    expect(wholeMonthsIn({ from: "2026-01-01", to: "2026-12-31" })).toBe(12);
    expect(wholeMonthsIn({ from: "2026-02-01", to: "2026-02-28" })).toBe(1);
  });

  it("devolve null para recorte que nao e mes inteiro", () => {
    expect(wholeMonthsIn({ from: "2026-03-10", to: "2026-04-22" })).toBeNull();
    expect(wholeMonthsIn({ from: "2026-03-01", to: "2026-03-30" })).toBeNull();
  });
});

describe("categoryTotals", () => {
  const rows: CategoryRow[] = [
    { categoryId: 1, name: "Mercado", color: "#0f0", totalCents: 50000, monthlyBudgetCents: 80000 },
    { categoryId: 2, name: "Lazer", color: "#00f", totalCents: 90000, monthlyBudgetCents: 80000 },
    { categoryId: 3, name: "Saúde", color: "#f00", totalCents: 12000 },
    { categoryId: null, name: "Sem categoria", color: null, totalCents: 500 }
  ];

  it("multiplica o orcamento pelos meses inteiros do periodo", () => {
    const totals = categoryTotals(rows, { range: { from: "2026-01-01", to: "2026-03-31" } });
    expect(totals[0]?.budgetCents).toBe(240000);
    expect(totals[0]?.overBudget).toBe(false);
  });

  it("marca estouro so quando passa, nao na igualdade", () => {
    const range = { from: "2026-03-01", to: "2026-03-31" };
    expect(categoryTotals(rows, { range })[1]?.overBudget).toBe(true);
    const exact = categoryTotals(
      [{ categoryId: 1, name: "X", color: null, totalCents: 80000, monthlyBudgetCents: 80000 }],
      { range }
    );
    expect(exact[0]?.overBudget).toBe(false);
  });

  it("nao proporcionaliza orcamento em periodo que nao e mes inteiro", () => {
    const totals = categoryTotals(rows, { range: { from: "2026-03-10", to: "2026-04-22" } });
    expect(totals[0]?.budgetCents).toBeNull();
    expect(totals[0]?.overBudget).toBe(false);
  });

  it("categoria sem orcamento vem com budget nulo e sem estouro", () => {
    const totals = categoryTotals(rows, { range: { from: "2026-03-01", to: "2026-03-31" } });
    expect(totals[2]?.budgetCents).toBeNull();
    expect(totals[2]?.overBudget).toBe(false);
  });

  it("converte objetivo percentual em centavos sobre o total de saidas", () => {
    const shareRows: CategoryRow[] = [
      { categoryId: 1, name: "Mercado", color: null, totalCents: 60000, budgetSharePerMille: 250 },
      { categoryId: 2, name: "Lazer", color: null, totalCents: 40000, monthlyBudgetCents: 30000 }
    ];
    const totals = categoryTotals(shareRows, { range: { from: "2026-03-01", to: "2026-03-31" } });
    // 25% de 1.000,00 de saidas: objetivo de 250,00, estourado com 600,00.
    expect(totals[0]).toMatchObject({
      budgetCents: 25000,
      budgetMode: "share",
      budgetSharePerMille: 250,
      overBudget: true
    });
    expect(totals[1]).toMatchObject({ budgetCents: 30000, budgetMode: "absolute", overBudget: true });
  });

  it("aplica o objetivo percentual em qualquer recorte, nao so em mes inteiro", () => {
    const totals = categoryTotals(
      [{ categoryId: 1, name: "Mercado", color: null, totalCents: 1000, budgetSharePerMille: 500 }],
      { range: { from: "2026-03-10", to: "2026-03-22" } }
    );
    expect(totals[0]?.budgetCents).toBe(500);
  });

  it("nao deixa categoria negativa inflar a base do percentual", () => {
    const totals = categoryTotals(
      [
        { categoryId: 1, name: "Mercado", color: null, totalCents: 1000, budgetSharePerMille: 500 },
        { categoryId: 2, name: "Estorno", color: null, totalCents: -400 }
      ],
      { range: { from: "2026-03-01", to: "2026-03-31" } }
    );
    expect(totals[0]?.budgetCents).toBe(500);
  });

  it("preserva total negativo vindo de estorno adiantado (6.6)", () => {
    const totals = categoryTotals(
      [{ categoryId: 1, name: "Mercado", color: null, totalCents: -3000 }],
      { range: { from: "2026-03-01", to: "2026-03-31" } }
    );
    expect(totals[0]?.spentCents).toBe(-3000);
  });
});

describe("topSlices", () => {
  const make = (n: number): CategoryTotal[] =>
    Array.from({ length: n }, (_, index) => ({
      categoryId: index + 1,
      name: `Cat ${index + 1}`,
      color: "#123456",
      spentCents: (n - index) * 1000,
      budgetCents: null,
      budgetMode: null,
      budgetSharePerMille: null,
      overBudget: false
    }));

  it("agrega o excedente em Outras e fecha em 1000", () => {
    const slices = topSlices(make(20));
    expect(slices).toHaveLength(10);
    expect(slices[9]?.name).toBe("Outras");
    expect(sum(slices.map((slice) => slice.sharePerMille))).toBe(1000);
  });

  it("nao cria Outras quando cabe no limite", () => {
    const slices = topSlices(make(4));
    expect(slices.map((slice) => slice.name)).not.toContain("Outras");
    expect(sum(slices.map((slice) => slice.sharePerMille))).toBe(1000);
  });

  it("deixa fatia negativa e zerada fora da rosca", () => {
    const slices = topSlices([
      { categoryId: 1, name: "A", color: null, spentCents: 1000, budgetCents: null, budgetMode: null, budgetSharePerMille: null, overBudget: false },
      { categoryId: 2, name: "B", color: null, spentCents: -500, budgetCents: null, budgetMode: null, budgetSharePerMille: null, overBudget: false },
      { categoryId: 3, name: "C", color: null, spentCents: 0, budgetCents: null, budgetMode: null, budgetSharePerMille: null, overBudget: false }
    ]);
    expect(slices.map((slice) => slice.name)).toEqual(["A"]);
    expect(slices[0]?.sharePerMille).toBe(1000);
  });
});

describe("previousRange", () => {
  it("compara um mes-calendario com o mes-calendario anterior inteiro", () => {
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-02-01",
      to: "2026-02-28"
    });
  });

  it("atravessa a virada do ano", () => {
    expect(previousRange({ from: "2026-01-01", to: "2026-01-31" })).toEqual({
      from: "2025-12-01",
      to: "2025-12-31"
    });
  });

  it("compara recorte livre com a mesma quantidade de dias imediatamente antes", () => {
    expect(previousRange({ from: "2026-03-10", to: "2026-03-19" })).toEqual({
      from: "2026-02-28",
      to: "2026-03-09"
    });
  });
});

describe("periodo parcial", () => {
  it("detecta o mes corrente como parcial", () => {
    expect(partialPeriod({ from: "2026-03-01", to: "2026-03-31" }, { today: "2026-03-21" })).toEqual(
      { partial: true, daysElapsed: 21, daysInPeriod: 31 }
    );
  });

  it("mes fechado nao e parcial", () => {
    expect(partialPeriod({ from: "2026-03-01", to: "2026-03-31" }, { today: "2026-05-02" })).toEqual(
      { partial: false, daysElapsed: 31, daysInPeriod: 31 }
    );
  });

  it("trunca o mes anterior no mesmo dia do mes", () => {
    expect(
      previousRangeToDate({ from: "2026-03-01", to: "2026-03-31" }, { today: "2026-03-21" })
    ).toEqual({ from: "2026-02-01", to: "2026-02-21" });
  });

  it("limita o corte ao ultimo dia de fevereiro", () => {
    expect(
      previousRangeToDate({ from: "2026-03-01", to: "2026-03-31" }, { today: "2026-03-30" })
    ).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("usa 29 de fevereiro em ano bissexto", () => {
    expect(
      previousRangeToDate({ from: "2028-03-01", to: "2028-03-31" }, { today: "2028-03-30" })
    ).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("nao trunca nada quando o periodo ja fechou", () => {
    expect(
      previousRangeToDate({ from: "2026-03-01", to: "2026-03-31" }, { today: "2026-05-01" })
    ).toBeNull();
  });
});

describe("comparePeriods", () => {
  const row = (id: number, name: string, cents: number): CategoryTotal => ({
    categoryId: id,
    name,
    color: null,
    spentCents: cents,
    budgetCents: null,
    budgetMode: null,
    budgetSharePerMille: null,
    overBudget: false
  });

  it("monta a frase com o percentual arredondado", () => {
    const [first] = comparePeriods([row(1, "Mercado", 13200)], [row(1, "Mercado", 10000)]);
    expect(first?.label).toBe("gastou 32% a mais em Mercado");
    expect(first?.variationRatio).toBeCloseTo(0.32, 5);
  });

  it("inverte o tom: em despesa, subir e ruim", () => {
    const [up] = comparePeriods([row(1, "Mercado", 13200)], [row(1, "Mercado", 10000)]);
    const [down] = comparePeriods([row(2, "Transporte", 8800)], [row(2, "Transporte", 10000)]);
    expect(up?.tone).toBe("negative");
    expect(down?.label).toBe("gastou 12% a menos em Transporte");
    expect(down?.tone).toBe("positive");
  });

  it("categoria nova vira 'novo', nunca infinito nem 100%", () => {
    const [first] = comparePeriods([row(1, "Mercado", 5000)], []);
    expect(first?.variationRatio).toBeNull();
    expect(first?.label).toBe("novo em Mercado");
  });

  it("categoria que sumiu vira -1 e 'nao gastou'", () => {
    const [first] = comparePeriods([], [row(1, "Mercado", 5000)]);
    expect(first?.variationRatio).toBe(-1);
    expect(first?.label).toBe("não gastou em Mercado");
    expect(first?.tone).toBe("positive");
  });

  it("omite categoria zerada nos dois periodos", () => {
    expect(comparePeriods([row(1, "Mercado", 0)], [row(1, "Mercado", 0)])).toEqual([]);
  });

  it("ordena pela maior variacao em reais, nao em percentual", () => {
    const current = [row(1, "Cafe", 2400), row(2, "Mercado", 108000)];
    const previous = [row(1, "Cafe", 1200), row(2, "Mercado", 90000)];
    const result = comparePeriods(current, previous);
    // Cafe dobrou (+100%) mas moveu R$ 12; Mercado subiu 20% e moveu R$ 180.
    expect(result[0]?.name).toBe("Mercado");
  });
});
