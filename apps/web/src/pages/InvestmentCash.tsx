import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpFromLine,
  Banknote,
  Landmark,
  Plus,
  Save,
  ShoppingCart,
  Undo2,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Dashboard, ManualPositionRecord, PositionRecord } from "@projeto41/contracts";
import { Drawer, useConfirm } from "../components/dialog.js";
import { PositionMoveDrawer, type MoveMode } from "../components/PositionMoveDrawer.js";
import {
  Button,
  Empty,
  Field,
  IconButton,
  Loading,
  Panel,
  SectionHeading,
  Segmented,
  Tag
} from "../components/ui.js";
import { api } from "../lib/api.js";
import {
  POSITION_CATEGORY_LABEL,
  isLiquid,
  MOVE_LABEL,
  useInvestmentCash,
  type CashSettings,
  type PositionMovement
} from "../lib/cash.js";
import { currency, ledgerDate, money, moneyFromCents } from "../lib/format.js";
import { useToast } from "../lib/toast.js";

/**
 * Em caixa: a visão do dinheiro que está entre o banco e as aplicações.
 *
 * Os caixas são as posições líquidas de "Caixa e renda fixa" (Caixa BR, Dólar,
 * Reserva) — as mesmas que o usuário já cria, agora ligadas à conta bancária.
 * O dinheiro chega por aporte; daqui é alocado numa aplicação (mover para a
 * renda fixa) ou numa compra (cripto, B3); e volta ao banco por resgate.
 */

type PayMode = "position" | "bank" | "none";


