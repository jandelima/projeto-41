import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Conta do módulo de investimentos em que a requisição está.
 *
 * Os repositórios de investimento (operações, posições, aportes, proventos,
 * metas, histórico) leem daqui o escopo, em vez de cada rota e cada serviço
 * passar o id adiante: a API abre o escopo uma vez por requisição e todo o
 * resto do código continua igual.
 *
 * - `null` é "todas as contas": leitura sem filtro. É o que vale fora de uma
 *   requisição (agendador, CLI, testes) e no patrimônio do módulo de finanças.
 * - Gravar sem conta escolhida grava na Principal.
 */
export const PRINCIPAL_INVESTMENT_ACCOUNT = 1;

const storage = new AsyncLocalStorage<{ accountId: number | null }>();

export function withInvestmentAccount<T>(accountId: number | null, callback: () => T): T {
  return storage.run({ accountId }, callback);
}

/** A conta da requisição, ou `null` para todas. */
export function investmentAccountScope(): number | null {
  return storage.getStore()?.accountId ?? null;
}

/** Onde um registro novo vai morar. */
export function investmentAccountForWrite(): number {
  return investmentAccountScope() ?? PRINCIPAL_INVESTMENT_ACCOUNT;
}

/**
 * Chave de configuração própria da conta. A Principal guarda nas chaves de
 * sempre, então o que já estava configurado continua valendo.
 */
export function investmentSettingKey(key: string): string {
  const account = investmentAccountForWrite();
  return account === PRINCIPAL_INVESTMENT_ACCOUNT ? key : `${key}@${account}`;
}
