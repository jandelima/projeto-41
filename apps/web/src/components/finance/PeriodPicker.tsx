import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { DateField } from "../datepicker.js";
import { Field } from "../ui.js";
import { monthNames } from "../../lib/format.js";

/** Período selecionado, já resolvido em datas concretas. */
export type SelectedPeriod = {
  mode: "month" | "year" | "custom";
  from: string;
  to: string;
  /** `YYYY-MM` quando o período é um mês-calendário; as rotas de alvo pedem isso. */
  period: string | null;
  year: number | null;
};

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

/** O mês `offset` meses depois do de `today` (negativo volta). */
export function monthPeriod(offset = 0, today = new Date()): SelectedPeriod {
  const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return {
    mode: "month",
    from: iso(start),
    to: iso(end),
    period: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    year: null
  };
}

export function yearPeriod(today = new Date()): SelectedPeriod {
  const year = today.getFullYear();
  return { mode: "year", from: `${year}-01-01`, to: `${year}-12-31`, period: null, year };
}

/** Anda um passo (mês ou ano) para trás ou para a frente. */
export function shiftPeriod(period: SelectedPeriod, step: -1 | 1): SelectedPeriod {
  const anchor = new Date(`${period.from}T12:00:00`);
  if (period.mode === "year") return yearPeriod(new Date(anchor.getFullYear() + step, 0, 1));
  return monthPeriod(step, anchor);
}

/** Rótulo curto do período, usado nos títulos das telas. */
export function periodLabel(period: SelectedPeriod): string {
  if (period.mode === "year") return String(period.year);
  if (period.period) {
    const [year, month] = period.period.split("-");
    return `${monthNames[Number(month) - 1] ?? ""} de ${year}`;
  }
  return `${period.from} a ${period.to}`;
}

/**
 * Setas para andar mês a mês (ou ano a ano), com o nome do período no meio.
 * "Hoje" volta ao mês corrente quando se andou para longe dele.
 */
export function PeriodStepper({
  label,
  onPrevious,
  onNext,
  onToday,
  isToday
}: {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday?: () => void;
  isToday?: boolean;
}) {
  return (
    <div className="period-stepper" role="group" aria-label="Período">
      <button type="button" onClick={onPrevious} aria-label="Período anterior" title="Anterior">
        <ChevronLeft size={16} />
      </button>
      <strong>{label}</strong>
      <button type="button" onClick={onNext} aria-label="Próximo período" title="Próximo">
        <ChevronRight size={16} />
      </button>
      {onToday && !isToday && (
        <button type="button" className="period-today" onClick={onToday}>
          Hoje
        </button>
      )}
    </div>
  );
}

export function PeriodPicker({
  value,
  onChange
}: {
  value: SelectedPeriod;
  onChange: (next: SelectedPeriod) => void;
}) {
  const current = monthPeriod(0);
  const isToday =
    value.mode === "year" ? value.year === new Date().getFullYear() : value.period === current.period;

  return (
    <div className="fin-period-picker">
      <div className="fin-period-row">
        {value.mode === "custom" ? (
          <span className="period-custom-label">
            <CalendarRange size={16} aria-hidden />
            Intervalo personalizado
          </span>
        ) : (
          <PeriodStepper
            label={periodLabel(value)}
            onPrevious={() => onChange(shiftPeriod(value, -1))}
            onNext={() => onChange(shiftPeriod(value, 1))}
            onToday={() => onChange(value.mode === "year" ? yearPeriod() : current)}
            isToday={isToday}
          />
        )}
        <div className="period-modes" role="group" aria-label="Tamanho do período">
          {(
            [
              ["month", "Mês"],
              ["year", "Ano"],
              ["custom", "Personalizado"]
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={value.mode === mode ? "active" : ""}
              onClick={() => {
                if (mode === value.mode) return;
                const anchor = new Date(`${value.from}T12:00:00`);
                if (mode === "month") onChange(monthPeriod(0, anchor));
                else if (mode === "year") onChange(yearPeriod(anchor));
                // "custom" mantém o intervalo atual e só libera os dois campos de data.
                else onChange({ ...value, mode: "custom", period: null, year: null });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {value.mode === "custom" && (
        <div className="field-row">
          <Field label="De">
            <DateField value={value.from} onChange={(from) => onChange({ ...value, from })} />
          </Field>
          <Field label="Até">
            <DateField value={value.to} onChange={(to) => onChange({ ...value, to })} />
          </Field>
        </div>
      )}
    </div>
  );
}
