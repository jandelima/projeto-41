import { describe, expect, it } from "vitest";
import {
  fetchB3Price,
  fetchCryptoPrices,
  fetchUsdBrl,
  searchCryptoAssets
} from "./providers.js";

describe("price providers", () => {
  it("parses the CoinGecko simple/price response", async () => {
    const fetcher = async () => Response.json({ bitcoin: { usd: 65000.5 }, ethereum: { usd: 3200 } });
    const prices = await fetchCryptoPrices(
      [
        { slug: "bitcoin", symbol: "BTC" },
        { slug: "ethereum", symbol: "ETH" }
      ],
      "demo-key",
      fetcher as typeof fetch
    );
    expect(prices[0]).toMatchObject({ symbol: "BTC", price: 65000.5, currency: "USD", provider: "coingecko" });
    expect(prices[1]).toMatchObject({ symbol: "ETH", price: 3200 });
  });

  it("parses one B3 quote from brapi", async () => {
    const fetcher = async () =>
      Response.json({
        results: [{ symbol: "PETR4", regularMarketPrice: 42.5, regularMarketTime: "2026-06-09T17:00:00Z" }]
      });
    const price = await fetchB3Price("PETR4", "token", fetcher as typeof fetch);
    expect(price).toMatchObject({ symbol: "PETR4", price: 42.5, currency: "BRL" });
  });

  it("retries a B3 quote after a transient request failure", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("The operation was aborted due to timeout");
      return Response.json({
        results: [{ symbol: "BBAS3", regularMarketPrice: 25.4 }]
      });
    };

    const price = await fetchB3Price("BBAS3", "token", fetcher as typeof fetch);

    expect(attempts).toBe(2);
    expect(price).toMatchObject({ symbol: "BBAS3", price: 25.4 });
  });

  it("maps the CoinGecko search response to symbol/id matches", async () => {
    const fetcher = async (input: string | URL) => {
      expect(String(input)).toContain("query=btc");
      return Response.json({
        coins: [
          { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1 },
          { id: "wrapped-bitcoin", symbol: "wbtc", name: "Wrapped Bitcoin", market_cap_rank: 15 },
          { id: "", symbol: "", name: "" }
        ]
      });
    };
    const results = await searchCryptoAssets("btc", "demo-key", fetcher as typeof fetch);
    expect(results).toEqual([
      { id: "bitcoin", symbol: "BTC", name: "Bitcoin", rank: 1 },
      { id: "wrapped-bitcoin", symbol: "WBTC", name: "Wrapped Bitcoin", rank: 15 }
    ]);
  });

  it("returns no search matches for an empty query without calling the API", async () => {
    let called = false;
    const fetcher = async () => {
      called = true;
      return Response.json({});
    };
    const results = await searchCryptoAssets("   ", "demo-key", fetcher as typeof fetch);
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("parses the official BCB PTAX response", async () => {
    const fetcher = async () =>
      Response.json({ value: [{ cotacaoVenda: 5.21, dataHoraCotacao: "2026-06-09 13:00:00.000" }] });
    const price = await fetchUsdBrl(new Date("2026-06-09T12:00:00Z"), fetcher as typeof fetch);
    expect(price).toMatchObject({ symbol: "USDBRL", price: 5.21, provider: "bcb" });
  });
});
