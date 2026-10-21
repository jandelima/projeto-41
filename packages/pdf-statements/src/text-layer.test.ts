import { describe, expect, it } from "vitest";
import {
  PdfPasswordIncorrectError,
  PdfPasswordRequiredError,
  ScannedPdfError
} from "./errors.js";
import { writePdf, type WriterPage } from "./testing/pdf-writer.js";
import { looksLikePdf, readTextLayer } from "./text-layer.js";

const TWO_LINES: WriterPage[] = [
  {
    items: [
      { text: "28/09/2026 11h27", x: 30, yTop: 253.3 },
      { text: "Descrição com acento", x: 300, yTop: 253.3 },
      { text: "-R$ 80,00", x: 555, yTop: 269.8, align: "right" }
    ]
  }
];

describe("readTextLayer", () => {
  it("devolve cada item com x e y a partir do topo da pagina", async () => {
    const [page] = await readTextLayer(writePdf(TWO_LINES));
    expect(page).toMatchObject({ pageNumber: 1, pageWidth: 595, pageHeight: 842 });
    const byText = Object.fromEntries(page!.items.map((item) => [item.text, item]));
    expect(byText["28/09/2026 11h27"]).toMatchObject({ x: 30, fontHeight: 8 });
    expect(byText["28/09/2026 11h27"]!.yTop).toBeCloseTo(253.3, 1);
    expect(byText["Descrição com acento"]!.x).toBe(300);
    // Valor alinhado a direita: a borda direita fica onde foi posta.
    const amount = byText["-R$ 80,00"]!;
    expect(amount.x + amount.width).toBeCloseTo(555, 0);
    expect(amount.yTop).toBeGreaterThan(byText["28/09/2026 11h27"]!.yTop);
  });

  it("recusa pagina sem texto como digitalizada, sem adivinhar", async () => {
    await expect(readTextLayer(writePdf([{ items: [], imageOnly: true }]))).rejects.toBeInstanceOf(
      ScannedPdfError
    );
  });

  it("PDF com senha: pede a senha, recusa a errada e abre com a certa", async () => {
    const locked = writePdf(TWO_LINES, { password: "12345" });
    await expect(readTextLayer(locked)).rejects.toBeInstanceOf(PdfPasswordRequiredError);
    await expect(readTextLayer(locked, { password: "errada" })).rejects.toBeInstanceOf(
      PdfPasswordIncorrectError
    );
    const [page] = await readTextLayer(locked, { password: "12345" });
    expect(page!.items.map((item) => item.text)).toContain("Descrição com acento");
  });

  it("a mensagem de senha errada nao repete a senha", async () => {
    const locked = writePdf(TWO_LINES, { password: "segredo-123" });
    const error = await readTextLayer(locked, { password: "tentativa-999" }).catch((caught) => caught);
    expect(String(error.message)).not.toContain("tentativa-999");
    expect(String(error.message)).not.toContain("segredo-123");
  });

  it("reconhece PDF pelos bytes", () => {
    expect(looksLikePdf(writePdf(TWO_LINES))).toBe(true);
    expect(looksLikePdf(Buffer.from("Data;Valor\n"))).toBe(false);
  });
});
