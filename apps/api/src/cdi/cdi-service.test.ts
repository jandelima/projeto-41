import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCdiService } from "./cdi-service.js";
import { parseSgsPayload, splitWindows } from "./sgs-client.js";

let db: AppDatabase;
let dir: string;

/** Nenhum teste aqui toca a rede: o `fetcher` é sempre injetado. */
const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

beforeEach(() => {
  db = createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), "projeto41-cdi-"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("splitWindows", () => {
  it("fatia intervalos maiores que 10 anos, porque a API devolve 406", () => {
    expect(splitWindows("2010-01-01", "2026-09-18")).toEqual([
      ["2010-01-01", "2019-12-31"],
      ["2020-01-01", "2026-09-18"]
    ]);
  });

  it("nao fatia o que cabe numa janela", () => {
    expect(splitWindows("2024-01-01", "2026-09-18")).toEqual([["2024-01-01", "2026-09-18"]]);
  });
});

describe("parseSgsPayload", () => {
  it("le os dois campos como string, com ponto decimal", () => {
    expect(parseSgsPayload('[{"data":"18/09/2026","valor":"0.050788"}]')).toEqual([
      { date: "2026-09-18", dailyRatePercent: 0.050788 }
    ]);
  });

  it("rejeita pagina HTML de erro, mesmo com status 200", () => {
    expect(() => parseSgsPayload("<html><body>erro</body></html>")).toThrow(/nao e JSON/i);
  });

  it("descarta a linha invalida sem derrubar as demais", () => {
    const rows = parseSgsPayload(
      '[{"data":"18/09/2026","valor":"0,050788"},{"data":"17/09/2026","valor":"0.050788"}]'
    );
    // A vírgula decimal seria lida como 0 por `parseFloat`; a linha sai fora.
    expect(rows).toEqual([{ date: "2026-09-17", dailyRatePercent: 0.050788 }]);
  });
});

describe("cdi-service", () => {
  it("grava o que veio e marca como sgs-12", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([{ data: "19/09/2026", valor: "0.049999" }], {
        headers: { etag: 'W/"abc"' }
      })
    );
    const service = createCdiService(db, dir, fetcher as unknown as typeof fetch);

    const result = await service.refresh();
    expect(result.inserted).toBeGreaterThan(0);
    expect(
      db.raw
        .prepare("SELECT source FROM cdi_rates WHERE date = '2026-09-19'")
        .get()
    ).toEqual({ source: "sgs-12" });
  });

  it("nao faz duas requisicoes seguidas: o limite de 15 min vale", async () => {
    const fetcher = vi.fn(async () => jsonResponse([]));
    const service = createCdiService(db, dir, fetcher as unknown as typeof fetch);

    await service.refresh();
    const calls = fetcher.mock.calls.length;
    const second = await service.refresh();

    expect(fetcher.mock.calls.length).toBe(calls);
    expect(second.reason).toMatch(/cache recente/i);
  });

  it("304 nao reescreve o banco", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 304 }));
    const service = createCdiService(db, dir, fetcher as unknown as typeof fetch);

    const before = db.raw.prepare("SELECT COUNT(*) AS n FROM cdi_rates").get();
    const result = await service.refresh();

    expect(result.inserted).toBe(0);
    expect(result.reason).toMatch(/304/);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM cdi_rates").get()).toEqual(before);
  });

  it("html com status 200 nao grava nada e nao derruba o servico", async () => {
    const fetcher = vi.fn(
      async () => new Response("<html>oops</html>", { status: 200 })
    );
    const service = createCdiService(db, dir, fetcher as unknown as typeof fetch, [0, 0, 0]);

    const before = db.raw.prepare("SELECT COUNT(*) AS n FROM cdi_rates").get();
    const result = await service.refresh();

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM cdi_rates").get()).toEqual(before);
  });

  it("sem rede, devolve os dados semeados e online: false", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    // Delays zerados: o backoff real é de 20s e não cabe num teste.
    const service = createCdiService(db, dir, fetcher as unknown as typeof fetch, [0, 0, 0]);

    const result = await service.refresh();
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/sem rede/i);

    const status = await service.status();
    expect(status.online).toBe(false);
    // Offline é requisito: a semente commitada continua respondendo.
    expect(status.rowCount).toBeGreaterThan(1000);
    expect(status.seededThrough).toBe("2026-09-18");
  });

  it("ensureRange nao sai pela rede quando a serie ja cobre o periodo", async () => {
    const fetcher = vi.fn(async () => jsonResponse([]));
    const service = createCdiService(db, dir, fetcher as unknown as typeof fetch);

    await service.ensureRange("2026-01-01", "2026-09-18");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("recuperacao depois de falha", () => {
  it("uma falha nao bloqueia a proxima tentativa por 15 minutos", async () => {
    let shouldFail = true;
    const fetcher = vi.fn(async () => {
      if (shouldFail) throw new Error("blip");
      return jsonResponse([{ data: "19/09/2026", valor: "0.049999" }]);
    });
    const service = createCdiService(db, dir, fetcher as unknown as typeof fetch, [0, 0, 0]);

    const failed = await service.refresh();
    expect(failed.reason).toMatch(/sem rede/i);
    expect((await service.status()).online).toBe(false);

    // A tentativa seguinte é barrada só pelo piso curto, não pelos 15 minutos.
    const throttled = await service.refresh();
    expect(throttled.reason).toMatch(/tentativa recente/i);

    // `force` passa por cima e recupera assim que a rede volta.
    shouldFail = false;
    const recovered = await service.refresh({ force: true });
    expect(recovered.inserted).toBeGreaterThan(0);
    expect((await service.status()).online).toBe(true);
  });
});
