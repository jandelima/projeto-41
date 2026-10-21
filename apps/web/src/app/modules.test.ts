import { describe, expect, it } from "vitest";
import { initialPage, lastPageOf, moduleById, moduleOf, modules, navItem } from "./modules.js";

describe("modules", () => {
  it("cada tela pertence a exatamente um módulo", () => {
    const pages = modules.flatMap((module) =>
      module.groups.flatMap((group) => group.items.map((item) => item.id))
    );
    expect(new Set(pages).size).toBe(pages.length);
    for (const page of pages) expect(moduleOf(page)).toBeDefined();
  });

  it("a tela inicial de cada módulo é dele", () => {
    for (const module of modules) expect(moduleOf(module.home).id).toBe(module.id);
  });

  it("separa investimentos de finanças", () => {
    expect(moduleOf("allocation").id).toBe("investments");
    expect(moduleOf("spending-allocation").id).toBe("finance");
    expect(moduleOf("invoice").id).toBe("finance");
    expect(navItem("crypto").label).toBe("Cripto");
  });

  it("sem armazenamento, abre na tela inicial", () => {
    // O ambiente de teste não tem localStorage: é o caso de aba privada.
    expect(lastPageOf("finance")).toBe(moduleById("finance").home);
    expect(initialPage()).toBe(moduleById("investments").home);
  });
});
