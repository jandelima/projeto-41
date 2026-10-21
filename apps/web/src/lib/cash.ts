import { useCallback, useEffect, useState } from "react";
import type { AccountRecord, ManualPositionRecord, PositionRecord } from "@projeto41/contracts";
import { api } from "./api.js";

/**
 * O dinheiro entre o banco e os investimentos.
 *
 *     conta bancária ──aporte──▶ caixa ──alocar──▶ renda fixa, cripto, B3…
 *     conta bancária ◀─resgate── caixa ◀──venda───
 *
 * Os caixas são as posições que o usuário cria em "Caixa e renda fixa" — não
 * existe outro conceito de caixa no módulo. O servidor faz a contabilidade
 * (posição e livro mudam juntos); aqui só se lê e se escolhe.
 */

export type CashSettings = {
  /** Registrar operação pela conta movimenta o banco. Desligado, é só registro. */
  autoDebit: boolean;
  /** Conta que paga direto, sem passar por caixa. */
  defaultAccountId: number | null;
  /** Caixa que paga por padrão; tem precedência sobre a conta. */
  defaultPositionId: number | null;
};

export type PositionMovement = {
  id: number;
  positionId: number;
  positionName: string;
  positionCategory: string;
  positionCurrency: string;
  date: string;
  kind: "deposit" | "withdrawal" | "move_in" | "move_out" | "buy" | "sell" | "yield" | "adjust";
  amount: number;
  transferId: number | null;
  operationId: number | null;
  pairId: number | null;
  description: string | null;
  accountName: string | null;
  transferStatus: string | null;
};

/** Onde o dinheiro espera: pode pagar uma compra e receber uma venda. */
export const LIQUID_CATEGORIES = ["cash", "dollar", "reserve", "crypto"] as const;
export const isLiquid = (position: Pick<ManualPositionRecord, "category">) =>
  (LIQUID_CATEGORIES as readonly string[]).includes(position.category);

export const MOVE_LABEL: Record<PositionMovement["kind"], string> = {
  deposit: "Aporte",
  withdrawal: "Resgate",
  move_in: "Entrada",
  move_out: "Saída",
  buy: "Compra",
  sell: "Venda",
  yield: "Rendimento",
  adjust: "Correção"
};

export const POSITION_CATEGORY_LABEL: Record<string, string> = {
  cash: "Caixa BR",
  dollar: "Dólar",
  reserve: "Reserva de emergência",
  crypto: "Caixa cripto",
  fixed_income: "Renda fixa",
  global: "Ações globais"
};

/** Contas de onde um aporte pode sair: dinheiro de verdade, sem cartão. */
export const isFundingAccount = (account: AccountRecord) =>
  account.kind !== "credit_card" && account.kind !== "investment" && !account.archived;

export function useInvestmentCash() {
  const [settings, setSettings] = useState<CashSettings | null>(null);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [nextSettings, nextAccounts, nextPositions] = await Promise.all([
      api<CashSettings>("/investments/cash-settings"),
      api<AccountRecord[]>("/ledger/accounts"),
      api<PositionRecord[]>("/positions")
    ]);
    setSettings(nextSettings);
    setAccounts(nextAccounts);
    setPositions(nextPositions);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload().catch(() => setLoading(false));
  }, [reload]);

  return {
    settings,
    accounts,
    banks: accounts.filter(isFundingAccount),
    positions,
    caixas: positions.filter(isLiquid),
    loading,
    reload
  };
}

export type AllocationGap = { category: string; targetBrl: number; actualBrl: number };

/**
 * Onde pôr o dinheiro em caixa para chegar mais perto da meta.
 *
 * Só as classes abaixo da meta recebem, e cada uma na proporção do que falta
 * para ela: se o caixa cobre todas as faltas, cada uma recebe a sua falta
 * inteira e o resto fica em caixa. O próprio caixa nunca é destino — alocar
 * caixa em caixa não move nada.
 */
export function suggestCashAllocation(
  gaps: AllocationGap[],
  cashBrl: number,
  cashCategory = "caixa_br"
): { category: string; amountBrl: number }[] {
  if (!(cashBrl > 0)) return [];
  const short = gaps
    .filter((gap) => gap.category !== cashCategory)
    .map((gap) => ({ category: gap.category, missing: gap.targetBrl - gap.actualBrl }))
    .filter((gap) => gap.missing > 0.005);
  const totalMissing = short.reduce((sum, gap) => sum + gap.missing, 0);
  if (totalMissing <= 0) return [];
  const scale = Math.min(1, cashBrl / totalMissing);
  return short
    .map((gap) => ({ category: gap.category, amountBrl: Math.round(gap.missing * scale * 100) / 100 }))
    .filter((gap) => gap.amountBrl > 0)
    .sort((a, b) => b.amountBrl - a.amountBrl);
}

/**
 * Para onde vai cada classe da meta quando o usuário decide alocar: as
 * carteiras abrem a compra; o resto é mover de um caixa para uma posição.
 */
export function destinationOf(category: string): "crypto" | "b3" | "positions" {
  if (category === "bitcoin" || category === "shitcoins") return "crypto";
  if (category === "bolsa_brasil") return "b3";
  return "positions";
}
