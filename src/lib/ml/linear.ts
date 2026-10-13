import { mean, solveLinear, std } from './util';

/** Regresión lineal múltiple (mínimos cuadrados con una pizca de regularización). */
export interface LinearModel {
  predict: (X: number[][]) => number[];
}

export function fitLinear(X: number[][], y: number[], isDummy: boolean[]): LinearModel {
  const p = X[0]?.length ?? 0;
  const mu = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(1);
  for (let j = 0; j < p; j++) {
    if (isDummy[j]) continue; // las 0/1 se dejan tal cual
    const col = X.map((r) => r[j]);
    mu[j] = mean(col);
    sd[j] = std(col, mu[j]) || 1;
  }
  const Z = (row: number[]) => [1, ...row.map((v, j) => (v - mu[j]) / sd[j])];

  const q = p + 1;
  const A: number[][] = Array.from({ length: q }, () => new Array<number>(q).fill(0));
  const b = new Array<number>(q).fill(0);
  for (let i = 0; i < X.length; i++) {
    const z = Z(X[i]);
    for (let r = 0; r < q; r++) {
      b[r] += z[r] * y[i];
      for (let c = r; c < q; c++) A[r][c] += z[r] * z[c];
    }
  }
  for (let r = 0; r < q; r++) {
    for (let c = 0; c < r; c++) A[r][c] = A[c][r];
    if (r > 0) A[r][r] += 1e-6 * X.length; // regularización mínima: evita sistemas singulares
  }
  const beta = solveLinear(A, b);
  return { predict: (rows) => rows.map((row) => Z(row).reduce((s, v, k) => s + v * beta[k], 0)) };
}
