import type { Migration } from "./runner.js";

/**
 * Marca o esquema legado de investimentos como versão 1.
 *
 * Propositalmente vazia: as tabelas de `operations`, `manual_positions`,
 * `prices` e companhia continuam sendo criadas pelo `migrate()` de
 * `packages/db/src/index.ts`, que roda **antes** do runner. Esta migração só
 * estabelece o ponto de partida para que bancos antigos e novos convirjam na
 * mesma linha do tempo.
 */
export const migration001Baseline: Migration = {
  version: 1,
  name: "baseline",
  up: () => {}
};
