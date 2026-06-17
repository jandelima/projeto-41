import { useId, useMemo, useRef } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
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
  tone = "accent"
}: {
  data: { date?: string; year?: number; [key: string]: unknown }[];
  dataKey?: string;
  height?: number | string;
  tone?: "accent" | "positive";
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

export function DualAreaTrend({
  data,
  height = 320
}: {
  data: { year: number; nominal: number; real: number }[];
  height?: number;
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
        <XAxis dataKey="year" tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={compactMoney} width={64} tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          content={({ active, payload, label }: any) =>
            active && payload?.length ? (
              <div className="chart-tooltip">
                <span>{label}</span>
                {payload.map((item: any) => (
                  <strong key={item.dataKey} style={{ color: item.stroke }}>
                    {item.name}: {money(item.value)}
                  </strong>
                ))}
              </div>
            ) : null
          }
        />
        <Area name="Saldo nominal" type="monotone" dataKey="nominal" stroke={colors.accent} strokeWidth={2.2} fill={`url(#${gradientId})`} />
        <Area name="Saldo corrigido" type="monotone" dataKey="real" stroke={colors.positive} strokeWidth={2.2} fill="transparent" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 280 }: { data: { key: string; label: string; value: number }[]; height?: number }) {
  const { colors } = useTheme();
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
    const color = colors.series[index % colors.series.length];
    const pct = `${(percent * 100).toFixed(1).replace(".", ",")}%`;
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
        </text>
      </g>
    );
  };

  return (
    <div className="donut">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart margin={{ top: 14, right: 14, bottom: 14, left: 14 }}>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="36%"
            outerRadius="54%"
            paddingAngle={2.5}
            cornerRadius={5}
            stroke="none"
            label={renderLabel}
            labelLine={false}
            isAnimationActive={false}
          >
            {data.map((item, index) => (
              <Cell key={item.key} fill={colors.series[index % colors.series.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }: any) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <span>{payload[0].payload.label}</span>
                  <strong>{money(payload[0].value)}</strong>
                </div>
              ) : null
            }
          />
        </PieChart>
      </ResponsiveContainer>
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

export function seriesColor(index: number, series: string[]) {
  return series[index % series.length];
}

function shortAxis(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}
