import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryRecord, CategoryReport } from "@projeto41/contracts";
import { AllocationBoard, type AllocationRow } from "../../components/AllocationBoard.js";
import {
  PeriodPicker,
  monthPeriod,
  periodLabel,
  type SelectedPeriod
} from "../../components/finance/PeriodPicker.js";
import { MiniStat, Panel, SectionHeading, Skeleton } from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

/**
 * Alocação de gastos: a tela de alocação da carteira, aplicada ao orçamento.
 *
 * Em vez de "quanto da carteira em cada classe", responde "quanto dos meus
 * gastos em cada categoria". O trilho mostra a fatia real do período
 * escolhido; o marcador define o objetivo percentual da categoria — o mesmo
 * `budget_share_per_mille` que a tela de Gastos compara com o realizado.
 *
 * Categoria com objetivo **em valor** aparece travada: arrastar o marcador
 * trocaria o modo em silêncio e apagaria o valor que o usuário digitou. A troca
 * de modo é explícita, na tela de Categorias.
 */

const perMilleLabel = (value: number) => `${(value / 10).toFixed(1).replace(".", ",")}%`;

export function SpendingAllocationPage() {
  const toast = useToast();
  const [period, setPeriod] = useState<SelectedPeriod>(() => monthPeriod(0));
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [report, setReport] = useState<CategoryReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ from: period.from, to: period.to, compare: "0" });
      const [nextCategories, nextReport] = await Promise.all([
        api<CategoryRecord[]>("/ledger/categories?kind=expense"),
        api<CategoryReport>(`/ledger/reports/categories?${params.toString()}`)
      ]);
      setCategories(nextCategories);
      setReport(nextReport);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [period, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const spentBy = useMemo(
    () => new Map((report?.rows ?? []).map((row) => [row.categoryId, row.spentCents])),
    [report]
  );
  // A mesma base do servidor: só o que efetivamente saiu.
  const base = useMemo(
    () => (report?.rows ?? []).reduce((total, row) => total + Math.max(row.spentCents, 0), 0),
    [report]
  );

  const rows = useMemo<AllocationRow[]>(
    () =>
      categories
        .map((category) => {
          const spent = Math.max(spentBy.get(category.id) ?? 0, 0);
          const actualWeight = base > 0 ? spent / base : 0;
          return {
            key: String(category.id),
            label: category.name,
            color: category.color,
            detail: `${moneyFromCents(spent)} · ${perMilleLabel(actualWeight * 1000)} atual`,
            actualWeight,
            weight: (category.budgetSharePerMille ?? 0) / 1000,
            ...(category.monthlyBudgetCents != null
              ? {
                  lockedReason: `Objetivo em valor: ${moneyFromCents(
                    category.monthlyBudgetCents
                  )}/mês · mude o modo em Categorias`
                }
              : {})
          };
        })
        // Ordenado pelo gasto real, estável durante o arraste do marcador.
        .sort((a, b) => b.actualWeight - a.actualWeight || a.label.localeCompare(b.label)),
    [categories, spentBy, base]
  );

  const shareSum = categories.reduce(
    (total, category) => total + (category.budgetSharePerMille ?? 0),
    0
  );
  const sumOff = shareSum > 1000;

  function setWeight(key: string, weight: number) {
    setCategories((current) =>
      current.map((category) =>
        String(category.id) === key
          ? { ...category, budgetSharePerMille: Math.round(weight * 1000) }
          : category
      )
    );
  }

  async function commit(key: string, weight: number) {
    const perMille = Math.round(weight * 1000);
    try {
      // Zero é "sem objetivo", não "objetivo de gastar nada".
      await api(`/ledger/categories/${key}/budget`, {
        method: "PUT",
        body: JSON.stringify({ budgetSharePerMille: perMille === 0 ? null : perMille })
      });
      toast.notify("Objetivo atualizado");
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
      await load();
    }
  }

  return (
    <div className="allocation">
      <SectionHeading
        title="Alocação de gastos"
        subtitle={`Quanto dos gastos cada categoria deveria ser · ${periodLabel(period)}`}
      />

      <Panel bodyClass="fin-filter-body">
        <PeriodPicker value={period} onChange={setPeriod} />
      </Panel>

      {loading ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <div className="summary-row">
            <MiniStat label="Gasto no período" value={moneyFromCents(base)} />
            <MiniStat
              label={sumOff ? "Soma dos objetivos · passa de 100%" : "Soma dos objetivos"}
              value={perMilleLabel(shareSum)}
              tone={sumOff ? "negative-text" : "positive-text"}
            />
            <MiniStat
              label="Sem objetivo percentual"
              value={perMilleLabel(Math.max(1000 - shareSum, 0))}
            />
          </div>

          <Panel
            title="Real x objetivo"
            subtitle="O trilho é a fatia real do período; arraste o marcador para definir o objetivo"
          >
            <AllocationBoard
              rows={rows}
              onChange={setWeight}
              onCommit={commit}
              emptyText="Nenhuma categoria de saída cadastrada."
              chartLabel="Objetivo em construção"
              actualChartLabel="Gasto real do período · nenhum objetivo percentual ainda"
            />
          </Panel>
        </>
      )}
    </div>
  );
}
