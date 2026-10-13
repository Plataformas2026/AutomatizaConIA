'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { AnomalyResult, ClassificationResult, ClusteringResult, Importance, RegressionResult } from '@/lib/ml/types';
import { AXIS, ChartTooltip } from '../stats/ChartRenderer';
import { fmt, fmtCompact, SERIES, truncate } from '../stats/format';

const H = 300;

/* ── Real frente a predicho ───────────────────────────────────────────── */

export function ActualVsPredicted({ points, target }: { points: RegressionResult['points']; target: string }) {
  if (!points.length) return null;
  const all = points.flatMap((p) => [p.actual, p.predicted]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.05 || 1;
  const domain: [number, number] = [min - pad, max + pad];
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
        <CartesianGrid stroke="var(--border)" />
        <XAxis
          type="number"
          dataKey="actual"
          name="Real"
          domain={domain}
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
          tickFormatter={fmtCompact}
          label={{ value: `Valor real de «${truncate(target, 24)}»`, position: 'insideBottom', offset: -12, style: AXIS }}
        />
        <YAxis type="number" dataKey="predicted" name="Predicho" domain={domain} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={52} />
        <ZAxis range={[56, 56]} />
        <ReferenceLine
          segment={[{ x: domain[0], y: domain[0] }, { x: domain[1], y: domain[1] }]}
          stroke="var(--muted)"
          strokeDasharray="5 4"
          ifOverflow="visible"
        />
        <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'var(--muted)' }} content={<ChartTooltip title={() => 'Una fila de comprobación'} />} />
        <Scatter data={points} fill="var(--c1)" fillOpacity={0.75} stroke="var(--surface)" strokeWidth={1.5} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/* ── Importancia de variables ─────────────────────────────────────────── */

export function ImportanceBars({ data }: { data: Importance[] }) {
  const shown = data.slice(0, 10);
  if (!shown.length || shown.every((d) => d.value === 0)) {
    return <p className="muted chart-note">Ninguna columna destaca sobre las demás: el modelo no ha encontrado una relación clara.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, shown.length * 34 + 30)}>
      <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v} %`} />
        <YAxis type="category" dataKey="feature" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={130} interval={0} tickFormatter={(v) => truncate(v, 20)} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip title={(i) => String(i.payload?.feature ?? '')} />} />
        <Bar dataKey="value" name="Peso en la predicción (%)" fill="var(--c1)" radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Matriz de confusión (tabla con intensidad de color) ──────────────── */

export function ConfusionMatrix({ r }: { r: ClassificationResult }) {
  const max = Math.max(1, ...r.confusion.flat());
  return (
    <div className="table-scroll">
      <table className="confusion">
        <caption className="sr-only">Aciertos y errores por categoría</caption>
        <thead>
          <tr>
            <td />
            <th colSpan={r.classes.length} scope="colgroup" className="conf-top">
              El modelo respondió…
            </th>
          </tr>
          <tr>
            <th scope="col" className="conf-side">Era realmente…</th>
            {r.classes.map((c) => (
              <th key={c} scope="col">{truncate(c, 14)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.classes.map((real, i) => (
            <tr key={real}>
              <th scope="row">{truncate(real, 18)}</th>
              {r.confusion[i].map((v, j) => (
                <td
                  key={j}
                  className={i === j ? 'hit' : 'miss'}
                  style={{ background: `color-mix(in srgb, ${i === j ? 'var(--c3)' : 'var(--c2)'} ${Math.round((v / max) * 70)}%, var(--surface))` }}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Anomalías ────────────────────────────────────────────────────────── */

export function AnomalyScatter({ series }: { series: AnomalyResult['series'] }) {
  const [idx, setIdx] = useState(0);
  if (!series.length) return null;
  const s = series[Math.min(idx, series.length - 1)];
  const normal = s.points.filter((p) => !p.flagged);
  const flagged = s.points.filter((p) => p.flagged);
  return (
    <div>
      {series.length > 1 && (
        <div className="field inline-field">
          <label htmlFor="an-col">Columna</label>
          <select id="an-col" value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
            {series.map((c, i) => (
              <option key={c.column} value={i}>{c.column}</option>
            ))}
          </select>
        </div>
      )}
      <ResponsiveContainer width="100%" height={H}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis type="number" dataKey="x" name="Fila" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--border)' }} label={{ value: 'Nº de fila en tu hoja', position: 'insideBottom', offset: -12, style: AXIS }} />
          <YAxis type="number" dataKey="y" name={s.column} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={56} />
          <ZAxis range={[48, 48]} />
          <ReferenceLine y={s.high} stroke="var(--c2)" strokeDasharray="5 4" label={{ value: 'Límite alto', position: 'insideTopRight', style: AXIS }} />
          <ReferenceLine y={s.low} stroke="var(--c2)" strokeDasharray="5 4" label={{ value: 'Límite bajo', position: 'insideBottomRight', style: AXIS }} />
          <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'var(--muted)' }} content={<ChartTooltip title={() => s.column} />} />
          <Scatter name="Normales" data={normal} fill="var(--c1)" fillOpacity={0.55} />
          <Scatter name="Atípicos" data={flagged} fill="var(--c2)" stroke="var(--surface)" strokeWidth={1.5} />
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mini-legend" aria-hidden="true">
        <span><i style={{ background: 'var(--c1)' }} />Normales</span>
        <span><i style={{ background: 'var(--c2)' }} />Atípicos</span>
      </div>
    </div>
  );
}

/* ── Clusters ─────────────────────────────────────────────────────────── */

export function ClusterScatter({ r }: { r: ClusteringResult }) {
  if (!r.projection.length) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={H}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 12, left: 4 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis type="number" dataKey="x" name="Eje 1" tick={false} axisLine={{ stroke: 'var(--border)' }} />
          <YAxis type="number" dataKey="y" name="Eje 2" tick={false} axisLine={false} width={12} />
          <ZAxis range={[48, 48]} />
          <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'var(--muted)' }} content={<ChartTooltip title={() => 'Una fila'} />} />
          {r.clusters.map((c) => (
            <Scatter
              key={c.id}
              name={c.name}
              data={r.projection.filter((p) => p.cluster === c.id)}
              fill={SERIES[c.id % SERIES.length]}
              fillOpacity={0.8}
              stroke="var(--surface)"
              strokeWidth={1.2}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mini-legend" aria-hidden="true">
        {r.clusters.map((c) => (
          <span key={c.id}><i style={{ background: SERIES[c.id % SERIES.length] }} />{c.name}</span>
        ))}
      </div>
    </div>
  );
}

export function ClusterSizes({ r }: { r: ClusteringResult }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={r.clusters} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={44} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip />} />
        <Bar dataKey="size" name="Filas" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {r.clusters.map((c) => (
            <Cell key={c.id} fill={SERIES[c.id % SERIES.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function KScores({ r }: { r: ClusteringResult }) {
  if (r.kScores.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={r.kScores} margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="k" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--border)' }} label={{ value: 'Número de grupos probados', position: 'insideBottom', offset: -10, style: AXIS }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => fmt(v)} />
        <Tooltip content={<ChartTooltip title={(i) => `${i.payload?.k} grupos`} />} />
        <Line dataKey="silhouette" name="Claridad de la separación" type="monotone" stroke="var(--c1)" strokeWidth={2} dot={{ r: 4, fill: 'var(--c1)', stroke: 'var(--surface)', strokeWidth: 2 }} />
        <ReferenceLine x={r.k} stroke="var(--c2)" strokeDasharray="4 4" />
      </LineChart>
    </ResponsiveContainer>
  );
}
