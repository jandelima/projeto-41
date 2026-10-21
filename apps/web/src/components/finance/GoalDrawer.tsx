import { Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { GoalProfitMode, GoalProgress } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { ColorPicker } from "../ColorPicker.js";
import { DateField } from "../datepicker.js";
import { Drawer, useConfirm } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { AccountSelect } from "./AccountSelect.js";
import { api } from "../../lib/api.js";
import { centsToInput, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";
import { MoneyInput } from "../forms.js";

/**
 * Criar ou editar caixinha. Toda caixinha tem saldo próprio e fica atrelada a
 * uma conta: é dela que sai o que se guarda e para ela que volta o resgate.
 */
export function GoalDrawer({
  goal,
  onClose,
  onSaved
}: {
  goal: GoalProgress | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const editing = goal != null;
  const [name, setName] = useState(goal?.name ?? "");
  const [color, setColor] = useState(goal?.color ?? "#00a86b");
  const [targetAmount, setTargetAmount] = useState(centsToInput(goal?.targetAmountCents));
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [cdiPercent, setCdiPercent] = useState(goal?.cdiPercent != null ? String(goal.cdiPercent) : "");
  // Caixinha nova nasce manual: o lucro entra quando o usuário lança. Automático
  // pede o % do CDI, de onde o sistema tira o rendimento todo dia.
  const [profitMode, setProfitMode] = useState<GoalProfitMode>(goal?.profitMode ?? "manual");
  const [parentAccountId, setParentAccountId] = useState<number | null>(goal?.parentAccountId ?? null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const target = targetAmount.trim() === "" ? null : parseCurrencyInput(targetAmount);
    if (targetAmount.trim() !== "" && target == null) {
      toast.notify("Valor-alvo inválido", "error");
      return;
    }
    if (parentAccountId == null) {
      toast.notify("Escolha a conta atrelada", "error");
      return;
    }
    if (profitMode === "auto" && !(Number(cdiPercent) >= 1)) {
      toast.notify("Informe o percentual do CDI para o lucro automático", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        color,
        targetAmountCents: target,
        targetDate: targetDate || null,
        cdiPercent: profitMode === "auto" ? Number(cdiPercent) : null,
        profitMode,
        parentAccountId
      };
      if (editing) {
        await api(`/ledger/goals/${goal.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/ledger/goals", {
          method: "POST",
          body: JSON.stringify({ ...body, mode: "account" })
        });
      }
      toast.notify("Caixinha salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Excluir de vez leva a caixinha e o extrato dela; o que foi guardado a
   * partir de outra conta fica lá como ajuste, sem mudar o saldo dela.
   */
  async function remove() {
    if (!goal) return;
    const ok = await confirm({
      title: "Excluir caixinha de vez",
      message:
        goal.balanceCents > 0
          ? `"${goal.name}" ainda tem ${moneyFromCents(goal.balanceCents)}. Resgate antes para o dinheiro voltar à conta: excluindo agora, ele some junto com o extrato. Não dá para desfazer.`
          : `"${goal.name}" será apagada com o extrato dela. O que foi guardado e resgatado fica na conta atrelada como ajuste, sem mudar o saldo. Não dá para desfazer.`,
      confirmLabel: "Excluir de vez",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await api(`/ledger/goals/${goal.id}?purge=1`, { method: "DELETE" });
      toast.notify("Caixinha excluída");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao excluir", "error");
    }
  }

  return (
    <Drawer
      title={editing ? "Editar caixinha" : "Nova caixinha"}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <Button variant="danger" icon={Trash2} onClick={() => void remove()}>
              Excluir
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="goal-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="goal-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            placeholder="Ex.: Viagem"
          />
        </Field>

        <Field label="Conta atrelada" hint="Guardar tira desta conta; resgatar devolve para ela.">
          <AccountSelect
            value={parentAccountId}
            onChange={setParentAccountId}
            exclude={["credit_card", "investment", "goal"]}
          />
        </Field>

        <div className="field-row">
          <Field label="Valor-alvo" hint="Opcional">
            <MoneyInput
              value={targetAmount}
              onChange={setTargetAmount}
              placeholder="Sem alvo"
            />
          </Field>
          <Field label="Data-alvo" hint="Opcional">
            <DateField value={targetDate} onChange={setTargetDate} />
          </Field>
        </div>

        <Field
          label="Lucro"
          hint={
            profitMode === "auto"
              ? "O rendimento do CDI é calculado e lançado sozinho, todo dia."
              : "Nada entra sozinho: você lança o lucro quando quiser e pode ajustá-lo para o que o banco mostra."
          }
        >
          <Segmented<GoalProfitMode>
            value={profitMode}
            onChange={setProfitMode}
            options={[
              { value: "manual", label: "Lançar eu mesmo" },
              { value: "auto", label: "Automático (CDI)" }
            ]}
          />
        </Field>

        {profitMode === "auto" && (
          <Field label="Percentual do CDI" hint="Quanto o banco paga do CDI nesta caixinha.">
            <input
              type="number"
              min={1}
              max={300}
              step="1"
              value={cdiPercent}
              onChange={(event) => setCdiPercent(event.target.value)}
              placeholder="Ex.: 110"
              required
            />
          </Field>
        )}

        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}
