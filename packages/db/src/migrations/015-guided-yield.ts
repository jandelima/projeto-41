import { rebuildTable, type Migration } from "./runner.js";

/**
 * Caixinhas e posições guiadas pelo que entrou, quando e quanto rendeu.
 *
 * - O extrato das posições ganha dois tipos: `yield` (rendimento CDI lançado
 *   pelo sistema) e `adjust` (correção do usuário: "o valor real era X no dia
 *   D"). Com eles, o valor de uma posição é sempre a soma do extrato, e o
 *   rendimento pode ser calculado e lançado sem ninguém digitar o valor atual.
 * - Toda posição cujo valor atual não fecha com o extrato ganha um `adjust`
 *   de saldo inicial com a diferença: é o dinheiro que já estava lá antes dos
 *   movimentos registrados. Nenhum valor muda.
 * - `goals.cdi_accrued_through`: até que dia o rendimento de uma caixinha de
 *   marcação já foi separado. A marcação não lança entrada na conta (quem paga
 *   o CDI é o banco, e isso chega pelo extrato); ela só separa o rendimento.
 */
export const migration015GuidedYield: Migration = {
  version: 15,
  name: "guided-yield",
  up: (db) => {
    const has = (name: string) =>
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null;

    if (has("goals")) {
      db.exec(`
        ALTER TABLE goals ADD COLUMN cdi_accrued_through TEXT;
        -- Marcação: quanto do separado é rendimento, para a tela mostrar o que
        -- você colocou e o que rendeu.
        ALTER TABLE goals ADD COLUMN cdi_yield_cents INTEGER NOT NULL DEFAULT 0;
        -- Correção de caixinha com conta própria: o saldo real no fim de um
        -- dia. O lançamento de ajuste guarda a diferença, refeita a partir do
        -- alvo quando um depósito com data anterior chega depois.
        CREATE TABLE IF NOT EXISTS goal_corrections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          target_cents INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS goal_corrections_goal ON goal_corrections(goal_id, date);
      `);
    }

    // Bancos mínimos (testes do runner) não têm o módulo de investimentos.
    if (!has("position_movements") || !has("manual_positions")) return;

    rebuildTable(db, {
      table: "position_movements",
      createSql: `
        CREATE TABLE position_movements__new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          position_id INTEGER NOT NULL REFERENCES manual_positions(id),
          date TEXT NOT NULL,
          kind TEXT NOT NULL
            CHECK(kind IN ('deposit','withdrawal','move_in','move_out','buy','sell','yield','adjust')),
          amount REAL NOT NULL,
          invested_delta REAL NOT NULL DEFAULT 0,
          transfer_id INTEGER UNIQUE REFERENCES transfers(id),
          operation_id INTEGER UNIQUE REFERENCES operations(id),
          pair_id INTEGER REFERENCES position_movements(id),
          description TEXT,
          created_at TEXT NOT NULL,
          -- Só na correção: o valor real da posição no fim daquele dia. A
          -- diferença (amount) é recalculada a partir dele sempre que um
          -- movimento com data anterior aparece depois.
          target_value REAL
        )`,
      columns: [
        "id",
        "position_id",
        "date",
        "kind",
        "amount",
        "invested_delta",
        "transfer_id",
        "operation_id",
        "pair_id",
        "description",
        "created_at"
      ],
      indexes: [
        "CREATE INDEX IF NOT EXISTS position_movements_position ON position_movements(position_id, date)"
      ]
    });

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const positions = db
      .prepare(
        `SELECT p.id, p.current_value AS value, p.cdi_since AS since,
                COALESCE((SELECT SUM(m.amount) FROM position_movements m WHERE m.position_id = p.id), 0) AS moved,
                (SELECT MIN(m.date) FROM position_movements m WHERE m.position_id = p.id) AS firstDate
         FROM manual_positions p`
      )
      .all() as {
      id: number;
      value: number;
      since: string | null;
      moved: number;
      firstDate: string | null;
    }[];
    const insert = db.prepare(
      `INSERT INTO position_movements
       (position_id, date, kind, amount, invested_delta, description, created_at)
       VALUES (?, ?, 'adjust', ?, 0, 'Saldo inicial: valor de antes do extrato', ?)`
    );
    for (const position of positions) {
      const residual = Math.round((position.value - position.moved) * 100) / 100;
      if (Math.abs(residual) < 0.005) continue;
      // O saldo inicial vale antes do primeiro movimento registrado.
      const date = position.firstDate ?? position.since ?? today;
      insert.run(position.id, date, residual, now.toISOString());
    }
  }
};
