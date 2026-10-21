import type { Migration } from "./runner.js";

/**
 * Renda fixa do módulo de investimentos rende CDI, como as caixinhas.
 *
 * `cdi_percent` é o percentual do CDI; `cdi_since` é o dia a partir do qual o
 * valor atual da posição rende. O valor atual é digitado (ou vem de aportes),
 * então a data diz desde quando ele vale: sem ela não há como saber o que já
 * está embutido no número.
 */
export const migration014PositionCdi: Migration = {
  version: 14,
  name: "position-cdi",
  up: (db) => {
    // Bancos mínimos (testes do runner) não têm a tabela legada.
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'manual_positions'")
      .get();
    if (!exists) return;
    db.exec(`
      ALTER TABLE manual_positions ADD COLUMN cdi_percent REAL
        CHECK (cdi_percent IS NULL OR cdi_percent > 0);
      ALTER TABLE manual_positions ADD COLUMN cdi_since TEXT;
    `);
  }
};
