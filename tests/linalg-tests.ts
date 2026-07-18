import { Lib } from '~/libs/index';

// Flatten a 2D matrix to 1D array
const flatten = (M: number[][]) => M.reduce((acc, row) => acc.concat(row), []);

// Compare two arrays (or flattened matrices) with tolerance and explicit NaN safety
function isClose(actual: number[] | Float32Array, expected: number[] | Float32Array, tolerance = 1e-4) {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) {
        if (isNaN(actual[i]) || isNaN(expected[i])) return false;
        if (Math.abs(actual[i] - expected[i]) > tolerance) return false;
    }
    return true;
}

// Calculate Mean Squared Error between two matrices
function calcMatrixMSE(A: number[][], B: number[][]) {
    const flatA = flatten(A);
    const flatB = flatten(B);
    let sumSq = 0;
    for (let i = 0; i < flatA.length; i++) {
        sumSq += (flatA[i] - flatB[i]) ** 2;
    }
    return sumSq / flatA.length;
}

// Check if two vectors match (accounting for potential sign flip)
function vectorsMatch(vecActual: number[], vecExpected: number[], tolerance = 1e-4) {
    if (vecActual.length !== vecExpected.length) return false;
    const posMatch = vecActual.every((val, i) => Math.abs(val - vecExpected[i]) < tolerance);
    if (posMatch) return true;
    const negMatch = vecActual.every((val, i) => Math.abs(val + vecExpected[i]) < tolerance);
    return negMatch;
}

// Extract a column from a matrix
function getCol(matrix: number[][], colIndex: number) {
    return matrix.map(row => row[colIndex]);
}

