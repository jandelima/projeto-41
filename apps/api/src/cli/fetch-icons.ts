import "dotenv/config";
import { dirname, resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { createIconService, type IconKind } from "../icons/icon-service.js";

const root = resolve(import.meta.dirname, "../../../..");
const databasePath = resolve(root, process.env.DATABASE_URL ?? "./data/projeto41.sqlite");
const db = createDatabase(databasePath);
const iconService = createIconService(resolve(dirname(databasePath), "icons"));

const crypto = [...new Set(db.operations.list("crypto").map((operation) => operation.asset))];
const b3 = [...new Set(db.operations.list("b3").map((operation) => operation.asset))];
const items = [
  ...crypto.map((key) => ({ kind: "crypto" as IconKind, key })),
  ...b3.map((key) => ({ kind: "b3" as IconKind, key })),
  ...db.positions.list().map((position) => ({ kind: "institution" as IconKind, key: position.name }))
];

const downloaded = await iconService.prefetch(items);
console.log(`Ícones locais atualizados: ${downloaded} novos de ${items.length} ativos.`);
db.close();
