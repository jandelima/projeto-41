import { allocateByRatio } from "./money.js";

/**
 * Divisao-alvo entre autores (plano mestre 6.4).
 *
 * Recebe so dados e devolve as barras prontas: sem banco, sem `Date`, sem I/O.
 *
 * A funcao **nao recebe o periodo anterior**. Isso e deliberado: e a forma mais
 * segura de garantir que a sobra do modo `pooled` zera todo mes e nao acumula.
 */

export type SplitMode = "none" | "income_proportional" | "pooled";

export type TargetPerson = {
  id: number;
  name: string;
  kind: "individual" | "joint";
  color: string;
  active: boolean;
};

export type TargetInput = {
  splitMode: SplitMode;
  people: TargetPerson[];
  /**
   * Renda apurada por pessoa no periodo, somando **todos os status**,
   * `pending` incluido: o alvo e sobre o mes combinado, nao sobre a liquidacao
   * bancaria. Difere de 6.1 de proposito.
   */
  incomeByPerson: Record<number, number>;
  /** Realizado por pessoa: `-SUM(amount_cents)` com `counts_toward_target = 1`. */
  realizedByPerson: Record<number, number>;
  incomeOverrides?: Record<number, number | null>;
  targetOverrides?: Record<number, number | null>;
  /** `budget_periods.total_expense_target_cents`. */
  totalExpenseTargetCents?: number | null;
  pooledIncomeCents?: number | null;
  jointExpenseTargetCents?: number | null;
  /** Soma dos orcamentos de categoria, o fallback de 6.5. */
  categoryBudgetSumCents?: number | null;
};

export type TargetBar = {
  personId: number | null;
  name: string;
  color: string;
  targetCents: number | null;
  realizedCents: number;
  /** Realizado / alvo em milesimos. Continua visivel no modo privacidade (R-04). */
  ratioPerMille: number | null;
  over: boolean;
};

export type TargetResult = {
  splitMode: SplitMode;
  totalTargetCents: number | null;
  bars: TargetBar[];
  warnings: string[];
};

function bar(
  personId: number | null,
  name: string,
  color: string,
  targetCents: number | null,
  realizedCents: number
): TargetBar {
  return {
    personId,
    name,
    color,
    targetCents,
    realizedCents,
    // O percentual e calculado aqui porque ele continua visivel no modo
    // privacidade: a UI mascara o dinheiro, nao a proporcao.
    ratioPerMille:
      targetCents != null && targetCents !== 0
        ? Math.round((realizedCents / targetCents) * 1000)
        : null,
    over: targetCents != null && realizedCents > targetCents
  };
}

/** Renda efetiva: o override vence, inclusive quando for zero. */
function effectiveIncome(input: TargetInput, personId: number): number {
  const override = input.incomeOverrides?.[personId];
  if (override != null) return override;
  return input.incomeByPerson[personId] ?? 0;
}

/**
 * Gasto-alvo do periodo: o valor configurado, senao a soma dos orcamentos de
 * categoria (6.5). O casal ja definiu esses tetos, e repetir o numero a mao so
 * criaria duas verdades.
 */
function resolveTotalTarget(input: TargetInput): number | null {
  if (input.totalExpenseTargetCents != null) return input.totalExpenseTargetCents;
  if (input.categoryBudgetSumCents != null && input.categoryBudgetSumCents > 0) {
    return input.categoryBudgetSumCents;
  }
  return null;
}

