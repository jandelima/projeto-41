import type { StatementAdapter } from "./adapter.js";
import { btgStatementAdapter } from "./adapters/btg.js";
import type { PdfPage } from "./text-layer.js";

/** So os bancos usados de verdade: cada adapter e manutencao anual. */
export const adapters: StatementAdapter[] = [btgStatementAdapter];

/** Abaixo disto o layout nao e reconhecido: escolher o menos ruim e importar errado. */
export const DETECTION_THRESHOLD = 0.7;

export function detectAdapter(
  pages: PdfPage[],
  registry: StatementAdapter[] = adapters
): { adapter: StatementAdapter; confidence: number }[] {
  return registry
    .map((adapter) => ({ adapter, confidence: adapter.detect(pages) }))
    .filter((candidate) => candidate.confidence >= DETECTION_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence);
}

export function adapterById(id: string, registry: StatementAdapter[] = adapters) {
  return registry.find((adapter) => adapter.id === id) ?? null;
}
