import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export function backupDatabase(databasePath: string, backupRoot: string) {
  if (!existsSync(databasePath)) return null;
  mkdirSync(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = resolve(backupRoot, `${basename(databasePath)}.${stamp}.bak`);
  copyFileSync(databasePath, destination);
  return destination;
}

export function ensureDatabaseDirectory(databasePath: string) {
  mkdirSync(dirname(databasePath), { recursive: true });
}

