import type { Migration } from "./runner.js";

/**
 * Importacao de PDF (fase 8): o que o PDF tem e o OFX/CSV nao.
 *
 * - no lote: qual adapter leu o arquivo, em que versao de layout, e o
 *   resultado da conciliacao contra os totais que o proprio documento declara
 *   — guardado, para responder depois "este lote foi conferido?";
 * - na linha: a confianca da leitura, se o sinal veio marcado, de onde no PDF
 *   ela saiu e os avisos do adapter.
 *
 * So `ADD COLUMN`: `source = 'pdf'` e `status = 'needs_review'` ja cabem nos
 * `CHECK` desde a 007, entao nenhuma tabela e reconstruida.
 */
export const migration021PdfImport: Migration = {
  version: 21,
  name: "pdf-import",
  up: (db) => {
    db.exec(`
      ALTER TABLE import_batches ADD COLUMN adapter_id TEXT;
      ALTER TABLE import_batches ADD COLUMN layout_version TEXT;
      ALTER TABLE import_batches ADD COLUMN reconciliation_status TEXT
        CHECK (reconciliation_status IN ('match', 'mismatch'));
      ALTER TABLE import_batches ADD COLUMN reconciliation_json TEXT;
      ALTER TABLE import_rows ADD COLUMN confidence REAL;
      ALTER TABLE import_rows ADD COLUMN sign_known INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE import_rows ADD COLUMN source_page INTEGER;
      ALTER TABLE import_rows ADD COLUMN source_line INTEGER;
      ALTER TABLE import_rows ADD COLUMN warnings_json TEXT;
    `);
  }
};
