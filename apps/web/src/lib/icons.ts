// Os ícones são servidos e cacheados localmente pela API (data/icons),
// que baixa do CDN sob demanda e mantém offline. 404 -> fallback nas iniciais.

export function cryptoIconUrl(symbol: string) {
  return `/api/icons/crypto/${encodeURIComponent(symbol)}`;
}

export function b3IconUrl(symbol: string) {
  return `/api/icons/b3/${encodeURIComponent(symbol)}`;
}

export function portfolioIconUrl(portfolio: "crypto" | "b3", symbol: string) {
  return portfolio === "crypto" ? cryptoIconUrl(symbol) : b3IconUrl(symbol);
}

export function institutionIconUrl(name: string) {
  return `/api/icons/institution/${encodeURIComponent(name)}`;
}
