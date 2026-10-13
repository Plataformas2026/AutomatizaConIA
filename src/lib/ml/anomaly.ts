import type { ParsedTable } from '@/lib/parsing/parse';
import { cellNumber, StatsError } from '@/lib/stats/compute';
import { mean, median, quantile, round, std } from './util';
import type { AnomalyItem, AnomalyMethod, AnomalyResult, Insight, Sensitivity } from './types';

/** Detección de valores atípicos por columna (IQR o Z-score). */

const IQR_K: Record<Sensitivity, number> = { low: 3, normal: 1.5, high: 1 };
const Z_K: Record<Sensitivity, number> = { low: 3.5, normal: 3, high: 2.5 };
const MAX_ITEMS = 1000;
const MAX_SERIES = 4;
const NORMAL_POINTS = 400;

export function detectAnomalies(
  table: ParsedTable,
  columns: string[],
  method: AnomalyMethod,
  sensitivity: Sensitivity,
  notes: string[],
  isNumeric: (column: string) => boolean,
): AnomalyResult {
  const usable = columns.filter((c) => {
    if (!table.headers.includes(c)) return false;
    if (isNumeric(c)) return true;
    notes.push(`«${c}» se ha omitido: aquí solo se revisan columnas con números.`);
    return false;
  });
  if (!usable.length) throw new StatsError('no_numeric_columns', 422);

  const rowScore = new Map<number, { score: number; column: string; value: number; direction: 'alto' | 'bajo' }>();
  const stats: AnomalyResult['columns'] = [];
  const perColumnPoints: { column: string; low: number; high: number; flagged: number; pts: { x: number; y: number; flagged: boolean }[] }[] = [];
  const used: string[] = [];

  for (const column of usable) {
    const vals: { row: number; v: number }[] = [];
    for (const r of table.rows) {
      const v = cellNumber(r.values[column]);
      if (v !== null) vals.push({ row: r.rowNumber, v });
    }
    if (vals.length < 8) {
      notes.push(`«${column}» se ha omitido: tiene muy pocos valores.`);
      continue;
    }
    const nums = vals.map((x) => x.v);
    const sorted = [...nums].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;

    let useMethod = method;
    if (method === 'iqr' && iqr === 0) {
      useMethod = 'zscore';
      notes.push(`En «${column}» muchos valores coinciden, así que se ha usado la desviación típica en lugar del IQR.`);
    }
    let low: number, high: number, center: number, spread: number;
    if (useMethod === 'iqr') {
      const k = IQR_K[sensitivity];
      low = q1 - k * iqr;
      high = q3 + k * iqr;
      center = median(nums);
      spread = iqr / 1.349; // equivale a una desviación típica si los datos fueran «normales»
    } else {
      const m = mean(nums);
      const s = std(nums, m);
      if (s === 0) {
        notes.push(`«${column}» se ha omitido: tiene siempre el mismo valor.`);
        continue;
      }
      const k = Z_K[sensitivity];
      low = m - k * s;
      high = m + k * s;
      center = m;
      spread = s;
    }

    let flagged = 0;
    const pts: { x: number; y: number; flagged: boolean }[] = [];
    for (const { row, v } of vals) {
      const isOut = v < low || v > high;
      if (isOut) {
        flagged++;
        const score = Math.abs(v - center) / (spread || 1);
        const cur = rowScore.get(row);
        if (!cur || score > cur.score) rowScore.set(row, { score, column, value: v, direction: v > high ? 'alto' : 'bajo' });
      }
      pts.push({ x: row, y: v, flagged: isOut });
    }
    used.push(column);
    stats.push({ column, low: round(low, 4), high: round(high, 4), flagged, method: useMethod });
    perColumnPoints.push({ column, low, high, flagged, pts });
  }
  if (!used.length) throw new StatsError('no_numeric_columns', 422);

  const items: AnomalyItem[] = [...rowScore.entries()]
    .map(([row, o]) => ({ row, column: o.column, value: o.value, score: round(o.score, 1), direction: o.direction }))
    .sort((a, b) => b.score - a.score);
  const flaggedRows = items.map((i) => i.row).sort((a, b) => a - b);

  const series = [...perColumnPoints]
    .sort((a, b) => b.flagged - a.flagged)
    .slice(0, MAX_SERIES)
    .map((c) => {
      const out = c.pts.filter((p) => p.flagged).slice(0, 300);
      const normal = c.pts.filter((p) => !p.flagged);
      const step = Math.max(1, Math.ceil(normal.length / NORMAL_POINTS));
      const picked = normal.filter((_, i) => i % step === 0);
      return { column: c.column, low: c.low, high: c.high, points: [...picked, ...out] };
    });

  const total = table.rows.length;
  const result: AnomalyResult = {
    task: 'anomaly',
    method,
    sensitivity,
    flagged: items.length,
    pct: total ? round((items.length / total) * 100, 1) : 0,
    columns: stats,
    items: items.slice(0, MAX_ITEMS),
    flaggedRows: flaggedRows.slice(0, 5000),
    series,
    rowsTotal: total,
    rowsUsed: total,
    features: used,
    notes,
    insights: [],
  };
  result.insights = anomalyInsights(result);
  return result;
}

function anomalyInsights(r: AnomalyResult): Insight[] {
  const out: Insight[] = [];
  if (r.flagged === 0) {
    out.push({ tone: 'good', text: 'No se ha encontrado ningún valor fuera de lo normal con esta sensibilidad. Si esperabas alguno, prueba con sensibilidad «Alta».' });
    return out;
  }
  out.push({
    tone: r.pct > 10 ? 'warn' : 'info',
    text: `Se ${r.flagged === 1 ? 'ha marcado 1 fila' : `han marcado ${r.flagged} filas`} con algún valor atípico (${String(r.pct).replace('.', ',')} % del total).`,
  });
  if (r.pct > 10) out.push({ tone: 'warn', text: 'Son muchas filas. Baja la sensibilidad a «Baja» para quedarte solo con lo más llamativo.' });
  const worst = [...r.columns].sort((a, b) => b.flagged - a.flagged)[0];
  if (worst && worst.flagged > 0) out.push({ tone: 'info', text: `La columna con más valores raros es «${worst.column}» (${worst.flagged}).` });
  const top = r.items.slice(0, 5).map((i) => i.row);
  if (top.length) out.push({ tone: 'info', text: top.length === 1 ? `Empieza por revisar la fila ${top[0]} de tu hoja: es la más alejada de lo habitual.` : `Empieza por revisar las filas ${top.join(', ')} de tu hoja: son las más alejadas de lo habitual.` });
  out.push({ tone: 'info', text: 'Un valor atípico no siempre es un error: puede ser un caso real poco frecuente. Compruébalo en tu archivo.' });
  return out;
}
