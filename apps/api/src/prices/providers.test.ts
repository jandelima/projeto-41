import { describe, expect, it } from "vitest";
import { fetchB3Price, fetchCryptoPrices, fetchUsdBrl } from "./providers.js";

describe("price providers", () => {
  it("parses the existing crypto server response", async () => {
    const fetcher = async () =>
      new Response('<prices><coin symbol = "BTC" id = "bitcoin">65000,5</coin></prices>');
    const prices = await fetchCryptoPrices(
      [{ slug: "bitcoin", symbol: "BTC" }],
      "http://prices.test",
      fetcher as typeof fetch
    );
    expect(prices[0]).toMatchObject({ symbol: "BTC", price: 65000.5, currency: "USD" });
  });

  it("parses one B3 quote from brapi", async () => {
    const fetcher = async () =>
      Response.json({
        results: [{ symbol: "PETR4", regularMarketPrice: 42.5, regularMarketTime: "2026-06-09T17:00:00Z" }]
      });
    const price = await fetchB3Price("PETR4", "token", fetcher as typeof fetch);
    expect(price).toMatchObject({ symbol: "PETR4", price: 42.5, currency: "BRL" });
  });

  it("parses the official BCB PTAX response", async () => {
    const fetcher = async () =>
      Response.json({ value: [{ cotacaoVenda: 5.21, dataHoraCotacao: "2026-06-09 13:00:00.000" }] });
    const price = await fetchUsdBrl(new Date("2026-06-09T12:00:00Z"), fetcher as typeof fetch);
    expect(price).toMatchObject({ symbol: "USDBRL", price: 5.21, provider: "bcb" });
  });
});
