import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine } from "lucide-react";
import { useState } from "react";
import type { AccountRecord, ManualPositionRecord } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { DateField } from "./datepicker.js";
import { Drawer } from "./dialog.js";
import { Button, Field } from "./ui.js";
import { api } from "../lib/api.js";
import { POSITION_CATEGORY_LABEL, isLiquid } from "../lib/cash.js";
import { currency, moneyFromCents, todayIso } from "../lib/format.js";
import { useToast } from "../lib/toast.js";

export type MoveMode = "deposit" | "withdraw" | "move";

const TITLE: Record<MoveMode, string> = {
  deposit: "Aportar",
  withdraw: "Resgatar",
  move: "Alocar em outra posição"
};

const SUBTITLE: Record<MoveMode, string> = {
  deposit: "Da conta bancária para uma posição de investimento",
  withdraw: "De uma posição de volta para a conta bancária",
  move: "De um caixa para outra posição, sem passar pelo banco"
};

/** Posições agrupadas pela classe, na ordem da tela de Caixa e renda fixa. */
function PositionOptions({ positions }: { positions: ManualPositionRecord[] }) {
  const groups = Object.keys(POSITION_CATEGORY_LABEL)
    .map((category) => ({
      category,
      items: positions.filter((position) => position.category === category)
    }))
    .filter((group) => group.items.length > 0);
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.category} label={POSITION_CATEGORY_LABEL[group.category]}>
          {group.items.map((position) => (
            <option key={position.id} value={position.id}>
              {position.name} · {currency(position.currentValue, position.currency)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/**
 * Aporte, resgate e movimento entre posições: os três caminhos do dinheiro
 * que não são compra nem venda. O servidor muda a posição e o livro juntos.
 */
export function PositionMoveDrawer({
  mode,
  positions,
  banks,
  initialPositionId,
  onClose,
  onDone
}: {
  mode: MoveMode;
  positions: ManualPositionRecord[];
  banks: AccountRecord[];
  initialPositionId?: number | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  // Mover sai de um caixa; aporte e resgate valem para qualquer posição.
  const sources = mode === "move" ? positions.filter(isLiquid) : positions;
  const [positionId, setPositionId] = useState<number | null>(
    initialPositionId ?? sources[0]?.id ?? null
  );
  const targets = positions.filter((position) => position.id !== positionId);
  const [targetId, setTargetId] = useState<number | null>(
    targets.find((position) => !isLiquid(position))?.id ?? targets[0]?.id ?? null
  );
  const [bankId, setBankId] = useState<number | null>(banks[0]?.id ?? null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);

  const position = positions.find((item) => item.id === positionId);
  const bank = banks.find((item) => item.id === bankId);
  const target = positions.find((item) => item.id === targetId);
  // Aporte e resgate são em reais (é o que sai ou entra na conta); mover é na
  // moeda da posição de origem.
  const amountCurrency = mode === "move" ? (position?.currency ?? "BRL") : "BRL";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseCurrencyInput(amount);
    if (cents == null || cents <= 0) {
      toast.notify("Informe um valor", "error");
      return;
    }
    if (positionId == null) {
      toast.notify("Escolha a posição", "error");
      return;
    }
    setSaving(true);
    try {
      if (mode === "move") {
        if (targetId == null) throw new Error("Escolha o destino");
        await api("/investments/move", {
          method: "POST",
          body: JSON.stringify({ fromPositionId: positionId, toPositionId: targetId, amount: cents / 100, date })
        });
        toast.notify(`Alocado em ${target?.name ?? "outra posição"}`);
      } else {
        if (bankId == null) throw new Error("Escolha a conta");
        await api(mode === "deposit" ? "/investments/deposit" : "/investments/withdraw", {
          method: "POST",
          body: JSON.stringify(
            mode === "deposit"
              ? { positionId, fromAccountId: bankId, amountCents: cents, date }
              : { positionId, toAccountId: bankId, amountCents: cents, date }
          )
        });
        toast.notify(mode === "deposit" ? `Aporte em ${position?.name ?? "posição"}` : "Resgate registrado");
      }
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  const Icon = mode === "deposit" ? ArrowDownToLine : mode === "withdraw" ? ArrowUpFromLine : ArrowRightLeft;
  const positionSelect = (
    <select
      value={positionId ?? ""}
      onChange={(event) => {
        const next = Number(event.target.value);
        setPositionId(next);
        // Origem e destino iguais não movem nada: o destino pula para outro.
        if (next === targetId) setTargetId(positions.find((item) => item.id !== next)?.id ?? null);
      }}
    >
      <PositionOptions positions={sources} />
    </select>
  );
  const bankSelect = (
    <select value={bankId ?? ""} onChange={(event) => setBankId(Number(event.target.value))}>
      {banks.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} · {moneyFromCents(account.currentBalanceCents)}
        </option>
      ))}
    </select>
  );

  return (
    <Drawer
      title={TITLE[mode]}
      subtitle={SUBTITLE[mode]}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Icon} type="submit" form="position-move-form" disabled={saving}>
            {saving ? "Salvando…" : TITLE[mode]}
          </Button>
        </>
      }
    >
      <form id="position-move-form" className="stack" onSubmit={submit}>
        {mode === "deposit" && (
          <>
            <Field label="Sai de">{bankSelect}</Field>
            <Field label="Vai para" hint="Um caixa, para decidir depois, ou direto numa aplicação">
              {positionSelect}
            </Field>
          </>
        )}
        {mode === "withdraw" && (
          <>
            <Field label="Sai de">{positionSelect}</Field>
            <Field label="Vai para">{bankSelect}</Field>
          </>
        )}
        {mode === "move" && (
          <>
            <Field label="Sai de">{positionSelect}</Field>
            <Field label="Vai para">
              <select value={targetId ?? ""} onChange={(event) => setTargetId(Number(event.target.value))}>
                <PositionOptions positions={targets} />
              </select>
            </Field>
          </>
        )}

        <div className="field-row">
          <Field label={`Valor (${amountCurrency === "USD" ? "US$" : "R$"})`}>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              autoFocus
              required
            />
          </Field>
          <Field label="Data">
            <DateField value={date} onChange={setDate} />
          </Field>
        </div>

        <p className="fin-muted">
          {mode === "deposit" &&
            `${bank?.name ?? "A conta"} tem ${moneyFromCents(bank?.currentBalanceCents ?? 0)}. O valor entra em ${position?.name ?? "posição"}${position?.currency === "USD" ? ", convertido pela cotação do dólar" : ""}.`}
          {mode === "withdraw" &&
            `${position?.name ?? "A posição"} tem ${currency(position?.currentValue ?? 0, position?.currency ?? "BRL")}.`}
          {mode === "move" &&
            `${position?.name ?? "O caixa"} tem ${currency(position?.currentValue ?? 0, position?.currency ?? "BRL")}. ${target?.category === "fixed_income" || target?.category === "global" ? "O valor soma ao investido do destino." : ""}`}
        </p>
      </form>
    </Drawer>
  );
}
