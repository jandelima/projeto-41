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
};

export type Dashboard = {
  totalBrl: number;
  totalUsd: number;
  usdBrl: number;
  categories: Record<string, number>;
  annualContributions: number;
  annualReturn: number;
  history: Snapshot[];
  prices: Price[];
  portfolios: { crypto: Asset[]; b3: Asset[] };
  reserveBrl: number;
  updatedAt: string;
};

export type Operation = {
  id: number;
  portfolio: "crypto" | "b3";
  type: "buy" | "sell";
  asset: string;
  date: string;
  quantity: number;
  total: number;
  currency: "BRL" | "USD";
  notes?: string;
};

export type ManualPosition = {
  id: number;
  category: string;
  name: string;
  invested: number;
  currentValue: number;
  currency: "BRL" | "USD";
  notes?: string;
};

export type Contribution = {
  id: number;
  date: string;
  amount: number;
  notes?: string;
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
