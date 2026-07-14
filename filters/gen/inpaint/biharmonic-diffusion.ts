import { Layer } from '~/layers';
import { Lib } from '~/libs/index';
import { PushPull } from './push-pull';
import { computeFeatheredMask } from './utils';

// FINITE DIFFERENCE & DIFFUSION SOLVERS (HARMONIC, BIHARMONIC)
export namespace Diffusion {
    export function getNeighCoef(ny: number, nx: number, cy: number, cx: number) {
        const grid = new Float32Array(ny * nx);
        grid[cy * nx + cx] = 1.0;

        const laplace = (inGrid: Float32Array): Float32Array => {
            const outGrid = new Float32Array(ny * nx);
            for (let y = 0; y < ny; y++) {
                for (let x = 0; x < nx; x++) {
                    let sum = 0;
                    const neighbors = [
                        [y - 1, x],
                        [y + 1, x],
                        [y, x - 1],
                        [y, x + 1]
                    ];
                    for (const [ny_, nx_] of neighbors) {
                        let ry = ny_;
                        if (ry < 0) ry = -ry;
                        if (ry >= ny) ry = 2 * ny - 2 - ry;

                        let rx = nx_;
                        if (rx < 0) rx = -rx;
                        if (rx >= nx) rx = 2 * nx - 2 - rx;

                        ry = Math.max(0, Math.min(ny - 1, ry));
                        rx = Math.max(0, Math.min(nx - 1, rx));

                        sum += inGrid[ry * nx + rx];
                    }
                    outGrid[y * nx + x] = sum - 4.0 * inGrid[y * nx + x];
                }
            }
            return outGrid;
        };

        const doubleLaplace = laplace(laplace(grid));
        const rY: number[] = [];
        const rX: number[] = [];
        const vals: number[] = [];

        for (let y = 0; y < ny; y++) {
            for (let x = 0; x < nx; x++) {
                const val = doubleLaplace[y * nx + x];
                if (Math.abs(val) > 1e-5) {
                    rY.push(y);
                    rX.push(x);
                    vals.push(val);
                }
            }
        }

        return { rY, rX, vals };
    }

    export function solveBiCGStab(
        N: number,
        initialGuess: Float32Array,
        b: Float32Array,
        diagWeights: Float32Array,
        maskedNeighbors: Array<{ indices: Int32Array, weights: Float32Array }>,
        maxIterations = 150,
        tolerance = 1e-4
    ): Float32Array {
        const applyA = (p: Float32Array): Float32Array => {
            const Ap = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                let val = diagWeights[i] * p[i];
                const neighs = maskedNeighbors[i];
                const idxs = neighs.indices;
                const wts = neighs.weights;
                const len = idxs.length;
                for (let k = 0; k < len; k++) {
                    val += wts[k] * p[idxs[k]];
                }
                Ap[i] = val;
            }
            return Ap;
        };

        const solution = Lib.linalg.solveBiCGStab(applyA, b, initialGuess, { maxIterations, tolerance });
        for (let i = 0; i < N; i++) {
            if (solution[i] < 0) solution[i] = 0;
            else if (solution[i] > 255) solution[i] = 255;
        }