export function computeTargets(input: TargetInput): TargetResult {
  const warnings: string[] = [];
  const totalTargetCents = resolveTotalTarget(input);
  const realizedOf = (personId: number) => input.realizedByPerson[personId] ?? 0;
  const totalRealized = Object.values(input.realizedByPerson).reduce(
    (sum, value) => sum + value,
    0
  );

  const individuals = input.people
    .filter((person) => person.kind === "individual" && person.active)
    // A ordem precisa ser estavel para o centavo impar cair sempre na mesma
    // pessoa; `people.id` e a ordem de criacao.
    .sort((a, b) => a.id - b.id);
  const joint = input.people.find((person) => person.kind === "joint" && person.active);

  if (input.splitMode === "none") {
    return {
      splitMode: "none",
      totalTargetCents,
      bars: [bar(null, "Total do período", "var(--accent)", totalTargetCents, totalRealized)],
      warnings
    };
  }

  if (input.splitMode === "income_proportional") {
    const jointTarget = input.jointExpenseTargetCents ?? null;
    let base = totalTargetCents == null ? null : totalTargetCents - (jointTarget ?? 0);
    // Teto conjunto maior que o total deixava alvo individual negativo, e a
    // barra dizia "estourou" sem a pessoa ter gastado nada.
    if (base != null && base < 0) {
      warnings.push(
        "O alvo conjunto é maior que o alvo total do período: não sobra alvo individual."
      );
      base = 0;
    }

    const overrides = individuals.map((person) => input.targetOverrides?.[person.id] ?? null);
    const withoutOverride = individuals.filter((_, index) => overrides[index] == null);
    const overrideSum = overrides.reduce<number>((sum, value) => sum + (value ?? 0), 0);

    let allocated: number[] = [];
    if (base != null) {
      const remaining = Math.max(0, base - overrideSum);
      if (base - overrideSum < 0) {
        warnings.push("Os alvos manuais passam do que sobra do alvo total do período.");
      }
      if (withoutOverride.length === 0) {
        if (overrideSum !== base) {
          warnings.push("Os alvos manuais não fecham com o alvo total do período.");
        }
      } else {
        const incomes = withoutOverride.map((person) => effectiveIncome(input, person.id));
        if (incomes.every((income) => income === 0)) {
          warnings.push("Sem renda registrada no período: o alvo foi dividido igualmente.");
        }
        // `allocateByRatio` fecha exatamente na base pelo metodo do maior resto.
        // Um `Math.round` de percentual float erraria um centavo em 33,3/66,7.
        allocated = allocateByRatio(remaining, incomes);
      }
    }

    let cursor = 0;
    const bars: TargetBar[] = [];
    if (joint) {
      bars.push(bar(joint.id, joint.name, joint.color, jointTarget, realizedOf(joint.id)));
    }
    individuals.forEach((person, index) => {
      const override = overrides[index];
      let target: number | null = override ?? null;
      if (target == null && base != null && withoutOverride.length > 0) {
        target = allocated[cursor] ?? 0;
        cursor += 1;
      }
      bars.push(bar(person.id, person.name, person.color, target, realizedOf(person.id)));
    });

    return {
      splitMode: "income_proportional",
      totalTargetCents,
      bars,
      warnings
    };
  }

  // Modo pooled: o casal junta a renda, reserva um teto conjunto e divide o
  // restante igualmente. O bolo é a renda de quem está ativo (a conjunta
  // inclusa): pessoa inativa já não reparte nada e não pode inflar o bolo.
  const pooledIncomeCents =
    input.pooledIncomeCents ??
    input.people
      .filter((person) => person.active)
      .reduce((sum, person) => sum + effectiveIncome(input, person.id), 0);
  const jointTarget = input.jointExpenseTargetCents ?? 0;
  let leftover = pooledIncomeCents - jointTarget;

  if (leftover < 0) {
    warnings.push("O teto conjunto é maior que a renda do bolo comum.");
    leftover = 0;
  }

  const personalTargets = allocateByRatio(
    leftover,
    individuals.map(() => 1)
  );

  const bars: TargetBar[] = [];
  if (joint) {
    bars.push(bar(joint.id, joint.name, joint.color, jointTarget, realizedOf(joint.id)));
  }
  individuals.forEach((person, index) => {
    bars.push(
      bar(person.id, person.name, person.color, personalTargets[index] ?? 0, realizedOf(person.id))
    );
  });

  return {
    splitMode: "pooled",
    totalTargetCents: pooledIncomeCents,
    bars,
    warnings
  };
}
