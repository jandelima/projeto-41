import {
  ArrowRightLeft,
  Banknote,
  Coins,
  DollarSign,
  Landmark,
  PiggyBank,
  Plus,
  Save,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { DateField } from "../components/datepicker.js";
import { Drawer, useConfirm } from "../components/dialog.js";
import { AssetIcon, Button, Card, Empty, Field, NumberInput, SectionHeading, Tag } from "../components/ui.js";
import { api } from "../lib/api.js";
import { currency as fmtCurrency, longDate, money, percent } from "../lib/format.js";
import { institutionIconUrl } from "../lib/icons.js";
import { MOVE_LABEL } from "../lib/cash.js";
import { useToast } from "../lib/toast.js";
import type { ManualPositionRecord, PositionRecord } from "@projeto41/contracts";

const groups = [
  { id: "dollar", label: "Dólar", icon: DollarSign, hint: "Contas e carteiras em dólar", tracksInvested: false },
  { id: "cash", label: "Caixa BR", icon: Banknote, hint: "Saldo disponível em reais", tracksInvested: false },
  { id: "reserve", label: "Reserva de emergência", icon: PiggyBank, hint: "Liquidez para imprevistos", tracksInvested: false },
  { id: "fixed_income", label: "Renda fixa", icon: Landmark, hint: "Tesouro e títulos", tracksInvested: true },
  { id: "global", label: "Ações globais", icon: Coins, hint: "Exposição internacional", tracksInvested: true }
] as const;

/** CDI só faz sentido em reais: renda fixa e os caixas. */
const canEarnCdi = (category: string, currencyCode: string) =>
  ["fixed_income", "cash", "reserve"].includes(category) && currencyCode === "BRL";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export function PositionsPage({
  onChanged,
  onOpenCash
}: {
  onChanged: () => Promise<void>;
  /** Aporte e resgate pelo banco moram em Em caixa. */
  onOpenCash?: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [editing, setEditing] = useState<Partial<PositionRecord> | null>(null);

  const load = useCallback(() => api<PositionRecord[]>("/positions").then(setPositions), []);
  useEffect(() => void load(), [load]);

  async function remove(position: ManualPositionRecord) {
    const ok = await confirm({
      title: "Excluir posição",
      message: `Remover "${position.name}"?`,
      tone: "danger",
      confirmLabel: "Excluir"
    });
    if (!ok) return;
    try {
      await api(`/positions/${position.id}`, { method: "DELETE" });
    } catch (error) {
      // Posição com aporte do banco ou operação não some sem desfazer antes.
      toast.notify(error instanceof Error ? error.message : "Falha ao excluir", "error");
      return;
    }
    await Promise.all([load(), onChanged()]);
    toast.notify("Posição excluída");
  }

  return (
    <div className="positions">
      <SectionHeading
        title="Caixa e renda fixa"
        subtitle="Os caixas e as aplicações. Aporte e resgate pela conta bancária em Em caixa"
      >
        {onOpenCash && (
          <Button variant="ghost" icon={ArrowRightLeft} onClick={onOpenCash}>
            Aportar e resgatar
          </Button>
        )}
        <Button icon={Plus} onClick={() => setEditing({})}>
          Nova posição
        </Button>
      </SectionHeading>

      <div className="position-groups stagger">
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
                          <small>
                            {position.cdiPercent != null && canEarnCdi(position.category, position.currency) ? (
                              <Tag tone="positive">{position.cdiPercent}% do CDI</Tag>
                            ) : (
                              position.currency
                            )}
                          </small>
                        </div>
                      </div>
                      <div className="position-item-values">
                        <strong>{fmtCurrency(position.currentValue, position.currency)}</strong>
                        {position.history.yieldTotal > 0 && (
                          <small
                            className="positive-text"
                            title={
                              position.history.lastYieldDate
                                ? `Rendimento lançado até ${longDate(position.history.lastYieldDate)}`
                                : undefined
                            }
                          >
                            +{money(position.history.yieldTotal)} rendeu
                          </small>
                        )}
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
          onDelete={editing.id ? () => remove(editing as ManualPositionRecord) : undefined}
          onChangedInPlace={async () => {
            const next = await api<PositionRecord[]>("/positions");
            setPositions(next);
            setEditing((current) => next.find((item) => item.id === current?.id) ?? current);
            await onChanged();
          }}
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

const MOVE_TONE: Record<string, string> = {
  yield: "positive-text",
  adjust: "fin-muted"
};

type StatementLine = {
  id: number;
  date: string;
  kind: keyof typeof MOVE_LABEL;
  amount: number;
  targetValue: number | null;
  description: string | null;
};

/**
 * Posição guiada pelo extrato: o que entrou, quando e quanto rendeu. O valor
 * de hoje é calculado; o usuário só informa aportes e, quando o banco
 * mostrar outro número, corrige o saldo de um dia.
 */
function PositionDrawer({
  initial,
  onClose,
  onSaved,
  onDelete,
  onChangedInPlace
}: {
  initial: Partial<PositionRecord>;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
  /** Aporte ou correção gravados: a gaveta continua aberta, com os números novos. */
  onChangedInPlace: () => Promise<void>;
}) {
  const toast = useToast();
  const creating = initial.id == null;
  const [category, setCategory] = useState(initial.category ?? "cash");
  const [currencyCode, setCurrencyCode] = useState<"BRL" | "USD">(initial.currency ?? "BRL");
  const [name, setName] = useState(initial.name ?? "");
  const [cdiPercent, setCdiPercent] = useState(initial.cdiPercent != null ? String(initial.cdiPercent) : "");
  const [cdiSince, setCdiSince] = useState(initial.cdiSince ?? today());
  // Na criação: quanto você colocou e quando. Rende a partir desse dia.
  const [firstAmount, setFirstAmount] = useState("");
  const [firstDate, setFirstDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const earns = canEarnCdi(category, currencyCode);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      toast.notify("Informe o nome da posição", "error");
      return;
    }
    const first = Number(firstAmount.replace(",", ".")) || 0;
    setSaving(true);
    try {
      const payload = {
        category,
        name: name.trim(),
        invested: initial.invested ?? 0,
        currentValue: initial.currentValue ?? 0,
        currency: currencyCode,
        notes: initial.notes ?? "",
        cdiPercent: earns && cdiPercent ? Number(cdiPercent.replace(",", ".")) : null,
        cdiSince: earns && cdiPercent ? (creating && first > 0 ? firstDate : cdiSince) : null
      };
      if (creating) {
        const created = await api<{ id: number }>("/positions", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        if (first > 0) {
          await api(`/positions/${created.id}/history`, {
            method: "POST",
            body: JSON.stringify({ date: firstDate, amount: first })
          });
        }
      } else {
        await api(`/positions/${initial.id}`, { method: "PUT", body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={creating ? "Nova posição" : initial.name ?? "Posição"}
      subtitle={
        creating
          ? "Diga quanto colocou e quando: o sistema calcula o valor de hoje"
          : "O valor de hoje é calculado pelo que entrou e pelo que rendeu"
      }
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button variant="danger" icon={Trash2} onClick={onDelete} className="footer-left">
              Excluir
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button icon={Save} type="submit" form="position-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      {!creating && initial.history && (
        <PositionSummary position={initial as PositionRecord} />
      )}
      <form id="position-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus={creating} placeholder="Ex.: CDB Nubank" />
        </Field>
        <div className="field-row">
          <Field label="Categoria">
            <select
              value={category}
              onChange={(event) => {
                const next = event.target.value as ManualPositionRecord["category"];
                setCategory(next);
                // Dólar vive em dólar; o resto, em reais.
                if (creating) setCurrencyCode(next === "dollar" ? "USD" : "BRL");
              }}
            >
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
        {creating && (
          <div className="field-row">
            <Field label={`Quanto você colocou (${currencyCode})`} hint="Vazio: a posição começa zerada.">
              <NumberInput value={firstAmount} min="0" onChange={(event) => setFirstAmount(event.target.value)} />
            </Field>
            <Field label="Quando">
              <DateField value={firstDate} onChange={setFirstDate} />
            </Field>
          </div>
        )}
        {earns && (
          <div className="field-row">
            <Field label="Percentual do CDI" hint="Vazio significa que a posição não rende.">
              <input
                type="number"
                min={1}
                max={300}
                step="any"
                value={cdiPercent}
                onChange={(event) => setCdiPercent(event.target.value)}
                placeholder="Ex.: 100"
              />
            </Field>
            {cdiPercent && !creating && (
              <Field label="Rende desde" hint="Mudar refaz o rendimento a partir daqui.">
                <DateField value={cdiSince} onChange={setCdiSince} />
              </Field>
            )}
          </div>
        )}
      </form>
      {!creating && initial.id != null && (
        <PositionActions
          positionId={initial.id}
          currencyCode={currencyCode}
          onDone={onChangedInPlace}
        />
      )}
      {!creating && initial.id != null && (
        <PositionStatement positionId={initial.id} currencyCode={currencyCode} version={initial.currentValue ?? 0} />
      )}
    </Drawer>
  );
}

/** Colocado, rendido e corrigido somam o valor de hoje — e a tela mostra a soma. */
function PositionSummary({ position }: { position: PositionRecord }) {
  const code = position.currency;
  const { history } = position;
  return (
    <dl className="position-summary">
      <div>
        <dt>Você colocou</dt>
        <dd>{fmtCurrency(history.contributed, code)}</dd>
      </div>
      <div>
        <dt>Rendeu</dt>
        <dd className="positive-text">{fmtCurrency(history.yieldTotal, code)}</dd>
      </div>
      {Math.abs(history.adjustTotal) >= 0.005 && (
        <div title="Diferença entre o calculado e o valor real que você informou">
          <dt>Correções</dt>
          <dd>{fmtCurrency(history.adjustTotal, code)}</dd>
        </div>
      )}
      <div className="position-summary-total">
        <dt>Valor hoje</dt>
        <dd>{fmtCurrency(position.currentValue, code)}</dd>
      </div>
      {position.yield && position.yield.projectedYield > 0 && (
        <p className="fin-muted">
          +{fmtCurrency(position.yield.projectedYield, code)} previstos
          {position.yield.projectedThroughDate && ` até ${longDate(position.yield.projectedThroughDate)}`}, quando o
          CDI desses dias sair.
        </p>
      )}
      {history.lastAdjust && (
        <p className="fin-muted">
          Última correção: {longDate(history.lastAdjust.date)}
          {history.lastAdjust.value != null && `, valor real ${fmtCurrency(history.lastAdjust.value, code)}`}.
        </p>
      )}
    </dl>
  );
}

/** Os dois gestos da posição guiada: registrar um aporte antigo e corrigir o saldo. */
function PositionActions({
  positionId,
  currencyCode,
  onDone
}: {
  positionId: number;
  currencyCode: string;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"contribution" | "correction">("correction");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);

  async function save() {
    const value = Number(amount.replace(",", "."));
    if (!(value >= 0) || amount.trim() === "") {
      toast.notify(mode === "correction" ? "Informe o valor real" : "Informe o valor", "error");
      return;
    }
    setBusy(true);
    try {
      if (mode === "correction") {
        await api(`/positions/${positionId}/correct`, {
          method: "POST",
          body: JSON.stringify({ date, value })
        });
        toast.notify("Saldo corrigido: o rendimento foi refeito a partir dele");
      } else {
        if (value === 0) throw new Error("Informe o valor");
        await api(`/positions/${positionId}/history`, {
          method: "POST",
          body: JSON.stringify({ date, amount: direction === "in" ? value : -value })
        });
        toast.notify(direction === "in" ? "Aporte registrado" : "Resgate registrado");
      }
      setAmount("");
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="position-actions">
      <div className="position-actions-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "correction"}
          className={mode === "correction" ? "active" : ""}
          onClick={() => setMode("correction")}
        >
          Corrigir saldo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "contribution"}
          className={mode === "contribution" ? "active" : ""}
          onClick={() => setMode("contribution")}
        >
          Aporte ou resgate antigo
        </button>
      </div>
      <p className="fin-muted">
        {mode === "correction"
          ? "O valor que o banco mostrava no fim de um dia. O sistema passa a calcular a partir dele."
          : "Dinheiro que entrou ou saiu antes de você usar o app, sem passar por uma conta dele. Aporte pelo banco é em Em caixa."}
      </p>
      <div className="field-row">
        {mode === "contribution" && (
          <Field label="Tipo">
            <select value={direction} onChange={(event) => setDirection(event.target.value as "in" | "out")}>
              <option value="in">Aporte</option>
              <option value="out">Resgate</option>
            </select>
          </Field>
        )}
        <Field label={mode === "correction" ? `Valor real (${currencyCode})` : `Valor (${currencyCode})`}>
          <NumberInput value={amount} min="0" onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label={mode === "correction" ? "No fim do dia" : "Data"}>
          <DateField value={date} onChange={setDate} />
        </Field>
      </div>
      <Button variant="soft" icon={Plus} onClick={() => void save()} disabled={busy}>
        {mode === "correction" ? "Corrigir" : "Registrar"}
      </Button>
    </section>
  );
}

function PositionStatement({
  positionId,
  currencyCode,
  version
}: {
  positionId: number;
  currencyCode: string;
  /** Muda quando o valor muda: recarrega o extrato. */
  version: number;
}) {
  const [lines, setLines] = useState<StatementLine[] | null>(null);
  useEffect(() => {
    void api<StatementLine[]>(`/positions/${positionId}/statement`)
      .then(setLines)
      .catch(() => setLines([]));
  }, [positionId, version]);
  if (!lines || lines.length === 0) return null;
  return (
    <section className="position-statement">
      <h4>Extrato</h4>
      <ul>
        {lines.map((line) => (
          <li key={line.id}>
            <span className="fin-muted">{longDate(line.date)}</span>
            <span>
              {MOVE_LABEL[line.kind] ?? line.kind}
              {line.kind === "adjust" && line.targetValue != null && (
                <small className="fin-muted"> · real {fmtCurrency(line.targetValue, currencyCode)}</small>
              )}
              {line.description &&
                line.kind !== "adjust" &&
                line.kind !== "yield" &&
                !line.description.startsWith(MOVE_LABEL[line.kind] ?? "\0") && (
                <small className="fin-muted"> · {line.description}</small>
              )}
            </span>
            <strong className={MOVE_TONE[line.kind] ?? ""}>
              {line.amount > 0 ? "+" : line.amount < 0 ? "−" : ""}
              {fmtCurrency(Math.abs(line.amount), currencyCode)}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
