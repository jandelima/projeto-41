import type { PriceRecord } from "@projeto41/db";

type Fetcher = typeof fetch;

export type CryptoPriceResult = {
  records: PriceRecord[];
  errors: { symbol: string; message: string }[];
};

export async function fetchCryptoPrices(
  assets: { slug: string; symbol: string }[],
  apiKey: string,
  fetcher: Fetcher = fetch
): Promise<CryptoPriceResult> {
  if (assets.length === 0) return { records: [], errors: [] };

  const endpoint = new URL("https://api.coingecko.com/api/v3/simple/price");
  endpoint.searchParams.set("ids", assets.map((asset) => asset.slug).join(","));
  endpoint.searchParams.set("vs_currencies", "usd");

  const headers = apiKey ? { "x-cg-demo-api-key": apiKey } : undefined;
  const response = await withTimeout(fetcher, endpoint, headers);
  if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
  const data = (await response.json()) as Record<string, { usd?: number }>;
  const fetchedAt = new Date().toISOString();

  const records: PriceRecord[] = [];
  const errors: { symbol: string; message: string }[] = [];
  for (const { slug, symbol } of assets) {
    const price = data[slug]?.usd ?? Number.NaN;
    if (!Number.isFinite(price) || price <= 0) {
      errors.push({ symbol, message: `Invalid crypto price for ${symbol}` });
      continue;
    }
    records.push({
      symbol,
      currency: "USD",
      price,
      provider: "coingecko",
      marketTime: null,
      fetchedAt,
      error: null
    });
  }
  return { records, errors };
}

export type CryptoSearchResult = {
  id: string;
  symbol: string;
  name: string;
  rank: number | null;
};

export async function searchCryptoAssets(
  query: string,
  apiKey: string,
  fetcher: Fetcher = fetch
): Promise<CryptoSearchResult[]> {
  const term = query.trim();
  if (!term) return [];

  const endpoint = new URL("https://api.coingecko.com/api/v3/search");
  endpoint.searchParams.set("query", term);

  const headers = apiKey ? { "x-cg-demo-api-key": apiKey } : undefined;
  const response = await withTimeout(fetcher, endpoint, headers);
  if (!response.ok) throw new Error(`CoinGecko search returned ${response.status}`);
  const data = (await response.json()) as {
    coins?: { id?: string; symbol?: string; name?: string; market_cap_rank?: number | null }[];
  };

  return (data.coins ?? [])
    .filter((coin): coin is { id: string; symbol: string; name: string; market_cap_rank?: number | null } =>
      Boolean(coin.id && coin.symbol && coin.name)
    )
    .slice(0, 1000)
    .map((coin) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      rank: coin.market_cap_rank ?? null
    }));
}

export async function fetchB3Price(
  symbol: string,
  token: string,
  fetcher: Fetcher = fetch
): Promise<PriceRecord> {
  const endpoint = new URL(`https://brapi.dev/api/quote/${encodeURIComponent(symbol)}`);
  if (token) endpoint.searchParams.set("token", token);
  const response = await withRetry(fetcher, endpoint);
  if (!response.ok) throw new Error(`brapi returned ${response.status} for ${symbol}`);
  const data = (await response.json()) as {
    results?: { symbol?: string; regularMarketPrice?: number; regularMarketTime?: string }[];
  };
  const quote = data.results?.[0];
  if (!quote?.regularMarketPrice || quote.regularMarketPrice <= 0) {
    throw new Error(`Invalid brapi quote for ${symbol}`);
  }
  return {
    symbol: quote.symbol ?? symbol,
    currency: "BRL",
    price: quote.regularMarketPrice,
    provider: "brapi",
    marketTime: quote.regularMarketTime ?? null,
    fetchedAt: new Date().toISOString(),
    error: null
  };
}

export async function fetchUsdBrl(
  now = new Date(),
  fetcher: Fetcher = fetch
): Promise<PriceRecord> {
  for (let offset = 0; offset < 7; offset += 1) {
    const target = new Date(now);
    target.setUTCDate(target.getUTCDate() - offset);
    const formatted = `${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(
      target.getUTCDate()
    ).padStart(2, "0")}-${target.getUTCFullYear()}`;
    const endpoint = new URL(
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)"
    );
    endpoint.searchParams.set("@dataCotacao", `'${formatted}'`);
    endpoint.searchParams.set("$format", "json");
    const response = await withTimeout(fetcher, endpoint);
    if (!response.ok) continue;
    const data = (await response.json()) as {
      value?: { cotacaoVenda?: number; dataHoraCotacao?: string }[];
    };
    const quote = data.value?.at(-1);
    if (quote?.cotacaoVenda && quote.cotacaoVenda > 0) {
      return {
        symbol: "USDBRL",
        currency: "BRL",
        price: quote.cotacaoVenda,
        provider: "bcb",
        marketTime: quote.dataHoraCotacao ?? null,
        fetchedAt: new Date().toISOString(),
        error: null
      };
    }
  }
  throw new Error("BCB did not return a USD/BRL quote for the last seven days");
}

async function withTimeout(
  fetcher: Fetcher,
  input: string | URL,
  headers?: Record<string, string>
) {
  return fetcher(input, { signal: AbortSignal.timeout(10_000), headers });
}

async function withRetry(fetcher: Fetcher, input: string | URL) {
  try {
    return await withTimeout(fetcher, input);
  } catch {
    return withTimeout(fetcher, input);
  }
}
