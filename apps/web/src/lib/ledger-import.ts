import type {
  BalancesResult,
  ImportBatchSummary,
  ImportBatchView,
  ImportRowConfirm,
  StatementKind
} from "@projeto41/contracts";
import { api } from "./api.js";

/** Falha do envio com o codigo da API (`pdf_password_required`...), quando houver. */
export class ImportUploadError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
  }
}

/** Cliente da importacao de extrato (CSV do Nubank, OFX, Excel, PDF). */
export const importApi = {
  list: () => api<ImportBatchSummary[]>("/ledger/imports"),

  get: (batchId: number) => api<ImportBatchView>(`/ledger/imports/${batchId}`),

  /** `multipart/form-data`: o browser define o `Content-Type` com o boundary. */
  upload: async (accountId: number, kind: StatementKind, file: File, password?: string) => {
    const form = new FormData();
    form.append("accountId", String(accountId));
    form.append("kind", kind);
    // A senha do PDF vai no corpo, nunca na URL.
    if (password) form.append("password", password);
    form.append("file", file);
    const response = await fetch("/api/ledger/imports", { method: "POST", body: form });
    if (!response.ok) {
      if (response.status === 413) throw new ImportUploadError("Arquivo maior que o limite de 10 MB", null);
      const body = (await response.json().catch(() => ({ error: "Falha no envio" }))) as {
        error?: string;
        code?: string;
      };
      throw new ImportUploadError(body.error ?? "Falha no envio", body.code ?? null);
    }
    return (await response.json()) as ImportBatchView;
  },

  confirm: (batchId: number, rowId: number, body: ImportRowConfirm) =>
    api<ImportBatchView & { balances: BalancesResult }>(
      `/ledger/imports/${batchId}/rows/${rowId}/confirm`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  reopen: (batchId: number, rowId: number) =>
    api<ImportBatchView>(`/ledger/imports/${batchId}/rows/${rowId}/reopen`, { method: "POST" }),

  commitReady: (batchId: number) =>
    api<ImportBatchView & { balances: BalancesResult }>(
      `/ledger/imports/${batchId}/commit-ready`,
      { method: "POST" }
    ),

  discard: (batchId: number) =>
    api<ImportBatchView>(`/ledger/imports/${batchId}/discard`, { method: "POST" })
};
