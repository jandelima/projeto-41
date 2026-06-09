import type { AppDatabase } from "@projeto41/db";
import type { MappedWorkbook } from "./projeto41-mapper.js";

export function importMappedWorkbook(
  db: AppDatabase,
  fingerprint: string,
  data: MappedWorkbook
) {
  if (db.imports.has(fingerprint)) {
    return { imported: false, reason: "already-imported" as const, report: report(data) };
  }

  const summary = report(data);
  db.transaction(() => {
    for (const operation of data.operations) db.operations.create(operation);
    for (const position of data.positions) db.positions.upsert(position);
    for (const dividend of data.dividends) db.dividends.set(dividend.asset, dividend.amount);
    for (const contribution of data.contributions) db.contributions.create(contribution);
    for (const target of data.targets) db.targets.set(target.category, target.weight);
    for (const price of data.prices) db.prices.upsert(price);
    for (const snapshot of data.snapshots) db.snapshots.upsert(snapshot);
    for (const [key, setting] of Object.entries(data.settings)) db.settings.set(key, setting);
    db.imports.record(fingerprint, summary);
  });

  return { imported: true, report: summary };
}

export function report(data: MappedWorkbook) {
  return {
    operations: data.operations.length,
    cryptoOperations: data.operations.filter((item) => item.portfolio === "crypto").length,
    b3Operations: data.operations.filter((item) => item.portfolio === "b3").length,
    positions: data.positions.length,
    dividends: data.dividends.length,
    contributions: data.contributions.length,
    targets: data.targets.length,
    prices: data.prices.length,
    snapshots: data.snapshots.length
  };
}

