import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@projeto41/db";
import { buildApp } from "./app.js";

let db: AppDatabase | undefined;
let temporaryDirectory: string | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("API", () => {
  it("serves the built web app in production mode", async () => {
    db = createDatabase(":memory:");
    temporaryDirectory = mkdtempSync(join(tmpdir(), "projeto41-web-"));
    writeFileSync(join(temporaryDirectory, "index.html"), "<h1>Projeto 41</h1>");
    const app = buildApp({
      db,
      priceService: { runAll: async () => [] },
      webRoot: temporaryDirectory
    });

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Projeto 41");
    await app.close();
  });

  it("creates an operation and returns the recalculated portfolio", async () => {
    db = createDatabase(":memory:");
    const app = buildApp({ db, priceService: { runAll: async () => [] } as any });

    const created = await app.inject({
      method: "POST",
      url: "/api/operations",
      payload: {
        portfolio: "b3",
        type: "buy",
        asset: "PETR4",
        date: "2026-06-09",
        quantity: 10,
        total: 400,
        currency: "BRL"
      }
    });
    expect(created.statusCode).toBe(201);

    const portfolio = await app.inject({ method: "GET", url: "/api/portfolios" });
    expect(portfolio.json().b3[0]).toMatchObject({ asset: "PETR4", quantity: 10 });
    await app.close();
  });

  it("exports crypto operations as CSV", async () => {
    db = createDatabase(":memory:");
    db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-06-09",
      quantity: 0.5,
      total: 32500,
      currency: "USD"
    });
    db.operations.create({
      portfolio: "b3",
      type: "buy",
      asset: "PETR4",
      date: "2026-06-09",
      quantity: 10,
      total: 400,
      currency: "BRL"
    });
    const app = buildApp({ db, priceService: { runAll: async () => [] } });

    const response = await app.inject({ method: "GET", url: "/api/export/operations.csv" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.body.split("\r\n")).toEqual([
      "asset,date,type,quantity,amount,unit_price,currency",
      "BTC,2026-06-09,buy,0.5,32500,65000,USD"
    ]);
    await app.close();
  });

  it("imports crypto operations from CSV in the export format", async () => {
    db = createDatabase(":memory:");
    const fetched: string[] = [];
    const app = buildApp({
      db,
      priceService: {
        runAll: async () => [],
        ensureCryptoPrice: async (symbol: string) => {
          fetched.push(symbol);
          return true;
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/import/operations.csv",
      headers: { "content-type": "text/csv" },
      payload: [
        "asset,date,type,quantity,amount,unit_price,currency",
        "BTC,2026-06-09,buy,0.5,32500,65000,USD",
        "eth,2026-06-10,sell,2,7000,3500,USD"
      ].join("\r\n")
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().imported).toBe(2);
    expect(fetched).toEqual(["BTC", "ETH"]);

    const operations = db.operations.list("crypto");
    expect(operations).toHaveLength(2);
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asset: "BTC", type: "buy", quantity: 0.5, total: 32500 }),
        expect.objectContaining({ asset: "ETH", type: "sell", quantity: 2, total: 7000 })
      ])
    );
    await app.close();
  });

  it("rejects a CSV import with invalid rows without inserting anything", async () => {
    db = createDatabase(":memory:");
    const app = buildApp({ db, priceService: { runAll: async () => [] } });

    const response = await app.inject({
      method: "POST",
      url: "/api/import/operations.csv",
      headers: { "content-type": "text/csv" },
      payload: "asset,date,type,quantity,amount,unit_price,currency\nBTC,2026-06-09,buy,-1,32500,65000,USD"
    });

    expect(response.statusCode).toBe(400);
    expect(db.operations.list("crypto")).toHaveLength(0);
    await app.close();
  });

  it("auto-fetches the price of a new crypto asset on creation", async () => {
    db = createDatabase(":memory:");
    const fetched: string[] = [];
    const app = buildApp({
      db,
      priceService: {
        runAll: async () => [],
        ensureCryptoPrice: async (symbol: string) => {
          fetched.push(symbol);
          return true;
        }
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/operations",
      payload: {
        portfolio: "crypto",
        type: "buy",
        asset: "btc",
        date: "2026-06-09",
        quantity: 1,
        total: 65000,
        currency: "USD"
      }
    });

    expect(created.statusCode).toBe(201);
    expect(fetched).toEqual(["BTC"]);
    await app.close();
  });

  it("searches crypto assets through the price service", async () => {
    db = createDatabase(":memory:");
    const app = buildApp({
      db,
      priceService: {
        runAll: async () => [],
        searchCrypto: async (query: string) => [
          { id: "bitcoin", symbol: "BTC", name: `Bitcoin (${query})`, rank: 1 }
        ]
      }
    });

    const response = await app.inject({ method: "GET", url: "/api/crypto/search?q=btc" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: "bitcoin", symbol: "BTC", name: "Bitcoin (btc)", rank: 1 }
    ]);
    await app.close();
  });

  it("remembers the CoinGecko slug picked for a new crypto operation", async () => {
    db = createDatabase(":memory:");
    const app = buildApp({
      db,
      priceService: { runAll: async () => [], ensureCryptoPrice: async () => true }
    });

    await app.inject({
      method: "POST",
      url: "/api/operations",
      payload: {
        portfolio: "crypto",
        type: "buy",
        asset: "avax",
        slug: "avalanche-2",
        name: "Avalanche",
        date: "2026-06-09",
        quantity: 2,
        total: 80,
        currency: "USD"
      }
    });

    expect(db.cryptoAssets.get("AVAX")).toEqual({
      symbol: "AVAX",
      slug: "avalanche-2",
      name: "Avalanche"
    });
    await app.close();
  });

  it("does not auto-fetch crypto prices for a new B3 asset", async () => {
    db = createDatabase(":memory:");
    let calls = 0;
    const app = buildApp({
      db,
      priceService: {
        runAll: async () => [],
        ensureCryptoPrice: async () => {
          calls += 1;
          return true;
        }
      }
    });

    await app.inject({
      method: "POST",
      url: "/api/operations",
      payload: {
        portfolio: "b3",
        type: "buy",
        asset: "PETR4",
        date: "2026-06-09",
        quantity: 10,
        total: 400,
        currency: "BRL"
      }
    });

    expect(calls).toBe(0);
    await app.close();
  });

  it("returns a structured refresh failure instead of an internal error", async () => {
    db = createDatabase(":memory:");
    const app = buildApp({
      db,
      priceService: {
        runAll: async () => {
          throw new Error("provider unavailable");
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/prices/refresh"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [],
      errors: ["provider unavailable"]
    });
    await app.close();
  });

  it("preserves known HTTP errors instead of masking them as internal errors", async () => {
    db = createDatabase(":memory:");
    const app = buildApp({ db, priceService: { runAll: async () => [] } });

    const response = await app.inject({
      method: "POST",
      url: "/api/prices/refresh",
      headers: { "content-type": "application/json" },
      payload: ""
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).not.toBe("Erro interno");
    await app.close();
  });
});
