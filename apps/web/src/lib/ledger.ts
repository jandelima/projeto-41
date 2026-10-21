import { useCallback, useEffect, useState } from "react";
import type {
  AccountRecord,
  BalancesResult,
  CategoryRecord,
  EntryFilter,
  EntryListResult,
  EntryRecord,
  PersonRecord,
  GoalRecord,
  PlaceRecord,
  SeriesScope,
  TagRecord
} from "@projeto41/contracts";
import { api } from "./api.js";

/**
 * Cliente do modulo de financas.
 *
 * Os cadastros mudam pouco e sao usados por todas as telas, entao ficam num
 * unico hook carregado uma vez e recarregado sob demanda depois de uma mutacao.
 */

export type LedgerReference = {
  people: PersonRecord[];
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  tags: TagRecord[];
  goals: GoalRecord[];
};

const EMPTY_REFERENCE: LedgerReference = {
  people: [],
  accounts: [],
  categories: [],
  tags: [],
  goals: []
};

export function useLedgerReference() {
  const [data, setData] = useState<LedgerReference>(EMPTY_REFERENCE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setError("");
      const [people, accounts, categories, tags, goals] = await Promise.all([
        api<PersonRecord[]>("/ledger/people"),
        api<AccountRecord[]>("/ledger/accounts"),
        api<CategoryRecord[]>("/ledger/categories"),
        api<TagRecord[]>("/ledger/tags"),
        api<GoalRecord[]>("/ledger/goals")
      ]);
      setData({ people, accounts, categories, tags, goals });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar cadastros");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, loading, error, reload };
}

/** Converte o filtro em query string, omitindo o que esta vazio. */
export function filterToQuery(filter: Partial<EntryFilter>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      // A chave repetida e o formato que `entryFilterSchema` entende.
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const ledgerApi = {
  entries: (filter: Partial<EntryFilter>) =>
    api<EntryListResult>(`/ledger/entries${filterToQuery(filter)}`),

  balances: () => api<BalancesResult>("/ledger/balances"),

  createEntry: (body: unknown) =>
    api<{ id: number; entry: EntryRecord; balances: BalancesResult }>("/ledger/entries", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  /** `scope` so tem efeito quando o lancamento pertence a um plano de parcelas. */
  updateEntry: (id: number, body: unknown, scope: SeriesScope = "one") =>
    api<{ ok: true; entry: EntryRecord; balances: BalancesResult }>(
      `/ledger/entries/${id}?scope=${scope}`,
      { method: "PUT", body: JSON.stringify(body) }
    ),

  removeEntry: (id: number) =>
    api<{ ok: true; balances: BalancesResult }>(`/ledger/entries/${id}`, { method: "DELETE" }),

  createTransfer: (body: unknown) =>
    api<{ fromEntryId: number; toEntryId: number; balances: BalancesResult }>(
      "/ledger/transfers",
      { method: "POST", body: JSON.stringify(body) }
    ),

  setStatus: (ids: number[], status: "pending" | "cleared" | "reconciled") =>
    api<{ ok: true; changed: number; balances: BalancesResult }>("/ledger/entries/status", {
      method: "POST",
      body: JSON.stringify({ ids, status })
    }),

  searchPlaces: (search: string) =>
    api<PlaceRecord[]>(`/ledger/places${search ? `?search=${encodeURIComponent(search)}` : ""}`),

  createPlace: (name: string, defaultCategoryId?: number | null) =>
    api<{ id: number; place: PlaceRecord }>("/ledger/places", {
      method: "POST",
      body: JSON.stringify({ name, defaultCategoryId: defaultCategoryId ?? null })
    }),

  createTag: (name: string, color: string) =>
    api<{ id: number; tags: TagRecord[] }>("/ledger/tags", {
      method: "POST",
      body: JSON.stringify({ name, color })
    }),

  /**
   * Upload de foto. Vai como `multipart/form-data`, entao o `Content-Type`
   * fica por conta do browser: defini-lo a mao quebra o boundary.
   */
  uploadPhoto: async (entryId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/ledger/entries/${entryId}/attachments`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      if (response.status === 413) throw new Error("Foto maior que o limite de 15 MB");
      const body = await response.json().catch(() => ({ error: "Falha ao enviar a foto" }));
      throw new Error(body.error ?? "Falha ao enviar a foto");
    }
    return (await response.json()) as { attachment: { id: number }; entry: EntryRecord };
  },

  removePhoto: (id: number) => api<{ ok: true }>(`/attachments/${id}`, { method: "DELETE" })
};

export const attachmentUrl = (id: number) => `/api/attachments/${id}`;
export const attachmentThumbUrl = (id: number) => `/api/attachments/${id}/thumb`;

export const ACCOUNT_KIND_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  // Só para contas antigas que ainda não passaram pela migração 011.
  savings: "Conta corrente",
  cash: "Dinheiro",
  meal_voucher: "Vale-refeição",
  credit_card: "Cartão de crédito",
  investment: "Investimento",
  goal: "Caixinha"
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  cleared: "Pago",
  reconciled: "Conciliado"
};

/** Pix e débito viraram dinheiro (migração 011): à vista ou crédito. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Dinheiro",
  credit: "Crédito",
  voucher: "Vale",
  other: "Outro"
};

/**
 * Onde o dinheiro de fato mora: conta corrente, dinheiro vivo e vale. Cartão
 * não é conta (é crédito de uma conta), caixinha tem tela própria e a ponte
 * dos investimentos só se move por aporte.
 */
export function isMoneyAccount(account: Pick<AccountRecord, "kind">): boolean {
  return account.kind !== "credit_card" && account.kind !== "goal" && account.kind !== "investment";
}

export const isCard = (account: Pick<AccountRecord, "kind">) => account.kind === "credit_card";
