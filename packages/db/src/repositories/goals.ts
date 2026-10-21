import type {
  GoalCreateInput,
  GoalProgress,
  GoalRecord,
  GoalUpdateInput
} from "@projeto41/contracts";
import {
  accrueLots,
  addDays,
  dayFactor,
  estimateRedemption,
  goalProgress,
  iofFreeDate,
  profitMetrics,
  projectCompletion,
  type CdiRate,
  type Lot,
  type ProfitEvent
} from "@projeto41/finance";
import { createEntriesRepository } from "./entries.js";
import { LedgerError, fromBit, notFound, nowIso, today, type Db } from "./shared.js";

const SELECT_GOAL = `
  SELECT g.id, g.name, g.mode, g.account_id AS accountId, a.name AS accountName,
         g.parent_account_id AS parentAccountId, pa.name AS parentAccountName,
         g.target_amount_cents AS targetAmountCents, g.target_date AS targetDate,
         g.cdi_percent AS cdiPercent, g.profit_mode AS profitMode, g.color, g.icon, g.archived,
         g.created_at AS createdAt
  FROM goals g
  LEFT JOIN accounts a ON a.id = g.account_id
  LEFT JOIN accounts pa ON pa.id = g.parent_account_id
`;

type GoalRow = Omit<GoalRecord, "archived"> & { archived: number };

/**
 * SQL: o lançamento `e` é lucro — rendimento do CDI, lucro que o usuário
 * lançou ou o ajuste do lucro. O resto é aporte e saque. A marca é a coluna
 * `goal_profit` (migração 022), nunca o texto: a descrição o usuário edita.
 */
const IS_PROFIT_SQL = `(e.goal_profit IS NOT NULL)`;

/** Dias úteis num mês típico, para levar o fator diário do CDI a um mês. */
const BUSINESS_DAYS_PER_MONTH = 21;

const map = (row: GoalRow): GoalRecord => ({ ...row, archived: fromBit(row.archived) });

