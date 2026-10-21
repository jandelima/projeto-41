import Database from "better-sqlite3";
import { migrations, runMigrations } from "./migrations/index.js";
import { createLedgerRepositories } from "./repositories/index.js";
import {
  investmentAccountForWrite,
  investmentAccountScope,
  PRINCIPAL_INVESTMENT_ACCOUNT
} from "./investment-scope.js";
import type { Contribution, ManualPosition, Operation } from "@projeto41/contracts";

/**
 * Payload do snapshot, versionado (R-03).
 *
 * - **v1 (legado):** objeto plano de numeros, sem nenhuma chave de metadado.
 * - **v2 (fase 4):** `{ version, classes, totals }`.
 *
 * A deteccao e pela **presenca da chave `version`**, nunca por heuristica sobre
 * os nomes das outras chaves. Nenhuma linha v1 e reescrita: o passado nao tinha
 * caixa e continuara nao tendo.
 */
export type SnapshotPayloadV2 = {
  version: 2;
  classes: Record<string, number>;
  totals: { investments: number; bank: number; liabilities: number };
};

export type SnapshotRecord = {
  date: string;
  totalBrl: number;
  payloadVersion: 1 | 2;
  classes: Record<string, number>;
  totals: SnapshotPayloadV2["totals"] | null;
  priceTimes: Record<string, string>;
  /** Mantido para os consumidores antigos, que leem `payload` como as classes. */
  payload: Record<string, number>;
};

type SnapshotInput = {
  date: string;
  totalBrl: number;
  /**
   * v2 para o que o app grava hoje; o objeto plano continua aceito porque o
   * importador da planilha e os dados de demonstracao gravam patrimonio de
   * antes do controle de caixa, que e v1 por natureza.
   */
  payload: SnapshotPayloadV2 | Record<string, number>;
  priceTimes?: Record<string, string>;
};

export type PriceRecord = {
  symbol: string;
  currency: "BRL" | "USD";
  price: number;
  provider: string;
  marketTime: string | null;
  fetchedAt: string;
  error: string | null;
  // Baseline diário: último preço do dia anterior e o dia (YYYY-MM-DD) a que ele se refere.
  // Gerenciado automaticamente pelo upsert e usado para calcular a variação do dia
  // (atual vs. baseline). Não deve ser preenchido pelos provedores.
  prevPrice?: number | null;
  prevDay?: string | null;
};

export type CryptoAsset = {
  symbol: string;
  slug: string;
  name: string;
};

export type AppDatabase = ReturnType<typeof createDatabase>;

type InvestmentAccountRow = {
  id: number;
  name: string;
  personId: number | null;
  sortOrder: number;
};

/**
 * Uma conta de investimento por pessoa individual ativa.
 *
 * Quem já tinha conta continua com ela: a ligação é por nome (foi assim que
 * "Steylor" e "Bianca" nasceram) e, na falta de nome igual, a conta Principal
 * de um banco antigo vira a da primeira pessoa. Pessoa nova ganha conta vazia
 * com as metas de alocação da primeira. O nome da conta segue o da pessoa.
 */
function syncInvestmentAccounts(raw: Database.Database) {
  const people = raw
    .prepare("SELECT id, name FROM people WHERE kind = 'individual' AND active = 1 ORDER BY id")
    .all() as { id: number; name: string }[];
  if (people.length === 0) return;
  const norm = (value: string) => value.trim().toLowerCase();

  raw.transaction(() => {
    const accounts = raw
      .prepare("SELECT id, name, person_id AS personId FROM investment_accounts ORDER BY sort_order, id")
      .all() as { id: number; name: string; personId: number | null }[];
    const taken = new Set(accounts.filter((a) => a.personId != null).map((a) => a.id));
    const update = raw.prepare("UPDATE investment_accounts SET person_id = ?, name = ? WHERE id = ?");

    for (const person of people) {
      let account = accounts.find((a) => a.personId === person.id);
      account ??= accounts.find((a) => !taken.has(a.id) && norm(a.name) === norm(person.name));
      account ??= accounts.find(
        (a) => !taken.has(a.id) && a.id === PRINCIPAL_INVESTMENT_ACCOUNT && norm(a.name) === "principal"
      );
      if (account) {
        taken.add(account.id);
        if (account.personId !== person.id || account.name !== person.name) {
          update.run(person.id, person.name, account.id);
        }
        continue;
      }
      const id = Number(
        raw
          .prepare(
            `INSERT INTO investment_accounts(name, person_id, sort_order, created_at)
             VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM investment_accounts), ?)`
          )
          .run(person.name, person.id, new Date().toISOString()).lastInsertRowid
      );
      raw
        .prepare(
          `INSERT INTO allocation_targets(investment_account_id, category, weight)
           SELECT ?, category, weight FROM allocation_targets WHERE investment_account_id = ?`
        )
        .run(id, PRINCIPAL_INVESTMENT_ACCOUNT);
      accounts.push({ id, name: person.name, personId: person.id });
      taken.add(id);
    }
  })();
}

