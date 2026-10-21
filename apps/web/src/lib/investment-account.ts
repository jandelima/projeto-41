/**
 * Conta do módulo de investimentos escolhida no menu.
 *
 * Fica num módulo, e não num contexto do React, porque é o `api()` que precisa
 * dela: toda requisição leva a conta no cabeçalho `x-investment-account`, e a
 * API mostra e grava os registros dessa conta. Trocar de conta remonta as
 * telas (ver `App.tsx`), então ninguém guarda dado da conta anterior.
 */
const STORAGE_KEY = "projeto41.investment-account";
export const PRINCIPAL_INVESTMENT_ACCOUNT = 1;

function readStored(): number {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : PRINCIPAL_INVESTMENT_ACCOUNT;
  } catch {
    return PRINCIPAL_INVESTMENT_ACCOUNT;
  }
}

let current = typeof window === "undefined" ? PRINCIPAL_INVESTMENT_ACCOUNT : readStored();

export function currentInvestmentAccount(): number {
  return current;
}

export function setCurrentInvestmentAccount(id: number) {
  current = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // Sem armazenamento, a escolha vale até recarregar a página.
  }
}

/** Cabeçalho para pedir o todo, sem filtro de conta (patrimônio). */
export const ALL_INVESTMENT_ACCOUNTS = { "x-investment-account": "all" } as const;
