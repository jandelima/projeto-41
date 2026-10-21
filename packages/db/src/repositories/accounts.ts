import type { AccountDraft, AccountRecord } from "@projeto41/contracts";
import { createBalancesRepository, type BalanceOptions } from "./balances.js";
import { countReferencing, notFound, nowIso, toBit, LedgerError, type Db } from "./shared.js";

export function createAccountsRepository(db: Db) {
  const balances = createBalancesRepository(db);

  function assertCardFields(account: AccountDraft) {
    if (account.kind !== "credit_card") return;
    if (account.closingDay == null || account.dueDay == null) {
      throw new LedgerError("Cartao precisa de dia de fechamento e de vencimento");
    }
  }

  const REFERENCES = {
    entries: "SELECT COUNT(*) AS n FROM entries WHERE account_id = ?",
    installmentPlans: "SELECT COUNT(*) AS n FROM installment_plans WHERE account_id = ?",
    paidCards: "SELECT COUNT(*) AS n FROM accounts WHERE payment_account_id = ?",
    goals: "SELECT COUNT(*) AS n FROM goals WHERE ? IN (account_id, parent_account_id)",
    operations: "SELECT COUNT(*) AS n FROM operations WHERE account_id = ?",
    importBatches: "SELECT COUNT(*) AS n FROM import_batches WHERE account_id = ?",
    importCounterparts: "SELECT COUNT(*) AS n FROM import_rows WHERE counterparty_account_id = ?"
  } as const;

  function referencesOf(id: number): Record<keyof typeof REFERENCES, number> {
    return Object.fromEntries(
      Object.entries(REFERENCES).map(([key, sql]) => [key, countReferencing(db, sql, id)])
    ) as Record<keyof typeof REFERENCES, number>;
  }

  const repository = {
    /**
     * Lista sempre com saldo atual e previsto embutidos: a UI nunca soma
     * lancamento no cliente.
     */
    list: (options: BalanceOptions = {}): AccountRecord[] => balances.all(options),

    get: (id: number, options: BalanceOptions = {}): AccountRecord | undefined =>
      balances.forAccount(id, options),

    create: (account: AccountDraft): number => {
      assertCardFields(account);
      return Number(
        db
          .prepare(
            `INSERT INTO accounts
             (person_id, name, kind, institution, color, icon, opening_balance_cents,
              opening_date, closing_day, due_day, credit_limit_cents, payment_account_id,
              include_in_net_worth, archived, sort_order, created_at)
             VALUES (@personId, @name, @kind, @institution, @color, @icon, @openingBalanceCents,
                     @openingDate, @closingDay, @dueDay, @creditLimitCents, @paymentAccountId,
                     @includeInNetWorth, @archived, @sortOrder, @createdAt)`
          )
          .run({
            personId: account.personId ?? null,
            name: account.name,
            kind: account.kind,
            institution: account.institution ?? null,
            color: account.color,
            icon: account.icon ?? null,
            openingBalanceCents: account.openingBalanceCents ?? 0,
            openingDate: account.openingDate ?? null,
            closingDay: account.closingDay ?? null,
            dueDay: account.dueDay ?? null,
            creditLimitCents: account.creditLimitCents ?? null,
            paymentAccountId: account.paymentAccountId ?? null,
            includeInNetWorth: toBit(account.includeInNetWorth, true),
            archived: toBit(account.archived, false),
            sortOrder: account.sortOrder ?? 0,
            createdAt: nowIso()
          }).lastInsertRowid
      );
    },

    update: (id: number, account: AccountDraft): number => {
      assertCardFields(account);
      if (account.paymentAccountId === id) {
        throw new LedgerError("Conta de pagamento nao pode ser o proprio cartao");
      }
      // Lancamento de cartao tem fatura e o das outras contas nao (4.2). Trocar
      // o tipo com historico deixaria linhas de um jeito numa conta do outro.
      const current = db.prepare("SELECT kind FROM accounts WHERE id = ?").get(id) as
        | { kind: AccountRecord["kind"] }
        | undefined;
      if (!current) throw notFound("Conta");
      const crossesCard =
        current.kind !== account.kind &&
        (current.kind === "credit_card" || account.kind === "credit_card");
      if (crossesCard && referencesOf(id).entries > 0) {
        throw new LedgerError(
          "Conta com lancamentos nao vira cartao, nem cartao vira conta: crie uma conta nova"
        );
      }
      const changes = db
        .prepare(
          `UPDATE accounts SET person_id=@personId, name=@name, kind=@kind,
           institution=@institution, color=@color, icon=@icon,
           opening_balance_cents=@openingBalanceCents, opening_date=@openingDate,
           closing_day=@closingDay, due_day=@dueDay, credit_limit_cents=@creditLimitCents,
           payment_account_id=@paymentAccountId, include_in_net_worth=@includeInNetWorth,
           archived=@archived, sort_order=@sortOrder
           WHERE id=@id`
        )
        .run({
          id,
          personId: account.personId ?? null,
          name: account.name,
          kind: account.kind,
          institution: account.institution ?? null,
          color: account.color,
          icon: account.icon ?? null,
          openingBalanceCents: account.openingBalanceCents ?? 0,
          openingDate: account.openingDate ?? null,
          closingDay: account.closingDay ?? null,
          dueDay: account.dueDay ?? null,
          creditLimitCents: account.creditLimitCents ?? null,
          paymentAccountId: account.paymentAccountId ?? null,
          includeInNetWorth: toBit(account.includeInNetWorth, true),
          archived: toBit(account.archived, false),
          sortOrder: account.sortOrder ?? 0
        }).changes;
      if (changes === 0) throw notFound("Conta");
      return changes;
    },

    archive: (id: number): number => {
      const changes = db.prepare("UPDATE accounts SET archived = 1 WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Conta");
      return changes;
    },

    /**
     * Conta em uso vira arquivada; apagar destruiria o historico. "Em uso" e
     * qualquer referencia sem cascata: lancamento, parcelamento, cartao que
     * paga por ela, caixinha, operacao de investimento ou importacao. Olhar so
     * os lancamentos deixava o DELETE esbarrar na chave estrangeira.
     */
    remove: (id: number): number => {
      const references = referencesOf(id);
      const used = Object.values(references).reduce((total, count) => total + count, 0);
      if (used > 0) {
        db.prepare("UPDATE accounts SET archived = 1 WHERE id = ?").run(id);
        return 0;
      }
      const changes = db.prepare("DELETE FROM accounts WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Conta");
      return changes;
    },

    /** Usado pelo repositorio de lancamentos para herdar pessoa e ciclo do cartao. */
    raw: (id: number) =>
      db
        .prepare(
          `SELECT id, person_id AS personId, kind, closing_day AS closingDay,
                  due_day AS dueDay, payment_account_id AS paymentAccountId,
                  credit_limit_cents AS creditLimitCents, name
           FROM accounts WHERE id = ?`
        )
        .get(id) as
        | {
            id: number;
            personId: number | null;
            kind: AccountRecord["kind"];
            closingDay: number | null;
            dueDay: number | null;
            paymentAccountId: number | null;
            creditLimitCents: number | null;
            name: string;
          }
        | undefined
  };

  return repository;
}
