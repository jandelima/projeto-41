import { Banknote, Coins, DollarSign, Landmark, PiggyBank, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Drawer, useConfirm } from "../components/dialog.js";
import { AssetIcon, Button, Card, Empty, Field, NumberInput, SectionHeading } from "../components/ui.js";
import { api } from "../lib/api.js";
import { currency as fmtCurrency, money, percent } from "../lib/format.js";
import { institutionIconUrl } from "../lib/icons.js";
import { useToast } from "../lib/toast.js";
import type { ManualPosition } from "../lib/types.js";

const groups = [
  { id: "dollar", label: "Dólar", icon: DollarSign, hint: "Contas e carteiras em dólar" },
  { id: "cash", label: "Caixa BR", icon: Banknote, hint: "Saldo disponível em reais" },
  { id: "reserve", label: "Reserva de emergência", icon: PiggyBank, hint: "Liquidez para imprevistos" },
  { id: "fixed_income", label: "Renda fixa", icon: Landmark, hint: "Tesouro e títulos" },
  { id: "global", label: "Ações globais", icon: Coins, hint: "Exposição internacional" }
] as const;

export function PositionsPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [positions, setPositions] = useState<ManualPosition[]>([]);
  const [editing, setEditing] = useState<Partial<ManualPosition> | null>(null);

  const load = useCallback(() => api<ManualPosition[]>("/positions").then(setPositions), []);
  useEffect(() => void load(), [load]);

  async function remove(position: ManualPosition) {
    const ok = await confirm({
      title: "Excluir posição",
      message: `Remover "${position.name}"?`,
      tone: "danger",
      confirmLabel: "Excluir"
    });
    if (!ok) return;
    await api(`/positions/${position.id}`, { method: "DELETE" });
    await Promise.all([load(), onChanged()]);
    toast.notify("Posição excluída");
  }

  return (
    <div className="positions">
      <SectionHeading title="Caixa e renda fixa" subtitle="Contas e aplicações atualizadas por você">
        <Button icon={Plus} onClick={() => setEditing({})}>
          Nova posição
        </Button>
      </SectionHeading>

      <div className="position-groups">
        {groups.map((group) => {
          const items = positions.filter((position) => position.category === group.id);
          if (!items.length && group.id === "global") return null;
          const subtotal = items.reduce(
            (sum, item) => sum + item.currentValue * (item.currency === "USD" ? 0 : 1),
            0
          );
          const Icon = group.icon;
          return (
            <Card key={group.id} className="position-card">
              <div className="position-card-head">
                <div className="position-group-icon">
                  <Icon size={18} />
                </div>
                <div>
                  <h3>{group.label}</h3>
                  <p>{group.hint}</p>
                </div>
                <strong className="position-subtotal">
                  {items.some((item) => item.currency === "USD")
                    ? `${fmtCurrency(
                        items.filter((i) => i.currency === "USD").reduce((s, i) => s + i.currentValue, 0),
                        "USD"
                      )}`
                    : money(subtotal)}
                </strong>
              </div>
              <div className="position-items">
                {items.map((position) => {
                  const change =
                    position.invested > 0 ? position.currentValue / position.invested - 1 : 0;
                  return (
                    <button key={position.id} className="position-item" onClick={() => setEditing(position)}>
                      <div className="position-item-main">
                        <AssetIcon src={institutionIconUrl(position.name)} label={position.name} />
                        <div className="position-item-name">
                          <strong>{position.name}</strong>
                          <small>{position.currency}</small>
                        </div>
                      </div>
                      <div className="position-item-values">
                        <strong>{fmtCurrency(position.currentValue, position.currency)}</strong>
                        {position.invested > 0 && Math.abs(change) > 1e-9 && (
                          <small className={change >= 0 ? "positive-text" : "negative-text"}>
                            {change >= 0 ? "+" : ""}
                            {percent(change)}
                          </small>
                        )}
                      </div>
                    </button>
                  );
                })}
                {!items.length && <Empty icon={group.icon} text="Sem posições nesta classe." />}
              </div>
            </Card>
          );
        })}
      </div>

      {editing && (
        <PositionDrawer
          initial={editing}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? () => remove(editing as ManualPosition) : undefined}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([load(), onChanged()]);
            toast.notify("Posição salva");
          }}
        />
      )}
    </div>
  );
}

function PositionDrawer({
  initial,
  onClose,
  onSaved,
  onDelete
}: {
  initial: Partial<ManualPosition>;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const toast = useToast();
  const [category, setCategory] = useState(initial.category ?? "cash");
  const [currencyCode, setCurrencyCode] = useState<"BRL" | "USD">(initial.currency ?? "BRL");
  const [name, setName] = useState(initial.name ?? "");
  const [invested, setInvested] = useState(String(initial.invested ?? 0));
  const [currentValue, setCurrentValue] = useState(String(initial.currentValue ?? 0));
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      toast.notify("Informe o nome da posição", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category,
        name: name.trim(),
        invested: Number(invested) || 0,
        currentValue: Number(currentValue) || 0,
        currency: currencyCode,
        notes: initial.notes ?? ""
      };
      await api(initial.id ? `/positions/${initial.id}` : "/positions", {
        method: initial.id ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={initial.id ? "Editar posição" : "Nova posição"}
      subtitle="Atualize o valor atual sempre que quiser"
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button variant="danger" icon={Trash2} onClick={onDelete} className="footer-left">
              Excluir
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="position-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="position-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder="Ex.: Caixinha Nubank" />
        </Field>
        <div className="field-row">
          <Field label="Categoria">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Moeda">
            <select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value as "BRL" | "USD")}>
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
            </select>
          </Field>
        </div>
        <div className="field-row">
          <Field label={`Investimento (${currencyCode})`}>
            <NumberInput value={invested} min="0" onChange={(event) => setInvested(event.target.value)} />
          </Field>
          <Field label={`Valor atual (${currencyCode})`}>
            <NumberInput value={currentValue} min="0" onChange={(event) => setCurrentValue(event.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
