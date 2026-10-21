/**
 * Regrava a fixture sintetica do BTG. Rodado a mao, nunca em teste:
 * `npx tsx packages/pdf-statements/scripts/build-btg-fixture.ts`.
 *
 * O golden **nao** e regravado aqui: depois de mudar a fixture, atualize o
 * `.golden.json` a mao, lendo o diff.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { btgFixturePages } from "../src/testing/btg-fixture.js";
import { writePdf } from "../src/testing/pdf-writer.js";

const target = fileURLToPath(new URL("../__fixtures__/btg-extrato/2026-10.pdf", import.meta.url));
writeFileSync(target, writePdf(btgFixturePages()));
console.log(`fixture gravada em ${target}`);
