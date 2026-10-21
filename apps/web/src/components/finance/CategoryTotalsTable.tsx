import type { CategoryReport } from "@projeto41/contracts";
import { ColorDot } from "../ColorPicker.js";
import { Empty } from "../ui.js";
import { Receipt } from "lucide-react";
import { budgetPair, moneyFromCents } from "../../lib/format.js";

/**
 * Totais por categoria com orçamento (6.5).
 *
 * Categoria com orçamento mostra o par `gasto/orçamento`, vermelho ao estourar;
 * sem orçamento mostra só o valor, sem placeholder.
 */
export function CategoryTotalsTable({
  report,
  onSelectCategory,
  selectedIds = []
}: {
  report: CategoryReport;
  onSelectCategory?: (categoryId: number | null) => void;
  selectedIds?: (number | null)[];
}) {
  if (report.rows.length === 0) {
    return <Empty icon={Receipt} text="Nenhum lançamento no período." />;
  }

  // A linha "Sem categoria" vai para o fim: ela é um lembrete de trabalho
  // pendente, não uma categoria de verdade.
  const rows = [...report.rows].sort((a, b) => {
    if (a.categoryId === null) return 1;
    if (b.categoryId === null) return -1;
    return b.spentCents - a.spentCents;
  });

  const comparisonByCategory = new Map(
    (report.comparison?.rows ?? []).map((row) => [row.categoryId, row])
  );

  // Altura limitada com cabecalho e total fixos: com muitas categorias a tabela
  // rola por dentro em vez de empurrar a rosca e o comparativo para longe.
  return (
    <div className="table-scroll fin-table-bounded">
      <table className="data-table">
        <thead>
          <tr>
            <th>Categoria</th>
            <th className="num">Valor</th>
            <th className="num">Participação</th>
            <th className="num">Variação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const comparison = comparisonByCategory.get(row.categoryId);
            const selected = selectedIds.includes(row.categoryId);
            return (
              <tr key={row.categoryId ?? "sem-categoria"} className={selected ? "fin-row-on" : ""}>
                <td>
                  <button
                    className="fin-link"
                    onClick={() => onSelectCategory?.(row.categoryId)}
                    disabled={!onSelectCategory}
                  >
                    <span className="fin-inline">
                      <ColorDot color={row.color ?? "var(--text-muted)"} />
                      {row.name}
                    </span>
                  </button>
                </td>
                <td className={`num ${row.overBudget ? "fin-budget-over" : ""}`}>
                  {budgetPair(row.spentCents, row.budgetCents)}
                </td>
                <td className="num fin-muted">
                  {(row.sharePerMille / 10).toFixed(1).replace(".", ",")}%
                </td>
                <td className="num">
                  {comparison ? (
                    // O tom vem do servidor já invertido: em despesa, subir é
                    // ruim. Derivar a cor do sinal aqui inverteria o sentido.
                    <span className={toneClass(comparison.tone)}>
                      {comparison.variationRatio == null
                        ? "novo"
                        : `${comparison.variationRatio > 0 ? "+" : ""}${Math.round(
                            comparison.variationRatio * 100
                          )}%`}
                    </span>
                  ) : (
                    <span className="fin-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <th className="num">{moneyFromCents(report.totalCents)}</th>
            <th className="num">100,0%</th>
            <th />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function toneClass(tone: "positive" | "negative" | "neutral") {
  if (tone === "negative") return "fin-negative";
  if (tone === "positive") return "fin-positive";
  return "fin-muted";
}
