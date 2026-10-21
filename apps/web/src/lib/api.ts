import { currentInvestmentAccount } from "./investment-account.js";

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  // A conta de investimento escolhida vai em toda requisição; as rotas do
  // livro-caixa simplesmente a ignoram.
  if (!headers.has("x-investment-account")) {
    headers.set("x-investment-account", String(currentInvestmentAccount()));
  }
  if (options?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Falha na requisicao" }));
    throw new Error(body.error ?? "Falha na requisicao");
  }
  return response.json();
}