export function InvestmentCashPage({
  dashboard,
  onChanged,
  onBuy,
  onOpenPositions
}: {
  dashboard: Dashboard | null;
  onChanged: () => Promise<void> | void;
  /** Abre a carteira com a compra pronta, paga por este caixa. */
  onBuy: (portfolio: "crypto" | "b3", positionId: number) => void;
  onOpenPositions: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { settings, banks, positions, caixas, loading, reload } = useInvestmentCash();
  const [movements, setMovements] = useState<PositionMovement[]>([]);
  const [drawer, setDrawer] = useState<{ mode: MoveMode; positionId?: number } | null>(null);
  const [creating, setCreating] = useState(false);

  const loadMovements = useCallback(async () => {
    setMovements(await api<PositionMovement[]>("/investments/movements?limit=40"));
  }, []);

  useEffect(() => {
    void loadMovements().catch(() => setMovements([]));
  }, [loadMovements]);

  const refresh = async () => {
    await Promise.all([reload(), loadMovements(), onChanged()]);
  };

  async function undo(movement: PositionMovement) {
    const ok = await confirm({
      title: `Desfazer ${MOVE_LABEL[movement.kind].toLowerCase()}`,
      message:
        movement.transferId != null
          ? `O valor volta para onde estava, e o lançamento em ${movement.accountName ?? "conta"} é removido.`
          : "O valor volta para a posição de origem.",
      confirmLabel: "Desfazer"
    });
    if (!ok) return;
    try {
      await api(`/investments/movements/${movement.id}`, { method: "DELETE" });
      toast.notify("Movimento desfeito");
      await refresh();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao desfazer", "error");
    }
  }

  if (loading || !settings) return <Loading />;

  const usdBrl = dashboard?.usdBrl ?? 0;
  const toBrl = (position: ManualPositionRecord) =>
    position.currentValue * (position.currency === "USD" ? usdBrl : 1);
  const bankCents = banks
    .filter((account) => account.includeInNetWorth)
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const cashBrl = caixas.reduce((sum, position) => sum + toBrl(position), 0);
  // Aplicado: tudo que já virou investimento — carteiras e posições não líquidas.
  const appliedBrl = Math.max(0, (dashboard?.investmentsBrl ?? 0) - cashBrl);
  const applications = positions.filter((position) => !isLiquid(position));

  return (
    <>
      <SectionHeading
        title="Em caixa"
        subtitle="O dinheiro entre o banco e as aplicações: aporte, decida e aloque"
      >
        <Button variant="ghost" icon={Plus} onClick={() => setCreating(true)}>
          Novo caixa
        </Button>
        <Button
          icon={ArrowDownToLine}
          onClick={() => setDrawer({ mode: "deposit" })}
          disabled={banks.length === 0 || positions.length === 0}
        >
          Aportar
        </Button>
      </SectionHeading>

      {/* O caminho do dinheiro, com os três saldos: é a explicação da tela. */}
      <Panel>
        <div className="cash-flow" aria-label="Caminho do dinheiro">
          <div className="cash-flow-node">
            <Landmark size={18} aria-hidden />
            <span>Contas bancárias</span>
            <strong>{moneyFromCents(bankCents)}</strong>
          </div>
          <div className="cash-flow-arrow">
            <small>aporte</small>
            <ArrowRight size={18} aria-hidden />
            <small>resgate</small>
          </div>
          <div className="cash-flow-node highlight">
            <Wallet size={18} aria-hidden />
            <span>Em caixa</span>
            <strong>{money(cashBrl)}</strong>
          </div>
          <div className="cash-flow-arrow">
            <small>alocar</small>
            <ArrowRight size={18} aria-hidden />
            <small>venda</small>
          </div>
          <div className="cash-flow-node">
            <ShoppingCart size={18} aria-hidden />
            <span>Aplicado</span>
            <strong>{money(appliedBrl)}</strong>
          </div>
        </div>
      </Panel>

      {caixas.length === 0 ? (
        <Panel>
          <div className="fin-onboarding">
            <Empty
              icon={Banknote}
              text="Nenhum caixa ainda. Crie um — por exemplo o saldo parado na corretora — e aporte nele."
            />
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Criar o primeiro caixa
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="cash-brokers">
          {caixas.map((position) => (
            <Panel
              key={position.id}
              title={
                <span className="fin-inline">
                  {position.name}
                  <Tag tone="info">{POSITION_CATEGORY_LABEL[position.category]}</Tag>
                  {position.yield && <Tag tone="positive">{position.cdiPercent}% do CDI</Tag>}
                </span>
              }
              subtitle={position.category === "reserve" ? "Reserva: fora da meta de alocação" : "Disponível para alocar"}
            >
              <strong className="cash-broker-value">{currency(position.currentValue, position.currency)}</strong>
              {position.history.yieldTotal > 0 && (
                <small className="positive-text">
                  {currency(position.history.yieldTotal, position.currency)} de rendimento já no valor
                </small>
              )}
              <div className="cash-broker-actions">
                <Button
                  variant="soft"
                  icon={ArrowRightLeft}
                  onClick={() => setDrawer({ mode: "move", positionId: position.id })}
                  disabled={positions.length < 2}
                >
                  Alocar
                </Button>
                <Button variant="ghost" icon={ShoppingCart} onClick={() => onBuy("crypto", position.id)}>
                  Cripto
                </Button>
                <Button variant="ghost" icon={ShoppingCart} onClick={() => onBuy("b3", position.id)}>
                  B3
                </Button>
                <IconButton
                  icon={ArrowDownToLine}
                  label={`Aportar em ${position.name}`}
                  onClick={() => setDrawer({ mode: "deposit", positionId: position.id })}
                  disabled={banks.length === 0}
                />
                <IconButton
                  icon={ArrowUpFromLine}
                  label={`Resgatar de ${position.name}`}
                  onClick={() => setDrawer({ mode: "withdraw", positionId: position.id })}
                  disabled={banks.length === 0}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}

      {applications.length > 0 && (
        <Panel
          title="Aplicações"
          subtitle="Também recebem aporte direto, sem passar por caixa"
          action={
            <Button variant="ghost" icon={ArrowRight} onClick={onOpenPositions}>
              Caixa e renda fixa
            </Button>
          }
        >
          <ul className="cash-suggestion">
            {applications.map((position) => (
              <li key={position.id}>
                <span>
                  {position.name}{" "}
                  <small className="fin-muted">· {POSITION_CATEGORY_LABEL[position.category]}</small>
                </span>
                <strong>{currency(position.currentValue, position.currency)}</strong>
                <span className="cash-row-actions">
                  <IconButton
                    icon={ArrowDownToLine}
                    label={`Aportar em ${position.name}`}
                    onClick={() => setDrawer({ mode: "deposit", positionId: position.id })}
                    disabled={banks.length === 0}
                  />
                  <IconButton
                    icon={ArrowUpFromLine}
                    label={`Resgatar de ${position.name}`}
                    onClick={() => setDrawer({ mode: "withdraw", positionId: position.id })}
                    disabled={banks.length === 0}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Movimentações" subtitle="Aportes, resgates, alocações e operações pagas por um caixa">
        {movements.length === 0 ? (
          <Empty icon={Wallet} text="Nada entrou nem saiu ainda. Comece por um aporte." />
        ) : (
          <ul className="cash-moves">
            {movements.map((movement) => (
              <li key={movement.id}>
                <span className="cash-move-date">{ledgerDate(movement.date)}</span>
                <span className="cash-move-main">
                  <strong>
                    {MOVE_LABEL[movement.kind]} · {movement.positionName}
                  </strong>
                  <small>
                    {movement.kind === "deposit" && `de ${movement.accountName ?? "conta"}`}
                    {movement.kind === "withdrawal" && `para ${movement.accountName ?? "conta"}`}
                    {movement.kind !== "deposit" && movement.kind !== "withdrawal" &&
                      (movement.description ?? "")}
                  </small>
                </span>
                <strong className={movement.amount < 0 ? "" : "fin-positive"}>
                  {movement.amount > 0 ? "+" : "−"}
                  {currency(Math.abs(movement.amount), movement.positionCurrency)}
                </strong>
                {movement.operationId == null && movement.kind !== "move_in" ? (
                  <IconButton icon={Undo2} label="Desfazer" onClick={() => void undo(movement)} />
                ) : (
                  <span className="cash-move-spacer" aria-hidden />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PaymentSettings settings={settings} caixas={caixas} banks={banks} onSaved={refresh} />

      {drawer && (
        <PositionMoveDrawer
          mode={drawer.mode}
          positions={positions}
          banks={banks}
          initialPositionId={drawer.positionId}
          onClose={() => setDrawer(null)}
          onDone={async () => {
            setDrawer(null);
            await refresh();
          }}
        />
      )}

      {creating && (
        <NewCashDrawer
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}

type CashCategory = "cash" | "dollar" | "crypto" | "reserve";

/** Um caixa novo é uma posição líquida de "Caixa e renda fixa", começando em zero. */
function NewCashDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CashCategory>("cash");
  // Dólar e cripto começam em dólar, mas qualquer caixa pode ser em reais.
  const [currencyCode, setCurrencyCode] = useState<"BRL" | "USD">("BRL");
  const chooseCategory = (next: CashCategory) => {
    setCategory(next);
    setCurrencyCode(next === "dollar" || next === "crypto" ? "USD" : "BRL");
  };
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.notify("Dê um nome ao caixa", "error");
      return;
    }
    setSaving(true);
    try {
      await api("/positions", {
        method: "POST",
        body: JSON.stringify({
          category,
          name: name.trim(),
          invested: 0,
          currentValue: 0,
          currency: currencyCode
        })
      });
      toast.notify("Caixa criado: aporte para colocar dinheiro nele");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao criar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DrawerShell title="Novo caixa" onClose={onClose} saving={saving} formId="new-cash-form">
      <form id="new-cash-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Saldo na corretora"
            autoFocus
          />
        </Field>
        <Field label="Tipo" hint="Aparece também em Caixa e renda fixa">
          <Segmented<CashCategory>
            value={category}
            onChange={chooseCategory}
            options={[
              { value: "cash", label: "Caixa BR" },
              { value: "dollar", label: "Dólar" },
              { value: "crypto", label: "Cripto" },
              { value: "reserve", label: "Reserva de emergência" }
            ]}
          />
        </Field>
        <Field
          label="Moeda"
          hint={
            currencyCode === "USD"
              ? "Em dólar: o aporte sai do banco em reais e é convertido pela cotação do dia."
              : "Em reais: o valor do caixa é o que você aportou, sem conversão."
          }
        >
          <Segmented<"BRL" | "USD">
            value={currencyCode}
            onChange={setCurrencyCode}
            options={[
              { value: "BRL", label: "Reais (R$)" },
              { value: "USD", label: "Dólares (US$)" }
            ]}
          />
        </Field>
      </form>
    </DrawerShell>
  );
}

function DrawerShell({
  title,
  onClose,
  saving,
  formId,
  children
}: {
  title: string;
  onClose: () => void;
  saving: boolean;
  formId: string;
  children: React.ReactNode;
}) {
  return (
    <Drawer
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form={formId} disabled={saving}>
            {saving ? "Salvando…" : "Criar"}
          </Button>
        </>
      }
    >
      {children}
    </Drawer>
  );
}

/**
 * Como uma compra paga por padrão. Uma escolha só, com a consequência escrita
 * embaixo — no lugar da antiga caixa "movimentar o caixa" mais "conta padrão".
 */
function PaymentSettings({
  settings,
  caixas,
  banks,
  onSaved
}: {
  settings: CashSettings;
  caixas: PositionRecord[];
  banks: { id: number; name: string }[];
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);

  const mode: PayMode =
    draft.defaultPositionId != null
      ? "position"
      : draft.autoDebit && draft.defaultAccountId != null
        ? "bank"
        : "none";
  const setMode = (next: PayMode) =>
    setDraft((current) => ({
      autoDebit: next !== "none",
      defaultPositionId: next === "position" ? (current.defaultPositionId ?? caixas[0]?.id ?? null) : null,
      defaultAccountId: next === "bank" ? (current.defaultAccountId ?? banks[0]?.id ?? null) : null
    }));

  const explanation: Record<PayMode, string> = {
    position:
      "Compras saem do caixa escolhido e vendas voltam para ele. Você aporta quando quiser e aloca aos poucos.",
    bank: "Compras saem direto da conta e vendas voltam para ela, sem passar por caixa.",
    none: "Operações ficam só registradas na carteira, sem mexer em dinheiro. Bom para lançar histórico."
  };

  async function save() {
    setSaving(true);
    try {
      await api("/investments/cash-settings", { method: "PUT", body: JSON.stringify(draft) });
      toast.notify("Configuração salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Como as operações pagam"
      subtitle="Vale como padrão; cada compra ou venda ainda pode escolher outra coisa"
      action={
        <Button icon={Save} variant="ghost" onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      }
    >
      <div className="stack">
        <Segmented<PayMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "position", label: "Um caixa" },
            { value: "bank", label: "Direto da conta" },
            { value: "none", label: "Só registrar" }
          ]}
        />
        <p className="fin-muted">{explanation[mode]}</p>

        {mode === "position" && (
          <Field label="Caixa padrão">
            <select
              value={draft.defaultPositionId ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, defaultPositionId: Number(event.target.value) }))
              }
            >
              {caixas.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {mode === "bank" && (
          <Field label="Conta padrão">
            <select
              value={draft.defaultAccountId ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, defaultAccountId: Number(event.target.value) }))
              }
            >
              {banks.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Panel>
  );
}
