import { AlertTriangle } from "lucide-react";
import type { TargetReport } from "@projeto41/contracts";
import { moneyFromCents } from "../../lib/format.js";

/**
 * Alvo x realizado por autor (plano mestre 6.4).
 *
 * O percentual continua visível no modo privacidade: a máscara esconde o
 * dinheiro, não a proporção (R-04). Ele vem pronto do servidor, em milésimos.
 */
export function TargetBars({
  report,
  onSelect
}: {
  report: TargetReport;
  /** Com ele, cada barra vira um botao que leva aos gastos daquela pessoa. */
  onSelect?: (bar: TargetReport["bars"][number]) => void;
}) {
  return (
    <div className="fin-targets">
      {report.warnings.map((warning) => (
        <p key={warning} className="fin-warning">
          <AlertTriangle size={13} aria-hidden />
          {warning}
        </p>
      ))}

      {report.bars.map((bar) => {
        const hasTarget = bar.targetCents != null;
        const percent = bar.ratioPerMille != null ? bar.ratioPerMille / 10 : null;
        const body = (
          <>
            <div className="fin-target-head">
              <span className="fin-inline">
                <span className="fin-dot" style={{ background: bar.color }} aria-hidden />
                {bar.name}
              </span>
              <span className={bar.over ? "fin-negative" : ""}>
                {moneyFromCents(bar.realizedCents)}
                {hasTarget && <em className="fin-target-of"> de {moneyFromCents(bar.targetCents!)}</em>}
              </span>
            </div>

            <div
              className={`fin-target-track ${hasTarget ? "" : "neutral"}`}
              role="progressbar"
              aria-valuenow={percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${bar.name}: realizado contra o alvo`}
            >
              {hasTarget && (
                <span
                  className={`fin-target-fill ${bar.over ? "over" : ""}`}
                  // A barra satura em 100% para não vazar do trilho; o número
                  // ao lado continua mostrando o estouro real.
                  style={{ width: `${Math.min(Math.max(percent ?? 0, 0), 100)}%` }}
                />
              )}
            </div>

            <small className="fin-target-foot">
              {hasTarget ? (
                <span className={bar.over ? "fin-negative" : "fin-muted"}>
                  {percent?.toFixed(1).replace(".", ",")}% do alvo
                </span>
              ) : (
                <span className="fin-muted">sem alvo definido</span>
              )}
            </small>
          </>
        );
        const key = `${bar.personId ?? "total"}-${bar.name}`;
        return onSelect ? (
          <button
            key={key}
            type="button"
            className="fin-target fin-target-link"
            onClick={() => onSelect(bar)}
            aria-label={`Ver os gastos de ${bar.name}`}
          >
            {body}
          </button>
        ) : (
          <div key={key} className="fin-target">
            {body}
          </div>
        );
      })}
    </div>
  );
}
