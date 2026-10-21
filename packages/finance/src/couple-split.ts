import { allocateByRatio } from "./money.js";
import type { SplitMode } from "./targets.js";

/**
 * Quanto cada um deposita na conta conjunta.
 *
 * O casal paga as contas da casa pela conjunta; o alvo do período diz quanto
 * elas devem custar. Esta função traduz isso em "fulano deposita X", ao lado
 * do que cada um recebe e do que sobra para gastar sozinho.
 *
 * - **Pela renda**: o teto conjunto é repartido na proporção da renda.
 * - **Bolo comum**: cada um fica só com a sua parte pessoal e deposita o
 *   resto. Quem ganha menos que a parte pessoal recebe a diferença da
 *   conjunta (depósito negativo).
 * - **Sem divisão**: não há conta a fazer.
 *
 * Pura: recebe as rendas efetivas (override já aplicado) e os alvos pessoais
 * que `computeTargets` calculou, para os dois números nunca discordarem.
 */

export type CoupleSplitPerson = {
  id: number;
  name: string;
  color: string;
  /** Renda efetiva do período: o override vence o apurado. */
  incomeCents: number;
  /** Alvo pessoal de `computeTargets`; `null` quando não há alvo. */
  personalTargetCents: number | null;
};

export type CoupleSplitRow = {
  personId: number;
  name: string;
  color: string;
  incomeCents: number;
  /** Fatia da renda do casal, em milésimos. */
  sharePerMille: number;
  /** Quanto vai para a conjunta. Negativo: recebe da conjunta. */
  depositCents: number;
  personalTargetCents: number | null;
  /** Renda − depósito − alvo pessoal: o que sobra para guardar. */
  leftoverCents: number | null;
};

export type CoupleSplit = {
  /** Soma dos depósitos: o que a conjunta recebe no período. */
  jointInflowCents: number;
  incomeTotalCents: number;
  rows: CoupleSplitRow[];
  /** Por que não dá para calcular, quando não dá. */
  missing: string | null;
};

export function computeCoupleSplit(input: {
  splitMode: SplitMode;
  /** Só as pessoas individuais ativas, na ordem de `people.id`. */
  people: CoupleSplitPerson[];
  jointTargetCents: number | null;
}): CoupleSplit {
  const people = [...input.people].sort((a, b) => a.id - b.id);
  const incomeTotalCents = people.reduce((sum, person) => sum + person.incomeCents, 0);
  const shareOf = (income: number) =>
    incomeTotalCents > 0 ? Math.round((income / incomeTotalCents) * 1000) : 0;
  const empty = (missing: string): CoupleSplit => ({
    jointInflowCents: 0,
    incomeTotalCents,
    rows: people.map((person) => ({
      personId: person.id,
      name: person.name,
      color: person.color,
      incomeCents: person.incomeCents,
      sharePerMille: shareOf(person.incomeCents),
      depositCents: 0,
      personalTargetCents: person.personalTargetCents,
      leftoverCents: null
    })),
    missing
  });

  if (input.splitMode === "none") {
    return empty("Escolha Pela renda ou Bolo comum para dividir as contas do casal.");
  }
  if (people.length === 0) return empty("Cadastre as pessoas do casal em Contas e pessoas.");

  let deposits: number[];
  if (input.splitMode === "pooled") {
    // Tudo que não é parte pessoal vai para o bolo.
    deposits = people.map((person) => person.incomeCents - (person.personalTargetCents ?? 0));
  } else {
    if (input.jointTargetCents == null || input.jointTargetCents <= 0) {
      return empty("Defina o teto dos gastos conjuntos para ver quanto cada um deposita.");
    }
    // Sem renda registrada, divide igual, como `computeTargets` faz.
    deposits = allocateByRatio(
      input.jointTargetCents,
      people.map((person) => Math.max(person.incomeCents, 0))
    );
  }

  const rows = people.map((person, index) => {
    const depositCents = deposits[index] ?? 0;
    return {
      personId: person.id,
      name: person.name,
      color: person.color,
      incomeCents: person.incomeCents,
      sharePerMille: shareOf(person.incomeCents),
      depositCents,
      personalTargetCents: person.personalTargetCents,
      leftoverCents:
        person.personalTargetCents == null
          ? null
          : person.incomeCents - depositCents - person.personalTargetCents
    };
  });

  return {
    jointInflowCents: rows.reduce((sum, row) => sum + row.depositCents, 0),
    incomeTotalCents,
    rows,
    missing: null
  };
}
