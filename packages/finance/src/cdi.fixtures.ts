import type { CdiRate } from "./cdi.js";

/**
 * Taxas fixas usadas nos testes.
 *
 * Origem: série 12 do SGS do Banco Central (CDI ao dia útil, em percentual),
 * conferida ao vivo em 2026-09-21 contra
 * `api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/3?formato=json`.
 */
export const cdiSetembro2026: CdiRate[] = [
  { date: "2026-09-16", dailyRatePercent: 0.05166 },
  { date: "2026-09-17", dailyRatePercent: 0.050788 }
];

/**
 * Semana do Carnaval de 2026: 16 e 17/02 são feriado, então a série só tem
 * quarta, quinta e sexta. A ausência de linha em feriado não é buraco.
 */
export const cdiCarnaval2026: CdiRate[] = [
  { date: "2026-02-18", dailyRatePercent: 0.05 },
  { date: "2026-02-19", dailyRatePercent: 0.05 },
  { date: "2026-02-20", dailyRatePercent: 0.05 }
];

export const feriadosCarnaval2026 = new Set(["2026-02-16", "2026-02-17"]);
