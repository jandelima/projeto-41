export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Falha na requisicao" }));
    throw new Error(body.error ?? "Falha na requisicao");
  }
  return response.json();
}

