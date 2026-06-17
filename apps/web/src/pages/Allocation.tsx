import { Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Donut } from "../components/charts.js";
import { Empty, MiniStat, Panel, SectionHeading } from "../components/ui.js";
import { api } from "../lib/api.js";
import { categoryLabel, money, percent } from "../lib/format.js";
import { useToast } from "../lib/toast.js";
import type { AllocationTarget, Dashboard } from "../lib/types.js";

const aliasToCategory: Record<string, string> = {
  dolar: "dollar",
  caixa_br: "cash",
  bolsa_brasil: "b3",
  renda_fixa: "fixed_income",
  acoes_globais: "global"
};

function actualValue(category: string, dashboard: Dashboard) {
  if (category === "bitcoin") {
    return dashboard.portfolios.crypto.find((asset) => asset.asset === "BTC")?.marketValueBrl ?? 0;
  }
  if (category === "shitcoins") {
    return dashboard.portfolios.crypto
      .filter((asset) => asset.asset !== "BTC")
      .reduce((sum, asset) => sum + asset.marketValueBrl, 0);
  }
  return dashboard.categories[aliasToCategory[category] ?? category] ?? 0;
}

const oneDecimal = (weight: number) => `${(weight * 100).toFixed(1).replace(".", ",")}%`;

export function AllocationPage({ dashboard }: { dashboard: Dashboard }) {
  const toast = useToast();
  const [targets, setTargets] = useState<AllocationTarget[]>([]);
  const load = useCallback(() => api<AllocationTarget[]>("/allocation").then(setTargets), []);
  useEffect(() => void load(), [load]);

  const investable = dashboard.totalBrl - dashboard.reserveBrl;

  // Ordenado pelo valor atual (estável durante o arraste do slider).
  const rows = useMemo(
    () =>
      targets
        .map((target) => {
          const actual = actualValue(target.category, dashboard);
          return {
            ...target,
            actual,
            actualWeight: investable > 0 ? actual / investable : 0
          };
        })
        .sort((a, b) => b.actual - a.actual),
    [targets, dashboard, investable]
  );

  const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0);
  const weightOff = Math.abs(totalWeight - 1) > 0.0005;

  // Donut da meta que está sendo montada — redesenha ao vivo conforme os sliders.
  const targetSlices = useMemo(
    () =>
      rows
        .filter((row) => row.weight > 0)
        .map((row) => ({
          key: row.category,
          label: categoryLabel(row.category),
          value: row.weight
        })),
    [rows]
  );

  function setWeight(category: string, weight: number) {
    setTargets((current) =>
      current.map((target) => (target.category === category ? { ...target, weight } : target))
    );
  }

  async function commit(category: string, weight: number) {
    await api(`/allocation/${category}`, { method: "PUT", body: JSON.stringify({ weight }) });
    toast.notify("Meta atualizada");
  }

  return (
    <div className="allocation">
      <SectionHeading
        title="Alocação ideal"
        subtitle="Compara a estratégia com a carteira atual (reserva excluída)"
      />

      <div className="summary-row">
        <MiniStat label="Total investível" value={money(investable)} />
        <MiniStat label="Reserva (fora da meta)" value={money(dashboard.reserveBrl)} />
        <MiniStat
          label={weightOff ? "Soma das metas · ajuste p/ 100%" : "Soma das metas"}
          value={oneDecimal(totalWeight)}
          tone={weightOff ? "negative-text" : "positive-text"}
        />
      </div>

      <Panel title="Real x ideal" subtitle="Arraste o marcador para definir a meta de cada classe">
        <div className="allocation-split">
          <div className="allocation-list">
            {rows.map((row) => (
              <div className="allocation-row" key={row.category}>
                <div className="allocation-name">
                  <strong>{categoryLabel(row.category)}</strong>
                  <span>
                    {money(row.actual)} · {percent(row.actualWeight)} atual
                  </span>
                </div>
                <div className="alloc-slider">
                  <div className="allocation-track">
                    <div
                      className="allocation-fill"
                      style={{ width: `${Math.min(100, row.actualWeight * 100)}%` }}
                    />
                  </div>
                  <input
                    className="alloc-range"
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={+(row.weight * 100).toFixed(1)}
                    aria-label={`Meta de ${categoryLabel(row.category)}`}
                    onChange={(event) => setWeight(row.category, Number(event.target.value) / 100)}
                    onPointerUp={(event) =>
                      void commit(row.category, Number((event.target as HTMLInputElement).value) / 100)
                    }
                    onKeyUp={(event) =>
                      void commit(row.category, Number((event.target as HTMLInputElement).value) / 100)
                    }
                  />
                </div>
                <strong className="alloc-target-value">{oneDecimal(row.weight)}</strong>
              </div>
            ))}
            {!rows.length && <Empty icon={Target} text="Nenhuma meta de alocação definida." />}
          </div>
          {rows.length > 0 && (
            <aside className="allocation-chart">
              <span className="allocation-chart-label">Meta em construção</span>
              <Donut data={targetSlices} height={340} />
            </aside>
          )}
        </div>
      </Panel>
    </div>
  );
}
