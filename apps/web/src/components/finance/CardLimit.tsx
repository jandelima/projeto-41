import type { CardSummary } from "@projeto41/contracts";
import { moneyFromCents } from "../../lib/format.js";

/**
 * Barra de limite do cartão.
 *
 * No modo privacidade os **números** são mascarados pelos formatadores, mas a
 * barra continua desenhada: ela mostra proporção, não valor, e é a proporção
 * que o usuário precisa ver numa gravação de tela (R-04).
 */
export function CardLimit({ card }: { card: CardSummary }) {
  if (card.creditLimitCents == null) {
    return (
      <p className="fin-muted fin-limit-empty">
        Sem limite cadastrado. Usado: {moneyFromCents(card.usedCents)}.
      </p>
    );
  }

  const percent = (card.usedCents / card.creditLimitCents) * 100;
  const over = (card.availableCents ?? 0) < 0;

  return (
    <div className="fin-limit">
      <div className="fin-limit-head">
        <span className="fin-muted">Limite usado</span>
        <span>
          {moneyFromCents(card.usedCents)}
          <em className="fin-target-of"> de {moneyFromCents(card.creditLimitCents)}</em>
        </span>
      </div>

      <div
        className="fin-target-track"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Limite usado do cartão"
      >
        <span
          className={`fin-target-fill ${over ? "over" : ""}`}
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>

      <small className="fin-target-foot">
        {over ? (
          <span className="fin-negative">
            Limite estourado em {moneyFromCents(Math.abs(card.availableCents ?? 0))}
          </span>
        ) : (
          <span className="fin-muted">
            {moneyFromCents(card.availableCents ?? 0)} disponíveis ·{" "}
            {percent.toFixed(1).replace(".", ",")}% usado
          </span>
        )}
      </small>
    </div>
  );
}
