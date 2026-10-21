import { AlertTriangle, Scale, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dashboard, ManualPositionRecord } from "@projeto41/contracts";
import { Donut } from "../../components/charts.js";
import { useConfirm } from "../../components/dialog.js";
import {
  AnimatedNumber,
  Button,
  Delta,
  Empty,
  Kpi,
  Loading,
  Panel,
  SectionHeading,
  Segmented,
  Tag
} from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { ALL_INVESTMENT_ACCOUNTS } from "../../lib/investment-account.js";
import { categoryLabel, longDate, money, percent } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

type Scope = "bank" | "all";

/** As classes do livro; as demais são o módulo de investimentos. */
const isLedgerClass = (key: string) => key.startsWith("ledger:");

export function NetWorthPage({
  dashboard,
  onChanged
}: {
  dashboard: Dashboard | null;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [scope, setScope] = useState<Scope>("all");
  const [positions, setPositions] = useState<ManualPositionRecord[]>([]);

  const loadPositions = useCallback(async () => {
    // O patrimônio soma todas as contas de investimento.
    setPositions(await api<ManualPositionRecord[]>("/positions", { headers: ALL_INVESTMENT_ACCOUNTS }));
  }, []);

  useEffect(() => {
    void loadPositions().catch(() => undefined);
  }, [loadPositions]);

  const entries = useMemo(() => {
    if (!dashboard) return [];
    return Object.entries(dashboard.categories)
      .filter(([key]) => (scope === "bank" ? isLedgerClass(key) : true))
      .filter(([, value]) => value !== 0)
      .sort((a, b) => b[1] - a[1]);
  }, [dashboard, scope]);

  const total = scope === "bank" ? (dashboard?.bankOnlyBrl ?? 0) : (dashboard?.totalBrl ?? 0);
  const positive = entries.filter(([, value]) => value > 0);
  const slices = positive.map(([key, value]) => ({
    key,
    label: categoryLabel(key),
    value
  }));
  const positiveTotal = positive.reduce((sum, [, value]) => sum + value, 0);

  /** Variação desde o último snapshot, para o `Delta`. */
  const change = useMemo(() => {
    const last = dashboard?.history.at(-1);
    if (!last || last.totalBrl === 0) return null;
    return (total - last.totalBrl) / Math.abs(last.totalBrl);
  }, [dashboard, total]);

  async function zeroPosition(position: { id: number; name: string }) {
    const full = positions.find((item) => item.id === position.id);
    if (!full) return;
    const ok = await confirm({
      title: "Zerar posição manual",
      message: `"${position.name}" passa a valer R$ 0,00. A posição continua existindo em "Caixa e renda fixa", onde você pode excluí-la de vez.`,
      confirmLabel: "Zerar"
    });
    if (!ok) return;
    await api(`/positions/${position.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...full, currentValue: 0 })
    });
    toast.notify("Posição zerada");
    await loadPositions();
    await onChanged();
  }

  if (!dashboard) return <Loading />;

  const cardDebt = dashboard.categories["ledger:credit_card"] ?? 0;
  const recentStep =
    dashboard.cashControlStartedOn != null &&
    Date.now() - new Date(`${dashboard.cashControlStartedOn}T12:00:00`).getTime() <
      7 * 86_400_000;

  return (
    <>
      <SectionHeading
        title="Patrimônio"
        subtitle="Contas, caixinhas e investimentos, menos a dívida de cartão"
      />

      {/* O aviso fica no topo, não no rodapé: é um erro de contabilidade em
          potencial, e ele some sozinho quando a condição deixa de valer. */}
      {dashboard.doubleCounting.active && (
        <Panel
          title={
            <span className="fin-inline">
              <AlertTriangle size={15} aria-hidden />
              Possível contagem dupla
            </span>
          }
          subtitle="Estas posições manuais podem representar o mesmo dinheiro das contas do livro"
          className="fin-alert"
        >
          <ul className="fin-list">
            {dashboard.doubleCounting.manualPositions.map((position) => (
              <li key={position.id}>
                <span>
                  {position.name}
                  <small className="fin-sub">{categoryLabel(position.category)}</small>
                </span>
                <span className="fin-list-meta">
                  <strong>{money(position.currentValue)}</strong>
                  <Button variant="ghost" onClick={() => void zeroPosition(position)}>
                    Zerar posição manual
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <small className="fin-muted">
            As contas do livro somam {money(dashboard.doubleCounting.ledgerBalanceBrl)}.
          </small>
        </Panel>
      )}

      <Panel bodyClass="fin-filter-body">
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { value: "bank", label: "Só banco" },
            { value: "all", label: "Banco + investimentos" }
          ]}
        />
      </Panel>

      <div className="fin-summary">
        <Kpi
          icon={Scale}
          label={scope === "bank" ? "Saldo em contas" : "Patrimônio total"}
          value={<AnimatedNumber value={total} format={money} />}
          detail={
            scope === "bank"
              ? "já descontando a dívida de cartão"
              : `investimentos ${money(dashboard.investmentsBrl)}`
          }
          right={change != null ? <Delta value={change} /> : undefined}
        />
        <Kpi
          icon={TrendingUp}
          label="Investimentos"
          value={<AnimatedNumber value={dashboard.investmentsBrl} format={money} />}
          detail="carteiras e posições manuais"
        />
      </div>

      {recentStep && (
        <p className="fin-warning">
          O controle de caixa começou em {longDate(dashboard.cashControlStartedOn!)}. O gráfico do
          histórico marca esse dia: antes dele, o patrimônio media só os investimentos.
        </p>
      )}

      <div className="fin-columns">
        <Panel title="Composição" subtitle={scope === "bank" ? "Só o livro" : "Tudo"}>
          {positive.length === 0 ? (
            <Empty icon={Scale} text="Nada a compor ainda." />
          ) : (
            <Donut data={slices} />
          )}
        </Panel>

        <Panel title="Classes" subtitle="Valor e participação">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Classe</th>
                  <th className="num">Valor</th>
                  <th className="num">Participação</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .filter(([key]) => key !== "ledger:credit_card")
                  .map(([key, value]) => (
                    <tr key={key}>
                      <td>{categoryLabel(key)}</td>
                      <td className="num">{money(value)}</td>
                      <td className="num fin-muted">
                        {positiveTotal > 0 ? percent(value / positiveTotal) : "—"}
                      </td>
                    </tr>
                  ))}
                {cardDebt !== 0 && (
                  // Passivo fica FORA da rosca — rosca não representa número
                  // negativo — e aparece como linha própria.
                  <tr>
                    <td>
                      <span className="fin-inline">
                        {categoryLabel("ledger:credit_card")}
                        <Tag tone="negative">entra pelo total devido</Tag>
                      </span>
                      <small className="fin-sub">
                        fatura atual {money(dashboard.creditCardCurrentBrl)} · total devido{" "}
                        {money(Math.abs(cardDebt))}
                      </small>
                    </td>
                    <td className="num fin-negative">{money(cardDebt)}</td>
                    <td className="num fin-muted">—</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="num">{money(total)}</th>
                  <th className="num">100%</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
