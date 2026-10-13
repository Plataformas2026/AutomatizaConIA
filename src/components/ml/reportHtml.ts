import { QUALITY_LABELS, taskInfo, type MlResult } from '@/lib/ml/types';

/**
 * Informe descargable: una única página HTML autocontenida (se abre con doble clic en
 * cualquier navegador y se imprime/guarda como PDF desde ahí). Se construye en el
 * navegador a partir del resultado en pantalla: el servidor no guarda ninguna copia.
 */

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: digits }) : '—';
const pct = (n: number): string => `${num(n * 100, 1)} %`;

function table(head: string[], rows: (string | number)[][]): string {
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function body(r: MlResult): string {
  const out: string[] = [];
  switch (r.task) {
    case 'regression': {
      out.push(
        `<ul class="kpis"><li><b>${num(r.metrics.r2, 2)}</b><span>Ajuste (R²; 1 es perfecto)</span></li>` +
          `<li><b>${num(r.metrics.mae)}</b><span>Error medio</span></li>` +
          `<li><b>${num(r.metrics.rmse)}</b><span>Error típico (RMSE)</span></li>` +
          `<li><b>${num(r.metrics.baselineRmse)}</b><span>Error si solo se predijera la media</span></li></ul>`,
      );
      if (r.importance.length) out.push('<h2>Qué columnas pesan más</h2>' + table(['Columna', 'Peso (%)'], r.importance.map((i) => [i.feature, num(i.value, 1)])));
      break;
    }
    case 'classification': {
      out.push(
        `<ul class="kpis"><li><b>${pct(r.metrics.accuracy)}</b><span>Aciertos</span></li>` +
          `<li><b>${pct(r.metrics.baseline)}</b><span>Aciertos si siempre se dijera lo más habitual</span></li></ul>`,
      );
      out.push('<h2>Resultado por categoría</h2>' + table(['Categoría', 'Precisión', 'Cobertura', 'Casos'], r.perClass.map((c) => [c.label, pct(c.precision), pct(c.recall), c.support])));
      out.push('<h2>Matriz de aciertos (filas = real, columnas = predicho)</h2>' + table(['Real \\ Predicho', ...r.classes], r.classes.map((c, i) => [c, ...r.confusion[i]])));
      if (r.importance.length) out.push('<h2>Qué columnas pesan más</h2>' + table(['Columna', 'Peso (%)'], r.importance.map((i) => [i.feature, num(i.value, 1)])));
      break;
    }
    case 'anomaly': {
      out.push(`<ul class="kpis"><li><b>${r.flagged}</b><span>Valores raros (${num(r.pct, 1)} % de las filas)</span></li></ul>`);
      out.push('<h2>Rangos normales por columna</h2>' + table(['Columna', 'Normal desde', 'Normal hasta', 'Marcados'], r.columns.map((c) => [c.column, num(c.low), num(c.high), c.flagged])));
      if (r.items.length)
        out.push(
          '<h2>Los más raros</h2>' +
            table(['Fila', 'Columna', 'Valor', 'Sentido'], r.items.slice(0, 100).map((i) => [i.row, i.column, i.value === null ? '—' : num(i.value), i.direction === 'alto' ? 'Muy alto' : 'Muy bajo'])),
        );
      break;
    }
    case 'clustering': {
      out.push(`<ul class="kpis"><li><b>${r.k}</b><span>Grupos${r.auto ? ' (elegidos automáticamente)' : ''}</span></li></ul>`);
      out.push(
        r.clusters
          .map((c) => `<h2>${esc(c.name)} · ${c.size} filas (${num(c.pct, 1)} %)</h2><p>${esc(c.description)}</p>`)
          .join(''),
      );
      break;
    }
  }
  return out.join('\n');
}

export function buildReportHtml(result: MlResult, meta: { title: string; fileName: string; sheet: string | null }): string {
  const info = taskInfo(result.task);
  const quality = 'quality' in result ? QUALITY_LABELS[result.quality] : null;
  const insights = result.insights.map((i) => `<li class="${i.tone}">${esc(i.text)}</li>`).join('');
  const notes = result.notes.map((n) => `<li>${esc(n)}</li>`).join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)}</title>
<style>
body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1735;max-width:820px;margin:32px auto;padding:0 20px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:26px 0 8px}
.meta{color:#625d85;font-size:14px}.badge{display:inline-block;background:#e9e5ff;color:#5b3df5;border-radius:99px;padding:2px 10px;font-size:13px;margin-right:6px}
.kpis{list-style:none;padding:0;margin:18px 0;display:flex;gap:12px;flex-wrap:wrap}
.kpis li{border:1px solid #dedaf2;border-radius:12px;padding:12px 16px;min-width:150px}.kpis b{display:block;font-size:24px}.kpis span{color:#625d85;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #dedaf2;padding:6px 8px;text-align:left}th{background:#f0eefb}
ul.ins{padding-left:20px}.ins .warn{color:#8a5a00}.ins .good{color:#0b7a6b}
footer{margin-top:36px;color:#625d85;font-size:12px}
@media print{body{margin:0}}
</style></head><body>
<h1>${esc(meta.title)}</h1>
<p class="meta"><span class="badge">${esc(info.plain)}</span>${quality ? `<span class="badge">${esc(quality)}</span>` : ''}
Archivo: ${esc(meta.fileName)}${meta.sheet ? ` · Hoja «${esc(meta.sheet)}»` : ''} · ${result.rowsUsed} de ${result.rowsTotal} filas usadas · ${esc(new Date().toLocaleString('es-ES'))}</p>
${insights ? `<h2>Conclusiones</h2><ul class="ins">${insights}</ul>` : ''}
${body(result)}
${notes ? `<h2>Avisos sobre los datos</h2><ul>${notes}</ul>` : ''}
<footer>Informe generado al momento por Automatización con IA. No se guarda ninguna copia en el sistema: este archivo es solo tuyo.</footer>
</body></html>`;
}
