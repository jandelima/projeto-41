import type { AppDatabase, PriceRecord } from "@projeto41/db";

export function seedDemoDatabase(db: AppDatabase, now = new Date()) {
  const date = formatDate(now);
  const fetchedAt = now.toISOString();

  const prices: PriceRecord[] = [
    quote("USDBRL", 5, "BRL", "demo", fetchedAt),
    quote("BTC", 60_000, "USD", "demo", fetchedAt),
    quote("ETH", 3_000, "USD", "demo", fetchedAt),
    quote("SOL", 150, "USD", "demo", fetchedAt),
    quote("PETR4", 40, "BRL", "demo", fetchedAt),
    quote("BBAS3", 30, "BRL", "demo", fetchedAt),
    quote("WEGE3", 50, "BRL", "demo", fetchedAt)
  ];
  prices.forEach((price) => db.prices.upsert(price));

  [
    ["BTC", 4_000 / 5 / 60_000, 680],
    ["ETH", 1_800 / 5 / 3_000, 320],
    ["SOL", 1_200 / 5 / 150, 205]
  ].forEach(([asset, quantity, total]) =>
    db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: String(asset),
      date,
      quantity: Number(quantity),
      total: Number(total),
      currency: "USD",
      notes: "Dados sinteticos para demonstracao"
    })
  );

  [
    ["PETR4", 50, 1_750],
    ["BBAS3", 50, 1_350],
    ["WEGE3", 30, 1_320]
  ].forEach(([asset, quantity, total]) =>
    db.operations.create({
      portfolio: "b3",
      type: "buy",
      asset: String(asset),
      date,
      quantity: Number(quantity),
      total: Number(total),
      currency: "BRL",
      notes: "Dados sinteticos para demonstracao"
    })
  );

  db.dividends.set("PETR4", 85);
  db.dividends.set("BBAS3", 62);
  db.dividends.set("WEGE3", 18);

  [
    {
      category: "dollar" as const,
      name: "Conta internacional",
      invested: 360,
      currentValue: 400,
      currency: "USD" as const
    },
    {
      category: "cash" as const,
      name: "Reserva de liquidez",
      invested: 2_500,
      currentValue: 2_500,
      currency: "BRL" as const
    },
    {
      category: "reserve" as const,
      name: "Reserva de emergencia",
      invested: 2_000,
      currentValue: 2_000,
      currency: "BRL" as const
    },
    {
      category: "fixed_income" as const,
      name: "Tesouro Direto",
      invested: 1_420,
      currentValue: 1_500,
      currency: "BRL" as const
    }
  ].forEach((position) => db.positions.upsert(position));

  [
    ["bitcoin", 0.25],
    ["shitcoins", 0.1],
    ["dolar", 0.1],
    ["caixa_br", 0.1],
    ["bolsa_brasil", 0.25],
    ["renda_fixa", 0.1],
    ["acoes_globais", 0.1]
  ].forEach(([category, weight]) => db.targets.set(String(category), Number(weight)));

  for (let month = 1; month <= 6; month += 1) {
    db.contributions.create({
      date: `2026-${String(month).padStart(2, "0")}-10`,
      amount: month % 2 ? 450 : 600,
      notes: "Aporte demonstrativo"
    });
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
  provider: string,
  fetchedAt: string
): PriceRecord {
  return {
    symbol,
    price,
    currency,
    provider,
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
