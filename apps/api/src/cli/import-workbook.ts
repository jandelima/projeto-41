import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { backupDatabase, ensureDatabaseDirectory } from "../backup/backup-service.js";
import { importMappedWorkbook, report } from "../import/import-service.js";
import { mapWorkbook } from "../import/projeto41-mapper.js";
import { readWorkbook } from "../import/xlsx-reader.js";

const root = resolve(import.meta.dirname, "../../../..");
const workbookPath = resolve(root, "Projeto 41.xlsx");
const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--confirm");
const databasePath = resolve(root, process.env.DATABASE_URL ?? "./data/projeto41.sqlite");
const fingerprint = createHash("sha256").update(readFileSync(workbookPath)).digest("hex");
const mapped = mapWorkbook(readWorkbook(workbookPath));

if (dryRun) {
  console.log(JSON.stringify({ mode: "dry-run", ...report(mapped) }, null, 2));
  process.exit(0);
}

mkdirSync(dirname(databasePath), { recursive: true });
ensureDatabaseDirectory(databasePath);
backupDatabase(databasePath, resolve(root, "backups"));
const db = createDatabase(databasePath);
try {
  const result = importMappedWorkbook(db, fingerprint, mapped);
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
