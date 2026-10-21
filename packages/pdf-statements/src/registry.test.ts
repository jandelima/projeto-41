import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtureIsComplete, listFixtures, readGolden, toGolden } from "./golden.js";
import { reconcile } from "./reconcile.js";
import { adapterById, adapters, detectAdapter } from "./registry.js";
import { writePdf } from "./testing/pdf-writer.js";
import { readTextLayer } from "./text-layer.js";

const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;

describe("registro de adapters", () => {
  it("dois adapters nunca compartilham id", () => {
    const ids = adapters.map((adapter) => adapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda fixture tem golden, todo golden tem fixture, e todo adapter tem fixture", () => {
    const fixtures = listFixtures();
    expect(fixtures.filter((fixture) => !fixtureIsComplete(fixture))).toEqual([]);
    for (const adapter of adapters) {
      expect(fixtures.some((fixture) => fixture.adapterId === adapter.id)).toBe(true);
    }
  });

  it("documento de layout desconhecido nao escolhe o menos ruim", async () => {
    const pages = await readTextLayer(
      writePdf([{ items: [{ text: "Fatura do cartao de outro banco", x: 30, yTop: 100 }] }])
    );
    expect(detectAdapter(pages)).toEqual([]);
  });
});

describe.each(listFixtures())("fixture $adapterId/$layoutVersion", (fixture) => {
  const load = async () => readTextLayer(readFileSync(fixture.pdfPath));

  it("e escolhida pelo adapter certo", async () => {
    const [best] = detectAdapter(await load());
    expect(best?.adapter.id).toBe(fixture.adapterId);
  });

  it("produz exatamente o golden", async () => {
    const adapter = adapterById(fixture.adapterId)!;
    expect(toGolden(adapter.parse(await load()))).toEqual(readGolden(fixture));
  });

  it("concilia contra o total declarado", async () => {
    expect(reconcile(readGolden(fixture).statement).status).toBe("match");
  });

  it("nao carrega CPF no texto extraido", async () => {
    const text = (await load()).flatMap((page) => page.items.map((item) => item.text)).join(" ");
    expect(text).not.toMatch(CPF);
  });
});
