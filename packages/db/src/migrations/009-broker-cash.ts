import type { Migration } from "./runner.js";

/**
 * Caixa da corretora: o dinheiro que já saiu do banco e ainda não virou ativo.
 *
 * Até aqui a conta de corretora (`kind='investment'`) só recebia a ponta de
 * uma transferência: comprar BTC tirava do banco e punha na corretora, e o
 * saldo da corretora crescia a cada compra sem nunca descer — por isso ela
 * ficava fora do patrimônio, para não contar o mesmo dinheiro duas vezes.
 *
 * Agora a conta de corretora é o **caixa para investir**:
 *
 * - aporte é transferência banco → corretora (o dinheiro fica em caixa);
 * - compra é um lançamento `adjustment` negativo na corretora (o caixa vira
 *   ativo); venda é o positivo (o ativo volta a ser caixa);
 * - resgate é transferência corretora → banco.
 *
 * `adjustment` fica fora de todo relatório de entrada e saída: converter
 * caixa em ativo não é gastar. `operation_cash_entries` liga a operação ao seu
 * lançamento de caixa, do mesmo jeito que `operation_transfers` liga ao aporte
 * automático.
 *
 * **Histórico.** Cada operação que já tinha transferência ganha aqui o seu
 * lançamento de caixa, com o valor oposto ao da ponta que caiu na corretora.
 * Assim o caixa das operações antigas fecha em zero — que é o que elas
 * significavam: o dinheiro saiu do banco e virou ativo na mesma hora.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS operation_cash_entries (
    operation_id INTEGER PRIMARY KEY REFERENCES operations(id),
    entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id),
    created_at TEXT NOT NULL
  );
`;

export const migration009BrokerCash: Migration = {
  version: 9,
  name: "broker-cash",
  up: (db) => {
    db.exec(SCHEMA);

    const legs = db
      .prepare(
        `SELECT ot.operation_id AS operationId, o.date, o.type, o.asset,
                e.id AS entryId, e.account_id AS accountId, e.person_id AS personId,
                e.amount_cents AS amountCents, e.status
         FROM operation_transfers ot
         JOIN operations o ON o.id = ot.operation_id
         JOIN transfers t ON t.id = ot.transfer_id
         JOIN entries e ON e.id IN (t.from_entry_id, t.to_entry_id)
         JOIN accounts a ON a.id = e.account_id AND a.kind = 'investment'
         WHERE ot.operation_id NOT IN (SELECT operation_id FROM operation_cash_entries)`
      )
      .all() as {
      operationId: number;
      date: string;
      type: "buy" | "sell";
      asset: string;
      entryId: number;
      accountId: number;
      personId: number | null;
      amountCents: number;
      status: string;
    }[];

    const now = new Date().toISOString();
    const insertEntry = db.prepare(
      `INSERT INTO entries
       (account_id, person_id, date, amount_cents, kind, status, description,
        counts_toward_target, created_at, updated_at)
       VALUES (@accountId, @personId, @date, @amountCents, 'adjustment', @status,
               @description, 0, @now, @now)`
    );
    const link = db.prepare(
      "INSERT INTO operation_cash_entries(operation_id, entry_id, created_at) VALUES (?, ?, ?)"
    );

    for (const leg of legs) {
      const entryId = Number(
        insertEntry.run({
          accountId: leg.accountId,
          personId: leg.personId,
          date: leg.date,
          amountCents: -leg.amountCents,
          status: leg.status,
          description: `${leg.type === "buy" ? "Compra" : "Venda"} ${leg.asset}`,
          now
        }).lastInsertRowid
      );
      link.run(leg.operationId, entryId, now);
    }
  }
};
