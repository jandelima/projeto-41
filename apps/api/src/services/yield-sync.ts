import type { AppDatabase } from "@projeto41/db";
import { syncPosition } from "./position-yield.js";

/**
 * Deixa caixinhas e posições em dia com o CDI publicado. O patrimônio lê o
 * valor guardado: sem isto, quem não abre as telas veria o valor de semanas
 * atrás. Uma caixinha ou posição com problema não impede as outras.
 */
export function syncAllYields(db: AppDatabase, today: string) {
  for (const goal of db.ledger.goals.list()) {
    try {
      db.ledger.goals.accrue(goal.id, today);
    } catch {
      // Segue para a próxima: a tela mostra o erro quando a caixinha for aberta.
    }
  }
  for (const position of db.positions.list()) {
    try {
      syncPosition(db, position.id, today);
    } catch {
      // Idem.
    }
  }
}
