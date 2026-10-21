import { Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CategoryRecord, CategoryReport } from "@projeto41/contracts";
import { shareBudgetCents, wholeMonthsIn } from "@projeto41/finance";
import { Empty } from "../ui.js";
import { api } from "../../lib/api.js";
import { moneyFromCents } from "../../lib/format.js";

/**
 * Objetivo x realizado por categoria de saida, no recorte da tela de Gastos.
 *
 * O objetivo vem de dois jeitos e a tela mostra os dois lado a lado: em valor
 * ("R$ 800,00 por mes") e em percentual ("25% dos gastos"). O percentual e
 * convertido em reais sobre o total que saiu **neste recorte**, entao ele
 * acompanha o filtro de periodo; o de valor so compara em meses inteiros,
 * porque proporcionalizar por dia gera alarme falso (regra da fase 2).
 *
 * Categoria sem gasto no periodo continua aparecendo quando tem objetivo: o
 * zero contra o objetivo tambem e informacao.
 */

type GoalRow = {
  id: number;
  name: string;
  color: string;
  spentCents: number;
  targetCents: number | null;
  /** Rotulo do objetivo como o usuario o definiu. */
  goalLabel: string;
  sharePerMille: number | null;
  actualSharePerMille: number;
};

const perMille = (value: number) => `${(value / 10).toFixed(1).replace(".", ",")}%`;

export function CategoryGoals({ from, to }: { from: string; to: string }) {
  const [report, setReport] = useState<CategoryReport | null>(null);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const params = new URLSearchParams({ from, to, compare: "0" });
    void Promise.all([
      api<CategoryReport>(`/ledger/reports/categories?${params.toString()}`),
      api<CategoryRecord[]>("/ledger/categories?kind=expense")
    ])
      .then(([nextReport, nextCategories]) => {
        if (cancelled) return;
        setReport(nextReport);
        setCategories(nextCategories);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const months = wholeMonthsIn({ from, to });

  const rows = useMemo<GoalRow[]>(() => {
    if (!report) return [];
    const spentBy = new Map(report.rows.map((row) => [row.categoryId, row]));
    // Mesma base do servidor: so o que efetivamente saiu.
    const base = report.rows.reduce((total, row) => total + Math.max(row.spentCents, 0), 0);

    return categories
      .filter(
        (category) => category.monthlyBudgetCents != null || category.budgetSharePerMille != null
      )
      .map((category) => {
        const spent = spentBy.get(category.id)?.spentCents ?? 0;
        const share = category.budgetSharePerMille ?? null;
        const monthly = category.monthlyBudgetCents ?? null;
        const targetCents =
          share != null
            ? shareBudgetCents(base, share)
            : monthly != null && months != null
              ? monthly * months
              : null;
        return {
          id: category.id,
          name: category.name,
          color: category.color,
          spentCents: spent,
          targetCents,
          goalLabel:
            share != null
              ? `${perMille(share)} dos gastos`
              : `${moneyFromCents(monthly ?? 0)} por mês`,
          sharePerMille: share,
          actualSharePerMille: base > 0 ? Math.round((Math.max(spent, 0) * 1000) / base) : 0
        };
      })
      .sort((a, b) => ratio(b) - ratio(a));
  }, [report, categories, months]);

  const shareSum = categories.reduce(
    (total, category) => total + (category.budgetSharePerMille ?? 0),
    0
  );

  if (failed) return <p className="fin-muted">Não foi possível carregar os objetivos.</p>;
  if (!report) return null;
  if (rows.length === 0) {
    return (
      <Empty
        icon={Target}
        text="Nenhuma categoria com objetivo. Defina em Categorias ou em Alocação de gastos."
      />
    );
  }

  return (
    <div className="fin-targets">
      {shareSum > 1000 && (
        <p className="fin-warning">
          Os objetivos em percentual somam {perMille(shareSum)}: mais que o total de gastos.
        </p>
      )}
      {months == null && rows.some((row) => row.sharePerMille == null) && (
        <p className="fin-muted fin-note">
          Objetivos em valor só são comparados em meses inteiros; neste recorte eles aparecem sem
          barra.
        </p>
      )}
      {/* Três colunas: a lista inteira cabe na tela sem rolar (encolhe no estreito). */}
      <div className="fin-targets-grid">
        {rows.map((row) => {
          const hasTarget = row.targetCents != null;
          const over = hasTarget && row.spentCents > row.targetCents!;
          const percent =
            hasTarget && row.targetCents! > 0 ? (row.spentCents / row.targetCents!) * 100 : null;
          return (
            <div key={row.id} className="fin-target">
              <div className="fin-target-head">
                <span className="fin-inline">
                  <span className="fin-dot" style={{ background: row.color }} aria-hidden />
                  {row.name}
                  <small className="fin-muted">· {row.goalLabel}</small>
                </span>
                <span className={over ? "fin-negative" : ""}>
                  {moneyFromCents(row.spentCents)}
                  {hasTarget && (
                    <em className="fin-target-of"> de {moneyFromCents(row.targetCents!)}</em>
                  )}
                </span>
              </div>
              <div
                className={`fin-target-track ${hasTarget ? "" : "neutral"}`}
                role="progressbar"
                aria-valuenow={percent ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${row.name}: gasto contra o objetivo`}
              >
                {hasTarget && (
                  <span
                    className={`fin-target-fill ${over ? "over" : ""}`}
                    style={{
                      width: `${Math.min(Math.max(percent ?? 0, 0), 100)}%`
                    }}
                  />
                )}
              </div>
              <small className="fin-target-foot">
                {hasTarget ? (
                  <span className={over ? "fin-negative" : "fin-muted"}>
                    {percent == null ? "objetivo zero" : `${percent.toFixed(0)}% do objetivo`}
                    {row.sharePerMille != null &&
                      ` · foi ${perMille(row.actualSharePerMille)} dos gastos`}
                  </span>
                ) : (
                  <span className="fin-muted">sem comparação neste recorte</span>
                )}
              </small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Quem mais consumiu o objetivo vem primeiro: e onde o olho precisa ir. */
function ratio(row: GoalRow) {
  if (row.targetCents == null) return -1;
  if (row.targetCents === 0) return row.spentCents > 0 ? Number.POSITIVE_INFINITY : 0;
  return row.spentCents / row.targetCents;
}
