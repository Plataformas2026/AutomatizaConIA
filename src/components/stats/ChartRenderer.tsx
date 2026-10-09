'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { AGG_LABELS, STACKABLE_AGGS, type ChartConfig, type ChartResult } from '@/lib/stats/types';
import { fmt, fmtCompact, SERIES, truncate } from './format';

const HEIGHT = 300;
const AXIS = { fontSize: 12, fill: 'var(--muted)' } as const;

/* ── Tooltip común: usa los tokens de texto, no el color de la serie ── */

interface TipItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({
  active,
  payload,
  label,
  title,
}: {
  active?: boolean;
  payload?: readonly TipItem[];
  label?: string | number;
  title?: (item: TipItem) => string;
}) {
  if (!active || !payload?.length) return null;
  const heading = title ? title(payload[0]) : label;
  return (
    <div className="ct">
      {heading !== undefined && heading !== '' && <div className="ct-title">{heading}</div>}
      {payload.map((p, i) => (
        <div className="ct-row" key={i}>
          <span className="ct-dot" style={{ background: p.color || 'var(--c1)' }} />
          <span className="ct-name">{p.name}</span>
          <b>{fmt(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

const legendProps = {
  iconType: 'circle' as const,
  iconSize: 9,
  wrapperStyle: { fontSize: 12, paddingTop: 8 },
  formatter: (value: string) => <span style={{ color: 'var(--text)' }}>{value}</span>,
};

const grid = <CartesianGrid vertical={false} stroke="var(--border)" />;

function metricName(c: ChartConfig): string {
  return c.agg === 'count' ? 'Filas' : `${AGG_LABELS[c.agg]} de ${c.y}`;
}

/* ── Renderizador ─────────────────────────────────────────────────────── */

export function ChartRenderer({ config, result }: { config: ChartConfig; result: ChartResult }) {
  const name = metricName(config);

  if (result.kind === 'kpi') {
    return (
      <div className="kpi">
        <span className="kpi-value">{result.value === null ? '—' : fmt(result.value)}</span>
        <span className="kpi-label">{name}</span>
      </div>
    );
  }

  if (result.kind === 'points') {
    return (
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 4 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis
            type="number"
            dataKey="x"
            name={config.x ?? 'X'}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tickFormatter={fmtCompact}
            label={{ value: config.x ?? '', position: 'insideBottom', offset: -10, style: AXIS }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={config.y ?? 'Y'}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtCompact}
            width={52}
          />
          <ZAxis range={[64, 64]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'var(--muted)' }}
            content={<ChartTooltip title={() => 'Fila'} />}
          />
          <Scatter
            name={`${config.y} según ${config.x}`}
            data={result.data}
            fill="var(--c1)"
            fillOpacity={0.8}
            stroke="var(--surface)"
            strokeWidth={1.5}
          />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (result.kind === 'multi') {
    const stacked = config.type === 'stacked_area' ? 'area' : 'bar';
    const keys = result.keys;
    const xInterval = result.data.length <= 12 ? 0 : 'preserveStartEnd';
    const margin = { top: 8, right: 12, bottom: 4, left: 4 };
    const xAxis = (
      <XAxis
        dataKey="label"
        tick={AXIS}
        tickLine={false}
        axisLine={{ stroke: 'var(--border)' }}
        tickFormatter={(v) => truncate(v, 12)}
        interval={xInterval}
      />
    );
    const yAxis = (
      <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
    );
    return (
      <ResponsiveContainer width="100%" height={HEIGHT}>
        {stacked === 'bar' ? (
          <BarChart data={result.data} margin={margin}>
            {grid}
            {xAxis}
            {yAxis}
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
            <Legend {...legendProps} />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="s"
                fill={SERIES[i % SERIES.length]}
                stroke="var(--surface)"
                strokeWidth={2}
                maxBarSize={56}
                radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={result.data} margin={margin}>
            {grid}
            {xAxis}
            {yAxis}
            <Tooltip cursor={{ stroke: 'var(--muted)' }} content={<ChartTooltip />} />
            <Legend {...legendProps} />
            {keys.map((k, i) => (
              <Area
                key={k}
                dataKey={k}
                type="monotone"
                stackId="s"
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                fill={SERIES[i % SERIES.length]}
                fillOpacity={0.55}
                activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    );
  }

  /* result.kind === 'series' */
  const data = result.data;
  const xInterval = data.length <= 12 && !['line', 'area'].includes(config.type) ? 0 : 'preserveStartEnd';
  const margin = { top: 8, right: 12, bottom: 4, left: 4 };
  const xAxis = (
    <XAxis
      dataKey="label"
      tick={AXIS}
      tickLine={false}
      axisLine={{ stroke: 'var(--border)' }}
      tickFormatter={(v) => truncate(v, 12)}
      interval={xInterval}
    />
  );
  const yAxis = <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />;

  switch (config.type) {
    case 'bar':
      return (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <BarChart data={data} margin={margin}>
            {grid}
            {xAxis}
            {yAxis}
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
            <Bar dataKey="value" name={name} fill="var(--c1)" radius={[4, 4, 0, 0]} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
      );

    case 'hbar':
      return (
        <ResponsiveContainer width="100%" height={Math.max(HEIGHT, data.length * 34 + 40)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
            <YAxis
              type="category"
              dataKey="label"
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              width={120}
              interval={0}
              tickFormatter={(v) => truncate(v, 18)}
            />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
            <Bar dataKey="value" name={name} fill="var(--c1)" radius={[0, 4, 4, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      );

    case 'line':
      return (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={data} margin={margin}>
            {grid}
            {xAxis}
            {yAxis}
            <Tooltip cursor={{ stroke: 'var(--muted)' }} content={<ChartTooltip />} />
            <Line
              dataKey="value"
              name={name}
              type="monotone"
              stroke="var(--c1)"
              strokeWidth={2}
              dot={data.length <= 12 ? { r: 4, fill: 'var(--c1)', stroke: 'var(--surface)', strokeWidth: 2 } : false}
              activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      );

    case 'area':
      return (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <AreaChart data={data} margin={margin}>
            {grid}
            {xAxis}
            {yAxis}
            <Tooltip cursor={{ stroke: 'var(--muted)' }} content={<ChartTooltip />} />
            <Area
              dataKey="value"
              name={name}
              type="monotone"
              stroke="var(--c1)"
              strokeWidth={2}
              fill="var(--c1)"
              fillOpacity={0.2}
              activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      );

    case 'pie':
    case 'donut': {
      const donut = config.type === 'donut';
      const additive = STACKABLE_AGGS.includes(config.agg);
      const total = data.reduce((s, d) => s + d.value, 0);
      return (
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height={HEIGHT}>
            <PieChart>
              <Tooltip content={<ChartTooltip title={(i) => String(i.payload?.label ?? '')} />} />
              <Legend {...legendProps} />
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                name={name}
                innerRadius={donut ? '56%' : 0}
                outerRadius="78%"
                stroke="var(--surface)"
                strokeWidth={2}
                isAnimationActive={false}
                labelLine={false}
                label={(p: { cx?: number; cy?: number; midAngle?: number; outerRadius?: number; percent?: number }) => {
                  if ((p.percent ?? 0) < 0.07) return null;
                  const r = (p.outerRadius ?? 0) + 16;
                  const a = (-(p.midAngle ?? 0) * Math.PI) / 180;
                  return (
                    <text
                      x={(p.cx ?? 0) + r * Math.cos(a)}
                      y={(p.cy ?? 0) + r * Math.sin(a)}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--text)"
                    >
                      {Math.round((p.percent ?? 0) * 100)}%
                    </text>
                  );
                }}
              >
                {data.map((d, i) => (
                  <Cell key={d.label} fill={SERIES[i % SERIES.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {donut && additive && (
            <div className="donut-center" aria-hidden="true">
              <strong>{fmt(total)}</strong>
              <span>Total</span>
            </div>
          )}
        </div>
      );
    }

    case 'radar':
      if (data.length < 3) {
        return <p className="muted chart-note">El radar necesita al menos 3 categorías. Elige otra columna o sube «Mostrar hasta».</p>;
      }
      return (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="label" tick={AXIS} tickFormatter={(v) => truncate(v, 14)} />
            <PolarRadiusAxis angle={90} tickCount={4} tick={{ ...AXIS, fontSize: 10 }} tickFormatter={fmtCompact} axisLine={false} />
            <Tooltip content={<ChartTooltip title={(i) => String(i.payload?.label ?? '')} />} />
            <Radar
              dataKey="value"
              name={name}
              stroke="var(--c1)"
              strokeWidth={2}
              fill="var(--c1)"
              fillOpacity={0.25}
              dot={{ r: 4, fill: 'var(--c1)', stroke: 'var(--surface)', strokeWidth: 2 }}
            />
          </RadarChart>
        </ResponsiveContainer>
      );

    case 'table': {
      const additive = STACKABLE_AGGS.includes(config.agg);
      const total = data.reduce((s, d) => s + d.value, 0);
      const max = Math.max(...data.map((d) => d.value), 0);
      return (
        <div className="table-scroll">
          <table className="sumtable">
            <thead>
              <tr>
                <th scope="col">{config.x}</th>
                <th scope="col" className="num">
                  {name}
                </th>
                <th scope="col">{additive ? '% del total' : 'Comparativa'}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const share = additive ? (total ? d.value / total : 0) : max ? d.value / max : 0;
                const bar = max ? d.value / max : 0; // la barra se escala al mayor para que se lea bien
                return (
                  <tr key={d.label}>
                    <th scope="row">{d.label}</th>
                    <td className="num">{fmt(d.value)}</td>
                    <td>
                      <span className="meter" aria-hidden="true">
                        <span style={{ width: `${Math.max(2, Math.round(Math.max(bar, 0) * 100))}%` }} />
                      </span>
                      {additive && <span className="meter-pct">{Math.round(share * 1000) / 10} %</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {additive && (
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="num">{fmt(total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      );
    }

    default:
      return null;
  }
}
