import { useId, useMemo, useRef } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { compactMoney, longDate, money } from "../lib/format.js";
import { useTheme } from "../lib/theme.js";

export function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{longDate(label)}</span>
      {payload.map((item: any) => (
        <strong key={item.dataKey} style={{ color: item.stroke || item.color }}>
          {item.name ? `${item.name}: ` : ""}
          {money(item.value)}
        </strong>
      ))}
    </div>
  );
}

export function AreaTrend({
  data,
  dataKey = "totalBrl",
  height = 300,
  tone = "accent",
  marker
}: {
  data: { date?: string; year?: number; [key: string]: unknown }[];
  dataKey?: string;
  height?: number | string;
  tone?: "accent" | "positive";
  /** Degrau no eixo X, como o dia em que o controle de caixa começou (D14). */
  marker?: { date: string; label: string };
}) {
  const { colors } = useTheme();
  const gradientId = useId().replace(/:/g, "");
  const stroke = tone === "positive" ? colors.positive : colors.accent;
  const xKey = data[0]?.date !== undefined ? "date" : "year";

  // Um tick por mês (primeira data de cada mês) evita rótulos de mês repetidos no eixo.
  const monthTicks = useMemo(() => {
    if (xKey !== "date") return undefined;
    const seen = new Set<string>();
    const ticks: string[] = [];
    for (const point of data) {
      const date = point.date as string | undefined;
      if (!date) continue;
      const key = date.slice(0, 7);
      if (!seen.has(key)) {
        seen.add(key);
        ticks.push(date);
      }
    }
    return ticks;
  }, [data, xKey]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          ticks={monthTicks}
          tickFormatter={xKey === "date" ? shortAxis : undefined}
          minTickGap={28}
          tick={{ fill: colors.axis, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={compactMoney}
          width={64}
          tick={{ fill: colors.axis, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<TrendTooltip />} />
        {marker && (
          // Marca uma mudança de significado da série, não um valor: por isso
          // linha tracejada e nos tokens do tema, sem cor literal.
          <ReferenceLine
            x={marker.date}
            stroke={colors.axis}
            strokeDasharray="4 4"
            label={{ value: marker.label, position: "insideTopLeft", fill: colors.axis, fontSize: 11 }}
          />
        )}
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={stroke}
          strokeWidth={2.4}
          fill={`url(#${gradientId})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Duas series comparadas. Os defaults reproduzem exatamente o uso original do
 * planejamento (ano x nominal/corrigido); as props existem para o comparativo
 * de periodos do modulo de financas reaproveitar o mesmo grafico.
 */
export function DualAreaTrend({
  data,
  height = 320,
  xKey = "year",
  keys = ["nominal", "real"],
  names = ["Saldo nominal", "Saldo corrigido"],
  formatValue = money,
  formatAxis = compactMoney,
  formatX
}: {
  data: Record<string, string | number>[];
  height?: number;
  xKey?: string;
  keys?: [string, string];
  names?: [string, string];
  formatValue?: (value: number) => string;
  formatAxis?: (value: number) => string;
  formatX?: (value: string) => string;
}) {
  const { colors } = useTheme();
  const gradientId = useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accent} stopOpacity={0.4} />
            <stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={colors.grid} vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={formatX} tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={formatAxis} width={64} tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          content={({ active, payload, label }: any) =>
            active && payload?.length ? (
              <div className="chart-tooltip">
                <span>{label}</span>
                {payload.map((item: any) => (
                  <strong key={item.dataKey} style={{ color: item.stroke }}>
                    {item.name}: {formatValue(item.value)}
                  </strong>
                ))}
              </div>
            ) : null
          }
        />
        <Area name={names[0]} type="monotone" dataKey={keys[0]} stroke={colors.accent} strokeWidth={2.2} fill={`url(#${gradientId})`} />
        <Area name={names[1]} type="monotone" dataKey={keys[1]} stroke={colors.positive} strokeWidth={2.2} fill="transparent" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export type DonutDatum = {
  key: string;
  label: string;
  value: number;
  /**
   * Cor escolhida pelo usuario para a categoria (D05). Quando ausente, cai na
   * paleta do tema — que e so o fallback de quem nao tem cor propria.
   */
  color?: string;
  /**
   * Percentual ja arredondado pelo metodo do maior resto, que soma exatamente
   * 100,0%. O `percent` do Recharts e o bruto, e a soma dos rotulos dele da
   * 99,9% ou 100,1% — exatamente o detalhe que destroi a confianca no relatorio.
   */
  percentLabel?: string;
};

export function Donut({
  data,
  height = 280,
  showValue = false,
  formatValue = money,
  legend = false,
  center
}: {
  data: DonutDatum[];
  height?: number;
  showValue?: boolean;
  /** Obrigatorio quando os valores sao centavos: `money` os leria como reais. */
  formatValue?: (value: number) => string;
  /**
   * Legenda ao lado em vez de rótulos com linha-guia. Com muitas fatias os
   * rótulos se atropelam; a legenda lista todas sem disputar espaço.
   */
  legend?: boolean;
  /** Texto no furo da rosca, como o total. */
  center?: { label: string; value: string };
}) {
  const { colors } = useTheme();
  const hatchId = `donut-hatch-${useId().replace(/:/g, "")}`;
  const layoutCache = useRef<{ key: string; map: Map<number, LabelSpot> }>({ key: "", map: new Map() });

  // Ângulo central de cada fatia (sem o paddingAngle, suficiente para posicionar rótulos).
  const midAngles = useMemo(() => {
    const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
    let acc = 0;
    return data.map((item) => {
      const start = acc / total;
      acc += item.value;
      return 360 * (start + item.value / total / 2);
    });
  }, [data]);

  // Resolve a sobreposição: empurra verticalmente os rótulos que ficariam grudados.
  function buildLayout(cx: number, cy: number, outerRadius: number): Map<number, LabelSpot> {
    const key = `${cx}|${cy}|${outerRadius}|${midAngles.map((a) => a.toFixed(1)).join(",")}`;
    if (layoutCache.current.key === key) return layoutCache.current.map;

    const RAD = Math.PI / 180;
    const GAP = 30;
    const minY = 8;
    const maxY = cy * 2 - 8;

    const spots: LabelSpot[] = midAngles.map((mid, index) => {
      const cos = Math.cos(-mid * RAD);
      const sin = Math.sin(-mid * RAD);
      const isRight = cos >= 0;
      return {
        index,
        isRight,
        sx: cx + outerRadius * cos,
        sy: cy + outerRadius * sin,
        kinkX: cx + (isRight ? 1 : -1) * (outerRadius + 10),
        endX: cx + (isRight ? 1 : -1) * (outerRadius + 26),
        y: cy + outerRadius * sin
      };
    });

    for (const side of [true, false]) {
      const group = spots.filter((spot) => spot.isRight === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < group.length; i += 1) {
        const floor = group[i - 1]!.y + GAP;
        if (group[i]!.y < floor) group[i]!.y = floor;
      }
      const last = group[group.length - 1];
      if (last && last.y > maxY) {
        last.y = maxY;
        for (let i = group.length - 2; i >= 0; i -= 1) {
          const ceil = group[i + 1]!.y - GAP;
          if (group[i]!.y > ceil) group[i]!.y = ceil;
        }
      }
      const first = group[0];
      if (first && first.y < minY) first.y = minY;
    }

    const map = new Map(spots.map((spot) => [spot.index, spot]));
    layoutCache.current = { key, map };
    return map;
  }

  const renderLabel = ({ cx, cy, outerRadius, percent, index, payload }: any) => {
    const spot = buildLayout(cx, cy, outerRadius).get(index);
    if (!spot) return <g />;
    const textX = spot.endX + (spot.isRight ? 7 : -7);
    // A cor e resolvida UMA vez e usada na fatia, na linha-guia e no ponto.
    // Recalcular aqui deixava linha e fatia de cores diferentes assim que a
    // categoria passou a trazer a propria cor.
    const color = sliceColor(data[index], index, colors.series);
    const pct = payload.percentLabel ?? `${(percent * 100).toFixed(1).replace(".", ",")}%`;
    return (
      <g>
        <polyline
          points={`${spot.sx},${spot.sy} ${spot.kinkX},${spot.sy} ${spot.endX},${spot.y}`}
          stroke={color}
          strokeWidth={1.4}
          fill="none"
        />
        <circle cx={spot.endX} cy={spot.y} r={1.8} fill={color} />
        <text x={textX} y={spot.y} textAnchor={spot.isRight ? "start" : "end"} dominantBaseline="central">
          <tspan x={textX} dy="-0.35em" fill="var(--text)" fontSize={12.5} fontWeight={600}>
            {payload.label}
          </tspan>
          <tspan x={textX} dy="1.3em" fill="var(--text-muted)" fontSize={11} fontWeight={700}>
            {pct}
          </tspan>
          {showValue && (
            <tspan x={textX} dy="1.25em" fill="var(--text-muted)" fontSize={10.5}>
              {formatValue(payload.value)}
            </tspan>
          )}
        </text>
      </g>
    );
  };

  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  // Com legenda, a rosca desenha as maiores e junta o resto numa fatia
  // "Outras" tracejada: ela não é uma categoria. A legenda lista todas.
  // Fatia própria enquanto a categoria tem ao menos PIE_MIN_SHARE do total
  // (até PIE_MAX_SLICES); o resto só vira "Outras" se forem duas ou mais.
  const headCount = legend
    ? (() => {
        let count = data.findIndex((item) => item.value / total < PIE_MIN_SHARE);
        if (count < 0) count = data.length;
        count = Math.min(count, PIE_MAX_SLICES);
        return data.length - count < 2 ? data.length : count;
      })()
    : data.length;
  const grouped = headCount < data.length;
  const pieData: (DonutDatum & { other?: boolean })[] = grouped
    ? [
        ...data.slice(0, headCount),
        {
          key: "__outras",
          label: "Outras",
          value: data.slice(headCount).reduce((sum, item) => sum + item.value, 0),
          other: true
        }
      ]
    : data;
  const chart = (
    <div className="donut">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart margin={legend ? { top: 4, right: 4, bottom: 4, left: 4 } : { top: 14, right: 14, bottom: 14, left: 14 }}>
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface-2, transparent)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-muted)" strokeWidth="2.2" />
            </pattern>
          </defs>
          <Pie
            data={pieData}
            dataKey="value"
            innerRadius={legend ? "62%" : "36%"}
            outerRadius={legend ? "96%" : "54%"}
            paddingAngle={legend ? 1.5 : 2.5}
            cornerRadius={legend ? 3 : 5}
            stroke="none"
            label={legend ? false : renderLabel}
            labelLine={false}
            isAnimationActive={false}
          >
            {pieData.map((item, index) =>
              item.other ? (
                <Cell
                  key={item.key}
                  fill={`url(#${hatchId})`}
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
              ) : (
                <Cell key={item.key} fill={sliceColor(item, index, colors.series)} />
              )
            )}
          </Pie>
          <Tooltip
            content={({ active, payload }: any) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <span>{payload[0].payload.label}</span>
                  <strong>{formatValue(payload[0].value)}</strong>
                </div>
              ) : null
            }
          />
        </PieChart>
      </ResponsiveContainer>
      {center && (
        <div className="donut-center">
          <span>{center.label}</span>
          <strong>{center.value}</strong>
        </div>
      )}
    </div>
  );
  if (!legend) return chart;

  return (
    <div className="donut-split">
      {chart}
      <ul className={`donut-legend${data.length > 6 ? " is-scroll" : ""}`}>
        {data.map((item, index) => (
          <li key={item.key} title={grouped && index >= headCount ? "Na fatia Outras" : undefined}>
            <i
              className={grouped && index >= headCount ? "is-other" : undefined}
              style={
                grouped && index >= headCount
                  ? { borderColor: sliceColor(item, index, colors.series) }
                  : { background: sliceColor(item, index, colors.series) }
              }
            />
            <span className="donut-legend-name" title={item.label}>
              {item.label}
            </span>
            <span className="donut-legend-pct">
              {item.percentLabel ?? `${((item.value / total) * 100).toFixed(1).replace(".", ",")}%`}
            </span>
            {showValue && <strong>{formatValue(item.value)}</strong>}
          </li>
        ))}
      </ul>
    </div>
  );
}

type LabelSpot = {
  index: number;
  isRight: boolean;
  sx: number;
  sy: number;
  kinkX: number;
  endX: number;
  y: number;
};

/** Cor da fatia: a do dado quando existir, senao a paleta do tema. */
/** Até quantas fatias a rosca desenha antes de agrupar o resto em "Outras". */
const PIE_MAX_SLICES = 14;
/** Categoria abaixo desta fração do total vai para "Outras". */
const PIE_MIN_SHARE = 0.02;

function sliceColor(item: DonutDatum | undefined, index: number, series: string[]) {
  return item?.color ?? series[index % series.length];
}

export function seriesColor(index: number, series: string[]) {
  return series[index % series.length];
}

function shortAxis(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}