/** Escopo do histórico que soma todas as contas de investimento (migração 017). */
const ALL_ACCOUNTS_SNAPSHOT = 0;

export type PositionMovementKind =
  | "deposit"
  | "withdrawal"
  | "move_in"
  | "move_out"
  | "buy"
  | "sell"
  /** Rendimento CDI lançado pelo sistema. */
  | "yield"
  /** Correção do usuário: o valor real naquele dia. */
  | "adjust";

export type PositionMovementRow = {
  id: number;
  positionId: number;
  date: string;
  kind: PositionMovementKind;
  /** Mudança no valor atual, na moeda da posição: positiva entra, negativa sai. */
  amount: number;
  /** Mudança no investido (só renda fixa e ações globais acompanham o investido). */
  investedDelta: number;
  transferId: number | null;
  operationId: number | null;
  pairId: number | null;
  description: string | null;
};

export type PositionMovement = PositionMovementRow & {
  positionName: string;
  positionCategory: string;
  positionCurrency: string;
  accountName: string | null;
  transferStatus: string | null;
};

/**
 * Aportes e resgates que passaram pelo livro: transferência de investimento
 * entre uma conta e a conta-ponte, em reais. Movimento entre posições não
 * passa pela ponte e fica de fora.
 */
function ledgerContributions(raw: Database.Database, account: number | null) {
  // A conta de investimento de um aporte pelo livro é a da posição que ele
  // abasteceu ou a da operação que ele pagou. Sem nenhuma das duas (a posição
  // foi apagada mas o lançamento ficou no banco), não é de conta nenhuma: só
  // aparece no todo.
  const rows = raw
    .prepare(
      `SELECT t.id AS transferId, fe.date,
              CASE WHEN ta.kind = 'investment' THEN te.amount_cents
                   ELSE -te.amount_cents END AS cents,
              COALESCE(fe.description, te.description) AS notes,
              CASE WHEN ta.kind = 'investment' THEN fa.name ELSE ta.name END AS accountName
       FROM transfers t
       JOIN entries fe ON fe.id = t.from_entry_id
       JOIN entries te ON te.id = t.to_entry_id
       JOIN accounts fa ON fa.id = fe.account_id
       JOIN accounts ta ON ta.id = te.account_id
       WHERE t.purpose = 'investment'
         AND (fa.kind = 'investment') <> (ta.kind = 'investment')
         AND (@account IS NULL OR @account = COALESCE(
           (SELECT p.investment_account_id FROM position_movements pm
            JOIN manual_positions p ON p.id = pm.position_id WHERE pm.transfer_id = t.id),
           (SELECT o.investment_account_id FROM operation_transfers ot
            JOIN operations o ON o.id = ot.operation_id WHERE ot.transfer_id = t.id)))
       ORDER BY fe.date, t.id`
    )
    .all({ account }) as {
    transferId: number;
    date: string;
    cents: number;
    notes: string | null;
    accountName: string;
  }[];
  return rows.map((row) => ({
    id: row.transferId,
    date: row.date,
    amount: row.cents / 100,
    notes: row.notes ?? undefined,
    source: "ledger" as const,
    transferId: row.transferId,
    accountName: row.accountName
  }));
}

