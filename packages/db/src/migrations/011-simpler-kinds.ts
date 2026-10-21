import type { Migration } from "./runner.js";

/**
 * Menos tipos para escolher.
 *
 * - **Poupança** deixa de ser um tipo de conta: na prática ela é uma conta
 *   corrente (ou uma caixinha), e o tipo só servia para confundir. As que
 *   existem viram conta corrente.
 * - **Pix e débito** viram **dinheiro**: os três saem da conta na hora, e a
 *   única diferença que importa para o livro é à vista contra crédito.
 *
 * Os `CHECK` antigos continuam aceitando os valores velhos — reconstruir
 * `accounts` e `entries` só para apertar o CHECK não vale o risco. Quem barra
 * valor novo é o contrato.
 */
export const migration011SimplerKinds: Migration = {
  version: 11,
  name: "simpler-kinds",
  up: (db) => {
    db.exec(`
      UPDATE accounts SET kind = 'checking' WHERE kind = 'savings';
      UPDATE entries SET payment_method = 'cash' WHERE payment_method IN ('pix', 'debit');
    `);
  }
};
