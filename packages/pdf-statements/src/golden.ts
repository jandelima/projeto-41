import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedStatement } from "./adapter.js";

/**
 * Saida dourada por fixture: `__fixtures__/<adapterId>/<layoutVersion>.pdf`
 * ao lado de `<layoutVersion>.golden.json`.
 *
 * Nao existe flag de "regravar goldens": atualizar um golden e editar o
 * arquivo lendo o diff. Uma flag dessas transforma regressao em commit
 * silencioso.
 */

export const FIXTURES_DIR = fileURLToPath(new URL("../__fixtures__", import.meta.url));

export type Golden = { rowCount: number; sumCents: number; statement: ParsedStatement };

export type Fixture = {
  adapterId: string;
  layoutVersion: string;
  pdfPath: string;
  goldenPath: string;
};

/** Toda fixture da pasta, com ou sem golden: o teste de consistencia confere. */
export function listFixtures(dir = FIXTURES_DIR): Fixture[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(dir, entry.name))
        .filter((name) => name.endsWith(".pdf") || name.endsWith(".golden.json"))
        .map((name) => name.replace(/\.golden\.json$|\.pdf$/, ""))
        .filter((version, index, all) => all.indexOf(version) === index)
        .map((layoutVersion) => ({
          adapterId: entry.name,
          layoutVersion,
          pdfPath: join(dir, entry.name, `${layoutVersion}.pdf`),
          goldenPath: join(dir, entry.name, `${layoutVersion}.golden.json`)
        }))
    );
}

export function fixtureIsComplete(fixture: Fixture) {
  return existsSync(fixture.pdfPath) && existsSync(fixture.goldenPath);
}

export function readGolden(fixture: Fixture): Golden {
  return JSON.parse(readFileSync(fixture.goldenPath, "utf8")) as Golden;
}

export function toGolden(statement: ParsedStatement): Golden {
  return {
    rowCount: statement.rows.length,
    sumCents: statement.rows.reduce((sum, row) => sum + row.amountCents, 0),
    statement
  };
}
