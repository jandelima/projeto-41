import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CdiStatus } from "@projeto41/contracts";
import type { AppDatabase } from "@projeto41/db";
import { DEFAULT_RETRY_DELAYS_MS, createSgsClient, type Fetcher } from "./sgs-client.js";

/**
 * Coleta e cache da série 12 do SGS.
 *
 * **Único lugar do módulo que fala com a rede.** Leitura *read-through*:
 * responde do banco e completa o que falta. **Nunca lança** — degrada devolvendo
 * o que já tem, porque offline é requisito, não degradação aceitável: uma
 * instalação que nunca viu a internet calcula a partir da semente commitada.
 */

/** Nunca mais que ~4 requisições por hora **quando dá certo**. */
const MIN_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Depois de uma falha, o piso é bem menor.
 *
 * Aplicar os 15 minutos a uma tentativa que falhou puniria o usuário por um
 * blip de rede: a série ficaria parada e o aviso de "sem conexão" na tela por
 * um quarto de hora, sem nenhuma chance de recuperação.
 */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
/**
 * Quanto uma rota espera pela rede antes de seguir com a série local.
 *
 * Sem rede, a busca gasta 3 tentativas de 20s cada. Uma tela que pede só as
 * caixinhas não pode ficar parada esse tempo todo: a busca termina em segundo
 * plano e a próxima leitura já encontra o resultado.
 */
const ROUTE_WAIT_MS = 3_000;

type State = {
  etag: string | null;
  /** Último contato, com ou sem sucesso. */
  lastFetchAt: string | null;
  /** Último contato **bem-sucedido**: é ele que governa o limite de 15 min. */
  lastSuccessAt: string | null;
  lastDate: string | null;
};

const EMPTY_STATE: State = {
  etag: null,
  lastFetchAt: null,
  lastSuccessAt: null,
  lastDate: null
};

export type CdiService = ReturnType<typeof createCdiService>;

export function createCdiService(
  db: AppDatabase,
  dataDir: string,
  fetcher: Fetcher = fetch,
  /** Só o teste passa algo aqui, para não esperar os 20s de backoff real. */
  retryDelaysMs?: readonly number[]
) {
  const client = createSgsClient(fetcher, retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS);
  const statePath = join(dataDir, "cdi", "sgs-12.state.json");
  let online = true;
  let inFlight: Promise<unknown> | null = null;

  async function readState(): Promise<State> {
    try {
      return { ...EMPTY_STATE, ...JSON.parse(await readFile(statePath, "utf8")) };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  async function writeState(state: State) {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2));
  }

  const lastRateDate = (): string | null =>
    (db.raw.prepare("SELECT MAX(date) AS last FROM cdi_rates").get() as { last: string | null })
      .last;

  const rowCount = (): number =>
    (db.raw.prepare("SELECT COUNT(*) AS n FROM cdi_rates").get() as { n: number }).n;

  const seededThrough = (): string | null =>
    (
      db.raw.prepare("SELECT MAX(date) AS last FROM cdi_rates WHERE source = 'seed'").get() as {
        last: string | null;
      }
    ).last;

  function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
  }

  const upsert = db.raw.prepare(
    `INSERT INTO cdi_rates(date, daily_factor, annual_252, source, fetched_at)
     VALUES (?, ?, NULL, 'sgs-12', ?)
     ON CONFLICT(date) DO UPDATE SET daily_factor = excluded.daily_factor,
       source = excluded.source, fetched_at = excluded.fetched_at`
  );

  /**
   * Busca o que falta desde a última data conhecida.
   *
   * Respeita o limite de 15 minutos inclusive quando chamado à mão: o `reason`
   * explica por que não buscou, em vez de mentir dizendo que buscou.
   */
  async function refresh(options: { force?: boolean } = {}) {
    const state = await readState();
    const now = Date.now();

    const sinceSuccess = state.lastSuccessAt
      ? now - new Date(state.lastSuccessAt).getTime()
      : Infinity;
    const sinceAttempt = state.lastFetchAt ? now - new Date(state.lastFetchAt).getTime() : Infinity;

    if (!options.force && sinceSuccess < MIN_INTERVAL_MS) {
      return { ok: true as const, inserted: 0, skipped: 0, reason: "cache recente" };
    }
    if (!options.force && sinceAttempt < RETRY_AFTER_FAILURE_MS) {
      return { ok: true as const, inserted: 0, skipped: 0, reason: "tentativa recente falhou" };
    }

    const last = lastRateDate();
    // Reconsulta os últimos dias para pegar revisão do BCB, sem refazer a série.
    const from = last
      ? new Date(new Date(`${last}T12:00:00Z`).getTime() - 5 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : "2018-01-01";

    try {
      const result = await client.fetchRange(from, today(), state.etag);
      online = true;

      if (result.notModified) {
        const stamp = new Date().toISOString();
        await writeState({ ...state, lastFetchAt: stamp, lastSuccessAt: stamp });
        return { ok: true as const, inserted: 0, skipped: 0, reason: "sem novidade (304)" };
      }

      let inserted = 0;
      db.transaction(() => {
        const stamp = new Date().toISOString();
        for (const row of result.rows) {
          upsert.run(row.date, row.dailyRatePercent, stamp);
          inserted += 1;
        }
      });

      const stamp = new Date().toISOString();
      await writeState({
        etag: result.etag,
        lastFetchAt: stamp,
        lastSuccessAt: stamp,
        lastDate: lastRateDate()
      });
      return { ok: true as const, inserted, skipped: 0, reason: null };
    } catch (error) {
      // Rede fora não é erro de aplicação: o app segue com o que tem.
      online = false;
      await writeState({ ...state, lastFetchAt: new Date().toISOString() });
      return {
        ok: true as const,
        inserted: 0,
        skipped: 0,
        reason: error instanceof Error ? `sem rede: ${error.message}` : "sem rede"
      };
    }
  }

  return {
    refresh,

    /**
     * Garante a série para o período pedido, sem transformar a rota em refém da
     * rede. Ausência em fim de semana e feriado **não é buraco** e nunca
     * dispara nova tentativa.
     */
    async ensureRange(_from: string, to: string) {
      const last = lastRateDate();
      if (last != null && last >= to) return;
      // Uma busca por vez: leituras simultâneas esperam a mesma, em vez de
      // cada uma abrir as suas tentativas contra o BCB.
      inFlight ??= refresh()
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
        });
      let timer: NodeJS.Timeout | undefined;
      const patience = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ROUTE_WAIT_MS);
      });
      await Promise.race([inFlight, patience]);
      clearTimeout(timer);
    },

    async status(): Promise<CdiStatus> {
      const state = await readState();
      const last = lastRateDate();
      const staleDays =
        last == null
          ? null
          : Math.round(
              (new Date(`${today()}T12:00:00Z`).getTime() -
                new Date(`${last}T12:00:00Z`).getTime()) /
                86_400_000
            );
      return {
        lastDate: last,
        rowCount: rowCount(),
        lastFetchAt: state.lastFetchAt,
        seededThrough: seededThrough(),
        online,
        staleDays
      };
    }
  };
}