export function createGoalsRepository(db: Db) {
  const entries = createEntriesRepository(db);

  const holidaySet = () =>
    new Set(
      (db.prepare("SELECT date FROM holidays").all() as { date: string }[]).map(
        (row) => row.date
      )
    );

  const ratesBetween = (from: string, to: string): CdiRate[] =>
    db
      .prepare(
        `SELECT date, daily_factor AS dailyRatePercent FROM cdi_rates
         WHERE date >= ? AND date <= ? ORDER BY date`
      )
      .all(from, to) as CdiRate[];

  /**
   * Os aportes da caixinha como lotes, em ordem de data.
   *
   * Cada entrada de dinheiro na conta da caixinha é um lote; o rendimento já
   * lançado não vira lote novo (ele já está no saldo e não recomeça a contagem
   * de IR). Saques consomem em FIFO.
   */
  function lotsOf(goal: GoalRecord): (Lot & { isYield?: boolean })[] {
    if (goal.accountId == null) return [];
    if (goal.mode === "earmark") return earmarkLotsOf(goal);
    const rows = db
      .prepare(
        `SELECT date, amount_cents AS amountCents, kind,
                COALESCE(goal_profit IN ('yield', 'profit'), 0) AS isYield
         FROM entries
         WHERE account_id = ? AND goal_profit IS NOT 'profit_adjust'
         ORDER BY date, id`
      )
      .all(goal.accountId) as { date: string; amountCents: number; kind: string; isYield: number }[];

    let lots: (Lot & { isYield?: boolean })[] = [];
    for (const row of rows) {
      if (row.amountCents > 0) {
        // O rendimento lançado rende junto (juros compostos), mas não é aporte:
        // não reinicia o prazo do IOF.
        lots.push({ principalCents: row.amountCents, startDate: row.date, isYield: row.isYield === 1 });
      } else if (row.amountCents < 0) {
        // Saque consome o dinheiro mais antigo primeiro.
        let remaining = -row.amountCents;
        const next: Lot[] = [];
        for (const lot of lots) {
          if (remaining <= 0) {
            next.push(lot);
          } else if (lot.principalCents <= remaining) {
            remaining -= lot.principalCents;
          } else {
            next.push({ ...lot, principalCents: lot.principalCents - remaining });
            remaining = 0;
          }
        }
        lots = next;
      }
    }
    return lots;
  }

  /**
   * Na marcação, cada alocação é um lote que rende a partir da data do
   * lançamento a que está presa. Liberar valor já reduz a alocação, então não
   * há saque para consumir.
   */
  function earmarkLotsOf(goal: GoalRecord): Lot[] {
    return db
      .prepare(
        `SELECT e.date AS startDate, ga.amount_cents AS principalCents
         FROM goal_allocations ga JOIN entries e ON e.id = ga.entry_id
         WHERE ga.goal_id = ? AND ga.amount_cents > 0
         ORDER BY e.date, e.id`
      )
      .all(goal.id) as Lot[];
  }

  /** Saldo: SUM dos lançamentos da conta, ou SUM das alocações na marcação. */
  function balanceOf(goal: GoalRecord, asOf: string): number {
    if (goal.mode === "account" && goal.accountId != null) {
      return (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries
             WHERE account_id = ? AND date <= ? AND status IN ('cleared','reconciled')`
          )
          .get(goal.accountId, asOf) as { total: number }
      ).total;
    }
    return (
      db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM goal_allocations WHERE goal_id = ?")
        .get(goal.id) as { total: number }
    ).total;
  }

  const repository = {
    list: (includeArchived = false): GoalRecord[] =>
      (
        db
          .prepare(`${SELECT_GOAL} ${includeArchived ? "" : "WHERE g.archived = 0"} ORDER BY g.id`)
          .all() as GoalRow[]
      ).map(map),

    get: (id: number): GoalRecord | undefined => {
      const row = db.prepare(`${SELECT_GOAL} WHERE g.id = ?`).get(id) as GoalRow | undefined;
      return row ? map(row) : undefined;
    },

    /**
     * No modo conta, a conta `kind='goal'` nasce na **mesma** transação: nunca
     * deixar caixinha sem conta pela metade. Ela é de quem é dono da conta
     * atrelada, a menos que a pessoa venha escolhida.
     */
    create: (input: GoalCreateInput): number =>
      db.transaction(() => {
        const mode = input.mode ?? "account";
        let accountId = input.accountId ?? null;
        const parentAccountId = mode === "account" ? (input.parentAccountId ?? null) : null;
        if (parentAccountId != null) assertParent(parentAccountId);
        const profitMode = input.profitMode ?? (input.cdiPercent != null ? "auto" : "manual");
        if (profitMode === "auto" && input.cdiPercent == null) {
          throw new LedgerError("Lucro automático precisa do percentual do CDI");
        }

        if (mode === "account") {
          const owner =
            input.personId ??
            (parentAccountId == null
              ? null
              : ((
                  db.prepare("SELECT person_id AS personId FROM accounts WHERE id = ?").get(parentAccountId) as
                    | { personId: number | null }
                    | undefined
                )?.personId ?? null));
          accountId = Number(
            db
              .prepare(
                `INSERT INTO accounts
                 (person_id, name, kind, color, opening_balance_cents, include_in_net_worth,
                  archived, sort_order, created_at)
                 VALUES (?, ?, 'goal', ?, 0, 1, 0, 50, ?)`
              )
              .run(owner, input.name, input.color, nowIso()).lastInsertRowid
          );
        }

        return Number(
          db
            .prepare(
              `INSERT INTO goals
               (name, mode, account_id, parent_account_id, target_amount_cents, target_date,
                cdi_percent, profit_mode, color, icon, archived, created_at)
               VALUES (@name, @mode, @accountId, @parentAccountId, @targetAmountCents, @targetDate,
                       @cdiPercent, @profitMode, @color, @icon, 0, @createdAt)`
            )
            .run({
              name: input.name,
              mode,
              accountId,
              parentAccountId,
              targetAmountCents: input.targetAmountCents ?? null,
              targetDate: input.targetDate ?? null,
              cdiPercent: input.cdiPercent ?? null,
              profitMode,
              color: input.color,
              icon: input.icon ?? null,
              createdAt: nowIso()
            }).lastInsertRowid
        );
      })(),

    /**
     * `mode` e `account_id` são ignorados mesmo que cheguem no objeto. A conta
     * atrelada pode mudar e vale para os próximos movimentos. Nome e cor
     * acompanham a conta da caixinha, que é o que o extrato mostra como destino.
     */
    update: (id: number, input: GoalUpdateInput): number => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      const parentAccountId =
        goal.mode === "account" ? (input.parentAccountId ?? goal.parentAccountId) : null;
      if (parentAccountId != null && parentAccountId !== goal.parentAccountId) {
        assertParent(parentAccountId);
      }
      // Sem % do CDI não há de onde tirar rendimento: o lucro vira manual, a menos
      // que o usuário tenha pedido automático de propósito (aí é erro).
      let profitMode = input.profitMode ?? goal.profitMode;
      if (profitMode === "auto" && input.cdiPercent == null) {
        if (input.profitMode === "auto") {
          throw new LedgerError("Lucro automático precisa do percentual do CDI");
        }
        profitMode = "manual";
      }
      if (goal.mode === "account" && goal.accountId != null) {
        db.prepare("UPDATE accounts SET name = ?, color = ? WHERE id = ?").run(
          input.name,
          input.color,
          goal.accountId
        );
      }
      return db
        .prepare(
          `UPDATE goals SET name=@name, target_amount_cents=@targetAmountCents,
           target_date=@targetDate, cdi_percent=@cdiPercent, profit_mode=@profitMode,
           color=@color, icon=@icon, parent_account_id=@parentAccountId
           WHERE id=@id`
        )
        .run({
          id,
          parentAccountId,
          profitMode,
          name: input.name,
          targetAmountCents: input.targetAmountCents ?? null,
          targetDate: input.targetDate ?? null,
          cdiPercent: input.cdiPercent ?? null,
          color: input.color,
          icon: input.icon ?? null
        }).changes;
    },

    archive: (id: number): number =>
      db.prepare("UPDATE goals SET archived = 1 WHERE id = ?").run(id).changes,

    /** Só apaga sem nenhum movimento; havendo movimento, arquiva. */
    remove: (id: number): { removed: boolean } => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      const moves =
        goal.accountId == null
          ? 0
          : (
              db
                .prepare("SELECT COUNT(*) AS n FROM entries WHERE account_id = ?")
                .get(goal.accountId) as { n: number }
            ).n;
      const allocations = (
        db
          .prepare("SELECT COUNT(*) AS n FROM goal_allocations WHERE goal_id = ?")
          .get(id) as { n: number }
      ).n;

      if (moves > 0 || allocations > 0) {
        repository.archive(id);
        return { removed: false };
      }
      return db.transaction(() => {
        db.prepare("DELETE FROM goals WHERE id = ?").run(id);
        if (goal.accountId != null) {
          db.prepare("DELETE FROM accounts WHERE id = ?").run(goal.accountId);
        }
        return { removed: true };
      })();
    },

    /**
     * Guardar é transferência com `purpose='goal_deposit'` (D20, D21): sai da
     * conta atrelada (ou da escolhida) e entra na caixinha.
     */
    deposit: (
      id: number,
      input: { amountCents: number; date: string; fromAccountId?: number; description?: string | null }
    ) => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      if (goal.mode !== "account" || goal.accountId == null) {
        throw new LedgerError("Deposito so existe em caixinha com conta propria");
      }
      const fromAccountId = input.fromAccountId ?? goal.parentAccountId;
      if (fromAccountId == null) throw new LedgerError("Atrele a caixinha a uma conta antes de guardar");
      return entries.createTransfer({
        fromAccountId,
        toAccountId: goal.accountId,
        date: input.date,
        amountCents: input.amountCents,
        purpose: "goal_deposit",
        description: input.description || `Guardado · ${goal.name}`
      });
    },

    withdraw: (
      id: number,
      input: { amountCents: number; date: string; toAccountId?: number; description?: string | null }
    ) => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      if (goal.mode !== "account" || goal.accountId == null) {
        throw new LedgerError("Saque so existe em caixinha com conta propria");
      }
      const toAccountId = input.toAccountId ?? goal.parentAccountId;
      if (toAccountId == null) throw new LedgerError("Atrele a caixinha a uma conta antes de resgatar");
      return entries.createTransfer({
        fromAccountId: goal.accountId,
        toAccountId,
        date: input.date,
        amountCents: input.amountCents,
        purpose: "goal_withdrawal",
        description: input.description || `Resgate · ${goal.name}`
      });
    },

    /**
     * Lucro lançado pelo usuário, quando quiser. Entra no saldo como lucro: não
     * conta como dinheiro que ele pôs, e o percentual da caixinha o inclui.
     */
    addProfit: (
      id: number,
      input: { amountCents: number; date: string; description?: string | null }
    ) =>
      db.transaction(() => {
        const goal = repository.get(id);
        if (!goal) throw notFound("Caixinha");
        if (goal.mode !== "account" || goal.accountId == null) {
          throw new LedgerError("Lucro so existe em caixinha com conta propria");
        }
        if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
          throw new LedgerError("Informe um lucro maior que zero; para diminuir, ajuste o lucro");
        }
        if (input.date > today()) {
          throw new LedgerError("O lucro é de um dia que já passou ou de hoje");
        }
        const category = db
          .prepare("SELECT id FROM categories WHERE name = 'Rendimentos' AND kind = 'income'")
          .get() as { id: number } | undefined;
        const note = input.description?.trim();
        const entryId = entries.createInternal({
          accountId: goal.accountId,
          date: input.date,
          amountCents: input.amountCents,
          kind: "income",
          status: "cleared",
          categoryId: category?.id ?? null,
          description: note ? `Lucro · ${note}` : "Lucro lançado",
          goalProfit: "profit",
          countsTowardTarget: false,
          tagIds: []
        });
        return { entryId };
      })(),

    /**
     * "O lucro total desta caixinha é X." Lança a diferença como ajuste de lucro,
     * para mais ou para menos, e o saldo passa a ser o que o banco mostra.
     * Repetir com o mesmo valor não faz nada.
     */
    adjustProfit: (id: number, input: { totalCents: number; date?: string }, asOf: string = today()) =>
      db.transaction(() => {
        const goal = repository.get(id);
        if (!goal) throw notFound("Caixinha");
        if (goal.mode !== "account" || goal.accountId == null) {
          throw new LedgerError("Lucro so existe em caixinha com conta propria");
        }
        if (!Number.isInteger(input.totalCents)) throw new LedgerError("Informe o lucro total");
        const date = input.date ?? asOf;
        if (date > asOf) throw new LedgerError("O ajuste é de um dia que já passou ou de hoje");
        const delta = input.totalCents - profitTotal(goal, asOf);
        if (delta === 0) return { entryId: null as number | null, deltaCents: 0 };
        const entryId = entries.createInternal({
          accountId: goal.accountId,
          date,
          amountCents: delta,
          kind: "adjustment",
          status: "cleared",
          categoryId: null,
          description: "Ajuste de lucro",
          goalProfit: "profit_adjust",
          countsTowardTarget: false,
          tagIds: []
        });
        return { entryId: entryId as number | null, deltaCents: delta };
      })(),

    /**
     * Marcação: amarra a caixinha a um lançamento.
     *
     * **Invariante validada dentro da transação:** a soma das alocações de
     * **todas** as caixinhas que marcam a mesma conta nunca pode passar do saldo
     * atual dela. Ultrapassar desfaz tudo e informa o disponível.
     */
    allocate: (id: number, entryId: number, amountCents: number) =>
      db.transaction(() => {
        const goal = repository.get(id);
        if (!goal) throw notFound("Caixinha");
        if (goal.mode !== "earmark") {
          throw new LedgerError("Alocacao so existe em caixinha de marcacao");
        }
        db.prepare(
          `INSERT INTO goal_allocations(goal_id, entry_id, amount_cents) VALUES (?, ?, ?)
           ON CONFLICT(goal_id, entry_id) DO UPDATE SET amount_cents = excluded.amount_cents`
        ).run(id, entryId, amountCents);

        const available = repository.freeBalance(goal.accountId!);
        if (available < 0) {
          throw new LedgerError(
            `As marcacoes passam do saldo da conta em ${Math.abs(available)} centavos`
          );
        }
        return { ok: true as const, freeBalanceCents: available };
      })(),

    /**
     * Marcação por valor: separa (`delta` > 0) ou libera (`delta` < 0) parte do
     * saldo da conta, sem o usuário escolher lançamento.
     *
     * A alocação continua presa a um lançamento, como o esquema pede: separar
     * soma no último dinheiro que entrou na conta; liberar tira das alocações
     * mais recentes primeiro. A mesma invariante do `allocate` vale no fim.
     */
    mark: (id: number, deltaCents: number) =>
      db.transaction(() => {
        const goal = repository.get(id);
        if (!goal) throw notFound("Caixinha");
        if (goal.mode !== "earmark" || goal.accountId == null) {
          throw new LedgerError("Separar valor so existe em caixinha de marcacao");
        }
        if (!Number.isInteger(deltaCents) || deltaCents === 0) {
          throw new LedgerError("Informe um valor para separar ou liberar");
        }

        if (deltaCents > 0) {
          const anchor = db
            .prepare(
              `SELECT id FROM entries
               WHERE account_id = ? AND amount_cents > 0 AND date <= ?
                 AND status IN ('cleared','reconciled')
               ORDER BY date DESC, id DESC LIMIT 1`
            )
            .get(goal.accountId, today()) as { id: number } | undefined;
          if (!anchor) {
            throw new LedgerError("A conta ainda nao recebeu dinheiro para separar");
          }
          db.prepare(
            `INSERT INTO goal_allocations(goal_id, entry_id, amount_cents) VALUES (?, ?, ?)
             ON CONFLICT(goal_id, entry_id) DO UPDATE SET amount_cents = amount_cents + excluded.amount_cents`
          ).run(id, anchor.id, deltaCents);
        } else {
          const allocations = db
            .prepare(
              `SELECT ga.entry_id AS entryId, ga.amount_cents AS amountCents
               FROM goal_allocations ga JOIN entries e ON e.id = ga.entry_id
               WHERE ga.goal_id = ? ORDER BY e.date DESC, e.id DESC`
            )
            .all(id) as { entryId: number; amountCents: number }[];
          const marked = allocations.reduce((sum, row) => sum + row.amountCents, 0);
          if (marked < -deltaCents) {
            throw new LedgerError(`A caixinha so tem R$ ${(marked / 100).toFixed(2).replace(".", ",")} separados`);
          }
          let remaining = -deltaCents;
          for (const row of allocations) {
            if (remaining <= 0) break;
            const take = Math.min(row.amountCents, remaining);
            remaining -= take;
            if (take === row.amountCents) {
              db.prepare("DELETE FROM goal_allocations WHERE goal_id = ? AND entry_id = ?").run(
                id,
                row.entryId
              );
            } else {
              db.prepare(
                "UPDATE goal_allocations SET amount_cents = amount_cents - ? WHERE goal_id = ? AND entry_id = ?"
              ).run(take, id, row.entryId);
            }
          }
        }

        const available = repository.freeBalance(goal.accountId);
        // Liberar sempre pode: é o que conserta uma conta que ficou curta.
        if (deltaCents > 0 && available < 0) {
          throw new LedgerError(
            `Falta saldo livre na conta: passaria em R$ ${(Math.abs(available) / 100).toFixed(2).replace(".", ",")}`
          );
        }
        return { ok: true as const, freeBalanceCents: available };
      })(),

    deallocate: (id: number, entryId: number) =>
      db.prepare("DELETE FROM goal_allocations WHERE goal_id = ? AND entry_id = ?").run(id, entryId)
        .changes,

    /**
     * Saldo livre de uma conta: saldo atual menos tudo que está marcado. Sem
     * isso o usuário soma a caixinha ao saldo e conta o mesmo dinheiro duas
     * vezes.
     */
    freeBalance: (accountId: number, asOf: string = today()): number => {
      const balance = (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries
             WHERE account_id = ? AND date <= ? AND status IN ('cleared','reconciled')`
          )
          .get(accountId, asOf) as { total: number }
      ).total;
      const opening = (
        db.prepare("SELECT opening_balance_cents AS o FROM accounts WHERE id = ?").get(accountId) as
          | { o: number }
          | undefined
      )?.o;
      const allocated = (
        db
          .prepare(
            `SELECT COALESCE(SUM(ga.amount_cents), 0) AS total
             FROM goal_allocations ga JOIN goals g ON g.id = ga.goal_id
             WHERE g.account_id = ? AND g.archived = 0`
          )
          .get(accountId) as { total: number }
      ).total;
      return (opening ?? 0) + balance - allocated;
    },

    /** Quanto cada conta tem separado em caixinhas de marcação, por id da conta. */
    earmarkedByAccount: (): Map<number, number> =>
      new Map(
        (
          db
            .prepare(
              `SELECT g.account_id AS accountId, COALESCE(SUM(ga.amount_cents), 0) AS total
               FROM goal_allocations ga JOIN goals g ON g.id = ga.goal_id
               WHERE g.mode = 'earmark' AND g.account_id IS NOT NULL AND g.archived = 0
               GROUP BY g.account_id`
            )
            .all() as { accountId: number; total: number }[]
        ).map((row) => [row.accountId, row.total])
      ),

    /**
     * Quanto está guardado nas caixinhas atreladas a cada conta, por id da
     * conta. Fica fora do saldo dela: é o "Em caixinhas" ao lado do saldo.
     */
    savedByParentAccount: (asOf: string = today()): Map<number, number> =>
      new Map(
        (
          db
            .prepare(
              `SELECT g.parent_account_id AS accountId, COALESCE(SUM(e.amount_cents), 0) AS total
               FROM goals g JOIN entries e ON e.account_id = g.account_id
               WHERE g.mode = 'account' AND g.parent_account_id IS NOT NULL AND g.archived = 0
                 AND e.date <= ? AND e.status IN ('cleared','reconciled')
               GROUP BY g.parent_account_id`
            )
            .all(asOf) as { accountId: number; total: number }[]
        ).map((row) => [row.accountId, row.total])
      ),

    progress: (id: number, asOf: string = today()): GoalProgress => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");

      const balanceCents = balanceOf(goal, asOf);
      const base = goalProgress({
        balanceCents,
        targetAmountCents: goal.targetAmountCents,
        targetDate: goal.targetDate,
        asOf
      });

      const lots = goal.cdiPercent != null ? lotsOf(goal) : [];
      const firstDate = lots[0]?.startDate ?? asOf;
      const accrual =
        goal.cdiPercent != null
          ? accrueLots({
              lots,
              rates: ratesBetween(firstDate, asOf),
              cdiPercent: goal.cdiPercent,
              from: firstDate,
              to: asOf,
              holidays: holidaySet()
            })
          : null;

      // O resgate hipotético usa o rendimento REALIZADO: projeção não se paga
      // imposto sobre o que ainda não aconteceu.
      const redemption = estimateRedemption({
        asOf,
        lots: (accrual?.lots ?? []).map((lot) => ({
          principalCents: lot.principalCents,
          startDate: lot.startDate,
          yieldCents: lot.realizedYieldCents
        }))
      });

      const newest = lots.filter((lot) => !(lot as { isYield?: boolean }).isYield).at(-1);
      const iofFree = newest ? iofFreeDate(newest.startDate) : null;

      const history = historyOf(goal, balanceCents);
      const pending = (() => {
        const next = goal.cdiPercent != null ? nextAccrualDate(goal) : null;
        const through = next ? addDays(next, -1) : null;
        if (goal.cdiPercent == null || lots.length === 0) {
          return { through, projected: 0, projectedThrough: null as string | null };
        }
        const from = next ?? lots[0]!.startDate;
        if (from > asOf) return { through, projected: 0, projectedThrough: null as string | null };
        const result = accrueLots({
          lots,
          rates: ratesBetween(from, asOf),
          cdiPercent: goal.cdiPercent,
          from,
          to: asOf,
          holidays: holidaySet()
        });
        return {
          through: result.realizedThroughDate ?? through,
          projected: result.projectedYieldCents + result.realizedYieldCents,
          projectedThrough: result.projectedThroughDate ?? result.realizedThroughDate
        };
      })();

      // Depósito é transferência que entra na conta da caixinha. Na marcação a
      // conta é a do dia a dia, e toda entrada nela pareceria depósito.
      const depositsByMonth: Record<string, number> =
        goal.mode === "account" && goal.accountId != null
          ? Object.fromEntries(
              (
                db
                  .prepare(
                    `SELECT substr(date, 1, 7) AS month, COALESCE(SUM(amount_cents), 0) AS total
                     FROM entries WHERE account_id = ? AND amount_cents > 0 AND kind = 'transfer'
                     GROUP BY month`
                  )
                  .all(goal.accountId) as { month: string; total: number }[]
              ).map((row) => [row.month, row.total])
            )
          : {};

      // ~21 dias úteis no mês, com o fator do último dia conhecido. O
      // rendimento acumulado dos lotes não serve: é o de toda a vida da
      // caixinha, e compô-lo todo mês adiantava a data estimada em anos.
      const lastRate =
        goal.cdiPercent != null
          ? (db
              .prepare(
                `SELECT date, daily_factor AS dailyRatePercent FROM cdi_rates
                 WHERE date <= ? ORDER BY date DESC LIMIT 1`
              )
              .get(asOf) as CdiRate | undefined)
          : undefined;

      const projection = projectCompletion({
        balanceCents,
        targetAmountCents: goal.targetAmountCents,
        depositsByMonth,
        monthlyYieldFactor:
          goal.cdiPercent != null && lastRate
            ? dayFactor(lastRate, goal.cdiPercent) ** BUSINESS_DAYS_PER_MONTH
            : 1,
        asOf
      });

      return {
        ...goal,
        balanceCents,
        ...base,
        ...history,
        profit: profitOf(goal, history, asOf),
        // O rendimento já está no saldo (lançado ou separado sozinho); aqui só
        // o que ainda falta: dias sem taxa publicada, nunca somados ao saldo.
        realizedYieldCents: history.yieldCents,
        realizedThroughDate: pending.through,
        projectedYieldCents: pending.projected,
        projectedThroughDate: pending.projectedThrough,
        grossCents: balanceCents,
        iofCents: redemption.iofCents,
        irCents: redemption.irCents,
        netCents: balanceCents - redemption.iofCents - redemption.irCents,
        iofFreeFrom: iofFree && iofFree > asOf ? iofFree : null,
        projection
      };
    },

    /**
     * Deixa o rendimento da caixinha em dia. Roda sozinho a cada leitura e
     * no agendador: ninguém precisa lembrar de lançar.
     *
     * - **Conta própria:** o rendimento é um `income` "Rendimento CDI" na conta
     *   da caixinha — é dinheiro de verdade no banco. Antes de apurar, refaz o
     *   que ficou errado: rendimento calculado antes de um depósito que chegou
     *   depois com data anterior sai, e cada correção volta a fechar no saldo
     *   real informado.
     * - **Marcação:** quem paga o CDI é o banco, e o dinheiro chega na conta
     *   pelo extrato. A caixinha só **separa** a parte dela (alocação), sem
     *   lançar entrada nenhuma — lançar contaria o rendimento duas vezes.
     *
     * Só dia com taxa publicada vira valor; projeção nunca.
     */
    accrue: (id: number, through: string = today()): { entryId: number | null; cents: number } =>
      db.transaction((): { entryId: number | null; cents: number } => {
        const goal = repository.get(id);
        if (!goal) throw notFound("Caixinha");
        if (goal.accountId == null) return { entryId: null, cents: 0 };
        if (goal.mode === "account") reconcileAccountGoal(goal);
        // Manual: o lucro entra quando o usuário lança, nunca sozinho.
        if (goal.cdiPercent == null || goal.profitMode === "manual") return { entryId: null, cents: 0 };

        const lots = lotsOf(goal);
        if (lots.length === 0) return { entryId: null, cents: 0 };
        const from = nextAccrualDate(goal) ?? lots[0]!.startDate;
        if (from > through) return { entryId: null, cents: 0 };

        const accrual = accrueLots({
          lots,
          rates: ratesBetween(from, through),
          cdiPercent: goal.cdiPercent,
          from,
          to: through,
          holidays: holidaySet()
        });
        if (accrual.realizedYieldCents <= 0 || accrual.realizedThroughDate == null) {
          return { entryId: null, cents: 0 };
        }

        if (goal.mode === "earmark") {
          const anchor = earmarkAnchor(goal.accountId);
          if (!anchor) return { entryId: null, cents: 0 };
          db.prepare(
            `INSERT INTO goal_allocations(goal_id, entry_id, amount_cents) VALUES (?, ?, ?)
             ON CONFLICT(goal_id, entry_id) DO UPDATE SET amount_cents = amount_cents + excluded.amount_cents`
          ).run(goal.id, anchor, accrual.realizedYieldCents);
          db.prepare(
            `UPDATE goals SET cdi_accrued_through = ?, cdi_yield_cents = cdi_yield_cents + ?
             WHERE id = ?`
          ).run(accrual.realizedThroughDate, accrual.realizedYieldCents, goal.id);
          return { entryId: null, cents: accrual.realizedYieldCents };
        }

        const category = db
          .prepare("SELECT id FROM categories WHERE name = 'Rendimentos' AND kind = 'income'")
          .get() as { id: number } | undefined;
        const entryId = entries.createInternal({
          accountId: goal.accountId,
          date: accrual.realizedThroughDate,
          amountCents: accrual.realizedYieldCents,
          kind: "income",
          status: "cleared",
          categoryId: category?.id ?? null,
          description: `Rendimento CDI · ${from} a ${accrual.realizedThroughDate}`,
          goalProfit: "yield",
          countsTowardTarget: false,
          tagIds: []
        });
        return { entryId, cents: accrual.realizedYieldCents };
      })(),

    /**
     * "O saldo real desta caixinha era X no fim do dia D." O rendimento
     * depois de D é refeito a partir de X.
     *
     * - Conta própria: um ajuste na conta da caixinha fecha o saldo em X, e a
     *   correção guarda X para refazer o ajuste se um depósito com data
     *   anterior chegar depois. Corrigir o mesmo dia de novo troca o valor.
     * - Marcação: o separado passa a ser X (separa ou libera a diferença).
     */
    correct: (id: number, input: { date: string; valueCents: number }, asOf: string = today()) =>
      db.transaction(() => {
        const goal = repository.get(id);
        if (!goal) throw notFound("Caixinha");
        if (goal.accountId == null) throw new LedgerError("Caixinha sem conta");
        if (input.date > asOf) throw new LedgerError("A correcao e de um dia que ja passou ou de hoje");
        if (!Number.isInteger(input.valueCents) || input.valueCents < 0) {
          throw new LedgerError("Informe o saldo real da caixinha");
        }

        if (goal.mode === "earmark") {
          const delta = input.valueCents - balanceOf(goal, asOf);
          if (delta !== 0) repository.mark(id, delta);
          if (goal.cdiPercent != null) {
            db.prepare("UPDATE goals SET cdi_accrued_through = ? WHERE id = ?").run(input.date, id);
          }
        } else {
          // Rendimento depois do dia corrigido foi calculado sobre o saldo
          // errado: sai e é refeito a partir do valor real.
          db.prepare(
            `DELETE FROM entries WHERE account_id = ? AND goal_profit = 'yield' AND date > ?`
          ).run(goal.accountId, input.date);
          const sameDay = db
            .prepare("SELECT entry_id AS entryId FROM goal_corrections WHERE goal_id = ? AND date = ?")
            .get(id, input.date) as { entryId: number } | undefined;
          if (sameDay) db.prepare("DELETE FROM entries WHERE id = ?").run(sameDay.entryId);
          const entryId = entries.createInternal({
            accountId: goal.accountId,
            date: input.date,
            amountCents: 0,
            kind: "adjustment",
            status: "cleared",
            categoryId: null,
            description: "Correção: saldo conferido",
            countsTowardTarget: false,
            tagIds: []
          });
          db.prepare(
            `INSERT INTO goal_corrections(goal_id, entry_id, date, target_cents, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, entryId, input.date, input.valueCents, nowIso());
          reconcileAccountGoal(goal);
        }
        repository.accrue(id, asOf);
        return repository.progress(id, asOf);
      })()
  };

  /** A conta atrelada guarda dinheiro do dia a dia: nunca cartão, caixinha ou a ponte. */
  function assertParent(accountId: number) {
    const row = db.prepare("SELECT kind FROM accounts WHERE id = ?").get(accountId) as
      | { kind: string }
      | undefined;
    if (!row) throw notFound("Conta atrelada");
    if (row.kind === "credit_card" || row.kind === "goal" || row.kind === "investment") {
      throw new LedgerError("A caixinha so pode ficar atrelada a uma conta de dinheiro");
    }
  }

  /** Última entrada de dinheiro da conta: onde a marcação se prende. */
  function earmarkAnchor(accountId: number): number | null {
    const row = db
      .prepare(
        `SELECT id FROM entries
         WHERE account_id = ? AND amount_cents > 0 AND date <= ?
           AND status IN ('cleared','reconciled')
         ORDER BY date DESC, id DESC LIMIT 1`
      )
      .get(accountId, today()) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /**
   * Primeiro dia que ainda falta apurar: o dia seguinte ao último rendimento
   * ou à última correção (que já inclui o que rendeu até ela). `null` quando
   * nunca rendeu: começa no primeiro aporte.
   */
  function nextAccrualDate(goal: GoalRecord): string | null {
    const next = (date: string | null) => (date ? addDays(date, 1) : null);
    if (goal.mode === "earmark") {
      const row = db.prepare("SELECT cdi_accrued_through AS through FROM goals WHERE id = ?").get(goal.id) as
        | { through: string | null }
        | undefined;
      return next(row?.through ?? null);
    }
    const last = (
      db
        .prepare(
          `SELECT MAX(date) AS last FROM (
             SELECT date FROM entries
             WHERE account_id = ? AND goal_profit = 'yield'
             UNION ALL
             SELECT date FROM goal_corrections WHERE goal_id = ?
           )`
        )
        .get(goal.accountId, goal.id) as { last: string | null }
    ).last;
    return next(last);
  }

  /**
   * Conta própria: tira o rendimento calculado antes de um depósito que chegou
   * depois com data anterior, e refaz cada correção para fechar no saldo real.
   * "Chegou depois" é a ordem de gravação (`id`), que não empata como dois
   * `created_at` no mesmo milissegundo.
   */
  function reconcileAccountGoal(goal: GoalRecord) {
    if (goal.accountId == null) return;
    const late = db
      .prepare(
        `SELECT MIN(d.date) AS since FROM entries d
         WHERE d.account_id = @account AND d.kind <> 'adjustment' AND d.goal_profit IS NULL
           AND EXISTS (
             SELECT 1 FROM entries y
             WHERE y.account_id = @account AND y.goal_profit = 'yield'
               AND y.date >= d.date AND y.id < d.id
           )`
      )
      .get({ account: goal.accountId }) as { since: string | null };
    if (late.since) {
      db.prepare(
        `DELETE FROM entries WHERE account_id = ? AND goal_profit = 'yield' AND date >= ?`
      ).run(goal.accountId, late.since);
    }

    const opening =
      (
        db.prepare("SELECT opening_balance_cents AS o FROM accounts WHERE id = ?").get(goal.accountId) as
          | { o: number }
          | undefined
      )?.o ?? 0;
    const corrections = db
      .prepare(
        `SELECT entry_id AS entryId, date, target_cents AS targetCents
         FROM goal_corrections WHERE goal_id = ? ORDER BY date, id`
      )
      .all(goal.id) as { entryId: number; date: string; targetCents: number }[];
    for (const correction of corrections) {
      const before = (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries
             WHERE account_id = ? AND date <= ? AND id <> ?
               AND status IN ('cleared','reconciled')`
          )
          .get(goal.accountId, correction.date, correction.entryId) as { total: number }
      ).total;
      db.prepare("UPDATE entries SET amount_cents = ?, updated_at = ? WHERE id = ?").run(
        correction.targetCents - opening - before,
        nowIso(),
        correction.entryId
      );
    }
  }

  /** Lucro total no saldo até a data: rendimento, lucro lançado, ajustes e correções. */
  function profitTotal(goal: GoalRecord, asOf: string): number {
    if (goal.accountId == null) return 0;
    return (
      db
        .prepare(
          `SELECT COALESCE(SUM(e.amount_cents), 0) AS total FROM entries e
           WHERE e.account_id = @account AND e.date <= @asOf
             AND e.status IN ('cleared','reconciled')
             AND (${IS_PROFIT_SQL}
                  OR e.id IN (SELECT entry_id FROM goal_corrections WHERE goal_id = @goal))`
        )
        .get({ account: goal.accountId, asOf, goal: goal.id }) as { total: number }
    ).total;
  }

  /** Lucro em reais, em % até agora e em % ao ano projetado (função pura em finance). */
  function profitOf(
    goal: GoalRecord,
    history: { yieldCents: number; correctionCents: number },
    asOf: string
  ) {
    const shape = (metrics: ReturnType<typeof profitMetrics>) => ({
      cents: metrics.profitCents,
      depositedCents: metrics.depositedCents,
      averageCapitalCents: metrics.averageCapitalCents,
      days: metrics.days,
      percent: metrics.periodPercent,
      annualPercent: metrics.annualPercent,
      shortHistory: metrics.shortHistory
    });
    if (goal.mode !== "account" || goal.accountId == null) {
      // Marcação (só dado antigo): o rendimento separado, sem base de capital.
      return shape({
        ...profitMetrics({ events: [], asOf }),
        profitCents: history.yieldCents + history.correctionCents
      });
    }
    const rows = db
      .prepare(
        `SELECT e.date, e.amount_cents AS cents,
                (${IS_PROFIT_SQL}
                 OR e.id IN (SELECT entry_id FROM goal_corrections WHERE goal_id = ?)) AS profit
         FROM entries e
         WHERE e.account_id = ? AND e.status IN ('cleared','reconciled')
         ORDER BY e.date, e.id`
      )
      .all(goal.id, goal.accountId) as { date: string; cents: number; profit: number }[];
    const events: ProfitEvent[] = rows.map((row) => ({
      date: row.date,
      cents: row.cents,
      profit: row.profit === 1
    }));
    return shape(profitMetrics({ events, asOf }));
  }

  /**
   * O extrato resumido: quanto você colocou, quanto rendeu e quanto foi
   * corrigido. Soma sempre o saldo.
   */
  function historyOf(goal: GoalRecord, balanceCents: number) {
    if (goal.mode === "earmark") {
      const row = db.prepare("SELECT cdi_yield_cents AS y FROM goals WHERE id = ?").get(goal.id) as
        | { y: number }
        | undefined;
      const yieldCents = Math.min(row?.y ?? 0, Math.max(balanceCents, 0));
      return { contributedCents: balanceCents - yieldCents, yieldCents, correctionCents: 0 };
    }
    const sum = (sql: string, ...params: unknown[]) =>
      (db.prepare(sql).get(...params) as { total: number }).total;
    const yieldCents = sum(
      `SELECT COALESCE(SUM(e.amount_cents), 0) AS total FROM entries e
       WHERE e.account_id = ? AND ${IS_PROFIT_SQL}`,
      goal.accountId
    );
    const correctionCents = sum(
      `SELECT COALESCE(SUM(e.amount_cents), 0) AS total FROM entries e
       JOIN goal_corrections c ON c.entry_id = e.id
       WHERE e.account_id = ? AND c.goal_id = ?`,
      goal.accountId,
      goal.id
    );
    return { contributedCents: balanceCents - yieldCents - correctionCents, yieldCents, correctionCents };
  }

  return repository;
}
