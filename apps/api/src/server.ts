import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { buildApp } from "./app.js";
import { startScheduler } from "./jobs/scheduler.js";
import { createPriceService } from "./prices/price-service.js";

const root = resolve(import.meta.dirname, "../../..");
const databasePath = resolve(root, process.env.DATABASE_URL ?? "./data/projeto41.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const db = createDatabase(databasePath);
const priceService = createPriceService(db, {
  cryptoUrl: process.env.CRYPTO_PRICE_URL ?? "http://34.215.218.57:5000",
  brapiToken: process.env.BRAPI_TOKEN ?? ""
});
const app = buildApp({ db, priceService });
const stopScheduler = startScheduler(db, priceService);

const close = async () => {
  stopScheduler();
  await app.close();
  db.close();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.PORT ?? 3001)
});
console.log("Projeto 41 API: http://127.0.0.1:3001");

