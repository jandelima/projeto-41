import { History as HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { AreaTrend } from "../components/charts.js";
import { Empty, MiniStat, Panel, SectionHeading } from "../components/ui.js";
import { longDate, money, percent } from "../lib/format.js";
import { filterHistory } from "./Dashboard.js";
import type { Snapshot } from "@projeto41/contracts";

const ranges = [
  { id: "ytd", label: "YTD" },
  { id: "3m", label: "90d" },
  { id: "6m", label: "6m" },
  { id: "1y", label: "1a" },
  { id: "all", label: "Tudo" }
] as const;

export function HistoryPage({
  history,
  cashControlStartedOn = null
}: {
  history: Snapshot[];
  /** Dia em que o patrimônio passou a somar caixa (D14). */
  cashControlStartedOn?: string | null;
}) {
  const [range, setRange] = useState<(typeof ranges)[number]["id"]>("all");

  const filtered = useMemo(() => filterHistory(history, range), [history, range]);

  const first = filtered[0];
  const last = filtered.at(-1);
  const periodChange = first && last && first.totalBrl > 0 ? last.totalBrl / first.totalBrl - 1 : 0;

  // O pico só compara snapshots da MESMA versão do último: um total v1 (só
  // investimentos) e um v2 (com caixa) são grandezas diferentes.
  const currentVersion = history.at(-1)?.payloadVersion ?? 1;
  const peak = history
    .filter((item) => item.payloadVersion === currentVersion)
    .reduce((max, item) => Math.max(max, item.totalBrl), 0);

  // O intervalo atravessa o degrau? Então a variação mistura duas definições.
  const crossesStep =
    cashControlStartedOn != null &&
    first != null &&
    last != null &&
    first.date < cashControlStartedOn &&
    last.date >= cashControlStartedOn;

  const marker =
    cashControlStartedOn != null &&
    filtered.some((item) => item.date >= cashControlStartedOn)
      ? { date: cashControlStartedOn, label: "início do controle de caixa" }
      : undefined;

  return (
    <div className="history">
      <SectionHeading title="Histórico patrimonial" subtitle="Snapshots diários às 23:59" />

      <div className="summary-row">
        <MiniStat label="Patrimônio atual" value={money(last?.totalBrl ?? 0)} />
        <MiniStat
          label="Variação no período"
          value={
            <>
              {`${periodChange >= 0 ? "+" : ""}${percent(periodChange)}`}
              {crossesStep && (
                <small className="fin-sub">o período atravessa o início do controle de caixa</small>
              )}
            </>
          }
          tone={periodChange >= 0 ? "positive-text" : "negative-text"}
        />
        <MiniStat label="Pico histórico" value={money(peak)} />
        <MiniStat label="Registros" value={String(history.length)} />
      </div>

      <Panel
        title="Evolução completa"
        subtitle={`${filtered.length} registros`}
        action={
          <div className="range-tabs">
            {ranges.map((item) => (
              <button key={item.id} className={item.id === range ? "active" : ""} onClick={() => setRange(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        {filtered.length ? (
          <AreaTrend data={filtered} height={360} tone="positive" marker={marker} />
        ) : (
          <Empty icon={HistoryIcon} text="Sem registros no período." />
        )}
      </Panel>

      <Panel title="Registros" subtitle="Mais recentes primeiro">
        <div className="table-scroll compact">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th className="right">Patrimônio</th>
                <th className="right">Variação diária</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((item, index, array) => {
                const previous = array[index + 1];
                const change = previous && previous.totalBrl > 0 ? item.totalBrl / previous.totalBrl - 1 : 0;
                return (
                  <tr key={item.date}>
                    <td>{longDate(item.date)}</td>
                    <td className="right num">
                      <strong>{money(item.totalBrl)}</strong>
                    </td>
                    <td className={`right num ${change >= 0 ? "positive-text" : "negative-text"}`}>
                      {change >= 0 ? "+" : ""}
                      {percent(change)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
