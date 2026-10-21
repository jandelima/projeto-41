import type { Contribution, ManualPosition, Operation } from "./index.js";

/**
 * Formatos de resposta que o servidor monta e o frontend so le.
 *
 * Nao sao schemas Zod porque nada os valida na entrada: eles existem para que
 * `apps/web` pare de manter uma copia manual dos tipos (D28). O frontend importa
 * daqui apenas com `import type`, para o Zod continuar fora do bundle.
 */

export type Price = {
  symbol: string;
  price: number;
  currency: string;
  provider: string;
  fetchedAt: string;
  error: string | null;
};

export type Asset = {
  asset: string;
  quantity: number;
  invested: number;
  averagePrice: number;
  soldValue: number;
  marketValue: number;
  marketValueBrl: number;
  currentReturn: number;
  totalReturn: number;
  dividends: number;
  price: number;
  priceCurrency: string;
  priceStatus: string;
  priceFetchedAt: string | null;
  dayChange: number | null;
};

export type Snapshot = {
  date: string;
  totalBrl: number;
  payload: Record<string, number>;
  classes: Record<string, number>;
  /** 1 = antes do controle de caixa; 2 = com caixa somado (fase 4). */
  payloadVersion: 1 | 2;
  totals: { investments: number; bank: number; liabilities: number } | null;
};

export type DoubleCounting = {
  active: boolean;
  manualPositions: { id: number; name: string; category: string; currentValue: number }[];
  ledgerBalanceBrl: number;
};

export type Dashboard = {
  totalBrl: number;
  totalUsd: number;
  usdBrl: number;
  categories: Record<string, number>;
  annualContributions: number;
  /** `null` quando a base do ano e anterior ao controle de caixa (fase 4). */
  annualReturn: number | null;
  history: Snapshot[];
  prices: Price[];
  portfolios: { crypto: Asset[]; b3: Asset[] };
  reserveBrl: number;
  /** So as classes do livro, ja liquidas da divida de cartao. */
  bankOnlyBrl: number;
  investmentsBrl: number;
  /** Total devido do cartao; e ele que entra no patrimonio (6.1). */
  liabilitiesBrl: number;
  /** So a fatura corrente do cartao: o outro numero de 6.1. */
  creditCardCurrentBrl: number;
  /** So o modulo de investimentos, sem a reserva: base dos pesos da carteira. */
  investableBrl: number;
  cashControlStartedOn: string | null;
  doubleCounting: DoubleCounting;
  payloadVersion: number;
  updatedAt: string;
};

/**
 * Linhas ja gravadas trazem `id`. Os schemas de entrada deixam `id` opcional
 * porque na criacao ele ainda nao existe; estes apelidos evitam espalhar
 * `id!` pelo frontend.
 */
export type OperationRecord = Operation & { id: number };
export type ManualPositionRecord = ManualPosition & { id: number };
/**
 * Rendimento CDI de uma posição. O realizado já é lançado no extrato sozinho;
 * aqui fica só o que ainda não virou linha: o realizado de hoje (raro, entre
 * a publicação da taxa e a próxima leitura) e a projeção dos dias sem taxa.
 */
export type PositionYield = {
  pendingYield: number;
  realizedThroughDate: string | null;
  projectedYield: number;
  projectedThroughDate: string | null;
};
/** O extrato resumido: quanto entrou, quanto rendeu, quanto foi corrigido. */
export type PositionHistory = {
  /** Aportes menos resgates, movimentos e compras: o dinheiro que você pôs. */
  contributed: number;
  yieldTotal: number;
  adjustTotal: number;
  lastYieldDate: string | null;
  lastAdjust: { date: string; value: number | null } | null;
};
export type PositionRecord = ManualPositionRecord & {
  yield: PositionYield | null;
  history: PositionHistory;
};
/**
 * Aporte no acompanhamento anual. `manual` é o digitado na tela de Aportes;
 * `ledger` vem do livro: dinheiro que saiu de uma conta para os investimentos
 * (positivo) ou voltou deles (resgate, negativo). O do livro não se apaga aqui
 * — quem desfaz é Investimentos › Em caixa, que devolve a posição junto.
 */
export type ContributionRecord = Contribution & {
  id: number;
  source?: "manual" | "ledger";
  transferId?: number | null;
  accountName?: string | null;
};

export type CryptoSearchResult = {
  id: string;
  symbol: string;
  name: string;
  rank: number | null;
};

export type B3SearchResult = {
  symbol: string;
  name: string;
  price: number;
  currency: string;
};

export type AllocationTarget = { category: string; weight: number };

export type PlanningForm = {
  initialCapital: number;
  monthlyContribution: number;
  monthlyReturnPercent: number;
  months: number;
  annualInflationPercent: number;
  initialYear: number;
};
