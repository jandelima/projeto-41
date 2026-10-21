import { ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Landmark } from "lucide-react";
import type { GoalProgress } from "@projeto41/contracts";
import { AnimatedNumber, Button, IconButton } from "../ui.js";
import { moneyFromCents, percentValue, signedMoneyFromCents } from "../../lib/format.js";

export type GoalMove = "deposit" | "withdraw";

/**
 * Um cartão por caixinha, só com o essencial: nome, conta atrelada, saldo e a
 * barra do alvo.
 *
 * Rendimento, CDI, impostos, aviso de IOF, projeção e ritmo ficam no detalhe,
 * que abre ao clicar no cartão.
 */
export function GoalCard({
  goal,
  onOpen,
  onMove,
  onReorder
}: {
  goal: GoalProgress;
  onOpen: () => void;
  onMove: (move: GoalMove) => void;
  /** Troca de lugar com a vizinha; ausente na ponta onde não dá para ir. */
  onReorder?: { back?: () => void; forward?: () => void };
}) {
  const percent = goal.targetRatioPerMille != null ? goal.targetRatioPerMille / 10 : null;
  // Botões dentro do cartão não abrem o detalhe.
  const stop = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    action();
  };

  return (
    <article
      className="fin-goal-card is-clickable"
      style={{ borderTopColor: goal.color }}
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${goal.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <header className="fin-goal-head">
        <span className="fin-inline">
          <span className="fin-dot" style={{ background: goal.color }} aria-hidden />
          <strong>{goal.name}</strong>
        </span>
        <span className="fin-goal-tags">
          {onReorder && (
            <span className="fin-goal-order">
              <IconButton
                icon={ChevronLeft}
                label="Mover para antes"
                disabled={!onReorder.back}
                onClick={onReorder.back ? stop(onReorder.back) : undefined}
              />
              <IconButton
                icon={ChevronRight}
                label="Mover para depois"
                disabled={!onReorder.forward}
                onClick={onReorder.forward ? stop(onReorder.forward) : undefined}
              />
            </span>
          )}
        </span>
      </header>

      <span className={`fin-goal-account ${goal.parentAccountName ? "" : "is-missing"}`}>
        <Landmark size={13} aria-hidden />
        {goal.parentAccountName ?? "Sem conta atrelada"}
      </span>

      <div className="fin-goal-value">
        <AnimatedNumber value={goal.balanceCents / 100} format={(v) => moneyFromCents(v * 100)} />
      </div>

      {goal.profit.depositedCents > 0 && (
        <small className="fin-goal-profit-line" title="Lucro sobre o dinheiro que ficou parado na caixinha">
          Lucro {signedMoneyFromCents(goal.profit.cents)}
          {goal.profit.percent != null && ` · ${percentValue(goal.profit.percent)}`}
          {goal.profit.annualPercent != null && !goal.profit.shortHistory && ` · ${percentValue(goal.profit.annualPercent)} ao ano`}
        </small>
      )}

      {goal.targetAmountCents != null && (
        <div
          className="fin-target-track"
          role="progressbar"
          aria-valuenow={Math.round(percent ?? 0)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso de ${goal.name}`}
          title={`${percent?.toFixed(1).replace(".", ",")}% de ${moneyFromCents(goal.targetAmountCents)}`}
        >
          <span
            className="fin-target-fill"
            style={{
              width: `${Math.min(Math.max(percent ?? 0, 0), 100)}%`,
              background: goal.color
            }}
          />
        </div>
      )}

      <footer className="fin-goal-actions">
        <Button variant="ghost" icon={ArrowDownToLine} onClick={stop(() => onMove("deposit"))}>
          Guardar
        </Button>
        <Button
          variant="ghost"
          icon={ArrowUpFromLine}
          onClick={stop(() => onMove("withdraw"))}
          disabled={goal.balanceCents <= 0}
        >
          Resgatar
        </Button>
      </footer>
    </article>
  );
}
