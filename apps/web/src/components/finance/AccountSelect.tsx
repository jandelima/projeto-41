import { useEffect, useState } from "react";
import type { AccountRecord } from "@projeto41/contracts";
import { api } from "../../lib/api.js";
import { moneyFromCents } from "../../lib/format.js";

/**
 * Seletor de conta do livro, agrupado por pessoa.
 *
 * Mostra o saldo ao lado do nome porque a pergunta que o usuário faz ao
 * escolher a conta é "tem dinheiro aí?". A fase 5 reaproveita este componente.
 */
export function AccountSelect({
  value,
  onChange,
  allowNone = false,
  noneLabel = "Não movimentar caixa",
  exclude = []
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  /** Tipos que não fazem sentido no contexto (cartão numa compra de ação). */
  exclude?: string[];
}) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);

  useEffect(() => {
    void api<AccountRecord[]>("/ledger/accounts")
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  const usable = accounts.filter((account) => !exclude.includes(account.kind));
  const firstUsable = usable[0]?.id ?? null;

  // Sem "nenhuma", o navegador mostra a primeira conta como escolhida mesmo
  // com o valor vazio: o formulário parecia pronto e o servidor recusava por
  // falta de conta. O valor passa a ser o que a tela mostra.
  useEffect(() => {
    if (!allowNone && value == null && firstUsable != null) onChange(firstUsable);
  }, [allowNone, value, firstUsable, onChange]);
  const groups = new Map<string, AccountRecord[]>();
  for (const account of usable) {
    const key = account.personName ?? "Sem pessoa";
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }

  return (
    <select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
    >
      {allowNone && <option value="">{noneLabel}</option>}
      {[...groups.entries()].map(([person, items]) => (
        <optgroup key={person} label={person}>
          {items.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {moneyFromCents(account.currentBalanceCents)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
