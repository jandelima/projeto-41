import { describe, expect, it } from "vitest";
import { timeFromNubankId } from "./nubank-id.js";

describe("hora pelo identificador do Nubank", () => {
  it("le a hora de Brasilia do comeco do identificador", () => {
    // 0x6a96ea0a = 2026-09-01T15:06:18Z = 12:06 em Brasilia.
    expect(timeFromNubankId("6a96ea0a-547b-4aec-a60c-984429e1e0bb", "2026-09-01")).toBe("12:06");
  });

  it("nao inventa hora quando a data decodificada nao e a da linha", () => {
    expect(timeFromNubankId("736f0bbb-def5-3d11-b1a5-4bdaaf6e92f3", "2026-09-01")).toBeNull();
    expect(timeFromNubankId("6a96ea0a-547b-4aec-a60c-984429e1e0bb", "2026-09-02")).toBeNull();
  });

  it("sem identificador (fatura do cartao) nao ha hora", () => {
    expect(timeFromNubankId(null, "2026-09-01")).toBeNull();
    expect(timeFromNubankId("12345", "2026-09-01")).toBeNull();
  });
});
