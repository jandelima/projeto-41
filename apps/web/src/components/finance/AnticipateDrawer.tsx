import { FastForward } from "lucide-react";
import { useMemo, useState } from "react";
import type { AnticipationDiscount, EntryRecord, StatementSummary } from "@projeto41/contracts";
import { anticipationDiscounts, parseCurrencyInput } from "@projeto41/finance";
import { Drawer, useConfirm } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { api } from "../../lib/api.js";
import { ledgerDate, monthLabel, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

type DiscountMode = "none" | AnticipationDiscount["mode"];
type DiscountScope = AnticipationDiscount["scope"];

/**
 * Antecipação de parcelas.
 *
 * Nada aqui é irreversível: confirmação antes e "Restaurar" na linha depois. A
 * antecipação só move o `statement_month`; a data da compra fica intacta, e é
 * por isso que dá para voltar sempre.
 *
 * Antecipar costuma vir com desconto. Ele entra em percentual ou em valor, por
 * parcela ou sobre o total, e a prévia usa a **mesma** função que o servidor
 * aplica (`anticipationDiscounts`), então o número mostrado é o que vai ser
 * gravado — centavo por centavo.
 */
export function AnticipateDrawer({
  cardId,
  installments,
  statements,
  defaultMonth,
  onClose,
  onDone
}: {
  cardId: number;
  installments: EntryRecord[];
  statements: StatementSummary[];
  /** A fatura corrente do cartão: antecipar para uma fatura passada não faz sentido. */
  defaultMonth?: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<number[]>([]);
  const [targetMonth, setTargetMonth] = useState(
    defaultMonth && statements.some((statement) => statement.month === defaultMonth)
      ? defaultMonth
      : (statements[0]?.month ?? "")
  );
  const [mode, setMode] = useState<DiscountMode>("none");
  const [scope, setScope] = useState<DiscountScope>("total");
  const [discountText, setDiscountText] = useState("");
  const [saving, setSaving] = useState(false);

  const chosen = useMemo(
    () => installments.filter((entry) => selected.includes(entry.id)),
    [installments, selected]
  );
  const movingCents = chosen.reduce((total, entry) => total + -entry.amountCents, 0);

  /**
   * O desconto como o contrato pede: centavos em `amount` e centésimos de
   * ponto percentual em `percent`. `parseCurrencyInput` já lê "12,5" como
   * 1250, que é exatamente 12,5% em centésimos.
   */
  const discount = useMemo<AnticipationDiscount | null>(() => {
    if (mode === "none") return null;
    const value = parseCurrencyInput(discountText);
    if (value == null || value <= 0) return null;
    return { mode, scope, value };
  }, [mode, scope, discountText]);

  const preview = useMemo(() => {
    if (!discount || chosen.length === 0) return { cents: 0, error: null as string | null };
    try {
      const parts = anticipationDiscounts(
        chosen.map((entry) => Math.abs(entry.amountCents)),
        discount
      );
      return { cents: parts.reduce((total, part) => total + part, 0), error: null };
    } catch (error) {
      return { cents: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }, [discount, chosen]);

  const target = statements.find((statement) => statement.month === targetMonth);
  const netMoving = movingCents - preview.cents;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (selected.length === 0) {
      toast.notify("Escolha ao menos uma parcela", "error");
      return;
    }
    if (mode !== "none" && !discount) {
      toast.notify("Informe o desconto ou escolha sem desconto", "error");
      return;
    }
    if (preview.error) {
      toast.notify(preview.error, "error");
      return;
    }
    const ok = await confirm({
      title: "Antecipar parcelas",
      message:
        `${selected.length} parcela(s) passam para a fatura de ${monthLabel(targetMonth)}. ` +
        (preview.cents > 0
          ? `Desconto de ${moneyFromCents(preview.cents)} lançado na mesma fatura. `
          : "") +
        "A data da compra não muda.",
      confirmLabel: "Antecipar"
    });
    if (!ok) return;

    setSaving(true);
    try {
      await api(`/ledger/cards/${cardId}/anticipate`, {
        method: "POST",
        body: JSON.stringify({ entryIds: selected, targetMonth, discount })
      });
      // O `Toast` do app não tem ação embutida, então o "desfazer" vive na
      // própria linha: parcela antecipada ganha a etiqueta e o botão de
      // restaurar na tela de fatura — e restaurar leva o desconto junto.
      toast.notify("Parcelas antecipadas · use Restaurar na linha para desfazer");
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao antecipar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Antecipar parcelas"
      subtitle="Move a parcela de fatura, sem mexer na data da compra"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={FastForward} type="submit" form="anticipate-form" disabled={saving}>
            {saving ? "Antecipando…" : "Antecipar"}
          </Button>
        </>
      }
    >
      <form id="anticipate-form" className="stack" onSubmit={submit}>
        <div>
          <span className="field-label">Parcelas futuras</span>
          <ul className="fin-list">
            {installments.map((entry) => (
              <li key={entry.id}>
                <label className="fin-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, entry.id]
                          : current.filter((id) => id !== entry.id)
                      )
                    }
                  />
                  <span>
                    {entry.installmentNumber}/{entry.installmentCount} · {ledgerDate(entry.date)}
                  </span>
                </label>
                <span className="fin-list-meta">
                  <small className="fin-muted">{monthLabel(entry.statementMonth ?? "")}</small>
                  <strong>{moneyFromCents(-entry.amountCents)}</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Field label="Fatura de destino">
          <select value={targetMonth} onChange={(event) => setTargetMonth(event.target.value)}>
            {statements.map((statement) => (
              <option key={statement.month} value={statement.month}>
                {monthLabel(statement.month)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Desconto" hint="O banco costuma abater os juros de quem antecipa">
          <Segmented<DiscountMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "none", label: "Sem desconto" },
              { value: "percent", label: "Percentual" },
              { value: "amount", label: "Valor" }
            ]}
          />
        </Field>

        {mode !== "none" && (
          <div className="field-row">
            <Field label={mode === "percent" ? "Percentual" : "Valor"}>
              <div className="input-suffix">
                <input
                  value={discountText}
                  onChange={(event) => setDiscountText(event.target.value)}
                  inputMode="decimal"
                  placeholder={mode === "percent" ? "5" : "0,00"}
                  autoFocus
                />
                <span>{mode === "percent" ? "%" : "R$"}</span>
              </div>
            </Field>
            <Field label="Aplicar">
              <Segmented<DiscountScope>
                value={scope}
                onChange={setScope}
                options={[
                  { value: "each", label: "Por parcela" },
                  { value: "total", label: "No total" }
                ]}
              />
            </Field>
          </div>
        )}

        {/* O efeito em linhas: o que muda e o que não muda. */}
        <div className="fin-effect">
          <p>
            Fatura de destino passa de {moneyFromCents(target?.totalCents ?? 0)} para{" "}
            {moneyFromCents((target?.totalCents ?? 0) + netMoving)}
          </p>
          {preview.error ? (
            <p className="fin-negative">{preview.error}</p>
          ) : preview.cents > 0 ? (
            <p className="fin-positive">
              Desconto de {moneyFromCents(preview.cents)}: você paga {moneyFromCents(netMoving)} em
              vez de {moneyFromCents(movingCents)}. O total devido cai o mesmo valor.
            </p>
          ) : (
            <p className="fin-muted">O total devido não muda.</p>
          )}
        </div>
      </form>
    </Drawer>
  );
}
