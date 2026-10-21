import type { Migration } from "./runner.js";

/**
 * Um conceito de caixa só: as posições de "Caixa e renda fixa".
 *
 * A 009 fez da conta de corretora um "caixa para investir", paralelo às
 * posições que o usuário já cria à mão (Caixa BR, Dólar, Reserva…). Eram dois
 * caixas no mesmo módulo. Esta migração desfaz o da corretora e liga o banco
 * direto às posições:
 *
 * - **aporte** tira da conta bancária e põe numa posição qualquer — um caixa,
 *   ou direto na renda fixa;
 * - **resgate** faz o caminho de volta;
 * - **mover** passa de uma posição para outra, sem tocar no banco;
 * - **comprar e vender** podem usar um caixa como origem ou destino.
 *
 * O livro precisa de duas pontas em toda transferência (D20). A ponta do lado
 * dos investimentos é uma conta-ponte única, "Investimentos": o saldo dela é
 * o total aportado líquido, e ela continua fora do patrimônio — o dinheiro já
 * aparece como valor das posições.
 *
 * `position_movements` é o extrato de cada posição: quanto o valor atual (e o
 * investido) mudou em cada movimento, para que desfazer devolva exatamente o
 * que foi feito.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS position_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL REFERENCES manual_positions(id),
    date TEXT NOT NULL,
    kind TEXT NOT NULL
      CHECK(kind IN ('deposit','withdrawal','move_in','move_out','buy','sell')),
    amount REAL NOT NULL,
    invested_delta REAL NOT NULL DEFAULT 0,
    transfer_id INTEGER UNIQUE REFERENCES transfers(id),
    operation_id INTEGER UNIQUE REFERENCES operations(id),
    pair_id INTEGER REFERENCES position_movements(id),
    description TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS position_movements_position
    ON position_movements(position_id, date);
`;

const SEEDED_NAMES = ["Corretora cripto", "Corretora B3"];

export const migration010PositionCash: Migration = {
  version: 10,
  name: "position-cash",
  up: (db) => {
    db.exec(SCHEMA);

    const hasCashTable = Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'operation_cash_entries'")
        .get()
    );

    // 0. O dinheiro que estava parado numa corretora não pode sumir. Aporte
    //    avulso (transferência que não é de operação) e compra paga pelo caixa
    //    da corretora viram um caixa de verdade: uma posição Caixa BR com o
    //    nome da corretora e o extrato desses movimentos. Operação paga direto
    //    pelo banco não entra: ela já não deixava saldo na corretora.
    const now = new Date().toISOString();
    const brokers = db
      .prepare("SELECT id, name, opening_balance_cents AS opening FROM accounts WHERE kind = 'investment'")
      .all() as { id: number; name: string; opening: number }[];
    // Preparadas só quando há o que preservar: bancos mínimos (testes do
    // runner) nem têm `manual_positions`.
    const insertPosition = () =>
      db.prepare(
        `INSERT INTO manual_positions (category, name, invested, current_value, currency, notes)
         VALUES ('cash', ?, 0, ?, 'BRL', 'Criado ao unificar os caixas: era o saldo desta corretora')`
      );
    const insertMovement = () =>
      db.prepare(
        `INSERT INTO position_movements
         (position_id, date, kind, amount, invested_delta, transfer_id, operation_id, description, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
      );
    for (const broker of brokers) {
      const loose = db
        .prepare(
          `SELECT t.id AS transferId, e.date, e.amount_cents AS cents
           FROM entries e
           JOIN transfers t ON t.from_entry_id = e.id OR t.to_entry_id = e.id
           JOIN entries other ON other.id = CASE WHEN t.from_entry_id = e.id
                                                 THEN t.to_entry_id ELSE t.from_entry_id END
           JOIN accounts oa ON oa.id = other.account_id AND oa.kind <> 'investment'
           WHERE e.account_id = ?
             AND t.id NOT IN (SELECT transfer_id FROM operation_transfers)
             AND t.id NOT IN (SELECT transfer_id FROM position_movements WHERE transfer_id IS NOT NULL)`
        )
        .all(broker.id) as { transferId: number; date: string; cents: number }[];
      const paidByBroker = hasCashTable
        ? (db
            .prepare(
              `SELECT oc.operation_id AS operationId, e.date, e.amount_cents AS cents,
                      e.description
               FROM operation_cash_entries oc
               JOIN entries e ON e.id = oc.entry_id
               WHERE e.account_id = ?
                 AND oc.operation_id NOT IN (SELECT operation_id FROM operation_transfers)`
            )
            .all(broker.id) as { operationId: number; date: string; cents: number; description: string | null }[])
        : [];
      if (loose.length === 0 && paidByBroker.length === 0 && broker.opening === 0) continue;

      const totalCents =
        broker.opening +
        loose.reduce((sum, row) => sum + row.cents, 0) +
        paidByBroker.reduce((sum, row) => sum + row.cents, 0);
      const positionId = Number(insertPosition().run(broker.name, totalCents / 100).lastInsertRowid);
      for (const row of loose) {
        insertMovement().run(
          positionId,
          row.date,
          row.cents >= 0 ? "deposit" : "withdrawal",
          row.cents / 100,
          row.transferId,
          null,
          row.cents >= 0 ? `Aporte · ${broker.name}` : `Resgate · ${broker.name}`,
          now
        );
      }
      for (const row of paidByBroker) {
        insertMovement().run(
          positionId,
          row.date,
          row.cents < 0 ? "buy" : "sell",
          row.cents / 100,
          null,
          row.operationId,
          row.description,
          now
        );
      }
      // O saldo agora mora na posição; a abertura da conta-ponte fica zerada
      // para não contar em dois lugares.
      if (broker.opening !== 0) {
        db.prepare("UPDATE accounts SET opening_balance_cents = 0 WHERE id = ?").run(broker.id);
      }
    }

    // 1. Desfaz o caixa da corretora da 009: os lançamentos de caixa somem e a
    //    operação que só usava esse caixa volta a ser "sem movimento" — a não
    //    ser que o passo 0 a tenha ligado ao caixa novo.
    if (hasCashTable) {
      const cashEntries = (
        db.prepare("SELECT entry_id AS id FROM operation_cash_entries").all() as { id: number }[]
      ).map((row) => row.id);
      db.exec("DROP TABLE operation_cash_entries");
      const remove = db.prepare("DELETE FROM entries WHERE id = ?");
      for (const id of cashEntries) remove.run(id);
    }
    db.exec(`
      UPDATE operations SET account_id = NULL
      WHERE account_id IN (SELECT id FROM accounts WHERE kind = 'investment')
        AND id NOT IN (SELECT operation_id FROM operation_transfers)
    `);

    // 2. Uma ponte só. A de cripto vira "Investimentos"; o que estava na de B3
    //    passa para ela, e a de B3 é arquivada.
    const setting = (key: string) => {
      const value = (
        db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
          | { value: string }
          | undefined
      )?.value;
      const id = Number(value);
      return Number.isInteger(id) && id > 0 ? id : null;
    };
    const exists = (id: number | null) =>
      id != null && Boolean(db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id));

    const crypto = setting("investment.crypto_account_id");
    const b3 = setting("investment.b3_account_id");
    let bridge = setting("investment.bridge_account_id");
    if (!exists(bridge)) bridge = exists(crypto) ? crypto : exists(b3) ? b3 : null;
    if (bridge == null) {
      const joint = db.prepare("SELECT id FROM people WHERE kind = 'joint' LIMIT 1").get() as
        | { id: number }
        | undefined;
      bridge = Number(
        db
          .prepare(
            `INSERT INTO accounts
             (person_id, name, kind, color, opening_balance_cents, include_in_net_worth,
              archived, sort_order, created_at)
             VALUES (?, 'Investimentos', 'investment', '#4f8ff7', 0, 0, 0, 90, ?)`
          )
          .run(joint?.id ?? null, new Date().toISOString()).lastInsertRowid
      );
    }
    for (const other of [crypto, b3]) {
      if (other == null || other === bridge || !exists(other)) continue;
      db.prepare("UPDATE entries SET account_id = ? WHERE account_id = ?").run(bridge, other);
      db.prepare("UPDATE operations SET account_id = ? WHERE account_id = ?").run(bridge, other);
      db.prepare("UPDATE accounts SET archived = 1 WHERE id = ?").run(other);
    }
    const name = (
      db.prepare("SELECT name FROM accounts WHERE id = ?").get(bridge) as { name: string }
    ).name;
    if (SEEDED_NAMES.includes(name)) {
      db.prepare("UPDATE accounts SET name = 'Investimentos' WHERE id = ?").run(bridge);
    }

    const upsert = db.prepare(
      `INSERT INTO settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    upsert.run("investment.bridge_account_id", String(bridge));
    upsert.run("investment.crypto_account_id", String(bridge));
    upsert.run("investment.b3_account_id", String(bridge));
    db.prepare(
      "INSERT INTO settings(key, value) VALUES ('investment.default_position_id', '') ON CONFLICT(key) DO NOTHING"
    ).run();
  }
};
