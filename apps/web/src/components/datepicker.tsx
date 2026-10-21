import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { monthNames, monthShort } from "../lib/format.js";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** Tamanho do calendário aberto (o mesmo do CSS de `.datepop`), para escolher o lado. */
const POP_WIDTH = 280;
const POP_HEIGHT = 340;

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

export function DateField({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parseDate(value));
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  // O calendário sai do fluxo (portal + fixed): dentro de uma gaveta com
  // rolagem ele era cortado pela borda dela. A posição vem do campo, com
  // ajuste para caber na janela.
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  function toggle() {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 8;
      const up = below < POP_HEIGHT && rect.top > below;
      const top = up ? Math.max(8, rect.top - POP_HEIGHT - 8) : rect.bottom + 8;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - POP_WIDTH - 8));
      setPos({ top, left });
    }
    setOpen((prev) => !prev);
  }

  // Ao abrir, posiciona o calendário no mês da data selecionada.
  useEffect(() => {
    if (open) setView(parseDate(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popRef.current?.contains(target)) setOpen(false);
    }
    // Rolar a gaveta desalinharia o calendário do campo: fecha.
    function onScroll(event: Event) {
      if (!popRef.current?.contains(event.target as Node)) setOpen(false);
    }
    const onResize = () => setOpen(false);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
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
        onClick={toggle}
      >
        <CalendarDays size={15} />
        <span>{triggerLabel}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="datepop"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-modal="false"
            aria-labelledby={dialogId}
          >
            <div className="datepop-head">
              <button
                type="button"
                aria-label="Mês anterior"
                onClick={() => setView(new Date(year, month - 1, 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span id={dialogId}>
                {monthNames[month]} {year}
              </span>
              <button
                type="button"
                aria-label="Próximo mês"
                onClick={() => setView(new Date(year, month + 1, 1))}
              >
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
          </div>,
          document.body
        )}
    </div>
  );
}
