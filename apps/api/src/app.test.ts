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
