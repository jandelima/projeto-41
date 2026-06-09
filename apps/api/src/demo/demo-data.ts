import type { AppDatabase, PriceRecord } from "@projeto41/db";

const cryptoAssets = [
  "BTC", "SOL", "ETH", "MKR", "NEAR", "PENDLE", "LINK", "AVAX",
  "AAVE", "SEI", "IMX", "LDO", "ADA", "FET", "RENDER", "ATOM",
  "UMA", "ASTR", "SNX", "VET", "DYDX", "AXL", "POL", "VANRY"
] as const;

const b3Assets = [
  "SLCE3", "PETR4", "BBAS3", "TTEN3", "FESA4", "BPAC11", "OBTC3",
  "TIMS3", "CASH3", "BBSE3", "WEGE3", "SHUL4", "CMIN3"
] as const;

const cryptoPrices: Record<(typeof cryptoAssets)[number], number> = {
  BTC: 50_000,
  SOL: 120,
  ETH: 2_500,
  MKR: 1_100,
  NEAR: 3.2,
  PENDLE: 2.1,
  LINK: 11,
  AVAX: 18,
  AAVE: 95,
  SEI: 0.32,
  IMX: 0.85,
  LDO: 1.15,
  ADA: 0.42,
  FET: 0.58,
  RENDER: 4.4,
  ATOM: 5.5,
  UMA: 1.7,
  ASTR: 0.041,
  SNX: 1.2,
  VET: 0.025,
  DYDX: 0.82,
  AXL: 0.34,
  POL: 0.21,
  VANRY: 0.052
};

const b3Prices: Record<(typeof b3Assets)[number], number> = {
  SLCE3: 18,
  PETR4: 36,
  BBAS3: 28,
  TTEN3: 13,
  FESA4: 7,
  BPAC11: 42,
  OBTC3: 48,
  TIMS3: 19,
  CASH3: 5,
  BBSE3: 37,
  WEGE3: 52,
  SHUL4: 6,
  CMIN3: 5.5
};

export function seedDemoDatabase(db: AppDatabase, now = new Date()) {
  const date = formatDate(now);
  const fetchedAt = now.toISOString();
  const usdBrl = 5;

  db.prices.upsert(quote("USDBRL", usdBrl, "BRL", fetchedAt));
  cryptoAssets.forEach((asset) =>
    db.prices.upsert(quote(asset, cryptoPrices[asset], "USD", fetchedAt))
  );
  b3Assets.forEach((asset) =>
    db.prices.upsert(quote(asset, b3Prices[asset], "BRL", fetchedAt))
  );

  seedAssetOperations(db, {
    assets: cryptoAssets,
    prices: cryptoPrices,
    portfolio: "crypto",
    currency: "USD",
    categoryTotalBrl: 7_000,
    conversion: usdBrl,
    date,
    primaryWeights: [0.5, 0.11, 0.1]
  });
  seedAssetOperations(db, {
    assets: b3Assets,
    prices: b3Prices,
    portfolio: "b3",
    currency: "BRL",
    categoryTotalBrl: 5_000,
    conversion: 1,
    date,
    primaryWeights: [0.13, 0.15, 0.12]
  });

  b3Assets.forEach((asset, index) => {
    db.dividends.set(asset, 8 + index * 3);
  });

  [
    manual("cash", "Caixinha Nubank", 900, "BRL"),
    manual("cash", "Saldo BTG", 850, "BRL"),
    manual("cash", "Aupo11", 750, "BRL"),
    manual("dollar", "Binance", 180, "USD"),
    manual("dollar", "MetaMask", 130, "USD"),
    manual("dollar", "Autocustodia", 90, "USD"),
    manual("fixed_income", "Tesouro Direto BB", 650, "BRL", 610),
    manual("fixed_income", "Tesouro Direto BTG", 500, "BRL", 470),
    manual("fixed_income", "Outros titulos", 350, "BRL", 330),
    manual("reserve", "Caixinha Itau", 800, "BRL"),
    manual("reserve", "Caixinha Nubank", 900, "BRL"),
    manual("reserve", "Papel-moeda", 300, "BRL")
  ].forEach((position) => db.positions.upsert(position));

  [
    ["bitcoin", 0.35],
    ["shitcoins", 0.05],
    ["dolar", 0.075],
    ["caixa_br", 0.075],
    ["bolsa_brasil", 0.25],
    ["renda_fixa", 0.1],
    ["acoes_globais", 0.1]
  ].forEach(([category, weight]) => db.targets.set(String(category), Number(weight)));

  for (let month = 1; month <= 6; month += 1) {
    for (let week = 0; week < 2; week += 1) {
      db.contributions.create({
        date: `2026-${String(month).padStart(2, "0")}-${String(5 + week * 14).padStart(2, "0")}`,
        amount: 220 + month * 15 + week * 40,
        notes: `Aporte demonstrativo ${week + 1}`
      });
    }
  }

  Object.entries({
    initialCapital: 20_000,
    monthlyContribution: 750,
    monthlyReturnPercent: 0.8,
    months: 180,
    annualInflationPercent: 4.5,
    initialYear: 2026
  }).forEach(([key, value]) => db.settings.set(key, String(value)));

  seedHistory(db, now);
}

