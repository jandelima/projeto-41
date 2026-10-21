/**
 * Camada de texto do PDF, **com coordenadas**.
 *
 * Biblioteca: `unpdf` (PDF.js empacotado, JavaScript puro, sem binario nativo).
 * Proibidas neste pacote, e o motivo:
 *
 * - `pdf-parse` — depende do nativo `@napi-rs/canvas` e nao devolve
 *   coordenadas; sem coordenadas nao ha como reconstruir coluna.
 * - `pdf-lib` — sem manutencao desde 2021, e serve para escrever PDF, nao para
 *   ler texto.
 *
 * Nada aqui concatena `item.str` em texto corrido: x e y sao exatamente o que
 * separa a coluna de data da coluna de valor num extrato.
 */
import { getDocumentProxy } from "unpdf";
import {
  PdfParseError,
  PdfPasswordIncorrectError,
  PdfPasswordRequiredError,
  ScannedPdfError
} from "./errors.js";

export type PdfItem = {
  text: string;
  x: number;
  /** Distancia do topo da pagina: a linha de cima tem o menor numero. */
  yTop: number;
  width: number;
  height: number;
  fontHeight: number;
};

export type PdfPage = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  items: PdfItem[];
};

/** Codigos de `PasswordResponses` do PDF.js. */
const NEED_PASSWORD = 1;
const INCORRECT_PASSWORD = 2;

export function looksLikePdf(data: Uint8Array): boolean {
  return Buffer.from(data.subarray(0, 1024)).toString("latin1").includes("%PDF-");
}

/**
 * Le o texto de cada pagina. A senha, quando vem, so passa por aqui: nao e
 * gravada, nem logada, nem entra em mensagem de erro.
 */
export async function readTextLayer(
  data: Uint8Array,
  options: { password?: string } = {}
): Promise<PdfPage[]> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // O PDF.js toma posse do buffer; uma copia evita que ele esvazie o do chamador.
    document = await getDocumentProxy(
      new Uint8Array(data),
      options.password ? { password: options.password } : {}
    );
  } catch (error) {
    const failure = error as { name?: string; code?: number };
    if (failure?.name === "PasswordException") {
      if (failure.code === INCORRECT_PASSWORD && options.password) {
        throw new PdfPasswordIncorrectError();
      }
      if (failure.code === NEED_PASSWORD || failure.code === INCORRECT_PASSWORD) {
        throw new PdfPasswordRequiredError();
      }
    }
    throw new PdfParseError("pdf_unreadable", "Nao consegui abrir o PDF: o arquivo parece corrompido.");
  }

  try {
    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const [, , , d, x, y] = item.transform as number[];
        items.push({
          text: item.str,
          x: x!,
          yTop: pageHeight - y!,
          width: item.width,
          height: item.height,
          fontHeight: Math.abs(d!)
        });
      }
      // Pagina sem nenhum texto e imagem: recusa, nunca adivinha.
      if (items.length === 0) throw new ScannedPdfError();
      pages.push({ pageNumber, pageWidth, pageHeight, items });
    }
    return pages;
  } finally {
    // A tarefa de carga e quem segura o worker; destrui-la libera tudo.
    await document.loadingTask.destroy();
  }
}
