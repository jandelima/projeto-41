import { ArrowDownToLine, ArrowUpFromLine, Landmark, Pencil, Scale, SlidersHorizontal, TrendingUp } from "lucide-react";
import type { EntryRecord, GoalProgress } from "@projeto41/contracts";
import { Modal } from "../dialog.js";
import { Button, Skeleton, Tag } from "../ui.js";
import { EntryTable } from "./EntryTable.js";
import { longDate, monthLabel, moneyFromCents, percentValue, signedMoneyFromCents } from "../../lib/format.js";

export type GoalAction = "deposit" | "withdraw" | "correct" | "profit" | "adjust";

/**
 * Tudo de uma caixinha: de onde vem o saldo, quanto sobra se sacar hoje, o
 * rendimento realizado e o projetado, o alvo, o ritmo e o extrato.
 *
 * Rendimento **projetado sempre visualmente distinto do realizado** — número
 * sem rótulo aqui vira decisão errada de resgate.
 */
export function GoalDetail({
  goal,
  rows,
  cdiThrough,
  onAction,
  onEdit,
  onClose
}: {
  goal: GoalProgress;
  /** Extrato da caixinha; `null` enquanto carrega. */
  rows: EntryRecord[] | null;
  /** Última data com taxa publicada, para rotular a projeção. */
  cdiThrough: string | null;
  onAction: (action: GoalAction) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const percent = goal.targetRatioPerMille != null ? goal.targetRatioPerMille / 10 : null;
  // Rendimento do CDI calculado e lançado sozinho: só no modo automático.
  const yields = goal.cdiPercent != null && goal.profitMode === "auto";
  const profit = goal.profit;
  const hasProfitBase = profit.depositedCents > 0;

  return (
    <Modal
      title={
        <span className="fin-inline">
          <span className="fin-dot" style={{ background: goal.color }} aria-hidden />
          {goal.name}
        </span>
      }
      onClose={onClose}
      width={900}
    >
      <div className="fin-goal-detail">
        <div className="fin-goal-detail-head">
          <span className={`fin-goal-account ${goal.parentAccountName ? "" : "is-missing"}`}>
            <Landmark size={13} aria-hidden />
            {goal.parentAccountName
              ? `Atrelada a ${goal.parentAccountName}`
              : "Sem conta atrelada: escolha uma em Editar"}
          </span>
          {yields ? (
            <Tag tone="positive">Lucro automático · {goal.cdiPercent}% do CDI</Tag>
          ) : (
            <Tag tone="neutral">Lucro lançado por você</Tag>
          )}
        </div>

        <dl className="position-summary">
          <div>
            <dt>Você colocou</dt>
            <dd>{moneyFromCents(goal.contributedCents)}</dd>
          </div>
          {(yields || goal.yieldCents !== 0) && (
            <div>
              <dt>Lucro no saldo</dt>
              <dd className={goal.yieldCents < 0 ? "negative-text" : "positive-text"}>
                {signedMoneyFromCents(goal.yieldCents)}
              </dd>
            </div>
          )}
          {goal.correctionCents !== 0 && (
            <div title="Diferença entre o calculado e o saldo real que você informou">
              <dt>Correções</dt>
              <dd>{moneyFromCents(goal.correctionCents)}</dd>
            </div>
          )}
          <div className="position-summary-total">
            <dt>Saldo hoje</dt>
            <dd>{moneyFromCents(goal.balanceCents)}</dd>
          </div>
          {yields && (
            <div title="Resgatando tudo hoje, já com IOF e IR">
              <dt>Líquido se sacar hoje</dt>
              <dd>{moneyFromCents(goal.netCents)}</dd>
            </div>
          )}
          {yields && (goal.iofCents > 0 || goal.irCents > 0) && (
            <p className="fin-muted">
              Impostos de um resgate total hoje: IOF {moneyFromCents(goal.iofCents)} · IR{" "}
              {moneyFromCents(goal.irCents)}
            </p>
          )}
        </dl>

        {hasProfitBase && (
          <dl className="fin-goal-profit" aria-label="Percentual de lucro">
            <div title={`Lucro sobre os ${moneyFromCents(profit.averageCapitalCents)} que ficaram parados em média`}>
              <dt>Lucro até agora</dt>
              <dd className={profit.cents < 0 ? "negative-text" : "positive-text"}>
                {profit.percent != null ? percentValue(profit.percent) : "—"}
                <small> · {signedMoneyFromCents(profit.cents)}</small>
              </dd>
            </div>
            <div title="Se o ritmo até agora se mantiver por um ano, em juros compostos">
              <dt className="fin-muted">Projeção ao ano</dt>
              {/* Projeção sempre apagada e rotulada: nunca se confunde com o lucro real. */}
              <dd className="fin-muted">
                {profit.annualPercent != null ? `${percentValue(profit.annualPercent)} ao ano` : "—"}
                {profit.annualPercent != null && profit.shortHistory && (
                  <small> · só {profit.days} dia{profit.days === 1 ? "" : "s"} de histórico: indicativo</small>
                )}
              </dd>
            </div>
          </dl>
        )}

        {yields && (
          <dl className="fin-goal-yield">
            <div>
              <dt>Rendimento no saldo</dt>
              <dd className="fin-positive">{moneyFromCents(goal.realizedYieldCents)}</dd>
            </div>
            <div>
              <dt className="fin-muted">A entrar</dt>
              {/* Tom apagado e sufixo explícito: projeção nunca se confunde com
                  realizado, e nunca é somada a ele. */}
              <dd className="fin-muted">{moneyFromCents(goal.projectedYieldCents)} (projeção)</dd>
            </div>
          </dl>
        )}

        {goal.targetAmountCents != null && (
          <div className="fin-goal-target">
            <div
              className="fin-target-track"
              role="progressbar"
              aria-valuenow={Math.round(percent ?? 0)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progresso de ${goal.name}`}
            >
              <span
                className="fin-target-fill"
                style={{
                  width: `${Math.min(Math.max(percent ?? 0, 0), 100)}%`,
                  background: goal.color
                }}
              />
            </div>
            <small className="fin-target-foot fin-muted">
              {percent?.toFixed(1).replace(".", ",")}% de {moneyFromCents(goal.targetAmountCents)}
              {goal.remainingCents != null && ` · faltam ${moneyFromCents(goal.remainingCents)}`}
              {goal.targetDate && ` · alvo em ${longDate(goal.targetDate)}`}
            </small>
          </div>
        )}

        {goal.iofFreeFrom && (
          <p className="fin-warning">
            Há IOF incidindo sobre o aporte mais novo. Ele zera em {longDate(goal.iofFreeFrom)}.
          </p>
        )}

        <small className="fin-muted">
          {goal.projection.estimatedDate
            ? `No ritmo atual, alvo em ${monthLabel(goal.projection.estimatedDate.slice(0, 7))}`
            : "Sem ritmo de depósito para projetar"}
          {yields && cdiThrough && ` · CDI atualizado até ${longDate(cdiThrough)}`}
        </small>

        <div className="fin-goal-actions">
          <Button icon={ArrowDownToLine} onClick={() => onAction("deposit")}>
            Guardar
          </Button>
          <Button
            variant="soft"
            icon={ArrowUpFromLine}
            onClick={() => onAction("withdraw")}
            disabled={goal.balanceCents <= 0}
          >
            Resgatar
          </Button>
          <Button variant="soft" icon={TrendingUp} onClick={() => onAction("profit")}>
            Lançar lucro
          </Button>
          <Button variant="ghost" icon={SlidersHorizontal} onClick={() => onAction("adjust")}>
            Ajustar lucro
          </Button>
          <Button variant="ghost" icon={Scale} onClick={() => onAction("correct")}>
            Corrigir saldo
          </Button>
          <Button variant="ghost" icon={Pencil} onClick={onEdit}>
            Editar
          </Button>
        </div>

        <h4 className="fin-goal-detail-title">Extrato</h4>
        {rows == null ? (
          <Skeleton rows={3} />
        ) : (
          <EntryTable rows={rows} onSelect={() => undefined} emptyText="Nenhum movimento nesta caixinha." />
        )}
      </div>
    </Modal>
  );
}