function seedAssetOperations<T extends readonly string[]>(
  db: AppDatabase,
  options: {
    assets: T;
    prices: Record<T[number], number>;
    portfolio: "crypto" | "b3";
    currency: "USD" | "BRL";
    categoryTotalBrl: number;
    conversion: number;
    date: string;
    primaryWeights: number[];
  }
) {
  const remainingWeight =
    (1 - options.primaryWeights.reduce((sum, weight) => sum + weight, 0)) /
    (options.assets.length - options.primaryWeights.length);

  options.assets.forEach((asset, index) => {
    const typedAsset = asset as T[number];
    const weight = options.primaryWeights[index] ?? remainingWeight;
    const marketValueBrl =
      index === options.assets.length - 1
        ? options.categoryTotalBrl -
          options.assets.slice(0, -1).reduce((sum, _item, priorIndex) => {
            const priorWeight = options.primaryWeights[priorIndex] ?? remainingWeight;
            return sum + options.categoryTotalBrl * priorWeight;
          }, 0)
        : options.categoryTotalBrl * weight;
    const marketValue = marketValueBrl / options.conversion;
    const price = options.prices[typedAsset]!;
    db.operations.create({
      portfolio: options.portfolio,
      type: "buy",
      asset: typedAsset,
      date: options.date,
      quantity: marketValue / price,
      total: marketValue * (0.82 + (index % 5) * 0.035),
      currency: options.currency,
      notes: "Dados sinteticos para demonstracao"
    });
  });
}

function manual(
  category: "dollar" | "cash" | "reserve" | "fixed_income",
  name: string,
  currentValue: number,
  currency: "BRL" | "USD",
  invested = currentValue * 0.94
) {
  return { category, name, invested, currentValue, currency };
}

function seedHistory(db: AppDatabase, now: Date) {
  const categoryWeights = {
    crypto: 0.35,
    b3: 0.25,
    dollar: 0.1,
    cash: 0.125,
    reserve: 0.1,
    fixed_income: 0.075,
    global: 0
  };

  for (let index = 0; index < 120; index += 1) {
    const progress = index / 119;
    const factor =
      0.72 + 0.28 * progress + Math.sin(progress * Math.PI * 7) * 0.015 * (1 - progress);
    const totalBrl = index === 119 ? 20_000 : 20_000 * factor;
    const target = new Date(now);
    target.setDate(target.getDate() - (119 - index));
    db.snapshots.upsert({
      date: formatDate(target),
      totalBrl,
      payload: Object.fromEntries(
        Object.entries(categoryWeights).map(([category, weight]) => [
          category,
          totalBrl * weight
        ])
      ),
      priceTimes: {}
    });
  }
}

function quote(
  symbol: string,
  price: number,
  currency: "BRL" | "USD",
  fetchedAt: string
): PriceRecord {
  return {
    symbol,
    price,
    currency,
    provider: "demo",
    marketTime: fetchedAt,
    fetchedAt,
    error: null
  };
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
