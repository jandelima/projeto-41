import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { buildApp } from "./app.js";
import { startScheduler } from "./jobs/scheduler.js";
import { createPriceService } from "./prices/price-service.js";

const root = resolve(import.meta.dirname, "../../..");
const databasePath = resolve(root, process.env.DATABASE_URL ?? "./data/projeto41.sqlite");
const port = Number(process.env.PORT ?? 3001);
const demoMode = process.env.DEMO_MODE === "true";
mkdirSync(dirname(databasePath), { recursive: true });
const db = createDatabase(databasePath);
const livePriceService = createPriceService(db, {
  cryptoUrl: process.env.CRYPTO_PRICE_URL ?? "http://34.215.218.57:5000",
  brapiToken: process.env.BRAPI_TOKEN ?? ""
});
const priceService = demoMode
  ? {
      runAll: async () => [
        { provider: "demo", updated: db.prices.list().length, errors: [] as string[] }
      ]
    }
  : livePriceService;
const app = buildApp({ db, priceService });
const stopScheduler = demoMode ? () => undefined : startScheduler(db, livePriceService);

const close = async () => {
  stopScheduler();
  await app.close();
  db.close();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({
  host: "127.0.0.1",
  port
});
console.log(`Projeto 41 API${demoMode ? " demo" : ""}: http://127.0.0.1:${port}`);
