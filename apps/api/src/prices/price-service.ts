import type { AppDatabase } from "@projeto41/db";
import { fetchB3Price, fetchCryptoPrices, fetchUsdBrl } from "./providers.js";

const cryptoSlugs: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  ADA: "cardano",
  AVAX: "avalanche-2",
  SOL: "solana",
  AXL: "axelar",
  LINK: "chainlink",
  FET: "fetch-ai",
  UMA: "uma",
  ATOM: "cosmos",
  PENDLE: "pendle",
  VET: "vechain",
  MKR: "maker",
  LDO: "lido-dao",
  SEI: "sei-network",
  DYDX: "dydx-chain",
  NEAR: "near",
  ASTR: "astar",
  SNX: "havven",
  POL: "polygon-ecosystem-token",
  VANRY: "vanar-chain",
  DOT: "polkadot",
  IMX: "immutable-x",
  RENDER: "render-token",
  AAVE: "aave"
};

export function createPriceService(
  db: AppDatabase,
  options: {
    cryptoUrl: string;
    brapiToken: string;
    fetcher?: typeof fetch;
  }
) {
  const fetcher = options.fetcher ?? fetch;

  async function runCrypto() {
    const symbols = [
      ...new Set(db.operations.list("crypto").map((operation) => operation.asset))
    ];
    try {
      const quotes = await fetchCryptoPrices(
        symbols.map((symbol) => ({ symbol, slug: cryptoSlugs[symbol] ?? symbol.toLowerCase() })),
        options.cryptoUrl,
        fetcher
      );
      for (const quote of quotes) db.prices.upsert(quote);
      return { provider: "crypto", updated: quotes.length, errors: [] as string[] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown crypto provider error";
      for (const symbol of symbols) db.prices.markError(symbol, message, new Date().toISOString());
      return { provider: "crypto", updated: 0, errors: [message] };
    }
  }

  async function runB3() {
    const symbols = [...new Set(db.operations.list("b3").map((operation) => operation.asset))];
    const errors: string[] = [];
    let updated = 0;
    for (const symbol of symbols) {
      try {
        db.prices.upsert(await fetchB3Price(symbol, options.brapiToken, fetcher));
        updated += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unknown brapi error for ${symbol}`;
        db.prices.markError(symbol, message, new Date().toISOString());
        errors.push(message);
      }
    }
    return { provider: "b3", updated, errors };
  }

  async function runCurrency() {
    try {
      db.prices.upsert(await fetchUsdBrl(new Date(), fetcher));
      return { provider: "currency", updated: 1, errors: [] as string[] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown BCB error";
      db.prices.markError("USDBRL", message, new Date().toISOString());
      return { provider: "currency", updated: 0, errors: [message] };
    }
  }

  return {
    runCrypto,
    runB3,
    runCurrency,
    runAll: () => Promise.all([runCrypto(), runB3(), runCurrency()])
  };
}

