import { Save } from "lucide-react";
import { useState } from "react";
import type { AccountRecord, CardSummary } from "@projeto41/contracts";
import { DateField } from "../datepicker.js";
import { Drawer } from "../dialog.js";
import { Button, Field } from "../ui.js";
import { api } from "../../lib/api.js";
import { moneyFromCents, todayIso } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

/**
 * Pagamento da fatura.
 *
 * O valor fica **travado no total**: pagamento parcial e rotativo estão fora de
 * escopo em definitivo (D12), não adiados. Dizer isso na tela evita o usuário
 * procurar o campo editável.
 */
export function InvoicePaymentDrawer({
  card,
  month,
  totalCents,
  dueDate,
  accounts,
  onClose,
  onPaid
}: {
  card: CardSummary;
  month: string;
  totalCents: number;
  dueDate: string;
  accounts: AccountRecord[];
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const toast = useToast();
  const [fromAccountId, setFromAccountId] = useState<number | null>(
    card.paymentAccountId ?? accounts.find((account) => account.kind !== "credit_card")?.id ?? null
  );
  // O padrão é hoje: quem registra o pagamento quase sempre acabou de pagar.
  // Abrir no vencimento lançava o débito no futuro, e o saldo da conta ficava
  // acima do banco até lá. Registro atrasado (depois do vencimento) usa o
  // vencimento, que é quando o banco debitou.
  const [date, setDate] = useState(() => {
    const today = todayIso();
    return today <= dueDate ? today : dueDate;
  });
  const [saving, setSaving] = useState(false);

  // Uma fatura não se paga com outro cartão.
  const sources = accounts.filter((account) => account.kind !== "credit_card");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (fromAccountId == null) {
      toast.notify("Escolha a conta de onde sai o pagamento", "error");
      return;
    }
    setSaving(true);
    try {
      await api(`/ledger/cards/${card.id}/statements/${month}/payment`, {
        method: "POST",
        body: JSON.stringify({ date, fromAccountId, amountCents: totalCents })
      });
      toast.notify("Fatura paga");
      await onPaid();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao pagar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Pagar fatura"
      subtitle={`${card.name} · ${month}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="invoice-payment" disabled={saving}>
            {saving ? "Pagando…" : "Pagar"}
          </Button>
        </>
      }
    >
      <form id="invoice-payment" className="stack" onSubmit={submit}>
        <Field label="Valor" hint="Pagamento parcial está fora de escopo.">
          <input value={moneyFromCents(totalCents)} readOnly disabled />
        </Field>
        <Field label="Conta de origem">
          <select
            value={fromAccountId ?? ""}
            onChange={(event) => setFromAccountId(Number(event.target.value))}
          >
            {sources.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Data do pagamento"
          hint={`O dia em que o dinheiro saiu da conta. Débito automático: use o vencimento, ${dueDate.split("-").reverse().join("/")}.`}
        >
          <DateField value={date} onChange={setDate} />
        </Field>
        <p className="fin-muted">
          O pagamento entra como transferência, não como despesa — senão o gasto
          seria contado duas vezes.
        </p>
      </form>
    </Drawer>
  );
}