export function runLinalgTests(runner: { test: (name: string, fn: () => any) => void }) {
    const { 
        add, subtract, scale, transpose, identity, clone, 
        multiply, inverse, svd, randomizedSvd, solveCG, 
        solveBiCGStab, spsolve, solveHomography, solve, pinv, det,
        lu, solveLU, norm, cholesky, solveCholesky, ldlt, solveLDLT,
        eigenSymmetric, covariance, crossProduct3d, pca
    } = Lib.linalg;

    // Map localized test calls to global runner
    const test = (name: string, fn: () => { pass: boolean; details: any }) => runner.test(name, fn);

    console.log("%cLinear Algebra tests", "font-size: 14px; font-weight: bold; padding: 5px 0;");

    // ==========================================
    // Basic Arithmetic & Helpers
    // ==========================================
    console.group("Arithmetic & Helpers");

    test("Arithmetic: Identity & Clone", () => {
        const I = identity(3);
        const C = clone(I);
        const pass = I.length === 3 && C !== I && isClose(flatten(I), flatten(C));
        return { pass, details: { identity: I, cloned: C } };
    });

    test("Arithmetic: Addition, Subtraction & Scaling", () => {
        const A = [[1, 2], [3, 4]];
        const B = [[5, 6], [7, 8]];
        const sum = add(A, B);
        const diff = subtract(B, A);
        const scaled = scale(A, 2.5);
        const sumOk = isClose(flatten(sum), [6, 8, 10, 12]);
        const diffOk = isClose(flatten(diff), [4, 4, 4, 4]);
        const scaledOk = isClose(flatten(scaled), [2.5, 5, 7.5, 10]);
        return { pass: sumOk && diffOk && scaledOk, details: { sum, diff, scaled } };
    });

    test("Arithmetic: Transpose", () => {
        const rect = [[1, 2, 3], [4, 5, 6]];
        const transposed = transpose(rect);
        const expected = [[1, 4], [2, 5], [3, 6]];
        return { pass: isClose(flatten(transposed), flatten(expected)), details: { rect, transposed } };
    });

    test("Arithmetic: Cross Product", () => {
        const u = [1, 0, 0];
        const v = [0, 1, 0];
        const res = crossProduct3d(u, v);
        const pass = isClose(res, [0, 0, 1]);
        return { pass, details: { u, v, res } };
    });
    console.groupEnd();

    // ==========================================
    // Solvers, Inverses & Determinants
    // ==========================================
    console.group("Solvers, Inverses & Determinants");
    test("Inverse 3x3: Identity Matrix", () => {
        const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const res = inverse(I);
        const flatRes = flatten(res!);
        const flatExp = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        return { pass: isClose(flatRes, flatExp), details: { actual: res, expected: I } };
    });

    test("Inverse 3x3: Known Solvable Matrix", () => {
        const A = [[1, 2, 3], [0, 1, 4], [5, 6, 0]];
        const expected = [
            [-24, 18, 5],
            [20, -15, -4],
            [-5, 4, 1]
        ];
        const res = inverse(A);
        return { pass: res !== null && isClose(flatten(res), flatten(expected)), details: { actual: res, expected } };
    });

    test("Inverse 3x3: Singular Matrix (Det=0)", () => {
        const A = [[1, 2, 3], [2, 4, 6], [0, 0, 1]];
        const res = inverse(A);
        return { pass: res === null, details: { actual: res, expected: null } };
    });

    test("Determinant & Generic Inverse: Solvable 4x4 Matrix", () => {
        const A = [
            [2, 3, 1, 5],
            [1, 0, 3, 2],
            [3, 5, 2, 1],
            [0, 2, 4, 3]
        ];
        const detVal = det(A);
        const detOk = Math.abs(detVal - (-156)) < 1e-4;
        const invA = inverse(A);
        const expectedInv = [
            [0.04487,  0.46794,  0.14743, -0.43589],
            [-0.00641, -0.35256,  0.12179,  0.20512],
            [-0.16025,  0.18589,  0.04487,  0.12820],
            [0.21794, -0.01282, -0.14102,  0.02564]
        ];
        const invOk = invA !== null && isClose(flatten(invA), flatten(expectedInv), 1e-4);
        return { pass: detOk && invOk, details: { detVal, invA } };
    });

    test("Least-Squares Solver: Overdetermined System (4x2)", () => {
        const A = [
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5]
        ];
        const b = [1, 3, 5, 6];
        const x = solve(A, b);
        const expected = [2.2, -0.5];
        return { pass: isClose(x, expected, 1e-4), details: { solved: x, expected } };
    });

    test("LU Decomposition, Solver & Matrix Norms", () => {
        const A = [
            [2, 1, -1],
            [-3, -1, 2],
            [-2, 1, 2]
        ];
        const b = [8, -11, -3];
        // LU Decomposition Check (P * A = L * U)
        const { L, U, P } = lu(A);
        const PA = Array.from({ length: 3 }, (_, i) => [...A[P[i]]]);
        const LU = multiply(L, U);
        const decompositionOk = isClose(flatten(PA), flatten(LU), 1e-6);
        const x = solveLU(A, b);
        const expected = [2, 3, -1];
        const solveOk = isClose(x, expected, 1e-4);
        const fNorm = norm(A, 'fro');
        const expectedFro = Math.sqrt(4 + 1 + 1 + 9 + 1 + 4 + 4 + 1 + 4); // sqrt(28)
        const normOk = Math.abs(fNorm - expectedFro) < 1e-5;
        return { pass: decompositionOk && solveOk && normOk, details: { L, U, P, x, fNorm } };
    });

    test("Cholesky Decomposition & Solver (SPD Matrix)", () => {
        // Symmetric Positive Definite matrix
        const A = [
            [4, 12, -16],
            [12, 37, -43],
            [-16, -43, 98]
        ];
        const b = [1, 2, 3];
        const L = cholesky(A);
        // Check L * L^T == A
        const Lt = transpose(L);
        const LLt = multiply(L, Lt);
        const decompOk = isClose(flatten(A), flatten(LLt), 1e-5);
        const x = solveCholesky(L, b);
        const xExpected = solve(A, b);
        const solveOk = isClose(x, xExpected, 1e-5);
        return { pass: decompOk && solveOk, details: { L, x, xExpected } };
    });

    test("LDLT Decomposition & Solver (Symmetric Matrix)", () => {
        const A = [
            [4, 12, -16],
            [12, 37, -43],
            [-16, -43, 98]
        ];
        const b = [1, 2, 3];
        const { L, D, P } = ldlt(A);
        // Reconstruct P^T * A * P as L * D * L^T
        const n = A.length;
        const PAP = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => A[P[i]][P[j]])
        );
        const D_mat = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => (i === j ? D[i] : 0.0))
        );
        const LD = multiply(L, D_mat);
        const LD_Lt = multiply(LD, transpose(L));
        const decompOk = isClose(flatten(PAP), flatten(LD_Lt), 1e-5);
        const x = solveLDLT(A, b);
        const xExpected = solve(A, b);
        const solveOk = isClose(x, xExpected, 1e-5);
        return { pass: decompOk && solveOk, details: { L, D, P, x, xExpected } };
    });
    console.groupEnd();

    // ==========================================
    // Moore-Penrose Pseudo-Inverse (pinv)
    // ==========================================
    console.group("Moore-Penrose Pseudo-Inverse");
    test("Pseudo-Inverse: Rectangular Matrix (3x2)", () => {
        const A = [
            [1, 2],
            [3, 4],
            [5, 6]
        ];
        const A_pinv = pinv(A);
        const expected = [
            [-1.3333, -0.3333,  0.6666],
            [ 1.0833,  0.3333, -0.4166]
        ];
        return { pass: isClose(flatten(A_pinv), flatten(expected), 1e-3), details: { actual: A_pinv, expected } };
    });

    test("Pseudo-Inverse: Singular Matrix (3x3, Det=0)", () => {
        const A = [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9]
        ];
        const A_pinv = pinv(A);
        const expected = [
            [-0.6388, -0.1666,  0.3055],
            [-0.0555,  0.0,     0.0555],
            [ 0.5277,  0.1666, -0.1944]
        ];
        return { pass: isClose(flatten(A_pinv), flatten(expected), 1e-3), details: { actual: A_pinv, expected } };
    });
    console.groupEnd();

    // ==========================================
    // SVD (Singular Value Decomposition)
    // ==========================================
    console.group("Singular Value Decomposition");
    test("SVD: Exact Values Comparison (Ground Truth)", () => {
        const A = [
            [1, 2, 3, 5],
            [2, 4, 8, 12],
            [0, 0, 0, 0.00001],
            [0, 0, 0, 0]
        ];
        const S_expected = [16.3337105, 0.458151551, 5.97614305e-06, 0.0];
        const U_expected = [
            [0.381457795, -0.924386256, -2.14285714e-06, 0.0],
            [0.924386256, 0.381457795, 3.57142857e-07, 0.0],
            [4.87271611e-07, -2.11706262e-06, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ];
        const V_expected = [
            [0.13654156, -0.35243942, -0.23904572, -0.89442719],
            [0.27308312, -0.70487884, -0.47809144, 0.4472136],
            [0.52281222, 0.60788529, -0.5976143, 0.0],
            [0.79589534, -0.09699355, 0.5976143, 0.0]
        ];
        const { U, S, V } = svd(A);
        const sPass = isClose(S, S_expected, 1e-4);
        let uPass = true;
        for (let i = 0; i < 4; i++) {
            if (!vectorsMatch(getCol(U, i), getCol(U_expected, i), 1e-3)) uPass = false;
        }
        let vPass = true;
        for (let i = 0; i < 4; i++) {
            if (!vectorsMatch(getCol(V, i), getCol(V_expected, i), 1e-3)) vPass = false;
        }
        return { pass: sPass && uPass && vPass, details: { S_ok: sPass, U_ok: uPass, V_ok: vPass } };
    });

    test("SVD: Reconstruction Accuracy", () => {
        const A = [
            [1, 2, 3, 5],
            [2, 4, 8, 12],
            [0, 0, 0, 0.00001],
            [0, 0, 0, 0]
        ];
        const { U, S, V } = svd(A);
        const k = S.length;
        const S_mat = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? S[i] : 0)));
        const US = multiply(U, S_mat);
        const Vt = transpose(V);
        const A_rec = multiply(US, Vt);
        const mse = calcMatrixMSE(A, A_rec);
        return { pass: mse < 1e-10, details: { mse } };
    });

    test("SVD: Reconstruction (M < N case)", () => {
        const A = [
            [1, 2, 3, 5],
            [2, 4, 8, 12]
        ];
        const { U, S, V } = svd(A);
        const k = S.length;
        const S_mat = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? S[i] : 0)));
        const US = multiply(U, S_mat);
        const Vt = transpose(V);
        const A_rec = multiply(US, Vt);
        const mse = calcMatrixMSE(A, A_rec);
        return { pass: mse < 1e-10, details: { mse } };
    });

    test("SVD: Partial Calculation (Top k=2)", () => {
        const A = [
            [1, 2, 3, 5],
            [2, 4, 8, 12],
            [0.1, 0.2, 0.1, 0],
            [0, 0, 0, 0]
        ];
        const fullRes = svd(A);
        const k = 2;
        const partialRes = svd(A, { k });
        const uDimOk = partialRes.U.length === 4 && partialRes.U[0].length === 2;
        const vDimOk = partialRes.V.length === 4 && partialRes.V[0].length === 2;
        const sDimOk = partialRes.S.length === 2;
        const sValOk = isClose(partialRes.S, fullRes.S.slice(0, k));
        let uColsOk = true;
        for (let i = 0; i < k; i++) if (!vectorsMatch(getCol(partialRes.U, i), getCol(fullRes.U, i))) uColsOk = false;
        let vColsOk = true;
        for (let i = 0; i < k; i++) if (!vectorsMatch(getCol(partialRes.V, i), getCol(fullRes.V, i))) vColsOk = false;
        return { pass: uDimOk && vDimOk && sDimOk && sValOk && uColsOk && vColsOk, details: { uDimOk, vDimOk, sDimOk } };
    });

    test("Randomized SVD vs Standard SVD (Low Rank)", () => {
        const U_gen = [
            [1,0,0], [0,1,0], [0,0,1], [1,1,0], [1,0,1],
            [0,1,1], [1,1,1], [0.5,0.5,0.5], [0,0,0], [0,0,0]
        ];
        const V_gen = [
            [1,0,0,1,0,1,0,1,0,0],
            [0,1,0,1,1,0,0,0,1,0],
            [0,0,1,0,1,1,1,0,0,1]
        ];
        const S_gen = [[10,0,0], [0,5,0], [0,0,2]];
        const temp = multiply(U_gen, S_gen);
        const A = multiply(temp, V_gen);
        const std = svd(A, { k: 3 });
        const rand = randomizedSvd(A, { k: 3, p: 5, q: 2 });
        const sClose = isClose(rand.S, std.S, 1e-2);
        const S_mat = [[rand.S[0], 0, 0], [0, rand.S[1], 0], [0, 0, rand.S[2]]];
        const US = multiply(rand.U, S_mat);
        const Vt = transpose(rand.V);
        const A_rec = multiply(US, Vt);
        const mseRec = calcMatrixMSE(A, A_rec);
        return { pass: sClose && mseRec < 1e-5, details: { mse_Reconstruction: mseRec } };
    });
    console.groupEnd();

    // ==========================================
    // Eigenvalues & Covariance
    // ==========================================
    console.group("Eigen & Statistics");
    test("Covariance Matrix Calculation", () => {
        const pts = [
            [2, 4],
            [4, 2],
            [4, 6],
            [6, 4]
        ];
        const { cov, mean } = covariance(pts);
        const meanOk = isClose(mean, [4, 4]);
        const expectedCov = [
            [2.6666, 0.0],
            [0.0,    2.6666]
        ];
        const covOk = isClose(flatten(cov), flatten(expectedCov), 1e-4);
        return { pass: meanOk && covOk, details: { mean, cov } };
    });

    test("Symmetric Eigenvalues (Jacobi Method)", () => {
        const A = [
            [4, 1, 1],
            [1, 4, 1],
            [1, 1, 4]
        ];
        const { values, vectors } = eigenSymmetric(A);
        const expectedVals = [6, 3, 3];
        const valsOk = isClose(values, expectedVals, 1e-4);
        // Check A * v = lambda * v for the largest eigenvector
        const v0 = getCol(vectors, 0);
        const Av0 = flatten(multiply(A, v0.map(v => [v])));
        const lv0 = v0.map(v => v * values[0]);
        const vecOk = vectorsMatch(Av0, lv0, 1e-4);
        return { pass: valsOk && vecOk, details: { values, expectedVals } };
    });

    test("Principal Component Analysis (PCA)", () => {
        const pts = [
            [2.5, 2.4], [0.5, 0.7], [2.2, 2.9], [1.9, 2.2], [3.1, 3.0],
            [2.3, 2.7], [2.0, 1.6], [1.0, 1.1], [1.5, 1.6], [1.1, 0.9]
        ];
        const { components, explainedVariance, mean } = pca(pts, 2);
        const meanOk = isClose(mean, [1.81, 1.91], 1e-4);
        const varianceOk = isClose(explainedVariance, [1.28402, 0.04908], 1e-4);
        const comp0Ok = vectorsMatch(components[0], [0.67787, 0.73518], 1e-4);
        const comp1Ok = vectorsMatch(components[1], [0.73518, -0.67787], 1e-4);
        return { 
            pass: meanOk && varianceOk && comp0Ok && comp1Ok, 
            details: { meanOk, varianceOk, comp0Ok, comp1Ok, components, explainedVariance } 
        };
    });
    console.groupEnd();

    // ==========================================
    // Sparse / Iterative Solvers
    // ==========================================
    console.group("Sparse & Iterative Solvers");
    test("Iterative Solver: Conjugate Gradient (CG) for Symmetric PD System", () => {
        const b = new Float32Array([1, 2]);
        const applyA = (x: Float32Array) => new Float32Array([
            4 * x[0] + 1 * x[1],
            1 * x[0] + 3 * x[1]
        ]);
        const x = solveCG(applyA, b, undefined, { tolerance: 1e-6 });
        const expected = [1/11, 7/11]; 
        return { pass: isClose(x, expected, 1e-4), details: { actual: x, expected } };
    });

    test("Iterative Solver: BiCGStab for Asymmetric System", () => {
        const b = new Float32Array([8, 9]);
        const applyA = (x: Float32Array) => new Float32Array([
            2 * x[0] + 3 * x[1],
            1 * x[0] + 4 * x[1]
        ]);
        const x = solveBiCGStab(applyA, b, undefined, { tolerance: 1e-6 });
        const expected = [1, 2]; 
        return { pass: isClose(x, expected, 1e-4), details: { actual: x, expected } };
    });

    test("Sparse Matrix API: spsolve() using CSR format", () => {
        const dense = [
            [3, 2, -1],
            [2, -2, 4],
            [-1, 0.5, -1]
        ];
        const b = [1, -2, 0];
        const A_sparse = Lib.linalg.SparseMatrix.fromDense(dense);
        const x = spsolve(A_sparse, b, { tolerance: 1e-6 });
        const expected = [1, -2, -2];
        return { pass: isClose(x, expected, 1e-4), details: { actual: x, expected } };
    });

    test("Sparse Matrix API Edge Case: Multiply & Solve All-Zeros System", () => {
        const dense = [
            [0, 0],
            [0, 0]
        ];
        const A_sparse = Lib.linalg.SparseMatrix.fromDense(dense);
        const x = new Float32Array([10, 20]);
        const multRes = A_sparse.multiplyVec(x);
        const multOk = isClose(multRes, [0, 0]);
        return { pass: multOk && A_sparse.indices.length === 0, details: { multRes, indices: A_sparse.indices } };
    });
    console.groupEnd();

    // ==========================================
    // Homography Transform
    // ==========================================
    console.group("Homography Transform");
    test("Homography Matrix: Perspective Projection", () => {
        const src = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
        ];
        const dst = [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 3 },
            { x: 1, y: 3 }
        ];
        const H_default = solveHomography(src, dst);
        const H_robust = solveHomography(src, dst, { method: 'robust' });
        const H_fast = solveHomography(src, dst, { method: 'fast' });

        const expected = [
            2, 0, 1,
            0, 2, 1,
            0, 0, 1
        ];
        const defaultOk = isClose(flatten(H_default), expected, 1e-4);
        const robustOk = isClose(flatten(H_robust), expected, 1e-4);
        const fastOk = isClose(flatten(H_fast), expected, 1e-4);

        return { pass: defaultOk && robustOk && fastOk, details: { H_default, H_robust, H_fast } };
    });

    test("Homography Matrix: Non-Affine Projective Transform", () => {
        const src = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
        ];
        const dst = [
            { x: 0, y: 0 },
            { x: 2, y: 0.5 },
            { x: 2, y: 1.5 },
            { x: 0, y: 2 }
        ];
        const H_default = solveHomography(src, dst);
        const H_robust = solveHomography(src, dst, { method: 'robust' });
        const H_fast = solveHomography(src, dst, { method: 'fast' });

        const expected = [
            4, 0, 0,
            1, 2, 0,
            1, 0, 1
        ];
        const defaultOk = isClose(flatten(H_default), expected, 1e-4);
        const robustOk = isClose(flatten(H_robust), expected, 1e-4);
        const fastOk = isClose(flatten(H_fast), expected, 1e-4);

        return { pass: defaultOk && robustOk && fastOk, details: { H_default, H_robust, H_fast } };
    });
    console.groupEnd();

    // ==========================================
    // Heavy / Realistic Matrix Stress Tests
    // ==========================================
    console.group("Heavy / Realistic Stress Tests");
    test("Heavy: LU / Dense Solver (20x20 Random System)", () => {
        const n = 20;
        const A = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.random() * 10 - 5));
        // Add values to diagonal to ensure non-singularity and stability
        for (let i = 0; i < n; i++) A[i][i] += 50; 
        const x_true = Array.from({ length: n }, () => Math.random());
        const b = flatten(multiply(A, x_true.map(v => [v])));
        const x_solved = solveLU(A, b);
        const pass = isClose(x_solved, x_true, 1e-5);
        return { pass, details: { mse: calcMatrixMSE([x_solved], [x_true]) } };
    });

    test("Heavy: SVD Reconstruction (30x20 Matrix)", () => {
        const m = 30, n = 20;
        const A = Array.from({ length: m }, () => Array.from({ length: n }, () => Math.random()));
        const { U, S, V } = svd(A);
        const k = S.length;
        const S_mat = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? S[i] : 0)));
        const US = multiply(U, S_mat);
        const Vt = transpose(V);
        const A_rec = multiply(US, Vt);
        const mse = calcMatrixMSE(A, A_rec);
        return { pass: mse < 1e-10, details: { mse } };
    });

    test("Heavy: Jacobi Eigenvalues (20x20 Symmetric)", () => {
        const n = 20;
        const M = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.random()));
        const A = add(M, transpose(M));
        const { values, vectors } = eigenSymmetric(A);
        const v5 = getCol(vectors, 5);
        const Av5 = flatten(multiply(A, v5.map(v => [v])));
        const lv5 = v5.map(v => v * values[5]);
        return { pass: vectorsMatch(Av5, lv5, 1e-4), details: { expected_Av: lv5, actual_Av: Av5 } };
    });

    test("Heavy: Iterative CG & BiCGStab (100x100 1D Laplacian)", () => {
        const n = 100;
        const x_true = new Float32Array(n);
        for(let i=0; i<n; i++) x_true[i] = Math.sin(i * Math.PI / n);
        const b = new Float32Array(n);
        for(let i=0; i<n; i++) {
            b[i] = 2 * x_true[i] - (i > 0 ? x_true[i-1] : 0) - (i < n - 1 ? x_true[i+1] : 0);
        }
        const applyA = (x: Float32Array) => {
            const res = new Float32Array(n);
            for(let i=0; i<n; i++) res[i] = 2 * x[i] - (i > 0 ? x[i-1] : 0) - (i < n - 1 ? x[i+1] : 0);
            return res;
        };
        const x_cg = solveCG(applyA, b, undefined, { tolerance: 1e-6 });
        const x_bicg = solveBiCGStab(applyA, b, undefined, { tolerance: 1e-6 });
        const passCg = isClose(x_cg, Array.from(x_true), 1e-3);
        const passBicg = isClose(x_bicg, Array.from(x_true), 1e-3);
        return { pass: passCg && passBicg, details: { passCg, passBicg } };
    });

    test("Heavy: Direct spsolve (225x225 2D Poisson Grid)", () => {
        const gridSize = 15;
        const n = gridSize * gridSize;
        const sparseData: number[] = [];
        const sparseIndices: number[] = [];
        const sparseIndptr: number[] = [0];
        const b = new Float32Array(n);
        const x_true = new Float32Array(n).fill(1.0); 
        // Assemble 2D grid Laplacian (sparse connectivity)
        for (let i = 0; i < n; i++) {
            const x = i % gridSize;
            const y = Math.floor(i / gridSize);
            const diagVal = 4;
            let expected_B_val = diagVal;
            const entries: { col: number, val: number }[] = [];
            entries.push({ col: i, val: diagVal });
            if (x > 0) { entries.push({ col: i - 1, val: -1 }); expected_B_val -= 1.0; }
            if (x < gridSize - 1) { entries.push({ col: i + 1, val: -1 }); expected_B_val -= 1.0; }
            if (y > 0) { entries.push({ col: i - gridSize, val: -1 }); expected_B_val -= 1.0; }
            if (y < gridSize - 1) { entries.push({ col: i + gridSize, val: -1 }); expected_B_val -= 1.0; }
            entries.sort((a, b) => a.col - b.col);
            for (const entry of entries) {
                sparseData.push(entry.val);
                sparseIndices.push(entry.col);
            }
            sparseIndptr.push(sparseData.length);
            b[i] = expected_B_val;
        }
        const A_sparse = new Lib.linalg.SparseMatrix(n, n, sparseData, sparseIndices, sparseIndptr);
        const x_solved = spsolve(A_sparse, b);
        const pass = isClose(x_solved, Array.from(x_true), 1e-4);
        return { pass, details: { size: n } };
    });
    console.groupEnd();
}
