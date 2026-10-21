import { Receipt } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryReport, CategoryTrend } from "@projeto41/contracts";
import { daysBetween, fromCents } from "@projeto41/finance";
import { AreaTrend, Donut, DualAreaTrend } from "../../components/charts.js";
import { CategoryTotalsTable, toneClass } from "../../components/finance/CategoryTotalsTable.js";
import {
  PeriodPicker,
  monthPeriod,
  periodLabel,
  type SelectedPeriod
} from "../../components/finance/PeriodPicker.js";
import { ExportMenu } from "../../components/ExportMenu.js";
import { Empty, Panel, SectionHeading, Skeleton } from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { filterToQuery } from "../../lib/ledger.js";
import { moneyFromCents } from "../../lib/format.js";
import { spendTone, variationText } from "../../lib/report-format.js";
import { useToast } from "../../lib/toast.js";

/** Consulta de relatório: mês-calendário usa `period`, recorte livre usa from/to. */
function reportQuery(period: SelectedPeriod, compare?: boolean) {
  const params = new URLSearchParams();
  if (period.period) params.set("period", period.period);
  else if (period.year != null) params.set("year", String(period.year));
  else {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  if (compare != null) params.set("compare", compare ? "1" : "0");
  return `?${params.toString()}`;
}

/** O total do período antes de qualquer detalhe: é a primeira pergunta. */
function ReportSummary({ report }: { report: CategoryReport }) {
  const comparison = report.comparison;
  const base = comparison
    ? comparison.partial && comparison.previousToDateCents != null
      ? comparison.previousToDateCents
      : comparison.previousCents
    : null;
  const days = comparison?.partial
    ? comparison.daysElapsed
    : daysBetween(report.range.from, report.range.to) + 1;
  const budget = report.budgetTotalCents;

  return (
    <Panel className="fin-flow-panel">
      <div className="fin-flow fin-report-summary">
        <div className="fin-report-total">
          <span>Total gasto</span>
          <strong>{moneyFromCents(report.totalCents)}</strong>
        </div>
        {base != null && (
          <div>
            <span>Contra o anterior</span>
            <strong className={spendTone(report.totalCents, base)}>
              {variationText(report.totalCents, base)}
            </strong>
            <small className="fin-muted">
              {moneyFromCents(base)} {comparison?.partial ? "até o mesmo dia" : "antes"}
            </small>
          </div>
        )}
        {budget != null && budget > 0 && (
          <div>
            <span>Dos objetivos</span>
            <strong className={report.totalCents > budget ? "fin-negative" : ""}>
              {Math.round((report.totalCents / budget) * 100)}%
            </strong>
            <small className="fin-muted">de {moneyFromCents(budget)}</small>
          </div>
        )}
        {days > 0 && (
          <div>
            <span>Média por dia</span>
            <strong>{moneyFromCents(Math.round(report.totalCents / days))}</strong>
            <small className="fin-muted">
              {days} dia{days === 1 ? "" : "s"}
            </small>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function ReportsPage() {
  const toast = useToast();
  const [period, setPeriod] = useState<SelectedPeriod>(() => monthPeriod(0));
  const [report, setReport] = useState<CategoryReport | null>(null);
  const [yearReport, setYearReport] = useState<CategoryReport | null>(null);
  const [trend, setTrend] = useState<CategoryTrend[]>([]);
  const [selected, setSelected] = useState<(number | null)[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = period.year ?? Number(period.from.slice(0, 4));
      const [next, nextYear] = await Promise.all([
        api<CategoryReport>(`/ledger/reports/categories${reportQuery(period, true)}`),
        api<CategoryReport>(`/ledger/reports/categories?year=${year}&compare=0`)
      ]);
      setReport(next);
      setYearReport(nextYear);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [period, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // A série só é buscada quando há categoria escolhida: sem seleção não há
  // gráfico de tendência para desenhar.
  useEffect(() => {
    const ids = selected.filter((id): id is number => id != null);
    if (ids.length === 0) {
      setTrend([]);
      return;
    }
    const params = new URLSearchParams({ months: "12" });
    for (const id of ids) params.append("categoryId", String(id));
    if (period.period) params.set("endMonth", period.period);
    void api<CategoryTrend[]>(`/ledger/reports/categories/trend?${params.toString()}`)
      .then(setTrend)
      .catch(() => setTrend([]));
  }, [selected, period.period]);

  function toggleCategory(categoryId: number | null) {
    setSelected((current) => {
      if (current.includes(categoryId)) return current.filter((id) => id !== categoryId);
      // No máximo duas: é o que o gráfico de duas séries comporta.
      return [...current, categoryId].slice(-2);
    });
  }

  const toSlices = (source: CategoryReport | null) =>
    (source?.slices ?? []).map((slice) => ({
      key: String(slice.categoryId ?? slice.name),
      label: slice.name,
      value: slice.valueCents,
      color: slice.color ?? undefined,
      percentLabel: `${(slice.sharePerMille / 10).toFixed(1).replace(".", ",")}%`
    }));

  const trendData = useMemo(() => {
    if (trend.length === 0) return [];
    const months = trend[0]?.points.map((point) => point.month) ?? [];
    return months.map((month, index) => ({
      // `AreaTrend` e `shortAxis` esperam uma data; o dia 1 é só a âncora do mês.
      date: `${month}-01`,
      // Conversão centavos → reais acontece SÓ aqui, na fronteira de
      // renderização, porque o eixo Y usa `compactMoney`, que espera reais.
      // Nenhuma soma acontece depois desta linha.
      a: fromCents(trend[0]?.points[index]?.totalCents ?? 0),
      b: fromCents(trend[1]?.points[index]?.totalCents ?? 0)
    }));
  }, [trend]);

  const comparison = report?.comparison;

  return (
    <>
      <SectionHeading title="Relatórios" subtitle={`Gastos de ${periodLabel(period)}`}>
        {/* O PDF sai do servidor com o mesmo período escolhido aqui. */}
        <ExportMenu
          csvUrl={`/api/ledger/export.csv${filterToQuery({ from: period.from, to: period.to })}`}
          pdfUrl={`/api/ledger/report.pdf${reportQuery(period)}`}
        />
      </SectionHeading>

      <Panel bodyClass="fin-filter-body">
        <PeriodPicker value={period} onChange={setPeriod} />
      </Panel>

      {loading && <Skeleton rows={8} />}

      {!loading && report && (
        <>
          <ReportSummary report={report} />

          <Panel title="Totais por categoria" subtitle="Clique numa categoria para ver a tendência">
            <CategoryTotalsTable
              report={report}
              onSelectCategory={toggleCategory}
              selectedIds={selected}
            />
          </Panel>

          {trend.length > 0 && (
            <Panel
              title={`Tendência · ${trend.map((series) => series.name).join(" × ")}`}
              subtitle="Últimos 12 meses"
            >
              {trend.length === 1 ? (
                <AreaTrend data={trendData.map(({ date, a }) => ({ date, value: a }))} dataKey="value" />
              ) : (
                <DualAreaTrend
                  data={trendData}
                  xKey="date"
                  keys={["a", "b"]}
                  names={[trend[0]?.name ?? "", trend[1]?.name ?? ""]}
                />
              )}
            </Panel>
          )}

          <div className="fin-donuts">
            <Panel title="Composição do período" subtitle={periodLabel(period)}>
              {report.slices.length === 0 ? (
                <Empty icon={Receipt} text="Nenhum gasto no período." />
              ) : (
                <Donut
                  data={toSlices(report)}
                  legend
                  showValue
                  formatValue={moneyFromCents}
                  height={200}
                  center={{ label: "Total", value: moneyFromCents(report.totalCents) }}
                />
              )}
            </Panel>
            <Panel title="Composição do ano" subtitle={String(period.year ?? period.from.slice(0, 4))}>
              {(yearReport?.slices.length ?? 0) === 0 ? (
                <Empty icon={Receipt} text="Nenhum gasto no ano." />
              ) : (
                <Donut
                  data={toSlices(yearReport)}
                  legend
                  showValue
                  formatValue={moneyFromCents}
                  height={200}
                  center={{ label: "Total", value: moneyFromCents(yearReport?.totalCents ?? 0) }}
                />
              )}
            </Panel>
          </div>

          {comparison && comparison.rows.length > 0 && (
            <Panel
              title="Comparativo com o período anterior"
              subtitle={`${comparison.previousRange.from} a ${comparison.previousRange.to}`}
            >
              {comparison.partial && (
                // Sem este rótulo o comparativo mente todo dia 3: 21 dias
                // contra 31 sempre parecem "gastou menos".
                <p className="fin-warning">
                  Parcial: {comparison.daysElapsed} de {comparison.daysInPeriod} dias. A comparação
                  usa o período anterior truncado no mesmo dia
                  {comparison.previousToDateCents != null && (
                    <>
                      {" "}
                      ({moneyFromCents(comparison.previousToDateCents)}); o período anterior inteiro
                      somou {moneyFromCents(comparison.previousCents)}.
                    </>
                  )}
                </p>
              )}
              <ComparisonTotal
                currentCents={report.totalCents}
                previousCents={
                  comparison.partial && comparison.previousToDateCents != null
                    ? comparison.previousToDateCents
                    : comparison.previousCents
                }
              />
              <ul className="fin-comparison">
                {comparison.rows.map((row) => (
                  <li key={row.categoryId ?? row.name} title={row.label}>
                    <span className="fin-comparison-name">{row.name}</span>
                    <strong className={toneClass(row.tone)}>
                      {variationText(row.currentCents, row.previousCents)}
                    </strong>
                    <small className="fin-muted">
                      {moneyFromCents(row.previousCents)} → {moneyFromCents(row.currentCents)}
                    </small>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </>
  );
}

function ComparisonTotal({ currentCents, previousCents }: { currentCents: number; previousCents: number }) {
  return (
    <div className="fin-comparison-total">
      <span>Total</span>
      <strong className={spendTone(currentCents, previousCents)}>
        {variationText(currentCents, previousCents)}
      </strong>
      <small className="fin-muted">
        {moneyFromCents(previousCents)} → {moneyFromCents(currentCents)}
      </small>
    </div>
  );
}