export function createDatabase(path: string) {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  // O `migrate()` legado cuida das tabelas de investimento e roda primeiro; o
  // runner versionado (D26) cuida de tudo que veio depois da fase 0.
  migrate(raw);
  runMigrations(raw, migrations);
  syncInvestmentAccounts(raw);

  return {
    raw,
    close: () => raw.close(),
    transaction: <T>(callback: () => T) => raw.transaction(callback)(),
    // Modulo de financas (centavos inteiros), separado das tabelas legadas de
    // investimento que seguem em REAL logo abaixo (D19).
    ledger: createLedgerRepositories(raw),
    // As contas de investimento são as pessoas do módulo de finanças: a lista
    // se acerta com elas, e ninguém cria conta à mão.
    investmentAccounts: {
      /** Contas das pessoas ativas, mais as sem dona (a Principal de bancos antigos). */
      list: () =>
        raw
          .prepare(
            `SELECT a.id, a.name, a.person_id AS personId, a.sort_order AS sortOrder
             FROM investment_accounts a LEFT JOIN people p ON p.id = a.person_id
             WHERE a.person_id IS NULL OR p.active = 1
             ORDER BY a.sort_order, a.id`
          )
          .all() as InvestmentAccountRow[],
      get: (id: number) =>
        raw
          .prepare(
            `SELECT id, name, person_id AS personId, sort_order AS sortOrder
             FROM investment_accounts WHERE id = ?`
          )
          .get(id) as InvestmentAccountRow | undefined,
      sync: () => syncInvestmentAccounts(raw)
    },
    operations: {
      /**
       * Da conta da requisição. `allAccounts` é para quem precisa do todo
       * independente da tela, como a lista de ativos a cotar.
       */
      list: (portfolio?: string, options: { allAccounts?: boolean } = {}) => {
        const account = options.allAccounts ? null : investmentAccountScope();
        const where = [
          portfolio ? "portfolio = @portfolio" : null,
          account != null ? "investment_account_id = @account" : null
        ].filter(Boolean);
        return raw
          .prepare(
            `SELECT id, portfolio, type, asset, date, quantity, total, currency, notes,
                    account_id AS accountId
             FROM operations
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY date DESC, id DESC`
          )
          .all({ portfolio: portfolio ?? null, account }) as (Operation & { id: number })[];
      },
      create: (operation: Operation) => {
        const result = raw
          .prepare(
            `INSERT INTO operations
             (portfolio, type, asset, date, quantity, total, currency, notes, account_id,
              investment_account_id)
             VALUES (@portfolio, @type, @asset, @date, @quantity, @total, @currency, @notes,
                     @accountId, @investmentAccountId)`
          )
          .run({
            notes: null,
            accountId: null,
            ...operation,
            investmentAccountId: investmentAccountForWrite()
          });
        return Number(result.lastInsertRowid);
      },
      update: (id: number, operation: Operation) =>
        raw
          .prepare(
            `UPDATE operations SET portfolio=@portfolio, type=@type, asset=@asset,
             date=@date, quantity=@quantity, total=@total, currency=@currency, notes=@notes,
             account_id=@accountId
             WHERE id=@id`
          )
          .run({ notes: null, accountId: null, ...operation, id }).changes,
      remove: (id: number) => raw.prepare("DELETE FROM operations WHERE id = ?").run(id).changes,
      clear: (portfolio?: string) => {
        const account = investmentAccountScope();
        const where = [
          portfolio ? "portfolio = @portfolio" : null,
          account != null ? "investment_account_id = @account" : null
        ].filter(Boolean);
        return raw
          .prepare(`DELETE FROM operations ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`)
          .run({ portfolio: portfolio ?? null, account }).changes;
      }
    },
    // Keyed by symbol: the asset identity across operations/prices/dividends.
    // Assumes one coin per ticker; re-picking a different coin for an existing
    // symbol overwrites its slug by design.
    cryptoAssets: {
      list: () =>
        raw
          .prepare("SELECT symbol, slug, name FROM crypto_assets ORDER BY symbol")
          .all() as CryptoAsset[],
      get: (symbol: string) =>
        raw
          .prepare("SELECT symbol, slug, name FROM crypto_assets WHERE symbol = ?")
          .get(symbol) as CryptoAsset | undefined,
      upsert: (asset: CryptoAsset) =>
        raw
          .prepare(
            `INSERT INTO crypto_assets(symbol, slug, name) VALUES (@symbol, @slug, @name)
             ON CONFLICT(symbol) DO UPDATE SET slug=excluded.slug, name=excluded.name`
          )
          .run(asset)
    },
    positions: {
      list: () =>
        raw
          .prepare(
            `SELECT id, category, name, invested, current_value AS currentValue,
             currency, notes, cdi_percent AS cdiPercent, cdi_since AS cdiSince FROM manual_positions
             WHERE @account IS NULL OR investment_account_id = @account
             ORDER BY category, id`
          )
          .all({ account: investmentAccountScope() }) as (ManualPosition & { id: number })[],
      upsert: (position: ManualPosition) => {
        const values = { notes: null, cdiPercent: null, cdiSince: null, ...position };
        if (position.id) {
          raw
            .prepare(
              `UPDATE manual_positions SET category=@category, name=@name, invested=@invested,
               current_value=@currentValue, currency=@currency, notes=@notes,
               cdi_percent=@cdiPercent, cdi_since=@cdiSince WHERE id=@id`
            )
            .run(values);
          return position.id;
        }
        const result = raw
          .prepare(
            `INSERT INTO manual_positions
             (category, name, invested, current_value, currency, notes, cdi_percent, cdi_since,
              investment_account_id)
             VALUES (@category, @name, @invested, @currentValue, @currency, @notes, @cdiPercent,
                     @cdiSince, @investmentAccountId)`
          )
          .run({ ...values, investmentAccountId: investmentAccountForWrite() });
        return Number(result.lastInsertRowid);
      },
      remove: (id: number) =>
        raw.prepare("DELETE FROM manual_positions WHERE id=?").run(id).changes,
      get: (id: number) =>
        raw
          .prepare(
            `SELECT id, category, name, invested, current_value AS currentValue,
             currency, notes, cdi_percent AS cdiPercent, cdi_since AS cdiSince FROM manual_positions WHERE id = ?`
          )
          .get(id) as (ManualPosition & { id: number }) | undefined,
      /** Rendimento incorporado: o valor novo passa a render a partir de `since`. */
      setCdiSince: (id: number, since: string) =>
        raw.prepare("UPDATE manual_positions SET cdi_since = ? WHERE id = ?").run(since, id).changes,
      /** Soma ao valor atual e ao investido: é assim que um movimento mexe na posição. */
      applyDelta: (id: number, amount: number, investedDelta: number) =>
        raw
          .prepare(
            `UPDATE manual_positions
             SET current_value = current_value + ?, invested = MAX(invested + ?, 0)
             WHERE id = ?`
          )
          .run(amount, investedDelta, id).changes
    },
    // Extrato das posições (migração 010): cada aporte, resgate, movimento
    // entre posições e compra ou venda paga por um caixa.
    positionMovements: {
      list: (options: { positionId?: number; limit?: number } = {}) =>
        raw
          .prepare(
            `SELECT m.id, m.position_id AS positionId, p.name AS positionName,
                    p.category AS positionCategory, p.currency AS positionCurrency,
                    m.date, m.kind, m.amount, m.invested_delta AS investedDelta,
                    m.transfer_id AS transferId, m.operation_id AS operationId,
                    m.pair_id AS pairId, m.description, a.name AS accountName,
                    e.status AS transferStatus
             FROM position_movements m
             JOIN manual_positions p ON p.id = m.position_id
             LEFT JOIN transfers t ON t.id = m.transfer_id
             LEFT JOIN entries e ON e.id = CASE WHEN m.kind = 'deposit' THEN t.from_entry_id
                                                ELSE t.to_entry_id END
             LEFT JOIN accounts a ON a.id = e.account_id
             ${
               options.positionId
                 ? "WHERE m.position_id = @positionId"
                 : "WHERE @account IS NULL OR p.investment_account_id = @account"
             }
             ORDER BY m.date DESC, m.id DESC
             LIMIT @limit`
          )
          .all({
            positionId: options.positionId ?? null,
            limit: options.limit ?? 50,
            account: investmentAccountScope()
          }) as PositionMovement[],
      get: (id: number) =>
        raw
          .prepare(
            `SELECT id, position_id AS positionId, date, kind, amount,
                    invested_delta AS investedDelta, transfer_id AS transferId,
                    operation_id AS operationId, pair_id AS pairId, description
             FROM position_movements WHERE id = ?`
          )
          .get(id) as PositionMovementRow | undefined,
      byOperation: (operationId: number) =>
        raw
          .prepare(
            `SELECT id, position_id AS positionId, date, kind, amount,
                    invested_delta AS investedDelta, transfer_id AS transferId,
                    operation_id AS operationId, pair_id AS pairId, description
             FROM position_movements WHERE operation_id = ?`
          )
          .get(operationId) as PositionMovementRow | undefined,
      create: (row: Omit<PositionMovementRow, "id">) =>
        Number(
          raw
            .prepare(
              `INSERT INTO position_movements
               (position_id, date, kind, amount, invested_delta, transfer_id, operation_id,
                pair_id, description, created_at)
               VALUES (@positionId, @date, @kind, @amount, @investedDelta, @transferId,
                       @operationId, @pairId, @description, @createdAt)`
            )
            .run({ ...row, createdAt: new Date().toISOString() }).lastInsertRowid
        ),
      setPair: (id: number, pairId: number) =>
        raw.prepare("UPDATE position_movements SET pair_id = ? WHERE id = ?").run(pairId, id),
      remove: (id: number) => {
        // O par de um movimento entre posicoes aponta para ele: solta antes.
        raw.prepare("UPDATE position_movements SET pair_id = NULL WHERE pair_id = ?").run(id);
        return raw.prepare("DELETE FROM position_movements WHERE id = ?").run(id).changes;
      },
      /** Movimentos que ligam a posição ao banco ou a operações. */
      countLinked: (positionId: number) =>
        (
          raw
            .prepare(
              `SELECT COUNT(*) AS n FROM position_movements
               WHERE position_id = ? AND (transfer_id IS NOT NULL OR operation_id IS NOT NULL)`
            )
            .get(positionId) as { n: number }
        ).n,
      /** Posições que já receberam dinheiro do banco: integradas, não manuais. */
      integratedPositionIds: () =>
        (
          raw
            .prepare(
              `SELECT DISTINCT m.position_id AS id FROM position_movements m
               JOIN manual_positions p ON p.id = m.position_id
               WHERE m.transfer_id IS NOT NULL
                 AND (@account IS NULL OR p.investment_account_id = @account)`
            )
            .all({ account: investmentAccountScope() }) as { id: number }[]
        ).map((row) => row.id)
    },
    dividends: {
      /** Todas as contas juntas somam os proventos do mesmo ativo. */
      list: () =>
        raw
          .prepare(
            `SELECT asset, SUM(amount) AS amount FROM dividends
             WHERE @account IS NULL OR investment_account_id = @account
             GROUP BY asset ORDER BY asset`
          )
          .all({ account: investmentAccountScope() }) as {
          asset: string;
          amount: number;
        }[],
      set: (asset: string, amount: number) =>
        raw
          .prepare(
            `INSERT INTO dividends(investment_account_id, asset, amount) VALUES (?, ?, ?)
             ON CONFLICT(investment_account_id, asset) DO UPDATE SET amount=excluded.amount`
          )
          .run(investmentAccountForWrite(), asset, amount)
    },
    contributions: {
      list: () =>
        raw
          .prepare(
            `SELECT id, date, amount, notes FROM contributions
             WHERE @account IS NULL OR investment_account_id = @account ORDER BY date`
          )
          .all({ account: investmentAccountScope() }) as (Contribution & { id: number })[],
      create: (entry: Contribution) =>
        Number(
          raw
            .prepare(
              `INSERT INTO contributions(date, amount, notes, investment_account_id)
               VALUES (@date, @amount, @notes, @investmentAccountId)`
            )
            .run({ notes: null, ...entry, investmentAccountId: investmentAccountForWrite() })
            .lastInsertRowid
        ),
      update: (id: number, entry: Contribution) =>
        raw
          .prepare(
            "UPDATE contributions SET date=@date, amount=@amount, notes=@notes WHERE id=@id"
          )
          .run({ notes: null, ...entry, id }).changes,
      remove: (id: number) => raw.prepare("DELETE FROM contributions WHERE id=?").run(id).changes,
      fromLedger: () => ledgerContributions(raw, investmentAccountScope()),
      /** Os digitados e os do livro, em ordem de data: é o que a tela e o rendimento usam. */
      all: () =>
        [
          ...(
            raw
              .prepare(
                `SELECT id, date, amount, notes FROM contributions
                 WHERE @account IS NULL OR investment_account_id = @account`
              )
              .all({ account: investmentAccountScope() }) as (Contribution & {
              id: number;
            })[]
          ).map((row) => ({
            ...row,
            source: "manual" as const,
            transferId: null,
            accountName: null
          })),
          ...ledgerContributions(raw, investmentAccountScope())
        ].sort((a, b) => a.date.localeCompare(b.date))
    },
    prices: {
      list: () =>
        raw
          .prepare(
            `SELECT symbol, currency, price, provider, market_time AS marketTime,
             fetched_at AS fetchedAt, error,
             prev_price AS prevPrice, prev_day AS prevDay FROM prices ORDER BY symbol`
          )
          .all() as PriceRecord[],
      get: (symbol: string) =>
        raw
          .prepare(
            `SELECT symbol, currency, price, provider, market_time AS marketTime,
             fetched_at AS fetchedAt, error,
             prev_price AS prevPrice, prev_day AS prevDay FROM prices WHERE symbol=?`
          )
          .get(symbol) as PriceRecord | undefined,
      upsert: (price: PriceRecord) =>
        raw
          .prepare(
            // prev_price/prev_day = "fechamento" do dia anterior: quando chega um preço de
            // um dia mais novo que o último gravado, o preço antigo vira a referência do dia.
            `INSERT INTO prices(symbol, currency, price, provider, market_time, fetched_at, error,
               prev_price, prev_day)
             VALUES (@symbol,@currency,@price,@provider,@marketTime,@fetchedAt,@error,
               @price,@day)
             ON CONFLICT(symbol) DO UPDATE SET currency=excluded.currency, price=excluded.price,
             provider=excluded.provider, market_time=excluded.market_time,
             fetched_at=excluded.fetched_at, error=excluded.error,
             prev_price = CASE WHEN substr(prices.fetched_at, 1, 10) < @day
               THEN prices.price ELSE prices.prev_price END,
             prev_day = CASE WHEN substr(prices.fetched_at, 1, 10) < @day
               THEN substr(prices.fetched_at, 1, 10) ELSE prices.prev_day END`
          )
          .run({
            symbol: price.symbol,
            currency: price.currency,
            price: price.price,
            provider: price.provider,
            marketTime: price.marketTime,
            fetchedAt: price.fetchedAt,
            error: price.error,
            day: price.fetchedAt.slice(0, 10)
          }),
      markError: (symbol: string, error: string, fetchedAt: string) =>
        raw
          .prepare("UPDATE prices SET error=?, fetched_at=? WHERE symbol=?")
          .run(error, fetchedAt, symbol)
    },
    // Metas de alocação são de cada conta; sem conta escolhida, as da Principal.
    targets: {
      list: () =>
        raw
          .prepare(
            `SELECT category, weight FROM allocation_targets
             WHERE investment_account_id = ? ORDER BY category`
          )
          .all(investmentAccountForWrite()) as {
          category: string;
          weight: number;
        }[],
      set: (category: string, weight: number) =>
        raw
          .prepare(
            `INSERT INTO allocation_targets(investment_account_id, category, weight) VALUES (?,?,?)
             ON CONFLICT(investment_account_id, category) DO UPDATE SET weight=excluded.weight`
          )
          .run(investmentAccountForWrite(), category, weight)
    },
    settings: {
      get: (key: string) =>
        (
          raw.prepare("SELECT value FROM settings WHERE key=?").get(key) as
            | { value: string }
            | undefined
        )?.value,
      set: (key: string, value: string) =>
        raw
          .prepare(
            `INSERT INTO settings(key,value) VALUES (?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`
          )
          .run(key, value)
    },
    snapshots: {
      list: () =>
        (
          raw
            .prepare(
              `SELECT date, total_brl AS totalBrl, payload, price_times AS priceTimes
               FROM snapshots WHERE investment_account_id = ? ORDER BY date`
            )
            .all(investmentAccountScope() ?? ALL_ACCOUNTS_SNAPSHOT) as {
            date: string;
            totalBrl: number;
            payload: string;
            priceTimes: string;
          }[]
        ).map((row): SnapshotRecord => {
          const parsed = JSON.parse(row.payload) as Record<string, unknown>;
          const isV2 = parsed.version === 2;
          const classes = (
            isV2 ? (parsed.classes ?? {}) : parsed
          ) as Record<string, number>;
          return {
            date: row.date,
            totalBrl: row.totalBrl,
            payloadVersion: isV2 ? 2 : 1,
            classes,
            totals: isV2 ? (parsed.totals as SnapshotPayloadV2["totals"]) : null,
            priceTimes: JSON.parse(row.priceTimes) as Record<string, string>,
            payload: classes
          };
        }),
      upsert: (snapshot: SnapshotInput) =>
        raw
          .prepare(
            `INSERT INTO snapshots(investment_account_id,date,total_brl,payload,price_times)
             VALUES (@scope,@date,@totalBrl,@payload,@priceTimes)
             ON CONFLICT(investment_account_id, date) DO UPDATE SET total_brl=excluded.total_brl,
             payload=excluded.payload, price_times=excluded.price_times`
          )
          .run({
            ...snapshot,
            scope: investmentAccountScope() ?? ALL_ACCOUNTS_SNAPSHOT,
            payload: JSON.stringify(snapshot.payload),
            priceTimes: JSON.stringify(snapshot.priceTimes ?? {})
          })
    },
    // Vinculo 1-1 entre operacao de investimento e a transferencia que ela
    // gerou no livro. Saber isso numa consulta e o que permite a interface
    // distinguir operacao com e sem movimento de caixa.
    operationLinks: {
      get: (operationId: number) =>
        raw
          .prepare(
            `SELECT operation_id AS operationId, transfer_id AS transferId,
                    created_at AS createdAt
             FROM operation_transfers WHERE operation_id = ?`
          )
          .get(operationId) as
          | { operationId: number; transferId: number; createdAt: string }
          | undefined,
      set: (operationId: number, transferId: number) =>
        raw
          .prepare(
            `INSERT INTO operation_transfers(operation_id, transfer_id, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT(operation_id) DO UPDATE SET transfer_id = excluded.transfer_id`
          )
          .run(operationId, transferId, new Date().toISOString()),
      remove: (operationId: number) =>
        raw.prepare("DELETE FROM operation_transfers WHERE operation_id = ?").run(operationId)
          .changes,

      /** Estado do vinculo de cada operacao, para a listagem. */
      listByOperations: (ids: number[]) => {
        if (ids.length === 0) return [];
        return raw
          .prepare(
            `SELECT ot.operation_id AS operationId, ot.transfer_id AS transferId,
                    e.status AS transferStatus, a.name AS accountName
             FROM operation_transfers ot
             JOIN transfers t ON t.id = ot.transfer_id
             JOIN entries e ON e.id = t.from_entry_id
             JOIN accounts a ON a.id = e.account_id
             WHERE ot.operation_id IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as {
          operationId: number;
          transferId: number;
          transferStatus: string;
          accountName: string;
        }[];
      }
    },
    imports: {
      has: (fingerprint: string) =>
        Boolean(raw.prepare("SELECT 1 FROM imports WHERE fingerprint=?").get(fingerprint)),
      record: (fingerprint: string, report: unknown) =>
        raw
          .prepare("INSERT INTO imports(fingerprint, imported_at, report) VALUES (?,?,?)")
          .run(fingerprint, new Date().toISOString(), JSON.stringify(report))
    }
  };
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio TEXT NOT NULL CHECK(portfolio IN ('crypto','b3')),
      type TEXT NOT NULL CHECK(type IN ('buy','sell')),
      asset TEXT NOT NULL,
      date TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      total REAL NOT NULL CHECK(total >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('BRL','USD')),
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS crypto_assets (
      symbol TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manual_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      invested REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('BRL','USD')),
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS dividends (
      asset TEXT PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS prices (
      symbol TEXT PRIMARY KEY,
      currency TEXT NOT NULL,
      price REAL NOT NULL,
      provider TEXT NOT NULL,
      market_time TEXT,
      fetched_at TEXT NOT NULL,
      error TEXT,
      prev_price REAL,
      prev_day TEXT
    );
    CREATE TABLE IF NOT EXISTS allocation_targets (
      category TEXT PRIMARY KEY,
      weight REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT PRIMARY KEY,
      total_brl REAL NOT NULL,
      payload TEXT NOT NULL,
      price_times TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS imports (
      fingerprint TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL,
      report TEXT NOT NULL
    );
  `);

  // Colunas adicionadas após o release inicial: garantem upgrade de bancos existentes.
  ensureColumn(db, "prices", "prev_price", "REAL");
  ensureColumn(db, "prices", "prev_day", "TEXT");

  const targetCount = db
    .prepare("SELECT COUNT(*) AS count FROM allocation_targets")
    .get() as { count: number };
  if (targetCount.count === 0) {
    db.exec(`
      INSERT INTO allocation_targets(category, weight) VALUES
        ('bitcoin', 0.25),
        ('shitcoins', 0.05),
        ('dolar', 0.10),
        ('caixa_br', 0.10),
        ('bolsa_brasil', 0.25),
        ('renda_fixa', 0.15),
        ('acoes_globais', 0.10);
    `);
  }
}

function ensureColumn(db: Database.Database, table: string, column: string, type: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export * from "./repositories/index.js";
export * from "./migrations/index.js";
export * from "./testing.js";
export * from "./investment-scope.js";
