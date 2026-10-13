import type { MlResult } from '@/lib/ml/types';

/** Exportación en el navegador: el archivo se genera aquí y se descarga a tu equipo. Nada pasa por el servidor. */

const esc = (v: string | number | null): string => {
  const s = v === null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(rows: (string | number | null)[][]): string {
  // BOM + «;» para que Excel en español lo abra con las columnas bien separadas.
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 50) || 'informe'
  );
}

/** Datos fila a fila del resultado, o null si no hay (p. ej. un informe guardado). */
export function resultCsv(r: MlResult): { name: string; text: string } | null {
  switch (r.task) {
    case 'regression':
      return r.points.length
        ? { name: 'real-vs-predicho', text: toCsv([['Valor real', 'Valor predicho'], ...r.points.map((p) => [p.actual, p.predicted])]) }
        : null;
    case 'classification':
      return {
        name: 'matriz-de-aciertos',
        text: toCsv([['Real \\ Predicho', ...r.classes], ...r.classes.map((c, i) => [c, ...r.confusion[i]])]),
      };
    case 'anomaly':
      return r.items.some((i) => i.value !== null)
        ? {
            name: 'valores-atipicos',
            text: toCsv([
              ['Fila en la hoja', 'Columna', 'Valor', 'Sentido', 'Intensidad'],
              ...r.items.map((i) => [i.row, i.column, i.value, i.direction === 'alto' ? 'Muy alto' : 'Muy bajo', i.score]),
            ]),
          }
        : null;
    case 'clustering':
      return r.assignments.length
        ? { name: 'grupos', text: toCsv([['Fila en la hoja', 'Grupo'], ...r.assignments.map((a) => [a.row, `Grupo ${a.cluster + 1}`])]) }
        : null;
  }
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
