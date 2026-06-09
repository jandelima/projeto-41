import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { seedDemoDatabase } from "../demo/demo-data.js";
import { buildDashboard } from "../services/portfolio-service.js";

const root = resolve(import.meta.dirname, "../../../..");
const databasePath = resolve(root, process.env.DATABASE_URL ?? "./data/projeto41-demo.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });
rmSync(databasePath, { force: true });
rmSync(`${databasePath}-shm`, { force: true });
rmSync(`${databasePath}-wal`, { force: true });

const db = createDatabase(databasePath);
try {
  seedDemoDatabase(db);
  const dashboard = buildDashboard(db);
  console.log(
    JSON.stringify(
      {
        database: databasePath,
        totalBrl: dashboard.totalBrl,
        cryptoAssets: dashboard.portfolios.crypto.length,
        b3Assets: dashboard.portfolios.b3.length,
        snapshots: dashboard.history.length
      },
      null,
      2
    )
  );
} finally {
  db.close();
}

