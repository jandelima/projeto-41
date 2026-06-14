import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { buildApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { startScheduler } from "./jobs/scheduler.js";
import { createPriceService } from "./prices/price-service.js";

const root = resolve(import.meta.dirname, "../../..");
const config = loadServerConfig(root);
const databasePath = resolve(root, config.databaseUrl);
mkdirSync(dirname(databasePath), { recursive: true });
const db = createDatabase(databasePath);
const livePriceService = createPriceService(db, {
  cryptoUrl: config.cryptoUrl,
  brapiToken: config.brapiToken
});
const priceService = config.demoMode
  ? {
      runAll: async () => [
        { provider: "demo", updated: db.prices.list().length, errors: [] as string[] }
      ]
    }
  : livePriceService;
const app = buildApp({ db, priceService });
const stopScheduler = config.demoMode ? () => undefined : startScheduler(db, livePriceService);

const close = async () => {
  stopScheduler();
  await app.close();
  db.close();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({
  host: "127.0.0.1",
  port: config.port
});
console.log(
  `Projeto 41 API${config.demoMode ? " demo" : ""}: http://127.0.0.1:${config.port}`
);
