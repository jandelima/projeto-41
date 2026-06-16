import { ArrowDownRight, ArrowUpRight, CircleDollarSign, PiggyBank, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { AreaTrend, Donut } from "../components/charts.js";
import { AnimatedNumber, Card, Delta, Kpi, Panel } from "../components/ui.js";
import { fx, money, percent, signedPercent, usd } from "../lib/format.js";
import type { Dashboard, Snapshot } from "../lib/types.js";

function changeSince(history: Snapshot[], days: number) {
  if (!history.length) return 0;
  const last = history[history.length - 1]!.totalBrl;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const past = [...history].reverse().find((item) => item.date <= cutoff) ?? history[0]!;
  return past.totalBrl > 0 ? last / past.totalBrl - 1 : 0;
}

const ranges = [
  { id: "ytd", label: "YTD" },
  { id: "3m", label: "90d", days: 90 },
  { id: "6m", label: "6m", days: 182 },
  { id: "1y", label: "1a", days: 365 },
  { id: "all", label: "Tudo" }
] as const;

type RangeId = (typeof ranges)[number]["id"];

export function filterHistory<T extends { date: string }>(history: T[], range: RangeId | string) {
  if (range === "all") return history;
  const now = new Date();
  const selectedRange = ranges.find((item) => item.id === range);
  const days = selectedRange && "days" in selectedRange ? selectedRange.days : 0;
  const cutoff =
    range === "ytd"
      ? new Date(now.getFullYear(), 0, 1)
      : new Date(now.getTime() - days * 86400000);
  const iso = cutoff.toISOString().slice(0, 10);
  return history.filter((item) => item.date >= iso);
}

export function DashboardPage({ data }: { data: Dashboard }) {
  const [range, setRange] = useState<RangeId>("ytd");

  const history = useMemo(() => filterHistory(data.history, range), [data.history, range]);

  const distribution = useMemo(() => {
    const btc = data.portfolios.crypto.find((asset) => asset.asset === "BTC")?.marketValueBrl ?? 0;
    const alts = data.portfolios.crypto
      .filter((asset) => asset.asset !== "BTC")
      .reduce((sum, asset) => sum + asset.marketValueBrl, 0);
    return [
      { key: "bitcoin", label: "Bitcoin", value: btc },
      { key: "shitcoins", label: "Altcoins", value: alts },
      { key: "b3", label: "Bolsa B3", value: data.categories.b3 ?? 0 },
      { key: "dollar", label: "Dólar", value: data.categories.dollar ?? 0 },
      { key: "cash", label: "Caixa BR", value: data.categories.cash ?? 0 },
      { key: "fixed_income", label: "Renda fixa", value: data.categories.fixed_income ?? 0 },
      { key: "global", label: "Ações globais", value: data.categories.global ?? 0 }
    ]
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const last = data.history.at(-1);
  const previous = data.history.at(-2);
  const dayChange = last && previous && previous.totalBrl > 0 ? last.totalBrl / previous.totalBrl - 1 : 0;
  const monthChange = changeSince(data.history, 30);
  const yearChange = changeSince(data.history, 365);
  const peak = data.history.reduce((max, item) => Math.max(max, item.totalBrl), 0);

  return (
    <div className="dashboard stagger">
      <section className="hero-grid">
        <Card glow className="hero-card">
          <div className="hero-top">
            <span className="card-label">
              <Wallet size={16} /> Patrimônio total
            </span>
            <Delta value={dayChange} suffix="hoje" />
          </div>
          <strong className="hero-value">
            <AnimatedNumber value={data.totalBrl} format={money} />
          </strong>
          <div className="hero-meta">
            <span>{usd(data.totalUsd)}</span>
            <span className="dot-sep" />
            <span>USD/BRL {fx(data.usdBrl, 4)}</span>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <span>30 dias</span>
              <strong className={monthChange >= 0 ? "positive-text" : "negative-text"}>
                <AnimatedNumber value={monthChange} format={signedPercent} countUp={false} />
              </strong>
            </div>
            <div className="hero-stat">
              <span>12 meses</span>
              <strong className={yearChange >= 0 ? "positive-text" : "negative-text"}>
                <AnimatedNumber value={yearChange} format={signedPercent} countUp={false} />
              </strong>
            </div>
            <div className="hero-stat">
              <span>Pico histórico</span>
              <strong>
                <AnimatedNumber value={peak} format={money} />
              </strong>
            </div>
          </div>
        </Card>
        <div className="kpi-stack stagger">
          <Kpi
            icon={data.annualReturn >= 0 ? ArrowUpRight : ArrowDownRight}
            label="Rentabilidade no ano"
            value={<AnimatedNumber value={data.annualReturn} format={percent} />}
            tone={data.annualReturn >= 0 ? "positive" : "negative"}
            detail="descontando aportes"
          />
          <Kpi
            icon={CircleDollarSign}
            label="Aportes no ano"
            value={<AnimatedNumber value={data.annualContributions} format={money} />}
            detail={`${new Date().getFullYear()}`}
          />
          <Kpi
            icon={PiggyBank}
            label="Reserva de emergência"
            value={<AnimatedNumber value={data.reserveBrl} format={money} />}
            detail={`${percent(data.totalBrl ? data.reserveBrl / data.totalBrl : 0)} do patrimônio`}
          />
        </div>
      </section>

      <section className="dashboard-grid">
        <Panel
          className="chart-panel"
          title="Evolução patrimonial"
          subtitle={`${history.length} registros`}
          action={
            <div className="range-tabs">
              {ranges.map((item) => (
                <button
                  key={item.id}
                  className={item.id === range ? "active" : ""}
                  onClick={() => setRange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          }
        >
          {history.length ? (
            <div className="chart-fill">
              <AreaTrend data={history} height="100%" />
            </div>
          ) : (
            <p className="muted-note">Sem registros no período selecionado.</p>
          )}
        </Panel>

        <Panel title="Distribuição" subtitle="Carteira por classe · sem reserva">
          <Donut data={distribution} />
        </Panel>
      </section>
    </div>
  );
}
