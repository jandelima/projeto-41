/**
 * Erros do leitor de PDF, cada um com um `code` estavel: a API traduz em status
 * HTTP pelo codigo, sem inspecionar a mensagem. Mensagens em portugues sem
 * acento, como no resto de `apps/api`.
 */
export type PdfErrorCode =
  | "pdf_unreadable"
  | "pdf_scanned"
  | "pdf_password_required"
  | "pdf_password_incorrect"
  | "pdf_layout_unknown"
  | "pdf_parse_failed";

export class PdfParseError extends Error {
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.name = "PdfParseError";
    this.code = code;
  }
}

export class ScannedPdfError extends PdfParseError {
  constructor() {
    super(
      "pdf_scanned",
      "Este PDF e uma imagem digitalizada, sem texto. O app nao faz OCR: exporte o extrato em Excel, CSV ou OFX."
    );
  }
}

export class PdfPasswordRequiredError extends PdfParseError {
  constructor() {
    super("pdf_password_required", "Este PDF tem senha. Digite a senha para abrir.");
  }
}

export class PdfPasswordIncorrectError extends PdfParseError {
  constructor() {
    super("pdf_password_incorrect", "Senha do PDF incorreta.");
  }
}

export class UnknownLayoutError extends PdfParseError {
  constructor() {
    super(
      "pdf_layout_unknown",
      "Nao reconheci o layout deste PDF. Hoje so o extrato de conta corrente do BTG Pactual e lido; para outros bancos, use Excel, CSV ou OFX."
    );
  }
}
