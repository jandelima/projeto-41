import type { CoupleSplit } from "@projeto41/finance";
import { moneyFromCents } from "../../lib/format.js";

const percent = (perMille: number) => `${(perMille / 10).toFixed(1).replace(".", ",")}%`;

/**
 * A divisão do casal em números que dá para agir: quanto cada um recebe,
 * quanto deposita na conjunta, quanto fica para gastar e o que sobra.
 *
 * `deposited` é o que já entrou na conjunta no período, por pessoa: as
 * transferências das contas de cada um para a conjunta. `null` enquanto
 * carrega.
 */
export function CoupleSplitPanel({
  split,
  baseLabel,
  deposited,
  unattributedCents,
  warning = null
}: {
  /** Algo errado na configuração, que torna os números abaixo enganosos. */
  warning?: string | null;
  split: CoupleSplit;
  /** De onde vem o total da conjunta, já formatado ("Teto conjunto: R$ 4.500,00"). */
  baseLabel: string;
  deposited: Map<number, number> | null;
  unattributedCents: number;
}) {
  return (
    <section className="couple-split" aria-label="Divisão do casal">
      <header className="couple-split-head">
        <strong>Divisão do casal</strong>
        <span>
          {baseLabel} · renda somada {moneyFromCents(split.incomeTotalCents)}
        </span>
      </header>

      {warning && <p className="fin-callout warning">{warning}</p>}

      {split.missing ? (
        <p className="fin-callout">{split.missing}</p>
      ) : (
        <div className="couple-split-people">
          {split.rows.map((row) => {
            const done = deposited?.get(row.personId) ?? 0;
            const owes = row.depositCents;
            const ratio = owes > 0 ? Math.min(done / owes, 1) : 0;
            return (
              <article key={row.personId} className="couple-person">
                <header>
                  <span className="fin-inline">
                    <span className="fin-dot" style={{ background: row.color }} aria-hidden />
                    <strong>{row.name}</strong>
                  </span>
                  <span className="fin-muted">{percent(row.sharePerMille)} da renda</span>
                </header>
                <dl>
                  <div>
                    <dt>Recebe</dt>
                    <dd>{moneyFromCents(row.incomeCents)}</dd>
                  </div>
                  <div className="couple-deposit">
                    <dt>{owes < 0 ? "Recebe da conjunta" : "Deposita na conjunta"}</dt>
                    <dd>{moneyFromCents(Math.abs(owes))}</dd>
                  </div>
                  <div>
                    <dt>Para gastar sozinho</dt>
                    <dd>
                      {row.personalTargetCents == null
                        ? "—"
                        : moneyFromCents(row.personalTargetCents)}
                    </dd>
                  </div>
                  <div>
                    <dt>Sobra para guardar</dt>
                    <dd className={row.leftoverCents != null && row.leftoverCents < 0 ? "negative-text" : ""}>
                      {row.leftoverCents == null ? "—" : moneyFromCents(row.leftoverCents)}
                    </dd>
                  </div>
                </dl>
                {owes > 0 && (
                  <div className="couple-progress">
                    <div
                      className="couple-progress-track"
                      role="progressbar"
                      aria-label={`Depositado por ${row.name}`}
                      aria-valuemin={0}
                      aria-valuemax={owes}
                      aria-valuenow={done}
                    >
                      <div
                        className={`couple-progress-fill ${done >= owes ? "done" : ""}`}
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                    <small>
                      {deposited == null
                        ? "Somando os depósitos…"
                        : done >= owes
                          ? `Já depositou ${moneyFromCents(done)}`
                          : `Já depositou ${moneyFromCents(done)} · faltam ${moneyFromCents(owes - done)}`}
                    </small>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {unattributedCents > 0 && (
        <p className="fin-muted">
          {moneyFromCents(unattributedCents)} entraram na conjunta como entrada, sem uma
          transferência da conta de quem depositou. Para contar como depósito de alguém, lance
          como transferência da conta dessa pessoa.
        </p>
      )}
    </section>
  );
}
