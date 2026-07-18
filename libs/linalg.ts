export type Matrix = number[][];
export type Vector = number[];

const hypot = (vec: number[]): number => {
    let max = 0;
    for (const v of vec) max = Math.max(max, Math.abs(v));
    if (max === 0) return 0;
    let sum = 0;
    for (const v of vec) sum += (v / max) ** 2;
    return max * Math.sqrt(sum);
};

const boxMuller = (): number => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const randomGaussianMatrix = (m: number, n: number): Matrix => {
    return Array.from({ length: m }, () => Array.from({ length: n }, boxMuller));
};

const assertSameDims = (A: Matrix, B: Matrix) => {
    if (A.length !== B.length || A[0].length !== B[0].length) {
        throw new Error(`Dim mismatch: ${A.length}x${A[0].length} vs ${B.length}x${B[0].length}`);
    }
};

// Compressed Sparse Row (CSR) Matrix
export class SparseMatrix {
    public rows: number;
    public cols: number;
    public data: Float32Array;
    public indices: Int32Array;
    public indptr: Int32Array;

    constructor(rows: number, cols: number, data: number[] | Float32Array, indices: number[] | Int32Array, indptr: number[] | Int32Array) {
        this.rows = rows;
        this.cols = cols;
        this.data = new Float32Array(data);
        this.indices = new Int32Array(indices);
        this.indptr = new Int32Array(indptr);
    }

    /** Creates a CSR Sparse Matrix from a dense 2D array */
    static fromDense(dense: Matrix): SparseMatrix {
        const rows = dense.length;
        const cols = dense[0].length;
        const data: number[] = [];
        const indices: number[] = [];
        const indptr: number[] = [0];

        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                if (Math.abs(dense[i][j]) > 1e-12) {
                    data.push(dense[i][j]);
                    indices.push(j);
                }
            }
            indptr.push(data.length);
        }

        return new SparseMatrix(rows, cols, data, indices, indptr);
    }

    /** Sparse Matrix-Vector Multiplication: y = A * x */
    multiplyVec(x: Float32Array | number[]): Float32Array {
        if (x.length !== this.cols) throw new Error("Dimension mismatch in SparseMatrix-Vector multiplication.");
        const y = new Float32Array(this.rows);
        for (let i = 0; i < this.rows; i++) {
            let sum = 0;
            const start = this.indptr[i];
            const end = this.indptr[i + 1];
            for (let j = start; j < end; j++) {
                sum += this.data[j] * x[this.indices[j]];
            }
            y[i] = sum;
        }
        return y;
    }

    /** Converts back to a dense 2D array (for debugging/small matrices) */
    toDense(): Matrix {
        const dense = Array.from({ length: this.rows }, () => new Array(this.cols).fill(0));
        for (let i = 0; i < this.rows; i++) {
            const start = this.indptr[i];
            const end = this.indptr[i + 1];
            for (let j = start; j < end; j++) {
                dense[i][this.indices[j]] = this.data[j];
            }
        }
        return dense;
    }
}

