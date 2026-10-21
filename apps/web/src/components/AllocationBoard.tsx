import { Target } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Donut } from "./charts.js";
import { Empty } from "./ui.js";

/**
 * Real x ideal com sliders: a mesma tela serve a carteira de investimentos e
 * a divisao dos gastos pessoais.
 *
 * Cada linha mostra o peso atual como preenchimento do trilho e o peso-meta
 * como o marcador que o usuario arrasta. A rosca ao lado redesenha a meta ao
 * vivo. O componente nao sabe o que os pesos significam — quem o usa decide
 * de onde vem o "atual" e para onde vai o "commit".
 */

export type AllocationRow = {
  key: string;
  label: string;
  /** Linha secundaria, ja formatada: "R$ 1.200,00 · 18,4% atual". */
  detail: ReactNode;
  /** Peso atual, de 0 a 1. */
  actualWeight: number;
  /** Peso-meta, de 0 a 1. */
  weight: number;
  color?: string;
  /** Linha que nao pode ser arrastada daqui, com o motivo. */
  lockedReason?: string;
};

const oneDecimal = (weight: number) => `${(weight * 100).toFixed(1).replace(".", ",")}%`;

export function AllocationBoard({
  rows,
  onChange,
  onCommit,
  emptyText,
  chartLabel = "Meta em construção",
  actualChartLabel
}: {
  rows: AllocationRow[];
  onChange: (key: string, weight: number) => void;
  onCommit: (key: string, weight: number) => void | Promise<void>;
  emptyText: string;
  chartLabel?: string;
  /** Sem nenhuma meta ainda, a rosca mostra o real com este título em vez de sumir. */
  actualChartLabel?: string;
}) {
  const targetSlices = rows
    .filter((row) => row.weight > 0)
    .map((row) => ({ key: row.key, label: row.label, value: row.weight, color: row.color }));
  const showActual = targetSlices.length === 0 && actualChartLabel != null;
  const slices = showActual
    ? rows
        .filter((row) => row.actualWeight > 0)
        .map((row) => ({ key: row.key, label: row.label, value: row.actualWeight, color: row.color }))
    : targetSlices;
  // Com muitas fatias os rótulos da rosca se atropelam: a legenda lista todas.
  const legend = slices.length > 6;

  // Teclado dispara um keyup por passo do slider: sem agrupar, segurar a seta
  // gravaria (e avisaria) dezenas de vezes. Grava o valor final, uma vez.
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; weight: number }>());
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  // Sair da tela com um valor ainda por gravar grava agora, em vez de perder.
  useEffect(() => {
    const queue = pending.current;
    return () => {
      queue.forEach(({ timer, weight }, key) => {
        clearTimeout(timer);
        void commitRef.current(key, weight);
      });
      queue.clear();
    };
  }, []);
  const commitFrom = (key: string, target: EventTarget) => {
    const weight = Number((target as HTMLInputElement).value) / 100;
    const previous = pending.current.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      pending.current.delete(key);
      void commitRef.current(key, weight);
    }, 400);
    pending.current.set(key, { timer, weight });
  };

  return (
    <div className="allocation-split">
      <div className="allocation-list">
        {rows.map((row) => (
          <div className={`allocation-row ${row.lockedReason ? "locked" : ""}`} key={row.key}>
            <div className="allocation-name">
              <strong className="fin-inline">
                {row.color && <span className="fin-dot" style={{ background: row.color }} aria-hidden />}
                {row.label}
              </strong>
              <span>{row.lockedReason ?? row.detail}</span>
            </div>
            <div className="alloc-slider">
              <div className="allocation-track">
                <div
                  className="allocation-fill"
                  style={{ width: `${Math.min(100, row.actualWeight * 100)}%` }}
                />
              </div>
              <input
                className="alloc-range"
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={+(row.weight * 100).toFixed(1)}
                disabled={row.lockedReason != null}
                aria-label={`Meta de ${row.label}`}
                onChange={(event) => onChange(row.key, Number(event.target.value) / 100)}
                onPointerUp={(event) => commitFrom(row.key, event.target)}
                onKeyUp={(event) => commitFrom(row.key, event.target)}
              />
            </div>
            <strong className="alloc-target-value">
              {row.lockedReason ? "—" : oneDecimal(row.weight)}
            </strong>
          </div>
        ))}
        {rows.length === 0 && <Empty icon={Target} text={emptyText} />}
      </div>
      {slices.length > 0 && (
        <aside className={`allocation-chart ${legend ? "with-legend" : ""}`}>
          <span className="allocation-chart-label">{showActual ? actualChartLabel : chartLabel}</span>
          <Donut
            data={slices}
            height={legend ? 200 : 340}
            legend={legend}
            formatValue={oneDecimal}
          />
        </aside>
      )}
    </div>
  );
}
