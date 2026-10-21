import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import type { StatementStatus, StatementSummary } from "@projeto41/contracts";
import { IconButton, Tag } from "../ui.js";
import { ledgerDate, monthLabel } from "../../lib/format.js";

const STATUS_LABEL: Record<StatementStatus, string> = {
  open: "Aberta",
  closed: "Fechada",
  paid: "Paga",
  overdue: "Vencida"
};

/** Tons já existentes no app; nenhum token novo. */
const STATUS_TONE: Record<StatementStatus, string> = {
  open: "info",
  closed: "warning",
  paid: "positive",
  overdue: "negative"
};

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` -> dia absoluto, sem fuso: o livro não tem hora. */
function dayNumber(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/** O fechamento anterior a este, um mês antes, respeitando o fim do mês. */
function previousClosing(closingDate: string): string {
  const [year, month, day] = closingDate.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 2, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(
    Math.min(day, lastDay)
  ).padStart(2, "0")}`;
}

function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number) as [number, number];
  const [toYear, toMonth] = to.split("-").map(Number) as [number, number];
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

export type CycleProgress = {
  /** 0 no dia seguinte ao fechamento anterior, 1 no fechamento. */
  ratio: number;
  daysLeft: number;
  label: string;
};

/**
 * Quanto do ciclo desta fatura já passou.
 *
 * Fatura futura ainda nem começou; fechada, paga ou vencida já terminou. Só a
 * aberta anda — e é ela que o destaque acompanha, do amarelo ao verde.
 */
export function cycleProgress(
  active: StatementSummary,
  previous: StatementSummary | undefined,
  today = todayIso()
): CycleProgress {
  if (active.status !== "open") return { ratio: 1, daysLeft: 0, label: "ciclo encerrado" };

  const end = dayNumber(active.closingDate);
  // O início do ciclo vem do servidor (`periodStart`): recalcular pelo dia de
  // fechamento atual errava um dia quando o fechamento cai no fim do mês.
  const start = active.periodStart
    ? dayNumber(active.periodStart)
    : dayNumber(
        previous && monthsBetween(previous.month, active.month) === 1
          ? previous.closingDate
          : previousClosing(active.closingDate)
      ) + 1;
  const now = dayNumber(today);
  if (now < start) {
    const days = end - now;
    return { ratio: 0, daysLeft: days, label: `começa em ${start - now} dia(s)` };
  }
  const span = Math.max(end - start, 1);
  const ratio = Math.min(Math.max((now - start) / span, 0), 1);
  const daysLeft = Math.max(end - now, 0);
  return {
    ratio,
    daysLeft,
    label: daysLeft === 0 ? "fecha hoje" : `fecha em ${daysLeft} dia${daysLeft === 1 ? "" : "s"}`
  };
}

/**
 * Navegação entre faturas.
 *
 * A navegação para frente **não para na fatura corrente**: vai até a última que
 * contém parcela, porque é justamente esse dinheiro já comprometido que se
 * precisa enxergar.
 *
 * A fatura em foco ganha destaque de cor pelo andamento do ciclo: amarela logo
 * depois do fechamento anterior, verde quando está para fechar. A cor sai da
 * mistura de dois tokens existentes (`--warning` e `--positive`), então segue
 * o tema claro e o escuro sem cor literal nova.
 */
export function StatementNav({
  statements,
  current,
  onChange
}: {
  statements: StatementSummary[];
  current: string;
  onChange: (month: string) => void;
}) {
  const index = statements.findIndex((statement) => statement.month === current);
  const active = statements[index];
  const progress = active ? cycleProgress(active, statements[index - 1]) : null;
  const percent = Math.round((progress?.ratio ?? 0) * 100);
  const style = {
    "--cycle-progress": `${percent}%`,
    "--cycle-color": `color-mix(in srgb, var(--positive) ${percent}%, var(--warning))`
  } as CSSProperties;

  return (
    <div className="fin-statement-nav">
      <IconButton
        icon={ChevronLeft}
        label="Fatura anterior"
        disabled={index <= 0}
        onClick={() => onChange(statements[index - 1]!.month)}
      />

      <div className="fin-statement-card" style={style}>
        <div className="fin-statement-top">
          <select
            className="fin-select fin-statement-select"
            value={current}
            onChange={(event) => onChange(event.target.value)}
            aria-label="Escolher fatura"
          >
            {statements.map((statement) => (
              <option key={statement.month} value={statement.month}>
                {monthLabel(statement.month)}
                {statement.isFuture ? " · futura" : ""}
              </option>
            ))}
          </select>
          <span className="fin-statement-tags">
            {active && <Tag tone={STATUS_TONE[active.status]}>{STATUS_LABEL[active.status]}</Tag>}
            {active?.isFuture && <Tag tone="info">Futura</Tag>}
          </span>
        </div>

        {active && (
          <>
            <div
              className="fin-cycle-track"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Andamento do ciclo da fatura"
            >
              <span className="fin-cycle-fill" />
            </div>
            <small className="fin-statement-meta">
              <span>
                fecha em {ledgerDate(active.closingDate)} · vence em {ledgerDate(active.dueDate)}
              </span>
              {progress && <strong className="fin-cycle-label">{progress.label}</strong>}
            </small>
          </>
        )}
      </div>

      <IconButton
        icon={ChevronRight}
        label="Próxima fatura"
        disabled={index < 0 || index >= statements.length - 1}
        onClick={() => onChange(statements[index + 1]!.month)}
      />
    </div>
  );
}
