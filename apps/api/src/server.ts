import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { buildApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createIconService, type IconKind } from "./icons/icon-service.js";
import { startScheduler } from "./jobs/scheduler.js";
import { createPriceService } from "./prices/price-service.js";

const root = resolve(import.meta.dirname, "../../..");
const config = loadServerConfig(root);
const databasePath = resolve(root, config.databaseUrl);
const webRoot = resolve(root, "apps/web/dist");
mkdirSync(dirname(databasePath), { recursive: true });
const db = createDatabase(databasePath);
const iconService = createIconService(resolve(dirname(databasePath), "icons"));
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
const app = buildApp({
  db,
  priceService,
  iconService,
  webRoot: existsSync(resolve(webRoot, "index.html")) ? webRoot : undefined
});
const stopScheduler = config.demoMode
  ? () => undefined
  : startScheduler(db, livePriceService, config.timezone);

function iconTargets() {
  const crypto = [...new Set(db.operations.list("crypto").map((operation) => operation.asset))];
  const b3 = [...new Set(db.operations.list("b3").map((operation) => operation.asset))];
  return [
    ...crypto.map((key) => ({ kind: "crypto" as IconKind, key })),
    ...b3.map((key) => ({ kind: "b3" as IconKind, key })),
    ...db.positions.list().map((position) => ({ kind: "institution" as IconKind, key: position.name }))
  ];
}

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

void iconService
  .prefetch(iconTargets())
  .then((count) => count && console.log(`Ícones baixados localmente: ${count}`))
  .catch(() => undefined);
