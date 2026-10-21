/**
 * Cliente da API de séries temporais do Banco Central (SGS).
 *
 * Conhece a API e nada mais: sem cache, sem banco, sem decisão de negócio.
 * Sem chave, CORS liberado.
 *
 * Série **12** = CDI ao dia útil, em percentual. Série **4389** = CDI
 * anualizada base 252 (e exige intervalo explícito para responder). **R-09:** a
 * série 11 (Selic) devolve valores idênticos hoje, mas nunca é substituta.
 */

export type SgsRow = { date: string; dailyRatePercent: number };

const BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados";

/** O parâmetro de data vai em `dd/MM/yyyy`, nunca em ISO. */
const toBr = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
};

const fromBr = (brDate: string) => {
  const [day, month, year] = brDate.split("/");
  return `${year}-${month}-${day}`;
};

/** Intervalo maior que 10 anos devolve HTTP 406: fatiar antes de pedir. */
export function splitWindows(from: string, to: string): [string, string][] {
  const windows: [string, string][] = [];
  let start = Number(from.slice(0, 4));
  const end = Number(to.slice(0, 4));
  if (end < start) return [];
  while (start <= end) {
    const stop = Math.min(start + 9, end);
    windows.push([
      start === Number(from.slice(0, 4)) ? from : `${start}-01-01`,
      stop === end ? to : `${stop}-12-31`
    ]);
    start = stop + 1;
  }
  return windows;
}

/**
 * Valida e converte a resposta.
 *
 * Os dois campos vêm como **string**, com ponto decimal. `Number()` só depois
 * de validar o formato: `parseFloat("0,050788")` devolveria `0` em silêncio se
 * o formato mudasse algum dia.
 */
export function parseSgsPayload(text: string): SgsRow[] {
  // O front-end Azure/F5 do BCB devolve página HTML de erro com status 200 de
  // forma intermitente. Corpo que não começa com "[" é falha, não dado.
  if (!text.trimStart().startsWith("[")) {
    throw new Error("Resposta do SGS nao e JSON");
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Resposta do SGS nao e uma lista");

  const rows: SgsRow[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { data, valor } = item as { data?: unknown; valor?: unknown };
    if (typeof data !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(data)) continue;
    // Uma linha inválida é descartada; as demais seguem.
    if (typeof valor !== "string" || !/^-?\d+(\.\d+)?$/.test(valor)) continue;
    rows.push({ date: fromBr(data), dailyRatePercent: Number(valor) });
  }
  return rows;
}

export type Fetcher = typeof fetch;

export type SgsResult = {
  rows: SgsRow[];
  etag: string | null;
  /** `true` quando o servidor respondeu 304: não há nada para gravar. */
  notModified: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 1s, 4s e 16s entre as tentativas. Injetável para o teste não esperar 20s. */
export const DEFAULT_RETRY_DELAYS_MS = [0, 4_000, 16_000] as const;

export function createSgsClient(
  fetcher: Fetcher = fetch,
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS
) {
  /** 3 tentativas com backoff e jitter; esgotadas, desiste em silêncio. */
  async function request(url: string, etag: string | null): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      const delay = retryDelaysMs[attempt] ?? 0;
      if (delay > 0) await sleep(delay * (0.75 + Math.random() * 0.5));
      try {
        const response = await fetcher(url, {
          headers: etag ? { "If-None-Match": etag } : undefined,
          signal: AbortSignal.timeout(20_000)
        });
        if (response.status >= 500) {
          lastError = new Error(`SGS respondeu ${response.status}`);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Falha ao falar com o SGS");
  }

  return {
    async fetchRange(from: string, to: string, etag: string | null = null): Promise<SgsResult> {
      const rows: SgsRow[] = [];
      let lastEtag = etag;
      let notModified = true;

      for (const [start, stop] of splitWindows(from, to)) {
        const url = `${BASE}?formato=json&dataInicial=${toBr(start)}&dataFinal=${toBr(stop)}`;
        const response = await request(url, etag);

        if (response.status === 304) continue;
        notModified = false;
        if (!response.ok) throw new Error(`SGS respondeu ${response.status}`);
        rows.push(...parseSgsPayload(await response.text()));
        lastEtag = response.headers.get("etag") ?? lastEtag;
      }

      return { rows, etag: lastEtag, notModified: notModified && rows.length === 0 };
    }
  };
}
