import type { Rng } from './util';
import { mean, quantile, std } from './util';

/** K-Means (inicialización k-means++), silueta y proyección PCA a 2 ejes. */

const dist2 = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
};

export interface KMeansFit {
  labels: number[];
  centers: number[][];
  inertia: number;
}

function once(Z: number[][], k: number, rnd: Rng, maxIter = 60): KMeansFit {
  const n = Z.length;
  // k-means++
  const centers: number[][] = [Z[Math.floor(rnd() * n)].slice()];
  const d = new Array<number>(n).fill(Infinity);
  while (centers.length < k) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      d[i] = Math.min(d[i], dist2(Z[i], centers[centers.length - 1]));
      total += d[i];
    }
    let r = rnd() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break; } }
    centers.push(Z[pick].slice());
  }

  const labels = new Array<number>(n).fill(0);
  for (let it = 0; it < maxIter; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const v = dist2(Z[i], centers[c]); if (v < bd) { bd = v; best = c; } }
      if (labels[i] !== best) { labels[i] = best; moved = true; }
    }
    const sums = centers.map((c) => new Array<number>(c.length).fill(0));
    const cnt = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) { cnt[labels[i]]++; for (let j = 0; j < Z[i].length; j++) sums[labels[i]][j] += Z[i][j]; }
    for (let c = 0; c < k; c++) {
      if (cnt[c] === 0) { centers[c] = Z[Math.floor(rnd() * n)].slice(); moved = true; continue; }
      centers[c] = sums[c].map((v) => v / cnt[c]);
    }
    if (!moved) break;
  }
  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += dist2(Z[i], centers[labels[i]]);
  return { labels, centers, inertia };
}

export function kmeans(Z: number[][], k: number, rnd: Rng, restarts = 4): KMeansFit {
  let best: KMeansFit | null = null;
  for (let r = 0; r < restarts; r++) {
    const fit = once(Z, k, rnd);
    if (!best || fit.inertia < best.inertia) best = fit;
  }
  return best as KMeansFit;
}

/** Silueta media (−1…1): cuánto más cerca está cada fila de su grupo que de los demás. */
export function silhouette(Z: number[][], labels: number[], k: number, sampleIdx: number[]): number {
  const S = sampleIdx;
  let total = 0, counted = 0;
  for (const i of S) {
    const sum = new Array<number>(k).fill(0);
    const cnt = new Array<number>(k).fill(0);
    for (const j of S) {
      if (j === i) continue;
      sum[labels[j]] += Math.sqrt(dist2(Z[i], Z[j]));
      cnt[labels[j]]++;
    }
    const own = labels[i];
    if (cnt[own] === 0) continue;
    const a = sum[own] / cnt[own];
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== own && cnt[c] > 0) b = Math.min(b, sum[c] / cnt[c]);
    if (!Number.isFinite(b)) continue;
    total += (b - a) / Math.max(a, b, 1e-12);
    counted++;
  }
  return counted ? total / counted : 0;
}

/** Estandariza columnas (las 0/1 se dejan como están). Devuelve también media y desviación. */
export function standardize(X: number[][], isDummy: boolean[]) {
  const p = X[0]?.length ?? 0;
  const mu = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(1);
  for (let j = 0; j < p; j++) {
    if (isDummy[j]) continue;
    const col = X.map((r) => r[j]);
    // Escala robusta (mediana y rango intercuartílico): un valor extremo no deforma el resto.
    const sorted = [...col].sort((a, b) => a - b);
    const iqr = (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 1.349;
    if (iqr > 0) {
      mu[j] = quantile(sorted, 0.5);
      sd[j] = iqr;
    } else {
      mu[j] = mean(col);
      sd[j] = std(col, mu[j]) || 1;
    }
  }
  return { Z: X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j])), mu, sd };
}

/** PCA a 2 ejes con iteración de potencias. Devuelve coordenadas y % de variación explicada. */
export function pca2(Z: number[][]): { coords: [number, number][]; explained: number } {
  const n = Z.length;
  const p = Z[0]?.length ?? 0;
  if (p === 0) return { coords: Z.map(() => [0, 0]), explained: 0 };
  const mu = Array.from({ length: p }, (_, j) => mean(Z.map((r) => r[j])));
  const C = Z.map((r) => r.map((v, j) => v - mu[j]));

  const cov: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const r of C) for (let a = 0; a < p; a++) for (let b = a; b < p; b++) cov[a][b] += r[a] * r[b];
  for (let a = 0; a < p; a++) for (let b = a; b < p; b++) { cov[a][b] /= Math.max(1, n - 1); cov[b][a] = cov[a][b]; }
  const trace = cov.reduce((s, row, i) => s + row[i], 0) || 1;

  const vectors: number[][] = [];
  const values: number[] = [];
  const M = cov.map((r) => r.slice());
  for (let comp = 0; comp < Math.min(2, p); comp++) {
    let v: number[] = Array.from({ length: p }, (_, i) => (i === comp ? 1 : 0.5));
    let lambda = 0;
    for (let it = 0; it < 100; it++) {
      const w = M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
      if (norm < 1e-12) break;
      v = w.map((x) => x / norm);
      lambda = norm;
    }
    vectors.push(v);
    values.push(lambda);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] -= lambda * v[a] * v[b];
  }
  const coords = C.map((r) => [
    vectors[0] ? r.reduce((s, x, j) => s + x * vectors[0][j], 0) : 0,
    vectors[1] ? r.reduce((s, x, j) => s + x * vectors[1][j], 0) : 0,
  ] as [number, number]);
  return { coords, explained: Math.min(1, (values[0] + (values[1] ?? 0)) / trace) };
}

