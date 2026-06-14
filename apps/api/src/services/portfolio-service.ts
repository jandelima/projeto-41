import type { AppDatabase } from "@projeto41/db";
import { calculatePosition } from "@projeto41/finance";

export function buildPortfolios(db: AppDatabase) {
  const prices = new Map(db.prices.list().map((price) => [price.symbol, price]));
  const dividends = new Map(db.dividends.list().map((item) => [item.asset, item.amount]));
  const usdBrl = prices.get("USDBRL")?.price ?? 0;

  const groups = (["crypto", "b3"] as const).map((portfolio) => {
    const operations = db.operations.list(portfolio);
    const assets = [...new Set(operations.map((operation) => operation.asset))];
    return {
      portfolio,
      assets: assets.map((asset) => {
        const price = prices.get(asset);
        const position = calculatePosition(
          operations
            .filter((operation) => operation.asset === asset)
            .map(({ type, quantity, total }) => ({ type, quantity, total })),
          price?.price ?? 0,
          portfolio === "b3" ? dividends.get(asset) ?? 0 : 0
        );
        const brlFactor = portfolio === "crypto" ? usdBrl : 1;
        return {
          asset,
          ...position,
          marketValueBrl: position.marketValue * brlFactor,
          investedBrl: position.invested * brlFactor,
          price: price?.price ?? 0,
          priceCurrency: portfolio === "crypto" ? "USD" : "BRL",
          priceStatus: priceStatus(price?.fetchedAt, price?.error),
          priceFetchedAt: price?.fetchedAt ?? null
        };
      })
    };
  });

  return {
    crypto: groups.find((group) => group.portfolio === "crypto")?.assets ?? [],
    b3: groups.find((group) => group.portfolio === "b3")?.assets ?? []
  };
}

export function buildDashboard(db: AppDatabase, now = new Date()) {
  const portfolios = buildPortfolios(db);
  const prices = db.prices.list();
  const usdBrl = db.prices.get("USDBRL")?.price ?? 0;
  const categories: Record<string, number> = {
    crypto: portfolios.crypto.reduce((sum, asset) => sum + asset.marketValueBrl, 0),
    b3: portfolios.b3.reduce((sum, asset) => sum + asset.marketValueBrl, 0),
    dollar: 0,
    cash: 0,
    reserve: 0,
    fixed_income: 0,
    global: 0
  };

  for (const position of db.positions.list()) {
    categories[position.category] =
      (categories[position.category] ?? 0) +
      position.currentValue * (position.currency === "USD" ? usdBrl : 1);
  }

  const totalBrl = Object.values(categories).reduce((sum, value) => sum + value, 0);
  const contributions = db.contributions.list();
  const currentYear = now.getFullYear();
  const annualContributions = contributions
    .filter((item) => Number(item.date.slice(0, 4)) === currentYear)
    .reduce((sum, item) => sum + item.amount, 0);
  const history = db.snapshots.list();
  const firstSnapshotOfYear = history.find((snapshot) =>
    snapshot.date.startsWith(String(currentYear))
  );
  const annualReturn =
    firstSnapshotOfYear && firstSnapshotOfYear.totalBrl > 0
      ? (totalBrl - annualContributions) / firstSnapshotOfYear.totalBrl - 1
      : 0;

  return {
    totalBrl,
    totalUsd: usdBrl > 0 ? totalBrl / usdBrl : 0,
    usdBrl,
    categories,
    annualContributions,
    annualReturn,
    history,
    prices,
    portfolios,
    reserveBrl: categories.reserve ?? 0,
    updatedAt: prices.reduce(
      (latest, price) => (price.fetchedAt > latest ? price.fetchedAt : latest),
      ""
    )
  };
}

export function createDailySnapshot(db: AppDatabase, date: string) {
  const dashboard = buildDashboard(db);
  const priceTimes = Object.fromEntries(
    dashboard.prices.map((price) => [price.symbol, price.fetchedAt])
  );
  db.snapshots.upsert({
    date,
    totalBrl: dashboard.totalBrl,
    payload: dashboard.categories,
    priceTimes
  });
  return dashboard.totalBrl;
}

function priceStatus(fetchedAt?: string, error?: string | null) {
  if (!fetchedAt) return "unavailable";
  if (error) return "stale";
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > 60 * 60 * 1000 ? "stale" : "current";
}