export const linalg = {
    SparseMatrix,

    identity(n: number): Matrix {
        return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    },

    clone(A: Matrix): Matrix {
        return A.map(row => [...row]);
    },

    add(A: Matrix, B: Matrix): Matrix {
        assertSameDims(A, B);
        return A.map((r, i) => r.map((v, j) => v + B[i][j]));
    },

    subtract(A: Matrix, B: Matrix): Matrix {
        assertSameDims(A, B);
        return A.map((r, i) => r.map((v, j) => v - B[i][j]));
    },

    scale(A: Matrix, s: number): Matrix {
        return A.map(r => r.map(v => v * s));
    },

    transpose(A: Matrix): Matrix {
        return A[0].map((_, c) => A.map(r => r[c]));
    },

    dotCols(A: Matrix, i: number, j: number): number {
        let sum = 0;
        for (let r = 0; r < A.length; r++) sum += A[r][i] * A[r][j];
        return sum;
    },

    multiply(A: Matrix, B: Matrix): Matrix {
        const m = A.length, n = A[0].length, p = B[0].length;
        if (n !== B.length) throw new Error(`Incompatible dims: ${m}x${n} * ${B.length}x${p}`);
        const C = Array.from({ length: m }, () => new Array(p).fill(0));
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < p; j++) {
                let sum = 0;
                for (let k = 0; k < n; k++) sum += A[i][k] * B[k][j];
                C[i][j] = sum;
            }
        }
        return C;
    },

    crossProduct3d(u: Vector, v: Vector): Vector {
        if (u.length !== 3 || v.length !== 3) throw new Error("Cross product requires 3D vectors.");
        return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    },

    /** QR Decomposition using stable LAPACK-style Householder Reflections. */
    qr(A_in: Matrix): { Q: Matrix; R: Matrix } {
        const m = A_in.length;
        const n = A_in[0].length;
        const R = linalg.clone(A_in);
        const Q: Matrix = Array.from({ length: m }, (_, i) =>
            Array.from({ length: m }, (_, j) => (i === j ? 1.0 : 0.0))
        );
        for (let k = 0; k < Math.min(m, n); k++) {
            const x: number[] = [];
            for (let i = k; i < m; i++) x.push(R[i][k]);
            const normX = hypot(x);
            if (normX < 1e-15) continue;
            const s = -Math.sign(x[0] || 1) * normX;
            const u1 = x[0] - s;
            const w = x.map(val => val / u1);
            w[0] = 1;
            const tau = -u1 / s;
            for (let j = k; j < n; j++) {
                let dot = 0;
                for (let i = 0; i < x.length; i++) dot += w[i] * R[k + i][j];
                const coeff = tau * dot;
                for (let i = 0; i < x.length; i++) R[k + i][j] -= coeff * w[i];
            }
            for (let i = 0; i < m; i++) {
                let dot = 0;
                for (let j = 0; j < x.length; j++) dot += Q[i][k + j] * w[j];
                const coeff = tau * dot;
                for (let j = 0; j < x.length; j++) Q[i][k + j] -= coeff * w[j];
            }
        }
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < i && j < n; j++) R[i][j] = 0;
        }
        return { Q, R };
    },

    solve(A: Matrix, b: Matrix | Vector): any {
        const { Q, R } = linalg.qr(A);
        const m = Q.length;
        const n = R[0].length;
        const B = (Array.isArray(b[0])) ? b as Matrix : (b as Vector).map(v => [v]);
        const colsB = B[0].length;
        const QT = linalg.transpose(Q);
        const y = linalg.multiply(QT, B);
        const x = Array.from({ length: n }, () => new Array(colsB).fill(0));
        for (let i = Math.min(n, m) - 1; i >= 0; i--) {
            const diag = R[i][i];
            if (Math.abs(diag) < 1e-12) {
                if (diag === 0) continue;
            }
            for (let col = 0; col < colsB; col++) {
                let sum = y[i][col];
                for (let j = i + 1; j < n; j++) {
                    sum -= R[i][j] * x[j][col];
                }
                x[i][col] = sum / diag;
            }
        }
        return (Array.isArray(b[0])) ? x : x.map(r => r[0]);
    },

    svd(A_in: Matrix, options: { k?: number } = {}): { U: Matrix; S: Vector; V: Matrix } {
        const k = options.k;
        const M_param = A_in.length;
        const N_param = A_in[0].length;

        if (M_param < N_param) {
            const res = linalg.svd(linalg.transpose(A_in), options);
            return { U: res.V, S: res.S, V: res.U };
        }

        const A = A_in.map(row => [...row]);
        const M = M_param, N = N_param;
        const V: Matrix = Array.from({ length: N }, (_, i) =>
            Array.from({ length: N }, (_, j) => (i === j ? 1.0 : 0.0))
        );
        const S_sq = new Array(N).fill(0);
        for (let i = 0; i < N; i++) S_sq[i] = linalg.dotCols(A, i, i);
        const max_iter = Math.max(M, 30);
        const eps = Number.EPSILON * 10;

        for (let iter = 0; iter < max_iter; iter++) {
            let changed = false;
            for (let i = 0; i < N - 1; i++) {
                for (let j = i + 1; j < N; j++) {
                    const a = S_sq[i];
                    const b = S_sq[j];
                    let p = linalg.dotCols(A, i, j);
                    if (Math.abs(p) <= eps * Math.sqrt(a * b)) continue;
                    changed = true;
                    p *= 2.0;
                    const beta = a - b;
                    const gamma = Math.hypot(p, beta);
                    let c, s;
                    if (beta < 0) {
                        const delta = (gamma - beta) * 0.5;
                        s = Math.sqrt(delta / gamma);
                        c = p / (gamma * s * 2.0);
                    } else {
                        c = Math.sqrt((gamma + beta) / (gamma * 2.0));
                        s = p / (gamma * c * 2.0);
                    }
                    for (let r = 0; r < M; r++) {
                        const t0 = c * A[r][i] + s * A[r][j];
                        const t1 = -s * A[r][i] + c * A[r][j];
                        A[r][i] = t0;
                        A[r][j] = t1;
                    }
                    S_sq[i] = linalg.dotCols(A, i, i);
                    S_sq[j] = linalg.dotCols(A, j, j);
                    for (let r = 0; r < N; r++) {
                        const t0v = c * V[r][i] + s * V[r][j];
                        const t1v = -s * V[r][i] + c * V[r][j];
                        V[r][i] = t0v;
                        V[r][j] = t1v;
                    }
                }
            }
            if (!changed) break;
        }

        const S = S_sq.map(x => Math.sqrt(x));
        const sortedIndices = S.map((val, idx) => [val, idx]).sort((a, b) => b[0] - a[0]).map(item => item[1]);
        const limit = (typeof k === 'number' && k > 0 && k < N) ? k : N;
        const activeIndices = sortedIndices.slice(0, limit);
        const S_sorted = activeIndices.map(idx => S[idx]);
        const V_sorted = V.map(row => activeIndices.map(idx => row[idx]));
        const U = Array.from({ length: M }, () => new Array(limit).fill(0));
        const minval = 1e-12;

        for (let i = 0; i < limit; i++) {
            const origIdx = activeIndices[i];
            const s_val = S[origIdx];
            if (s_val > minval) {
                for (let r = 0; r < M; r++) U[r][i] = A[r][origIdx] / s_val;
            } else {
                const rand_vec = Array.from({ length: M }, () => Math.random());
                for (let pass = 0; pass < 2; pass++) {
                    for (let j = 0; j < i; j++) {
                        let dot = 0;
                        for (let r = 0; r < M; r++) dot += rand_vec[r] * U[r][j];
                        for (let r = 0; r < M; r++) rand_vec[r] -= dot * U[r][j];
                    }
                }
                let norm = 0;
                for (let r = 0; r < M; r++) norm += rand_vec[r] ** 2;
                norm = Math.sqrt(norm);
                if (norm > minval) for (let r = 0; r < M; r++) U[r][i] = rand_vec[r] / norm;
            }
        }
        return { U, S: S_sorted, V: V_sorted };
    },

    randomizedSvd(A: Matrix, options: { k?: number; p?: number; q?: number } = {}): { U: Matrix; S: Vector; V: Matrix } {
        const k = options.k || Math.min(A.length, A[0].length);
        const p = options.p || 5;
        const q = (options.q !== undefined) ? options.q : 1;
        const m = A.length;
        const n = A[0].length;
        const l = Math.min(k + p, n);
        const Omega = randomGaussianMatrix(n, l);
        let Y = linalg.multiply(A, Omega);
        const AT = linalg.transpose(A);
        for (let i = 0; i < q; i++) {
            const Z = linalg.multiply(AT, Y);
            Y = linalg.multiply(A, Z);
        }

        const Q_full = linalg.qr(Y).Q;
        const Q = Q_full.map(row => row.slice(0, l));
        const QT = linalg.transpose(Q);
        const B = linalg.multiply(QT, A);
        const svdRes = linalg.svd(B);
        const U_hat = svdRes.U;
        const S = svdRes.S;
        const V = svdRes.V;
        const U = linalg.multiply(Q, U_hat);
        const U_k = U.map(row => row.slice(0, k));
        const S_k = S.slice(0, k);
        const V_k = V.map(row => row.slice(0, k));

        return { U: U_k, S: S_k, V: V_k };
    },

    /** Computes Eigenvalues and Eigenvectors for a Symmetric Matrix using Jacobi method */
    eigenSymmetric(A_in: Matrix, options: { maxIter?: number; tol?: number } = {}): { values: Vector; vectors: Matrix } {
        const n = A_in.length;
        const A = linalg.clone(A_in);
        const V = linalg.identity(n);
        const maxIter = options.maxIter || Math.max(1000, n * n * 5);
        const tol = options.tol || 1e-12;

        for (let iter = 0; iter < maxIter; iter++) {
            let maxVal = 0, p = 0, q = 0;
            for (let i = 0; i < n - 1; i++) {
                for (let j = i + 1; j < n; j++) {
                    const absVal = Math.abs(A[i][j]);
                    if (absVal > maxVal) {
                        maxVal = absVal;
                        p = i;
                        q = j;
                    }
                }
            }
            if (maxVal < tol) break;
            const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
            let t = 1;
            if (theta !== 0) {
                t = Math.sign(theta) / (Math.abs(theta) + Math.hypot(1, theta));
            }
            const c = 1 / Math.sqrt(1 + t * t);
            const s = c * t;

            for (let i = 0; i < n; i++) {
                if (i !== p && i !== q) {
                    const a_ip = A[i][p];
                    const a_iq = A[i][q];
                    A[i][p] = A[p][i] = c * a_ip - s * a_iq;
                    A[i][q] = A[q][i] = s * a_ip + c * a_iq;
                }
            }
            const a_pp = A[p][p];
            const a_qq = A[q][q];
            const a_pq = A[p][q];
            A[p][p] = c * c * a_pp - 2 * s * c * a_pq + s * s * a_qq;
            A[q][q] = s * s * a_pp + 2 * s * c * a_pq + c * c * a_qq;
            A[p][q] = A[q][p] = 0;

            for (let i = 0; i < n; i++) {
                const v_ip = V[i][p];
                const v_iq = V[i][q];
                V[i][p] = c * v_ip - s * v_iq;
                V[i][q] = s * v_ip + c * v_iq;
            }
        }
        
        const values = A.map((r, i) => r[i]);
        const indices = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
        const sortedValues = indices.map(x => x.v);
        const sortedVectors = Array.from({ length: n }, (_, i) => indices.map(x => V[i][x.i]));

        return { values: sortedValues, vectors: sortedVectors };
    },

    /** Computes covariance matrix and mean vector for an array of points (rows) */
    covariance(points: Matrix): { cov: Matrix; mean: Vector } {
        const numPoints = points.length;
        if (numPoints === 0) throw new Error("Cannot compute covariance of empty points array.");
        const dim = points[0].length;
        const mean = new Array(dim).fill(0);
        for (let i = 0; i < numPoints; i++) {
            for (let d = 0; d < dim; d++) mean[d] += points[i][d];
        }
        for (let d = 0; d < dim; d++) mean[d] /= numPoints;
        const cov = Array.from({ length: dim }, () => new Array(dim).fill(0));
        for (let i = 0; i < numPoints; i++) {
            for (let j = 0; j < dim; j++) {
                for (let k = 0; k < dim; k++) {
                    cov[j][k] += (points[i][j] - mean[j]) * (points[i][k] - mean[k]);
                }
            }
        }
        const factor = numPoints > 1 ? numPoints - 1 : 1;
        for (let j = 0; j < dim; j++) {
            for (let k = 0; k < dim; k++) cov[j][k] /= factor;
        }
        return { cov, mean };
    },

    pinv(A: Matrix): Matrix {
        const { U, S, V } = linalg.svd(A);
        const m = U.length, n = V.length;
        const maxS = S[0];
        const tol = Math.max(A.length, A[0].length) * maxS * 1e-15;
        const S_inv = new Array(S.length).fill(0);
        for (let i = 0; i < S.length; i++) {
            if (S[i] > tol) S_inv[i] = 1.0 / S[i];
        }
        const res = Array.from({ length: n }, () => new Array(m).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < m; j++) {
                let sum = 0;
                for (let k = 0; k < S.length; k++) sum += V[i][k] * S_inv[k] * U[j][k];
                res[i][j] = sum;
            }
        }
        return res;
    },

    inverse(A: Matrix): Matrix | null {
        if (A.length === 3 && A[0].length === 3) {
            const m = A;
            const det = m[0][0] * (m[1][1] * m[2][2] - m[2][1] * m[1][2]) -
                        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
            if (Math.abs(det) < 1e-12) return null;
            const invDet = 1 / det;
            return [
                [(m[1][1] * m[2][2] - m[2][1] * m[1][2]) * invDet, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet],
                [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet, (m[1][0] * m[0][2] - m[0][0] * m[1][2]) * invDet],
                [(m[1][0] * m[2][1] - m[2][0] * m[1][1]) * invDet, (m[2][0] * m[0][1] - m[0][0] * m[2][1]) * invDet, (m[0][0] * m[1][1] - m[1][0] * m[0][1]) * invDet]
            ];
        }
        const n = A.length;
        if (n !== A[0].length) throw new Error("Inverse requires square matrix");
        const I = linalg.identity(n);
        return linalg.solve(A, I) as Matrix;
    },

    det(A: Matrix): number {
        const { R } = linalg.qr(A);
        let d = 1;
        for (let i = 0; i < R.length; i++) d *= R[i][i];
        return d;
    },

    /** LU Decomposition of a square matrix with partial pivoting: P * A = L * U */
    lu(A: Matrix): { L: Matrix; U: Matrix; P: number[] } {
        const n = A.length;
        if (n !== A[0].length) throw new Error("LU decomposition requires a square matrix");
        const L: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0)));
        const U = linalg.clone(A);
        const P = Array.from({ length: n }, (_, i) => i);
        for (let k = 0; k < n; k++) {
            let pivot = k;
            let maxVal = Math.abs(U[k][k]);
            for (let i = k + 1; i < n; i++) {
                if (Math.abs(U[i][k]) > maxVal) {
                    maxVal = Math.abs(U[i][k]);
                    pivot = i;
                }
            }
            if (pivot !== k) {
                const tempU = U[k];
                U[k] = U[pivot];
                U[pivot] = tempU;
                for (let j = 0; j < k; j++) {
                    const tempL = L[k][j];
                    L[k][j] = L[pivot][j];
                    L[pivot][j] = tempL;
                }
                const tempP = P[k];
                P[k] = P[pivot];
                P[pivot] = tempP;
            }
            for (let i = k + 1; i < n; i++) {
                if (Math.abs(U[k][k]) < 1e-15) continue;
                const factor = U[i][k] / U[k][k];
                L[i][k] = factor;
                U[i][k] = 0;
                for (let j = k + 1; j < n; j++) {
                    U[i][j] -= factor * U[k][j];
                }
            }
        }
        return { L, U, P };
    },

    /** Solves A * x = b for a square system using LU decomposition with partial pivoting */
    solveLU(A: Matrix, b: Vector): Vector {
        const { L, U, P } = linalg.lu(A);
        const n = A.length;
        const y = new Array(n);
        for (let i = 0; i < n; i++) y[i] = b[P[i]];
        const z = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            let sum = y[i];
            for (let j = 0; j < i; j++) sum -= L[i][j] * z[j];
            z[i] = sum;
        }
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let sum = z[i];
            for (let j = i + 1; j < n; j++) sum -= U[i][j] * x[j];
            const diag = U[i][i];
            if (Math.abs(diag) < 1e-15) {
                x[i] = 0;
            } else {
                x[i] = sum / diag;
            }
        }
        return x;
    },

    /** Cholesky Decomposition for Symmetric Positive Definite matrices (A = L * L^T) */
    cholesky(A: Matrix): Matrix {
        const n = A.length;
        const L = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                let sum = 0;
                for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
                if (i === j) {
                    const val = A[i][i] - sum;
                    if (val <= 0) throw new Error("Matrix is not Symmetric Positive Definite");
                    L[i][j] = Math.sqrt(val);
                } else {
                    L[i][j] = (A[i][j] - sum) / L[j][j];
                }
            }
        }
        return L;
    },

    /** Solves A * x = b using an existing Cholesky decomposition L */
    solveCholesky(L: Matrix, b: Vector): Vector {
        const n = L.length;
        const y = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            let sum = b[i];
            for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
            y[i] = sum / L[i][i];
        }
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let sum = y[i];
            for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
            x[i] = sum / L[i][i];
        }
        return x;
    },

    /** LDLT decomposition with pivoting: P^T * A * P = L * D * L^T */
    ldlt(A_in: Matrix): { L: Matrix; D: Vector; P: number[] } {
        const n = A_in.length;
        const A = A_in.map(row => [...row]);
        const P = Array.from({ length: n }, (_, i) => i);
        const L: Matrix = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0))
        );
        const D = new Array(n).fill(0);
        for (let k = 0; k < n; k++) {
            let pivot = k;
            let maxVal = Math.abs(A[k][k]);
            for (let i = k + 1; i < n; i++) {
                if (Math.abs(A[i][i]) > maxVal) {
                    maxVal = Math.abs(A[i][i]);
                    pivot = i;
                }
            }
            if (pivot !== k) {
                const tempRow = A[k];
                A[k] = A[pivot];
                A[pivot] = tempRow;
                for (let r = 0; r < n; r++) {
                    const temp = A[r][k];
                    A[r][k] = A[r][pivot];
                    A[r][pivot] = temp;
                }
                const tempP = P[k];
                P[k] = P[pivot];
                P[pivot] = tempP;
                for (let j = 0; j < k; j++) {
                    const tempL = L[k][j];
                    L[k][j] = L[pivot][j];
                    L[pivot][j] = tempL;
                }
            }
            let sumD = 0;
            for (let j = 0; j < k; j++) sumD += L[k][j] ** 2 * D[j];
            D[k] = A[k][k] - sumD;
            if (Math.abs(D[k]) < 1e-15) {
                D[k] = 0;
                continue;
            }
            for (let i = k + 1; i < n; i++) {
                let sumL = 0;
                for (let j = 0; j < k; j++) sumL += L[i][j] * L[k][j] * D[j];
                L[i][k] = (A[i][k] - sumL) / D[k];
            }
        }
        return { L, D, P };
    },

    /** Solves A * x = b using LDLT decomposition with pivoting */
    solveLDLT(A: Matrix, b: Vector): Vector {
        const { L, D, P } = linalg.ldlt(A);
        const n = L.length;
        const b_perm = new Array(n);
        for (let i = 0; i < n; i++) b_perm[i] = b[P[i]];
        const y = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            let sum = b_perm[i];
            for (let j = 0; j < i; j++) sum -= L[i][j] * y[j];
            y[i] = sum;
        }
        const z = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            if (Math.abs(D[i]) < 1e-15) {
                z[i] = 0;
            } else {
                z[i] = y[i] / D[i];
            }
        }
        const x_perm = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let sum = z[i];
            for (let j = i + 1; j < n; j++) sum -= L[j][i] * x_perm[j];
            x_perm[i] = sum;
        }
        const x = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            x[P[i]] = x_perm[i];
        }
        return x;
    },

    /** Computes matrix norm (Frobenius 'fro' or Infinity 'inf') */
    norm(A: Matrix, type: 'fro' | 'inf' = 'fro'): number {
        if (type === 'fro') {
            let sum = 0;
            for (let i = 0; i < A.length; i++) {
                for (let j = 0; j < A[i].length; j++) sum += A[i][j] ** 2;
            }
            return Math.sqrt(sum);
        } else {
            let maxRowSum = 0;
            for (let i = 0; i < A.length; i++) {
                let rowSum = 0;
                for (let j = 0; j < A[i].length; j++) rowSum += Math.abs(A[i][j]);
                maxRowSum = Math.max(maxRowSum, rowSum);
            }
            return maxRowSum;
        }
    },

    // --- Sparse / Implicit Solvers (Krylov Subspace Methods) ---

    solveCG(
        applyA: (x: Float32Array) => Float32Array,
        b: Float32Array,
        initialGuess?: Float32Array,
        options: { maxIterations?: number; tolerance?: number; applyM?: (x: Float32Array) => Float32Array } = {}
    ): Float32Array {
        const N = b.length;
        const maxIter = options.maxIterations || N;
        const tol = options.tolerance || 1e-6;
        const applyM = options.applyM || ((x) => x);
        const x = initialGuess ? new Float32Array(initialGuess) : new Float32Array(N);
        const r = new Float32Array(N);
        const p = new Float32Array(N);
        const dot = (v1: Float32Array, v2: Float32Array) => {
            let sum = 0;
            for (let i = 0; i < N; i++) sum += v1[i] * v2[i];
            return sum;
        };

        const Ax = applyA(x);
        for (let i = 0; i < N; i++) r[i] = b[i] - Ax[i];
        let z = applyM(r);
        for (let i = 0; i < N; i++) p[i] = z[i];
        let rsOld = dot(r, z);
        const normB = Math.sqrt(dot(b, b));
        const toleranceSq = tol * tol * (normB > 1e-5 ? normB * normB : N);
        if (dot(r, r) < toleranceSq) return x;

        for (let i = 0; i < maxIter; i++) {
            const Ap = applyA(p);
            const alphaDenom = dot(p, Ap);
            if (Math.abs(alphaDenom) < 1e-25) break;
            const alpha = rsOld / alphaDenom;
            for (let j = 0; j < N; j++) {
                x[j] += alpha * p[j];
                r[j] -= alpha * Ap[j];
            }
            if (dot(r, r) < toleranceSq) break;
            z = applyM(r);
            const rsNew = dot(r, z);
            const beta = rsNew / rsOld;
            for (let j = 0; j < N; j++) {
                p[j] = z[j] + beta * p[j];
            }
            rsOld = rsNew;
        }

        return x;
    },

    solveBiCGStab(
        applyA: (x: Float32Array) => Float32Array,
        b: Float32Array,
        initialGuess?: Float32Array,
        options: { maxIterations?: number; tolerance?: number; applyM?: (x: Float32Array) => Float32Array } = {}
    ): Float32Array {
        const N = b.length;
        const maxIter = options.maxIterations || N * 2;
        const tol = options.tolerance || 1e-6;
        const applyM = options.applyM || ((x) => x);
        const x = initialGuess ? new Float32Array(initialGuess) : new Float32Array(N);
        const dot = (v1: Float32Array, v2: Float32Array) => {
            let sum = 0;
            for (let i = 0; i < N; i++) sum += v1[i] * v2[i];
            return sum;
        };

        const r = new Float32Array(N);
        const Ax = applyA(x);
        for (let i = 0; i < N; i++) r[i] = b[i] - Ax[i];
        const r_hat = new Float32Array(r);
        const p = new Float32Array(N);
        let v = new Float32Array(N);
        let rho_prev = 1.0;
        let alpha = 1.0;
        let omega = 1.0;
        const normB = Math.sqrt(dot(b, b));
        const toleranceSq = tol * tol * (normB > 1e-5 ? normB * normB : N);
        if (dot(r, r) < toleranceSq) return x;

        for (let iter = 0; iter < maxIter; iter++) {
            const rho = dot(r_hat, r);
            if (Math.abs(rho) < 1e-25) break;
            if (iter === 0) {
                for (let i = 0; i < N; i++) p[i] = r[i];
            } else {
                const beta = (rho / rho_prev) * (alpha / omega);
                for (let i = 0; i < N; i++) {
                    p[i] = r[i] + beta * (p[i] - omega * v[i]);
                }
            }
            const p_hat = applyM(p);
            v = applyA(p_hat);
            const r_hat_dot_v = dot(r_hat, v);
            if (Math.abs(r_hat_dot_v) < 1e-25) break;
            alpha = rho / r_hat_dot_v;
            const s = new Float32Array(N);
            for (let i = 0; i < N; i++) s[i] = r[i] - alpha * v[i];
            if (dot(s, s) < toleranceSq) {
                for (let i = 0; i < N; i++) x[i] += alpha * p_hat[i];
                break;
            }

            const s_hat = applyM(s);
            const t = applyA(s_hat);
            const t_dot_t = dot(t, t);
            if (t_dot_t < 1e-25) {
                for (let i = 0; i < N; i++) x[i] += alpha * p_hat[i];
                break;
            }

            omega = dot(t, s) / t_dot_t;
            let r_norm_sq = 0;
            for (let i = 0; i < N; i++) {
                x[i] += alpha * p_hat[i] + omega * s_hat[i];
                r[i] = s[i] - omega * t[i];
                r_norm_sq += r[i] * r[i];
            }

            if (r_norm_sq < toleranceSq) break;
            rho_prev = rho;
        }

        return x;
    },

    /**
     * Solves Ax = b using a Sparse Matrix and direct Gaussian Elimination with partial pivoting (LU).
     */
    spsolve(A: SparseMatrix, b: Float32Array | number[], options: { maxIterations?: number; tolerance?: number } = {}): Float32Array {
        const bArray = b instanceof Float32Array ? b : new Float32Array(b);
        const n = A.rows;
        if (bArray.length !== n) {
            throw new Error(`Dimension mismatch: A is ${n}x${A.cols}, b has length ${bArray.length}`);
        }

        // Represent each row as a Map<number, number> for sparse elimination
        const activeRows: Map<number, number>[] = [];
        for (let i = 0; i < n; i++) {
            const rowMap = new Map<number, number>();
            const start = A.indptr[i];
            const end = A.indptr[i + 1];
            for (let j = start; j < end; j++) {
                rowMap.set(A.indices[j], A.data[j]);
            }
            activeRows.push(rowMap);
        }

        const x = new Float32Array(bArray);
        for (let k = 0; k < n; k++) {
            let pivotRow = k;
            let maxVal = Math.abs(activeRows[k].get(k) || 0);
            for (let i = k + 1; i < n; i++) {
                const val = Math.abs(activeRows[i].get(k) || 0);
                if (val > maxVal) {
                    maxVal = val;
                    pivotRow = i;
                }
            }
            if (maxVal < 1e-15) {
                continue;
            }
            if (pivotRow !== k) {
                const tempRow = activeRows[k];
                activeRows[k] = activeRows[pivotRow];
                activeRows[pivotRow] = tempRow;
                const tempB = x[k];
                x[k] = x[pivotRow];
                x[pivotRow] = tempB;
            }
            const pivotVal = activeRows[k].get(k)!;
            for (let i = k + 1; i < n; i++) {
                const rowI = activeRows[i];
                const aik = rowI.get(k);
                if (aik === undefined || aik === 0) {
                    continue;
                }
                const factor = aik / pivotVal;
                rowI.delete(k);
                const rowK = activeRows[k];
                for (const [col, val] of rowK.entries()) {
                    if (col === k) continue;
                    const currentVal = rowI.get(col) || 0;
                    const newVal = currentVal - factor * val;
                    if (Math.abs(newVal) < 1e-15) {
                        rowI.delete(col);
                    } else {
                        rowI.set(col, newVal);
                    }
                }
                x[i] -= factor * x[k];
            }
        }

        const sol = new Float32Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let sum = x[i];
            const rowI = activeRows[i];
            const diagVal = rowI.get(i) || 0;
            for (const [col, val] of rowI.entries()) {
                if (col > i) {
                    sum -= val * sol[col];
                }
            }
            if (Math.abs(diagVal) < 1e-15) {
                sol[i] = 0;
            } else {
                sol[i] = sum / diagVal;
            }
        }

        return sol;
    },

    solveHomography(
        src: { x: number; y: number }[],
        dst: { x: number; y: number }[],
        options: { method?: 'fast' | 'robust' } = {}
    ): Matrix {
        let method = options.method || (src.length === 4 ? 'fast' : 'robust');
        if (method === 'fast') {
            if (src.length !== 4 || dst.length !== 4) {
                throw new Error("Fast homography requires exactly 4 points.");
            }
            const A: Matrix = [];
            const B: Vector = [];
            for (let i = 0; i < 4; i++) {
                const { x, y } = src[i];
                const { x: u, y: v } = dst[i];
                A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
                B.push(u);
                A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
                B.push(v);
            }
            try {
                const h = linalg.solveLU(A, B);
                for (let i = 0; i < 8; i++) {
                    if (isNaN(h[i]) || !isFinite(h[i])) {
                        throw new Error("Invalid results in fast homography.");
                    }
                }
                return [
                    [h[0], h[1], h[2]],
                    [h[3], h[4], h[5]],
                    [h[6], h[7], 1.0]
                ];
            } catch (err) {
                method = 'robust';
            }
        }
        const A: Matrix = [];
        for (let i = 0; i < src.length; i++) {
            const { x, y } = src[i];
            const { x: u, y: v } = dst[i];
            A.push([-x, -y, -1, 0, 0, 0, x * u, y * u, u]);
            A.push([0, 0, 0, -x, -y, -1, x * v, y * v, v]);
        }
        if (src.length === 4) {
            A.push([0, 0, 0, 0, 0, 0, 0, 0, 0]);
        }
        const { V } = linalg.svd(A);
        const lastCol = V[0].length - 1;
        const H_flat = V.map(row => row[lastCol]);
        const scale = H_flat[8] !== 0 ? 1.0 / H_flat[8] : 1.0;
        return [
            [H_flat[0] * scale, H_flat[1] * scale, H_flat[2] * scale],
            [H_flat[3] * scale, H_flat[4] * scale, H_flat[5] * scale],
            [H_flat[6] * scale, H_flat[7] * scale, H_flat[8] * scale]
        ];
    },

    /** Computes Principal Component Analysis (PCA) for a set of data points (rows) */
    pca(points: Matrix, k: number): { components: Matrix; explainedVariance: Vector; mean: Vector } {
        const { cov, mean } = linalg.covariance(points);
        const { values, vectors } = linalg.eigenSymmetric(cov);
        const limit = Math.min(k, values.length);
        const explainedVariance = values.slice(0, limit);
        const components: Matrix = Array.from({ length: limit }, (_, colIdx) =>
            vectors.map(row => row[colIdx])
        );
        return { components, explainedVariance, mean };
    }
};
