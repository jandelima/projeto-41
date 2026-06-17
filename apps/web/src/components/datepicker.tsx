import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { monthNames, monthShort } from "../lib/format.js";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Datas da app são strings "YYYY-MM-DD"; ancoramos ao meio-dia local para
// evitar deslocamento de fuso ao formatar.
function parseDate(value: string): Date {
  return value ? new Date(`${value}T12:00:00`) : new Date();
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parseDate(value));
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  // Ao abrir, posiciona o calendário no mês da data selecionada.
  useEffect(() => {
    if (open) setView(parseDate(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = value ? parseDate(value) : null;
  const today = new Date();
  const year = view.getFullYear();
  const month = view.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  function pick(date: Date) {
    onChange(toIso(date));
    setOpen(false);
  }

  const triggerLabel = selected
    ? `${selected.getDate()} ${monthShort[selected.getMonth()]} ${selected.getFullYear()}`
    : "Selecionar data";

  return (
    <div className="datefield" ref={rootRef}>
      <button
        type="button"
        className={`datefield-trigger ${open ? "open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <CalendarDays size={15} />
        <span>{triggerLabel}</span>
      </button>
      {open && (
        <div className="datepop" role="dialog" aria-modal="false" aria-labelledby={dialogId}>
          <div className="datepop-head">
            <button type="button" aria-label="Mês anterior" onClick={() => setView(new Date(year, month - 1, 1))}>
              <ChevronLeft size={16} />
            </button>
            <span id={dialogId}>
              {monthNames[month]} {year}
            </span>
            <button type="button" aria-label="Próximo mês" onClick={() => setView(new Date(year, month + 1, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="datepop-grid datepop-weekdays">
            {WEEKDAYS.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>
          <div className="datepop-grid">
            {cells.map((date, index) =>
              date ? (
                <button
                  key={index}
                  type="button"
                  className={`datepop-day ${sameDay(date, selected) ? "sel" : ""} ${
                    sameDay(date, today) ? "today" : ""
                  }`}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              ) : (
                <span key={index} />
              )
            )}
          </div>
          <div className="datepop-foot">
            <button type="button" className="datepop-today" onClick={() => pick(new Date())}>
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
