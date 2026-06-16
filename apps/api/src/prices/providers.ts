import type { PriceRecord } from "@projeto41/db";

type Fetcher = typeof fetch;

export async function fetchCryptoPrices(
  assets: { slug: string; symbol: string }[],
  url: string,
  fetcher: Fetcher = fetch
): Promise<PriceRecord[]> {
  const response = await withTimeout(fetcher, url);
  if (!response.ok) throw new Error(`Crypto provider returned ${response.status}`);
  const body = await response.text();
  const fetchedAt = new Date().toISOString();

  return assets.map(({ slug, symbol }) => {
    const tag = findTag(body, "id", slug);
    const price = tag ? Number(tag.content.trim().replace(",", ".")) : Number.NaN;
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid crypto price for ${symbol}`);
    }
    return {
      symbol,
      currency: "USD",
      price,
      provider: "crypto-server",
      marketTime: null,
      fetchedAt,
      error: null
    };
  });
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
    results?: {
      symbol?: string;
      regularMarketPrice?: number;
      regularMarketTime?: string;
      regularMarketChangePercent?: number;
    }[];
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
    error: null,
    // brapi devolve o percentual já em pontos (1,5 = 1,5%); guardamos como razão.
    changePercent:
      typeof quote.regularMarketChangePercent === "number"
        ? quote.regularMarketChangePercent / 100
        : null
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

async function withTimeout(fetcher: Fetcher, input: string | URL) {
  return fetcher(input, { signal: AbortSignal.timeout(10_000) });
}

async function withRetry(fetcher: Fetcher, input: string | URL) {
  try {
    return await withTimeout(fetcher, input);
  } catch {
    return withTimeout(fetcher, input);
  }
}

function findTag(body: string, attribute: string, value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<([\\w:-]+)\\b[^>]*\\b${attribute}\\s*=\\s*(["'])${escaped}\\2[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i"
  );
  const match = body.match(pattern);
  return match ? { content: match[3] ?? "" } : null;
}
