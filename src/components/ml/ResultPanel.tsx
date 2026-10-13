'use client';

import {
  QUALITY_LABELS,
  taskInfo,
  ANOMALY_METHOD_LABELS,
  SENSITIVITY_LABELS,
  type AnomalyResult,
  type ClassificationResult,
  type ClusteringResult,
  type Insight,
  type MlResult,
  type Quality,
  type RegressionResult,
} from '@/lib/ml/types';
import { fmt } from '../stats/format';
import { IconCheck, IconBell, IconSpark } from '../Icons';
import {
  ActualVsPredicted,
  AnomalyScatter,
  ClusterScatter,
  ClusterSizes,
  ConfusionMatrix,
  ImportanceBars,
  KScores,
} from './MlCharts';

const pct = (n: number, d = 0) => `${fmt(Math.round(n * 10 ** (d + 2)) / 10 ** d)} %`;

function Metric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: Quality }) {
  return (
    <div className={`metric ${tone ? `q-${tone}` : ''}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-hint">{hint}</span>
    </div>
  );
}

function QualityBadge({ q }: { q: Quality }) {
  return <span className={`qbadge q-${q}`}>{QUALITY_LABELS[q]}</span>;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rsection">
      <h3>{title}</h3>
      {hint && <p className="muted rhint">{hint}</p>}
      {children}
    </section>
  );
}

function Insights({ items }: { items: Insight[] }) {
  return (
    <ul className="insights">
      {items.map((i, k) => (
        <li key={k} className={`insight tone-${i.tone}`}>
          <span className="insight-icon" aria-hidden="true">
            {i.tone === 'good' ? <IconCheck size={16} /> : i.tone === 'warn' ? <IconBell size={16} /> : <IconSpark size={16} />}
          </span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── Por tarea ────────────────────────────────────────────────────────── */

function Regression({ r }: { r: RegressionResult }) {
  const m = r.metrics;
  return (
    <>
      <div className="metrics">
        <Metric tone={r.quality} label="Acierto del modelo" value={pct(Math.max(0, m.r2))} hint={`Parte de las variaciones de «${r.target}» que sabe explicar.`} />
        <Metric label="Error típico (RMSE)" value={fmt(m.rmse)} hint="Cuánto suele fallar una predicción. Los fallos grandes pesan más." />
        <Metric label="Error medio (MAE)" value={fmt(m.mae)} hint="Cuánto falla de media, sin más." />
        <Metric label="Filas usadas" value={`${r.trainRows} + ${r.testRows}`} hint="Para aprender + para comprobar con datos que no había visto." />
      </div>
      <Insights items={r.insights} />
      <div className="rgrid">
        {r.points.length > 0 && (
          <Section title="Real frente a predicho" hint="Cada punto es una fila de comprobación. Cuanto más cerca de la línea discontinua, mejor acertó.">
            <ActualVsPredicted points={r.points} target={r.target} />
          </Section>
        )}
        <Section title="Qué columnas influyen más" hint="Cuánto empeora el modelo si esa columna se desordena. Suma 100 %.">
          <ImportanceBars data={r.importance} />
        </Section>
      </div>
    </>
  );
}

function Classification({ r }: { r: ClassificationResult }) {
  const m = r.metrics;
  return (
    <>
      <div className="metrics">
        <Metric tone={r.quality} label="Aciertos" value={pct(m.accuracy)} hint="De cada 100 filas nuevas, en cuántas acierta la categoría." />
        <Metric label="Sin modelo acertaría" value={pct(m.baseline)} hint="Respondiendo siempre la categoría más habitual." />
        <Metric label="Categorías" value={String(r.classes.length)} hint={`Valores distintos de «${r.target}».`} />
        <Metric label="Filas usadas" value={`${r.trainRows} + ${r.testRows}`} hint="Para aprender + para comprobar con datos que no había visto." />
      </div>
      <Insights items={r.insights} />
      <div className="rgrid">
        <Section title="Dónde acierta y dónde se confunde" hint="Las casillas verdes (diagonal) son aciertos; las naranjas, confusiones.">
          <ConfusionMatrix r={r} />
        </Section>
        <Section title="Qué columnas influyen más" hint="Cuánto empeora el modelo si esa columna se desordena. Suma 100 %.">
          <ImportanceBars data={r.importance} />
        </Section>
      </div>
      <Section title="Resultado por categoría">
        <div className="table-scroll">
          <table className="sumtable">
            <thead>
              <tr>
                <th scope="col">Categoría</th>
                <th scope="col" className="num">Filas de prueba</th>
                <th scope="col" className="num" title="De las veces que dijo esta categoría, cuántas eran correctas">Fiabilidad al decirla</th>
                <th scope="col" className="num" title="De las filas que eran esta categoría, cuántas detectó">Casos que detecta</th>
              </tr>
            </thead>
            <tbody>
              {r.perClass.map((c) => (
                <tr key={c.label}>
                  <th scope="row">{c.label}</th>
                  <td className="num">{c.support}</td>
                  <td className="num">{pct(c.precision)}</td>
                  <td className="num">{pct(c.recall)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function Anomaly({ r }: { r: AnomalyResult }) {
  const hasValues = r.items.some((i) => i.value !== null);
  return (
    <>
      <div className="metrics">
        <Metric tone={r.flagged === 0 ? 'good' : r.pct > 10 ? 'weak' : 'ok'} label="Filas atípicas" value={String(r.flagged)} hint="Filas con algún valor fuera de lo habitual." />
        <Metric label="Del total" value={`${String(r.pct).replace('.', ',')} %`} hint={`De ${r.rowsTotal} filas revisadas.`} />
        <Metric label="Columnas revisadas" value={String(r.features.length)} hint={r.features.slice(0, 3).join(', ')} />
        <Metric label="Criterio" value={r.method === 'iqr' ? 'IQR' : 'Z-score'} hint={`${ANOMALY_METHOD_LABELS[r.method]}. Sensibilidad ${SENSITIVITY_LABELS[r.sensitivity].split(':')[0].toLowerCase()}.`} />
      </div>
      <Insights items={r.insights} />
      <div className="rgrid">
        {r.series.length > 0 && (
          <Section title="Dónde están los valores raros" hint="Los puntos naranjas quedan fuera de las líneas discontinuas (el rango normal).">
            <AnomalyScatter series={r.series} />
          </Section>
        )}
        <Section title="Rango normal por columna" hint="Lo que quede por debajo o por encima se marca como atípico.">
          <div className="table-scroll">
            <table className="sumtable">
              <thead>
                <tr>
                  <th scope="col">Columna</th>
                  <th scope="col" className="num">Desde</th>
                  <th scope="col" className="num">Hasta</th>
                  <th scope="col" className="num">Atípicos</th>
                </tr>
              </thead>
              <tbody>
                {r.columns.map((c) => (
                  <tr key={c.column}>
                    <th scope="row">{c.column}</th>
                    <td className="num">{fmt(c.low)}</td>
                    <td className="num">{fmt(c.high)}</td>
                    <td className="num">{c.flagged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
      {r.items.length > 0 && (
        <Section title="Filas a revisar primero" hint="Ordenadas de más a menos llamativas. El número es la fila en tu hoja de Excel.">
          <div className="table-scroll">
            <table className="sumtable">
              <thead>
                <tr>
                  <th scope="col" className="num">Fila</th>
                  <th scope="col">Columna</th>
                  {hasValues && <th scope="col" className="num">Valor</th>}
                  <th scope="col">Qué ocurre</th>
                  <th scope="col" className="num" title="Cuántas veces se aleja de lo habitual">Intensidad</th>
                </tr>
              </thead>
              <tbody>
                {r.items.slice(0, 15).map((i) => (
                  <tr key={`${i.row}-${i.column}`}>
                    <td className="num">{i.row}</td>
                    <th scope="row">{i.column}</th>
                    {hasValues && <td className="num">{i.value === null ? '—' : fmt(i.value)}</td>}
                    <td>{i.direction === 'alto' ? 'Muy alto' : 'Muy bajo'}</td>
                    <td className="num">×{fmt(i.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.flagged > 15 && <p className="muted chart-foot">Se muestran 15 de {r.flagged}. {hasValues ? 'Descarga los datos (CSV) para ver todas.' : ''}</p>}
        </Section>
      )}
    </>
  );
}

function Clustering({ r }: { r: ClusteringResult }) {
  return (
    <>
      <div className="metrics">
        <Metric label="Grupos" value={String(r.k)} hint={r.auto ? 'Elegido automáticamente.' : 'El número que has indicado.'} />
        <Metric tone={r.quality} label="Claridad de la separación" value={r.silhouette.toFixed(2).replace('.', ',')} hint="De −1 a 1. Más de 0,5 = grupos bien diferenciados." />
        <Metric label="Filas agrupadas" value={fmt(r.rowsUsed)} hint={`De ${fmt(r.rowsTotal)} en la hoja.`} />
        <Metric label="Grupo mayor" value={`${String(r.clusters[0]?.pct ?? 0).replace('.', ',')} %`} hint="Parte de las filas que reúne." />
      </div>
      <Insights items={r.insights} />
      <div className="rgrid">
        {r.projection.length > 0 && (
          <Section
            title="Mapa de grupos"
            hint={`Cada punto es una fila; los cercanos se parecen. Es una vista simplificada que conserva el ${Math.round(r.explained * 100)} % de la información.`}
          >
            <ClusterScatter r={r} />
          </Section>
        )}
        <Section title="Tamaño de cada grupo">
          <ClusterSizes r={r} />
        </Section>
      </div>
      <Section title="Cómo es cada grupo" hint="Los rasgos que más lo distinguen del conjunto.">
        <div className="cluster-cards">
          {r.clusters.map((c) => (
            <article key={c.id} className="cluster-card" style={{ ['--cc' as string]: `var(--c${(c.id % 8) + 1})` }}>
              <header>
                <h4>{c.name}</h4>
                <span className="tag">{c.size} {c.size === 1 ? 'fila' : 'filas'} ({String(c.pct).replace('.', ',')} %)</span>
              </header>
              <p className="muted">{c.description}</p>
              {c.traits.length > 0 && (
                <ul>
                  {c.traits.map((t) => (
                    <li key={t.text}>{t.text}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </Section>
      {r.auto && r.kScores.length > 1 && (
        <Section title="Cómo se eligió el número de grupos" hint="Se probaron varios y se eligió el de mejor separación (línea naranja).">
          <KScores r={r} />
        </Section>
      )}
    </>
  );
}

/* ── Panel completo ───────────────────────────────────────────────────── */

export function ResultPanel({ result }: { result: MlResult }) {
  const info = taskInfo(result.task);
  const quality = 'quality' in result ? result.quality : null;
  return (
    <div className="result">
      <div className="result-head">
        <span className="tag tag-task" style={{ ['--ta' as string]: info.accent }}>{info.plain}</span>
        {quality && <QualityBadge q={quality} />}
        {'algorithmLabel' in result && <span className="muted">Método: {result.algorithmLabel}</span>}
      </div>

      {result.task === 'regression' && <Regression r={result} />}
      {result.task === 'classification' && <Classification r={result} />}
      {result.task === 'anomaly' && <Anomaly r={result} />}
      {result.task === 'clustering' && <Clustering r={result} />}

      {result.notes.length > 0 && (
        <details className="rnotes">
          <summary>Avisos sobre los datos ({result.notes.length})</summary>
          <ul>
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