        return solution;
    }

    export function solveSpsolve(
        N: number,
        b: Float32Array,
        diagWeights: Float32Array,
        maskedNeighbors: Array<{ indices: Int32Array, weights: Float32Array }>
    ): Float32Array {
        const sparseData: number[] = [];
        const sparseIndices: number[] = [];
        const sparseIndptr: number[] = [0];

        for (let i = 0; i < N; i++) {
            const entries: Array<{ col: number, val: number }> = [];
            entries.push({ col: i, val: diagWeights[i] });

            const neighs = maskedNeighbors[i];
            for (let k = 0; k < neighs.indices.length; k++) {
                entries.push({ col: neighs.indices[k], val: neighs.weights[k] });
            }

            entries.sort((a, b) => a.col - b.col);

            for (const entry of entries) {
                sparseData.push(entry.val);
                sparseIndices.push(entry.col);
            }
            sparseIndptr.push(sparseData.length);
        }

        const A = new Lib.linalg.SparseMatrix(N, N, sparseData, sparseIndices, sparseIndptr);
        const solution = Lib.linalg.spsolve(A, b);

        for (let i = 0; i < N; i++) {
            if (solution[i] < 0) solution[i] = 0;
            else if (solution[i] > 255) solution[i] = 255;
        }

        return solution;
    }

    export function inpaintBiharmonic(
        layer: Layer,
        maskCanvas: HTMLCanvasElement,
        solver = 'bicgstab',
        iterations = 150,
        softness = 0
    ) {
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;
        const originalPixels = new Uint8ClampedArray(pixels);
        const mCtx = maskCanvas.getContext('2d')!;
        const mImgData = mCtx.getImageData(0, 0, w, h);
        const mPixels = mImgData.data;
        const mask = new Uint8Array(w * h);
        const maskedIndices: number[] = [];

        for (let i = 0; i < w * h; i++) {
            if (mPixels[i * 4 + 3] > 10) {
                mask[i] = 1;
                maskedIndices.push(i);
            }
        }

        if (maskedIndices.length === 0) return;

        PushPull.initialize(pixels, w, h, mask, maskedIndices);

        const N = maskedIndices.length;
        const pixelToIndexMap = new Int32Array(w * h).fill(-1);
        for (let i = 0; i < N; i++) {
            pixelToIndexMap[maskedIndices[i]] = i;
        }

        const maskedNeighbors: Array<{ indices: Int32Array, weights: Float32Array }> = [];
        const boundaryNeighbors: Array<{ pixelIndices: Int32Array, weights: Float32Array }> = [];
        const diagWeights = new Float32Array(N);

        for (let i = 0; i < N; i++) {
            const idx = maskedIndices[i];
            const x0 = idx % w;
            const y0 = Math.floor(idx / w);
            const isInterior = (y0 >= 2 && y0 < h - 2 && x0 >= 2 && x0 < w - 2);

            let rY: number[];
            let rX: number[];
            let vals: number[];
            let yLo = 0;
            let xLo = 0;

            if (isInterior) {
                rY = [ 0, -1,  1,  0,  0, -1, -1,  1,  1, -2,  2,  0,  0];
                rX = [ 0,  0,  0, -1,  1, -1,  1, -1,  1,  0,  0, -2,  2];
                vals = [ 20.0, -8.0, -8.0, -8.0, -8.0, 2.0, 2.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0 ];
                yLo = y0;
                xLo = x0;
            } else {
                yLo = Math.max(0, y0 - 2);
                const yHi = Math.min(h, y0 + 3);
                xLo = Math.max(0, x0 - 2);
                const xHi = Math.min(w, x0 + 3);
                const ny = yHi - yLo;
                const nx = xHi - xLo;
                const cy = y0 - yLo;
                const cx = x0 - xLo;

                const stencil = getNeighCoef(ny, nx, cy, cx);
                rY = stencil.rY;
                rX = stencil.rX;
                vals = stencil.vals;
            }

            const mInds: number[] = [];
            const mWts: number[] = [];
            const bInds: number[] = [];
            const bWts: number[] = [];
            let centerWeight = 20.0;

            for (let k = 0; k < vals.length; k++) {
                const neighIdx = (yLo + rY[k]) * w + (xLo + rX[k]);
                const weight = vals[k];
                const mappedIdx = pixelToIndexMap[neighIdx];
                if (mappedIdx === i) {
                    centerWeight = weight;
                } else if (mappedIdx !== -1) {
                    mInds.push(mappedIdx);
                    mWts.push(weight);
                } else {
                    bInds.push(neighIdx);
                    bWts.push(weight);
                }
            }

            diagWeights[i] = centerWeight;
            maskedNeighbors.push({
                indices: new Int32Array(mInds),
                weights: new Float32Array(mWts)
            });
            boundaryNeighbors.push({
                pixelIndices: new Int32Array(bInds),
                weights: new Float32Array(bWts)
            });
        }

        for (let c = 0; c < 4; c++) {
            const b = new Float32Array(N);
            const initialGuess = new Float32Array(N);

            for (let i = 0; i < N; i++) {
                let sum = 0;
                const bNeigh = boundaryNeighbors[i];
                for (let k = 0; k < bNeigh.pixelIndices.length; k++) {
                    sum += bNeigh.weights[k] * pixels[bNeigh.pixelIndices[k] * 4 + c];
                }
                b[i] = -sum;
                initialGuess[i] = pixels[maskedIndices[i] * 4 + c];
            }

            let solution: Float32Array;
            if (solver === 'spsolve') {
                solution = solveSpsolve(N, b, diagWeights, maskedNeighbors);
            } else {
                solution = solveBiCGStab(N, initialGuess, b, diagWeights, maskedNeighbors, iterations, 1e-4);
            }

            for (let i = 0; i < N; i++) {
                pixels[maskedIndices[i] * 4 + c] = Math.max(0, Math.min(255, Math.round(solution[i])));
            }
        }

        // Apply feather blend
        const blendMask = computeFeatheredMask(maskCanvas, w, h, softness);
        for (let i = 0; i < w * h; i++) {
            const weight = blendMask[i];
            if (weight < 1.0) {
                const idx = i * 4;
                pixels[idx]     = Math.max(0, Math.min(255, Math.round(originalPixels[idx]     * (1 - weight) + pixels[idx]     * weight)));
                pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 1] * (1 - weight) + pixels[idx + 1] * weight)));
                pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 2] * (1 - weight) + pixels[idx + 2] * weight)));
                pixels[idx + 3] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 3] * (1 - weight) + pixels[idx + 3] * weight)));
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }

    export function inpaintHarmonic(layer: Layer, maskCanvas: HTMLCanvasElement, iterations = 100, omega = 1.1, softness = 0) {
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;
        const originalPixels = new Uint8ClampedArray(pixels);
        const mCtx = maskCanvas.getContext('2d')!;
        const mImgData = mCtx.getImageData(0, 0, w, h);
        const mPixels = mImgData.data;
        const mask = new Uint8Array(w * h);
        const maskedIndices: number[] = [];

        for (let i = 0; i < w * h; i++) {
            if (mPixels[i * 4 + 3] > 10) {
                mask[i] = 1;
                maskedIndices.push(i);
            }
        }

        if (maskedIndices.length === 0) return;

        PushPull.initialize(pixels, w, h, mask, maskedIndices);

        const getVal = (x: number, y: number, offset: number): number => {
            const cx = Math.max(0, Math.min(w - 1, x));
            const cy = Math.max(0, Math.min(h - 1, y));
            return pixels[(cy * w + cx) * 4 + offset];
        };

        for (let iter = 0; iter < iterations; iter++) {
            for (let idx = 0; idx < maskedIndices.length; idx++) {
                const i = maskedIndices[idx];
                const x = i % w;
                const y = Math.floor(i / w);

                for (let c = 0; c < 4; c++) {
                    const sumN1 = getVal(x + 1, y, c) + getVal(x - 1, y, c) + getVal(x, y + 1, c) + getVal(x, y - 1, c);
                    const currentVal = pixels[i * 4 + c];
                    const residual = 4 * currentVal - sumN1;

                    let newVal = currentVal - omega * (residual / 4);
                    if (newVal < 0) newVal = 0;
                    else if (newVal > 255) newVal = 255;

                    pixels[i * 4 + c] = newVal;
                }
            }
        }

        // Apply feather blend
        const blendMask = computeFeatheredMask(maskCanvas, w, h, softness);
        for (let i = 0; i < w * h; i++) {
            const weight = blendMask[i];
            if (weight < 1.0) {
                const idx = i * 4;
                pixels[idx]     = Math.max(0, Math.min(255, Math.round(originalPixels[idx]     * (1 - weight) + pixels[idx]     * weight)));
                pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 1] * (1 - weight) + pixels[idx + 1] * weight)));
                pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 2] * (1 - weight) + pixels[idx + 2] * weight)));
                pixels[idx + 3] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 3] * (1 - weight) + pixels[idx + 3] * weight)));
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }
}
