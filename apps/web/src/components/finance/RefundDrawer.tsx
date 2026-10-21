import { Undo2 } from "lucide-react";
import { useState } from "react";
import type { EntryRecord } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { DateField } from "../datepicker.js";
import { Drawer } from "../dialog.js";
import { Button, Field } from "../ui.js";
import { api } from "../../lib/api.js";
import { centsToInput, moneyFromCents, todayIso } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";
import { MoneyInput } from "../forms.js";


/**
 * Estorno de um lançamento, ou da compra parcelada inteira.
 *
 * Quando a linha é parcela de um plano, a tela deixa explícito que as parcelas
 * futuras **continuam sendo cobradas** (6.6) — é o que o banco faz, e esconder
 * isso geraria uma surpresa na próxima fatura.
 */
export function RefundDrawer({
  entry,
  onClose,
  onDone
}: {
  entry: EntryRecord;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const isInstallment = entry.installmentPlanId != null;
  const [whole, setWhole] = useState(false);
  const [amount, setAmount] = useState(centsToInput(entry.amountCents));
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (whole && entry.installmentPlanId != null) {
        await api(`/ledger/installment-plans/${entry.installmentPlanId}/refund`, {
          method: "POST",
          body: JSON.stringify({ date, description: description || null })
        });
      } else {
        const cents = parseCurrencyInput(amount);
        if (cents == null || cents <= 0) {
          toast.notify("Informe um valor válido", "error");
          return;
        }
        await api(`/ledger/entries/${entry.id}/refund`, {
          method: "POST",
          body: JSON.stringify({ amountCents: cents, date, description: description || null })
        });
      }
      toast.notify("Estorno registrado");
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao estornar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Estornar"
      subtitle={entry.description ?? entry.placeName ?? undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Undo2} type="submit" form="refund-form" disabled={saving}>
            {saving ? "Estornando…" : "Estornar"}
          </Button>
        </>
      }
    >
      <form id="refund-form" className="stack" onSubmit={submit}>
        {isInstallment && (
          <label className="fin-check">
            <input
              type="checkbox"
              checked={whole}
              onChange={(event) => setWhole(event.target.checked)}
            />
            <span>Estornar a compra parcelada inteira</span>
          </label>
        )}

        {whole ? (
          <p className="fin-warning">
            O estorno entra de uma vez, pelo total da compra. As parcelas futuras
            continuam existindo e sendo cobradas — é assim que a fatura do banco
            funciona.
          </p>
        ) : (
          <Field label="Valor do estorno" hint={`Lançamento: ${moneyFromCents(entry.amountCents)}`}>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              autoFocus
            />
          </Field>
        )}

        <Field label="Data do estorno">
          <DateField value={date} onChange={setDate} />
        </Field>

        <Field label="Descrição" hint="Opcional">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: devolução na loja"
          />
        </Field>
      </form>
    </Drawer>
  );
}
