import { Save } from "lucide-react";
import { useState } from "react";
import type { GoalProgress } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { DateField } from "../datepicker.js";
import { Drawer } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { AccountSelect } from "./AccountSelect.js";
import { api } from "../../lib/api.js";
import { moneyFromCents, signedMoneyFromCents, todayIso } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";
import { MoneyInput } from "../forms.js";

export type GoalDirection = "deposit" | "withdraw" | "correct" | "profit" | "adjust";

const SUBMIT_LABEL: Record<GoalDirection, string> = {
  deposit: "Guardar",
  withdraw: "Resgatar",
  correct: "Corrigir",
  profit: "Lançar lucro",
  adjust: "Ajustar lucro"
};

/**
 * Guardar, resgatar, corrigir o saldo, lançar o lucro ou ajustá-lo.
 *
 * Guardar tira da conta atrelada e resgatar devolve para ela: o saldo da conta
 * muda junto, como no banco. Caixinha antiga sem conta atrelada pede a conta
 * aqui mesmo.
 *
 * O lucro é separado do dinheiro que você pôs: **lançar** soma um lucro que o
 * banco já pagou; **ajustar** diz quanto a caixinha lucrou no total, e o
 * sistema lança só a diferença (para mais ou para menos).
 */
export function GoalDepositDrawer({
  goal,
  initialDirection = "deposit",
  onClose,
  onDone
}: {
  goal: GoalProgress;
  initialDirection?: GoalDirection;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [direction, setDirection] = useState<GoalDirection>(initialDirection);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const parent = goal.parentAccountName;
  const isProfit = direction === "profit" || direction === "adjust";
  /**
   * Ao resgatar, o usuário precisa ver o que recebe de verdade. A estimativa é
   * a do resgate total; num resgate parcial ela é o teto do imposto.
   */
  const showTaxes = direction === "withdraw" && (goal.iofCents > 0 || goal.irCents > 0);
  const typed = amount.trim() === "" ? null : parseCurrencyInput(amount);
  const adjustDelta = direction === "adjust" && typed != null ? typed - goal.profit.cents : null;

  async function run(path: string, body: object, success: string) {
    setSaving(true);
    try {
      await api(`/ledger/goals/${goal.id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      toast.notify(success);
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = typed;
    if (direction === "correct") {
      if (cents == null || cents < 0) {
        toast.notify("Informe o saldo real", "error");
        return;
      }
      await run("correct", { date, valueCents: cents }, "Saldo corrigido: o rendimento foi refeito a partir dele");
      return;
    }
    if (direction === "adjust") {
      if (cents == null) {
        toast.notify("Informe o lucro total", "error");
        return;
      }
      if (adjustDelta === 0) {
        toast.notify("O lucro já é esse: nada a ajustar", "error");
        return;
      }
      await run("profit/adjust", { totalCents: cents, date }, "Lucro ajustado");
      return;
    }
    if (cents == null || cents <= 0) {
      toast.notify("Informe um valor válido", "error");
      return;
    }
    if (direction === "profit") {
      await run(
        "profit",
        { amountCents: cents, date, description: description || null },
        `Lucro lançado em ${goal.name}`
      );
      return;
    }
    if (parent == null && accountId == null) {
      toast.notify("Escolha a conta", "error");
      return;
    }
    const deposit = direction === "deposit";
    await run(
      deposit ? "deposit" : "withdraw",
      {
        amountCents: cents,
        date,
        // Sem conta atrelada, a escolhida aqui; com ela, o servidor usa a atrelada.
        ...(parent == null ? { [deposit ? "fromAccountId" : "toAccountId"]: accountId } : {}),
        description: description || null
      },
      deposit ? `Guardado em ${goal.name}` : `Resgatado de ${goal.name}`
    );
  }

  const explanation = (() => {
    switch (direction) {
      case "correct":
        return "O saldo que o banco mostrava para esta caixinha no fim de um dia. O sistema passa a calcular a partir dele: o rendimento depois desse dia é refeito.";
      case "profit":
        return "Um lucro que o banco já pagou e que ainda não está aqui. Ele entra no saldo da caixinha como lucro, não como dinheiro que você pôs.";
      case "adjust":
        return `Quanto a caixinha lucrou no total, como o banco mostra. O sistema lança só a diferença, para mais ou para menos. Hoje o lucro é ${signedMoneyFromCents(goal.profit.cents)}.`;
      default:
        return parent == null
          ? "Esta caixinha ainda não tem conta atrelada. Escolha a conta abaixo, ou atrele uma em Editar."
          : direction === "deposit"
            ? `Sai do saldo de ${parent} e entra na caixinha.`
            : `Sai da caixinha e volta para o saldo de ${parent}.`;
    }
  })();

  return (
    <Drawer
      title={goal.name}
      subtitle={`Saldo ${moneyFromCents(goal.balanceCents)}${parent ? ` · atrelada a ${parent}` : ""}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="goal-move" disabled={saving}>
            {saving ? "Salvando…" : SUBMIT_LABEL[direction]}
          </Button>
        </>
      }
    >
      <form id="goal-move" className="stack" onSubmit={submit}>
        <Segmented<GoalDirection>
          value={direction}
          onChange={(next) => {
            setDirection(next);
            setAmount("");
          }}
          options={[
            { value: "deposit", label: "Guardar" },
            { value: "withdraw", label: "Resgatar" },
            { value: "profit", label: "Lançar lucro" },
            { value: "adjust", label: "Ajustar lucro" },
            { value: "correct", label: "Corrigir saldo" }
          ]}
        />

        <p className="fin-muted">{explanation}</p>

        <div className="field-row">
          <Field
            label={
              direction === "correct"
                ? "Saldo real"
                : direction === "adjust"
                  ? "Lucro total"
                  : direction === "profit"
                    ? "Lucro"
                    : "Valor"
            }
          >
            <MoneyInput
              value={amount}
              onChange={setAmount}
              autoFocus
              required
              allowNegative={direction === "adjust"}
              placeholder="0,00"
            />
          </Field>
          <Field label={direction === "correct" ? "No fim do dia" : "Data"}>
            <DateField value={date} onChange={setDate} />
          </Field>
        </div>

        {adjustDelta != null && adjustDelta !== 0 && (
          <div className="fin-effect">
            <p>
              Vai lançar {signedMoneyFromCents(adjustDelta)} de lucro: o saldo vai de{" "}
              {moneyFromCents(goal.balanceCents)} para {moneyFromCents(goal.balanceCents + adjustDelta)}.
            </p>
          </div>
        )}

        {!isProfit && direction !== "correct" && parent == null && (
          <Field label={direction === "deposit" ? "Sai da conta" : "Volta para a conta"}>
            <AccountSelect
              value={accountId}
              onChange={setAccountId}
              exclude={["credit_card", "investment", "goal"]}
            />
          </Field>
        )}

        {showTaxes && (
          <div className="fin-effect">
            <p>
              Resgatando tudo hoje: IOF {moneyFromCents(goal.iofCents)} · IR {moneyFromCents(goal.irCents)}
            </p>
            <p className="fin-muted">
              Você receberia {moneyFromCents(goal.netCents)} de {moneyFromCents(goal.grossCents)}.
            </p>
          </div>
        )}

        {(direction === "deposit" || direction === "withdraw" || direction === "profit") && (
          <Field label="Descrição" hint="Opcional">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={direction === "profit" ? "Ex.: rendimento do mês" : "Ex.: sobra do mês"}
            />
          </Field>
        )}
      </form>
    </Drawer>
  );
}
