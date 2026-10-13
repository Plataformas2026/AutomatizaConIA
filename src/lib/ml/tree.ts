import type { Rng } from './util';
import { shuffled } from './util';

/** Árbol de decisión (CART) para regresión y clasificación, y bosque de árboles. */

type Node =
  | { leaf: true; value: number; dist?: number[] }
  | { leaf: false; f: number; t: number; l: Node; r: Node };

export interface TreeOpts {
  task: 'reg' | 'cls';
  nClasses: number;
  maxDepth: number;
  minLeaf: number;
  /** Nº de columnas que se prueban en cada división (null = todas). */
  mtry: number | null;
  rnd: Rng;
}

export function fitTree(X: number[][], y: number[], idx: number[], o: TreeOpts): Node {
  const p = X[0]?.length ?? 0;
  const reg = o.task === 'reg';

  const leaf = (ids: number[]): Node => {
    if (reg) return { leaf: true, value: ids.reduce((s, i) => s + y[i], 0) / ids.length };
    const dist = new Array<number>(o.nClasses).fill(0);
    for (const i of ids) dist[y[i]] += 1;
    let best = 0;
    for (let c = 1; c < dist.length; c++) if (dist[c] > dist[best]) best = c;
    return { leaf: true, value: best, dist };
  };

  const build = (ids: number[], depth: number): Node => {
    if (depth >= o.maxDepth || ids.length < 2 * o.minLeaf) return leaf(ids);

    let pure = true;
    for (let k = 1; k < ids.length; k++) if (y[ids[k]] !== y[ids[0]]) { pure = false; break; }
    if (pure) return leaf(ids);

    const feats = o.mtry && o.mtry < p ? shuffled(Array.from({ length: p }, (_, j) => j), o.rnd).slice(0, o.mtry) : Array.from({ length: p }, (_, j) => j);

    let bestScore = Infinity;
    let bestF = -1;
    let bestT = 0;
    const n = ids.length;

    // Impureza del nodo, para exigir que la división mejore algo.
    let parent: number;
    if (reg) {
      const m = ids.reduce((s, i) => s + y[i], 0) / n;
      parent = ids.reduce((s, i) => s + (y[i] - m) ** 2, 0);
    } else {
      const tot = new Array<number>(o.nClasses).fill(0);
      for (const i of ids) tot[y[i]] += 1;
      parent = n * (1 - tot.reduce((s, c) => s + (c / n) ** 2, 0));
    }

    for (const f of feats) {
      const order = ids.slice().sort((a, b) => X[a][f] - X[b][f]);
      if (X[order[0]][f] === X[order[n - 1]][f]) continue;

      if (reg) {
        let sumL = 0, sqL = 0;
        let sumT = 0, sqT = 0;
        for (const i of order) { sumT += y[i]; sqT += y[i] * y[i]; }
        for (let k = 0; k < n - 1; k++) {
          const v = y[order[k]];
          sumL += v; sqL += v * v;
          if (X[order[k]][f] === X[order[k + 1]][f]) continue;
          const nl = k + 1, nr = n - nl;
          if (nl < o.minLeaf || nr < o.minLeaf) continue;
          const sumR = sumT - sumL, sqR = sqT - sqL;
          const score = sqL - (sumL * sumL) / nl + (sqR - (sumR * sumR) / nr);
          if (score < bestScore) { bestScore = score; bestF = f; bestT = (X[order[k]][f] + X[order[k + 1]][f]) / 2; }
        }
      } else {
        const left = new Array<number>(o.nClasses).fill(0);
        const right = new Array<number>(o.nClasses).fill(0);
        for (const i of order) right[y[i]] += 1;
        for (let k = 0; k < n - 1; k++) {
          const c = y[order[k]];
          left[c] += 1; right[c] -= 1;
          if (X[order[k]][f] === X[order[k + 1]][f]) continue;
          const nl = k + 1, nr = n - nl;
          if (nl < o.minLeaf || nr < o.minLeaf) continue;
          let gl = 0, gr = 0;
          for (let q = 0; q < o.nClasses; q++) { gl += (left[q] / nl) ** 2; gr += (right[q] / nr) ** 2; }
          const score = nl * (1 - gl) + nr * (1 - gr);
          if (score < bestScore) { bestScore = score; bestF = f; bestT = (X[order[k]][f] + X[order[k + 1]][f]) / 2; }
        }
      }
    }

    if (bestF < 0 || !(bestScore < parent - 1e-12)) return leaf(ids);

    const l: number[] = [];
    const r: number[] = [];
    for (const i of ids) (X[i][bestF] <= bestT ? l : r).push(i);
    if (!l.length || !r.length) return leaf(ids);
    return { leaf: false, f: bestF, t: bestT, l: build(l, depth + 1), r: build(r, depth + 1) };
  };

  return build(idx, 0);
}

function walk(node: Node, x: number[]): Extract<Node, { leaf: true }> {
  let cur = node;
  while (!cur.leaf) cur = x[cur.f] <= cur.t ? cur.l : cur.r;
  return cur;
}

export interface Predictor {
  predict: (X: number[][]) => number[];
}

export function treeModel(X: number[][], y: number[], o: TreeOpts): Predictor {
  const root = fitTree(X, y, X.map((_, i) => i), o);
  return { predict: (rows) => rows.map((x) => walk(root, x).value) };
}

/** Bosque: muchos árboles sobre muestras con reemplazo; en clasificación votan, en regresión se promedian. */
export function forestModel(X: number[][], y: number[], o: TreeOpts, nTrees = 30): Predictor {
  const p = X[0]?.length ?? 1;
  const mtry = Math.max(1, o.task === 'reg' ? Math.floor(p / 3) : Math.round(Math.sqrt(p)));
  const n = X.length;
  const trees: Node[] = [];
  for (let t = 0; t < nTrees; t++) {
    const boot = Array.from({ length: n }, () => Math.floor(o.rnd() * n));
    trees.push(fitTree(X, y, boot, { ...o, mtry }));
  }
  return {
    predict: (rows) =>
      rows.map((x) => {
        if (o.task === 'reg') return trees.reduce((s, tr) => s + walk(tr, x).value, 0) / trees.length;
        const votes = new Array<number>(o.nClasses).fill(0);
        for (const tr of trees) {
          const lf = walk(tr, x);
          const tot = lf.dist ? lf.dist.reduce((a, b) => a + b, 0) || 1 : 1;
          lf.dist?.forEach((c, q) => { votes[q] += c / tot; });
        }
        let best = 0;
        for (let q = 1; q < votes.length; q++) if (votes[q] > votes[best]) best = q;
        return best;
      }),
  };
}
