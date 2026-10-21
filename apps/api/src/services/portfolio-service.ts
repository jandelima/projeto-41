import { withInvestmentAccount, type AppDatabase, type PriceRecord } from "@projeto41/db";
import { buildNetWorth, markCashControlStart } from "./net-worth-service.js";
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
            // Cripto é cotada em dólar: uma operação registrada em reais entra
            // no custo convertida, senão R$ 400 viravam US$ 400.
            .map(({ type, quantity, total, currency }) => ({
              type,
              quantity,
              total: portfolio === "crypto" && currency === "BRL" && usdBrl > 0 ? total / usdBrl : total
            })),
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
          priceFetchedAt: price?.fetchedAt ?? null,
          dayChange: dayChange(price)
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
  // O patrimonio agora e unificado: contas, caixinhas e investimentos, menos a
  // divida de cartao. `categories` continua sendo a chave que o dashboard e o
  // snapshot consomem.
  const netWorth = buildNetWorth(db, now);
  const categories = netWorth.classes;
  const totalBrl = netWorth.totalBrl;
  // Aporte pelo livro conta junto: sem ele, o rendimento do ano trataria
  // dinheiro novo como ganho.
  const contributions = db.contributions.all();
  const currentYear = now.getFullYear();
  const annualContributions = contributions
    .filter((item) => Number(item.date.slice(0, 4)) === currentYear)
    .reduce((sum, item) => sum + item.amount, 0);
  const history = db.snapshots.list();
  const firstSnapshotOfYear = history.find((snapshot) =>
    snapshot.date.startsWith(String(currentYear))
  );
  /**
   * `null` quando nao ha base comparavel.
   *
   * Comparar o total de hoje (v2, com caixa) contra um snapshot v1 (so
   * investimentos) seria comparar grandezas diferentes e devolver um numero
   * errado com cara de certo. A tela mostra "—" nesse caso.
   */
  const annualReturn =
    firstSnapshotOfYear &&
    firstSnapshotOfYear.totalBrl > 0 &&
    firstSnapshotOfYear.payloadVersion === 2
      ? (totalBrl - annualContributions) / firstSnapshotOfYear.totalBrl - 1
      : null;

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
    // Os dois recortes e o aviso de dupla contagem saem prontos daqui: a tela
    // nao soma nada.
    bankOnlyBrl: netWorth.bankOnlyBrl,
    investmentsBrl: netWorth.investmentsBrl,
    liabilitiesBrl: netWorth.liabilitiesBrl,
    creditCardCurrentBrl: netWorth.creditCardCurrentBrl,
    investableBrl: netWorth.investableBrl,
    cashControlStartedOn: netWorth.cashControlStartedOn,
    doubleCounting: netWorth.doubleCounting,
    payloadVersion: netWorth.schemaVersion,
    updatedAt: prices.reduce(
      (latest, price) => (price.fetchedAt > latest ? price.fetchedAt : latest),
      ""
    )
  };
}

export function createDailySnapshot(db: AppDatabase, date: string) {
  const netWorth = buildNetWorth(db);
  const prices = db.prices.list();
  const priceTimes = Object.fromEntries(prices.map((price) => [price.symbol, price.fetchedAt]));

  db.snapshots.upsert({
    date,
    totalBrl: netWorth.totalBrl,
    // Payload v2: nenhuma linha v1 e reescrita, convertida ou completada — o
    // passado nao tinha caixa e continuara nao tendo (D14, R-03).
    payload: {
      version: 2,
      classes: netWorth.classes,
      totals: {
        investments: netWorth.investmentsBrl,
        bank: netWorth.bankBrl,
        liabilities: netWorth.liabilitiesBrl
      }
    },
    priceTimes
  });
  markCashControlStart(db, date, netWorth);
  return netWorth.totalBrl;
}

/**
 * O retrato do dia de cada conta de investimento e o de todas juntas: cada
 * histórico é desenhado com os próprios registros.
 */
export function createDailySnapshots(db: AppDatabase, date: string) {
  const total = withInvestmentAccount(null, () => createDailySnapshot(db, date));
  for (const account of db.investmentAccounts.list()) {
    withInvestmentAccount(account.id, () => createDailySnapshot(db, date));
  }
  return total;
}

// Variação do dia por ativo, como razão (0.012 = +1,2%) ou null quando indisponível.
// Calculada sempre aqui: preço atual vs. o "fechamento" do dia anterior gravado no
// baseline (prevPrice/prevDay). Não usamos percentual de provedor externo.
function dayChange(price?: PriceRecord): number | null {
  if (!price || price.error) return null;
  const today = price.fetchedAt.slice(0, 10);
  if (price.prevPrice && price.prevPrice > 0 && price.prevDay && price.prevDay < today) {
    return price.price / price.prevPrice - 1;
  }
  return null;
}

function priceStatus(fetchedAt?: string, error?: string | null) {
  if (!fetchedAt) return "unavailable";
  if (error) return "stale";
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > 60 * 60 * 1000 ? "stale" : "current";
}
