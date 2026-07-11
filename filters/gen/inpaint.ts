import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { App } from '~/app';
import { Lib } from '~/libs/index';

// Hierarchical push-pull pyramid interpolation for high-quality low-frequency initialization
export function pushPullInitialize(
    pixels: Uint8ClampedArray,
    w: number,
    h: number,
    mask: Uint8Array,
    maskedIndices: number[]
) {
    const levels: Array<{ data: Float32Array; mask: Uint8Array; w: number; h: number }> = [];

    const level0Data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i++) level0Data[i] = pixels[i];
    const level0Mask = new Uint8Array(mask);

    levels.push({ data: level0Data, mask: level0Mask, w, h });

    let curW = w;
    let curH = h;
    while (curW > 4 && curH > 4) {
        const nextW = Math.ceil(curW / 2);
        const nextH = Math.ceil(curH / 2);
        const prevData = levels[levels.length - 1].data;
        const prevMask = levels[levels.length - 1].mask;
        const prevW = curW;
        const prevH = curH;

        const nextData = new Float32Array(nextW * nextH * 4);
        const nextMask = new Uint8Array(nextW * nextH);

        for (let ny = 0; ny < nextH; ny++) {
            for (let nx = 0; nx < nextW; nx++) {
                const nIdx = ny * nextW + nx;

                let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
                let knownWeightSum = 0;

                for (let dy = 0; dy < 2; dy++) {
                    const py = ny * 2 + dy;
                    if (py >= prevH) continue;
                    for (let dx = 0; dx < 2; dx++) {
                        const px = nx * 2 + dx;
                        if (px >= prevW) continue;

                        const pIdx = py * prevW + px;
                        if (prevMask[pIdx] === 0) {
                            rSum += prevData[pIdx * 4];
                            gSum += prevData[pIdx * 4 + 1];
                            bSum += prevData[pIdx * 4 + 2];
                            aSum += prevData[pIdx * 4 + 3];
                            knownWeightSum += 1.0;
                        }
                    }
                }

                if (knownWeightSum > 0) {
                    nextData[nIdx * 4] = rSum / knownWeightSum;
                    nextData[nIdx * 4 + 1] = gSum / knownWeightSum;
                    nextData[nIdx * 4 + 2] = bSum / knownWeightSum;
                    nextData[nIdx * 4 + 3] = aSum / knownWeightSum;
                    nextMask[nIdx] = 0;
                } else {
                    nextMask[nIdx] = 1;
                }
            }
        }

        levels.push({ data: nextData, mask: nextMask, w: nextW, h: nextH });
        curW = nextW;
        curH = nextH;
    }

    const coarsest = levels[levels.length - 1];
    let avgR = 0, avgG = 0, avgB = 0, avgA = 0;
    let count = 0;
    for (let i = 0; i < coarsest.w * coarsest.h; i++) {
        if (coarsest.mask[i] === 0) {
            avgR += coarsest.data[i * 4];
            avgG += coarsest.data[i * 4 + 1];
            avgB += coarsest.data[i * 4 + 2];
            avgA += coarsest.data[i * 4 + 3];
            count++;
        }
    }
    if (count > 0) {
        avgR /= count; avgG /= count; avgB /= count; avgA /= count;
    }
    for (let i = 0; i < coarsest.w * coarsest.h; i++) {
        if (coarsest.mask[i] === 1) {
            coarsest.data[i * 4] = avgR;
            coarsest.data[i * 4 + 1] = avgG;
            coarsest.data[i * 4 + 2] = avgB;
            coarsest.data[i * 4 + 3] = avgA;
            coarsest.mask[i] = 0;
        }
    }

    for (let L = levels.length - 2; L >= 0; L--) {
        const fine = levels[L];
        const coarse = levels[L + 1];

        for (let fy = 0; fy < fine.h; fy++) {
            const cy = Math.min(coarse.h - 1, fy / 2);
            const cy0 = Math.floor(cy);
            const cy1 = Math.min(coarse.h - 1, cy0 + 1);
            const tY = cy - cy0;

            for (let fx = 0; fx < fine.w; fx++) {
                const fIdx = fy * fine.w + fx;
                if (fine.mask[fIdx] === 1) {
                    const cx = Math.min(coarse.w - 1, fx / 2);
                    const cx0 = Math.floor(cx);
                    const cx1 = Math.min(coarse.w - 1, cx0 + 1);
                    const tX = cx - cx0;

                    const i00 = (cy0 * coarse.w + cx0) * 4;
                    const i10 = (cy0 * coarse.w + cx1) * 4;
                    const i01 = (cy1 * coarse.w + cx0) * 4;
                    const i11 = (cy1 * coarse.w + cx1) * 4;

                    for (let c = 0; c < 4; c++) {
                        const val = (1 - tY) * ((1 - tX) * coarse.data[i00 + c] + tX * coarse.data[i10 + c]) +
                                    tY * ((1 - tX) * coarse.data[i01 + c] + tX * coarse.data[i11 + c]);
                        fine.data[fIdx * 4 + c] = val;
                    }
                    fine.mask[fIdx] = 0;
                }
            }
        }
    }

    const fineData = levels[0].data;
    for (const i of maskedIndices) {
        pixels[i * 4] = Math.max(0, Math.min(255, Math.round(fineData[i * 4])));
        pixels[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(fineData[i * 4 + 1])));
        pixels[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(fineData[i * 4 + 2])));
        pixels[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(fineData[i * 4 + 3])));
    }
}

// Dynamically compute exact double-laplacian neighborhood coefficients with reflection matching scipy
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

// Bi-Conjugate Gradient Stabilized (BiCGStab) Solver delegated to Lib.linalg
export function solveBiCGStab(
    N: number,
    initialGuess: Float32Array,
    b: Float32Array,
    diagWeights: Float32Array,
    maskedNeighbors: Array<{ indices: Int32Array, weights: Float32Array }>,
    maxIterations = 150,
    tolerance = 1e-4,
    channelName = 'unknown'
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

    const solution = Lib.linalg.solveBiCGStab(applyA, b, initialGuess, {
        maxIterations,
        tolerance
    });

    // Clamp final values strictly into the physical display bounds
    for (let i = 0; i < N; i++) {
        if (solution[i] < 0) solution[i] = 0;
        else if (solution[i] > 255) solution[i] = 255;
    }

    return solution;
}

// Direct sparse LU solver delegation to Lib.linalg.spsolve
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

    // Clamp final values strictly into the physical display bounds
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
    omega = 1.15
) {
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    const ctx = layer.ctx;
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

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

    // Apply push-pull pyramid for low-frequency initial guess
    pushPullInitialize(pixels, w, h, mask, maskedIndices);

    const N = maskedIndices.length;
    const pixelToIndexMap = new Int32Array(w * h).fill(-1);
    for (let i = 0; i < N; i++) {
        pixelToIndexMap[maskedIndices[i]] = i;
    }

    const maskedNeighbors: Array<{ indices: Int32Array, weights: Float32Array }> = [];
    const boundaryNeighbors: Array<{ pixelIndices: Int32Array, weights: Float32Array }> = [];
    const diagWeights = new Float32Array(N);

    let emptyStencils = 0;
    let totalMaskLinks = 0;
    let totalBoundaryLinks = 0;

    for (let i = 0; i < N; i++) {
        const idx = maskedIndices[i];
        const x0 = idx % w;
        const y0 = Math.floor(idx / w);

        // Check if the pixel is in the interior (at least 2 pixels away from all image boundaries)
        const isInterior = (y0 >= 2 && y0 < h - 2 && x0 >= 2 && x0 < w - 2);

        let rY: number[];
        let rX: number[];
        let vals: number[];
        let yLo = 0;
        let xLo = 0;

        if (isInterior) {
            // Use the exact free-space 13-point bilaplacian stencil
            rY = [ 0, -1,  1,  0,  0, -1, -1,  1,  1, -2,  2,  0,  0];
            rX = [ 0,  0,  0, -1,  1, -1,  1, -1,  1,  0,  0, -2,  2];
            vals = [
                20.0, // Center (0,0)
                -8.0, -8.0, -8.0, -8.0, // 1st-ring axial
                2.0,  2.0,  2.0,  2.0, // Diagonal 1-step
                1.0,  1.0,  1.0,  1.0  // Axial 2-steps
            ];
            yLo = y0;
            xLo = x0;
        } else {
            // Compute the truncated stencil near boundaries using real subgrid reflections
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

        if (vals.length === 0) emptyStencils++;

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
        totalMaskLinks += mInds.length;
        totalBoundaryLinks += bInds.length;

        maskedNeighbors.push({
            indices: new Int32Array(mInds),
            weights: new Float32Array(mWts)
        });
        boundaryNeighbors.push({
            pixelIndices: new Int32Array(bInds),
            weights: new Float32Array(bWts)
        });
    }

    const channelNames = ['R', 'G', 'B', 'A'];

    // Solve for each channel independently using exact, stable BiCGStab Krylov solver
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
            solution = solveBiCGStab(N, initialGuess, b, diagWeights, maskedNeighbors, iterations, 1e-4, channelNames[c]);
        }

        for (let i = 0; i < N; i++) {
            pixels[maskedIndices[i] * 4 + c] = Math.max(0, Math.min(255, Math.round(solution[i])));
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

// Run Successive Over-Relaxation for standard harmonic diffusion with hierarchical initial guess
export function inpaintHarmonic(layer: Layer, maskCanvas: HTMLCanvasElement, iterations = 100, omega = 1.1) {
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    const ctx = layer.ctx;
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

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

    pushPullInitialize(pixels, w, h, mask, maskedIndices);

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

    ctx.putImageData(imgData, 0, 0);
}

// Fill selection with a solid color
export function inpaintSolid(layer: Layer, maskCanvas: HTMLCanvasElement, hexColor: string) {
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    const ctx = layer.ctx;
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

    const mCtx = maskCanvas.getContext('2d')!;
    const mImgData = mCtx.getImageData(0, 0, w, h);
    const mPixels = mImgData.data;

    const parseHex = (hex: string) => {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [255, 255, 255];
    };
    const color = parseHex(hexColor);

    for (let i = 0; i < w * h; i++) {
        if (mPixels[i * 4 + 3] > 10) {
            pixels[i * 4] = color[0];
            pixels[i * 4 + 1] = color[1];
            pixels[i * 4 + 2] = color[2];
            pixels[i * 4 + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

// Reconstructed patch-based content-aware Poisson fill algorithm
export function inpaintPatchBased(layer: Layer, maskCanvas: HTMLCanvasElement) {
    const width = layer.canvas.width;
    const height = layer.canvas.height;
    const ctx = layer.ctx;
    const imgData = ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    const pixelsOriginal = new Uint8ClampedArray(pixels);

    const mCtx = maskCanvas.getContext('2d')!;
    const mImgData = mCtx.getImageData(0, 0, width, height);
    const mPixels = mImgData.data;

    let minX = width, maxX = 0, minY = height, maxY = 0;
    let hasMask = false;
    const mask = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
        const yOffset = y * width;
        for (let x = 0; x < width; x++) {
            const idx = yOffset + x;
            if (mPixels[idx * 4 + 3] > 10) {
                mask[idx] = 1;
                hasMask = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!hasMask) return;

    const padding = 10;
    minX = Math.max(0, minX - padding);
    maxX = Math.min(width - 1, maxX + padding);
    minY = Math.max(0, minY - padding);
    maxY = Math.min(height - 1, maxY + padding);

    const depth = new Int32Array(width * height).fill(-1);
    const queue: number[] = [];

    for (let y = minY; y <= maxY; y++) {
        const yOffset = y * width;
        for (let x = minX; x <= maxX; x++) {
            const idx = yOffset + x;
            if (mask[idx] === 1) {
                let isBoundary = false;
                if (x > 0 && mask[idx - 1] === 0) isBoundary = true;
                else if (x < width - 1 && mask[idx + 1] === 0) isBoundary = true;
                else if (y > 0 && mask[idx - width] === 0) isBoundary = true;
                else if (y < height - 1 && mask[idx + width] === 0) isBoundary = true;

                if (isBoundary) {
                    depth[idx] = 1;
                    queue.push(idx);
                }
            }
        }
    }

    let head = 0;
    while (head < queue.length) {
        const curr = queue[head++];
        const cx = curr % width;
        const cy = Math.floor(curr / width);
        const currDepth = depth[curr];

        const neighbors = [curr - 1, curr + 1, curr - width, curr + width];
        for (let i = 0; i < neighbors.length; i++) {
            const nIdx = neighbors[i];
            if (nIdx >= 0 && nIdx < width * height) {
                const nx = nIdx % width;
                const ny = Math.floor(nIdx / width);
                if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
                    if (mask[nIdx] === 1 && depth[nIdx] === -1) {
                        depth[nIdx] = currDepth + 1;
                        queue.push(nIdx);
                    }
                }
            }
        }
    }

    const targetPixels: number[] = [];
    for (let y = minY; y <= maxY; y++) {
        const yOffset = y * width;
        for (let x = minX; x <= maxX; x++) {
            const idx = yOffset + x;
            if (mask[idx] === 1 && depth[idx] !== -1) {
                targetPixels.push(idx);
            }
        }
    }

    targetPixels.sort((a, b) => depth[a] - depth[b]);

    const offsetsX = new Int16Array(width * height);
    const offsetsY = new Int16Array(width * height);
    const filled = new Uint8Array(width * height);

    const patchRadius = 3; 
    const searchRadius = 40;

    const evaluateOffset = (x: number, y: number, dx: number, dy: number): number => {
        let ssd = 0;
        let weightSum = 0;

        for (let py = -patchRadius; py <= patchRadius; py++) {
            const ty = y + py;
            const sy = y + dy + py;
            if (ty < 0 || ty >= height || sy < 0 || sy >= height) continue;

            const tyOffset = ty * width;
            const syOffset = sy * width;

            for (let px = -patchRadius; px <= patchRadius; px++) {
                const tx = x + px;
                const sx = x + dx + px;
                if (tx < 0 || tx >= width || sx < 0 || sx >= width) continue;

                const tIdx = tyOffset + tx;
                if (mask[tIdx] === 0 || filled[tIdx] === 1) {
                    const sIdx = syOffset + sx;
                    const tIdx4 = tIdx * 4;
                    const sIdx4 = sIdx * 4;

                    const dr = pixels[tIdx4] - pixels[sIdx4];
                    const dg = pixels[tIdx4 + 1] - pixels[sIdx4 + 1];
                    const db = pixels[tIdx4 + 2] - pixels[sIdx4 + 2];
                    const da = pixels[tIdx4 + 3] - pixels[sIdx4 + 3];

                    const distSq = px * px + py * py;
                    const weight = 1 / (1 + distSq);

                    ssd += (dr * dr + dg * dg + db * db + da * da) * weight;
                    weightSum += weight;
                }
            }
        }

        return weightSum > 0 ? ssd / weightSum : Infinity;
    };

    const checked = new Set<number>();

    for (let i = 0; i < targetPixels.length; i++) {
        const idx = targetPixels[i];
        const x = idx % width;
        const y = Math.floor(idx / width);

        let bestDx = 0;
        let bestDy = 0;
        let minScore = Infinity;

        checked.clear();

        const addCandidate = (dx: number, dy: number) => {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sx >= width || sy < 0 || sy >= height) return;
            if (mask[sy * width + sx] === 1) return;

            const key = (dx + 1000) * 2000 + (dy + 1000);
            if (checked.has(key)) return;
            checked.add(key);

            const score = evaluateOffset(x, y, dx, dy);
            if (score < minScore) {
                minScore = score;
                bestDx = dx;
                bestDy = dy;
            }
        };

        const spatialNeighbors = [
            { nx: x - 1, ny: y },
            { nx: x + 1, ny: y },
            { nx: x, ny: y - 1 },
            { nx: x, ny: y + 1 }
        ];

        for (let j = 0; j < spatialNeighbors.length; j++) {
            const sn = spatialNeighbors[j];
            if (sn.nx >= 0 && sn.nx < width && sn.ny >= 0 && sn.ny < height) {
                const nIdx = sn.ny * width + sn.nx;
                if (mask[nIdx] === 0 || filled[nIdx] === 1) {
                    addCandidate(offsetsX[nIdx], offsetsY[nIdx]);
                }
            }
        }

        if (minScore === Infinity) {
            for (let r = 1; r <= searchRadius; r += 2) {
                let found = false;
                for (let dy = -r; dy <= r; dy += r) {
                    for (let dx = -r; dx <= r; dx += r) {
                        const sx = x + dx;
                        const sy = y + dy;
                        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                            if (mask[sy * width + sx] === 0) {
                                addCandidate(dx, dy);
                                found = true;
                            }
                        }
                    }
                }
                if (found) break;
            }
        }

        let currSearchRadius = searchRadius;
        while (currSearchRadius >= 1) {
            for (let step = 0; step < 4; step++) {
                const rdx = bestDx + Math.round((Math.random() - 0.5) * 2 * currSearchRadius);
                const rdy = bestDy + Math.round((Math.random() - 0.5) * 2 * currSearchRadius);
                addCandidate(rdx, rdy);
            }
            currSearchRadius = Math.floor(currSearchRadius / 2);
        }

        if (minScore === Infinity) {
            let found = false;
            for (let ty = 0; ty < height; ty++) {
                for (let tx = 0; tx < width; tx++) {
                    if (mask[ty * width + tx] === 0) {
                        bestDx = tx - x;
                        bestDy = ty - y;
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }

        offsetsX[idx] = bestDx;
        offsetsY[idx] = bestDy;

        const sourceIdx = (y + bestDy) * width + (x + bestDx);
        const tIdx4 = idx * 4;
        const sIdx4 = sourceIdx * 4;

        pixels[tIdx4] = pixels[sIdx4];
        pixels[tIdx4 + 1] = pixels[sIdx4 + 1];
        pixels[tIdx4 + 2] = pixels[sIdx4 + 2];
        pixels[tIdx4 + 3] = pixels[sIdx4 + 3];

        filled[idx] = 1;
    }

    ctx.putImageData(imgData, 0, 0);

    const gsIterations = 20;
    const w_sor = 1.4;
    const diff = new Float32Array(width * height * 4);

    for (let i = 0; i < targetPixels.length; i++) {
        const idx = targetPixels[i];
        const x = idx % width;
        const y = Math.floor(idx / width);
        const dx = offsetsX[idx];
        const dy = offsetsY[idx];

        const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
        for (let j = 0; j < neighbors.length; j++) {
            const nIdx = neighbors[j];
            if (nIdx >= 0 && nIdx < width * height && mask[nIdx] === 0) {
                const nx = nIdx % width;
                const ny = Math.floor(nIdx / width);
                const sx = nx + dx;
                const sy = ny + dy;
                if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                    const sIdx = sy * width + sx;
                    for (let c = 0; c < 4; c++) {
                        diff[nIdx * 4 + c] = pixelsOriginal[nIdx * 4 + c] - pixelsOriginal[sIdx * 4 + c];
                    }
                }
            }
        }
    }

    for (let it = 0; it < gsIterations; it++) {
        for (let i = 0; i < targetPixels.length; i++) {
            const idx = targetPixels[i];
            const x = idx % width;
            const y = Math.floor(idx / width);
            if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) continue;

            const up = idx - width;
            const down = idx + width;
            const left = idx - 1;
            const right = idx + 1;

            for (let c = 0; c < 4; c++) {
                const cIdx = idx * 4 + c;
                const average = (diff[up * 4 + c] + diff[down * 4 + c] + diff[left * 4 + c] + diff[right * 4 + c]) / 4;
                diff[cIdx] += w_sor * (average - diff[cIdx]);
            }
        }
    }

    for (let i = 0; i < targetPixels.length; i++) {
        const idx = targetPixels[i];
        for (let c = 0; c < 4; c++) {
            const cIdx = idx * 4 + c;
            pixels[cIdx] = Math.max(0, Math.min(255, pixels[cIdx] + diff[cIdx]));
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

Filters.register('inpaint', {
    name: 'Inpaint Selection',
    mode: 'unified',
    menu: {
        path: 'Generate',
        label: 'Inpaint Selection...',
        order: 11
    },

    apply(context: FilterContext) {
        const { layer, values, selection } = context;
        if (!selection.active || !selection.mask) {
            alert('Please select an area first.');
            return;
        }

        const method = values.method || 'biharmonic';
        if (method === 'biharmonic') {
            inpaintBiharmonic(layer, selection.mask, values.biharmonicSolver, values.biharmonicIterations);
        } else if (method === 'harmonic') {
            inpaintHarmonic(layer, selection.mask, values.harmonicIterations, values.harmonicOmega);
        } else if (method === 'patch') {
            inpaintPatchBased(layer, selection.mask);
        } else if (method === 'solid') {
            inpaintSolid(layer, selection.mask, values.solidColor);
        }
    },

    renderUI(root: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            method: 'biharmonic',
            biharmonicSolver: 'bicgstab',
            biharmonicIterations: 300,
            biharmonicOmega: 1.6,
            harmonicIterations: 100,
            harmonicOmega: 1.1,
            solidColor: '#ffffff'
        };

        const update = () => hooks.preview(state);

        root.appendChild(UI.createSelectRow({
            label: 'Method',
            options: [
                { value: 'biharmonic', text: 'Biharmonic Diffusion' },
                { value: 'harmonic', text: 'Harmonic Diffusion (Laplace)' },
                { value: 'patch', text: 'Patch-Based (Content-Aware)' },
                { value: 'solid', text: 'Solid Color Fill' }
            ],
            value: state.method,
            onChange: (v) => {
                state.method = v;
                UI.toggle(biharmonicGroup, v === 'biharmonic');
                UI.toggle(harmonicGroup, v === 'harmonic');
                UI.toggle(solidGroup, v === 'solid');
                update();
            }
        }));

        const biharmonicIterationsRow = UI.createSliderRow({
            label: 'Iterations', min: 10, max: 500, step: 5, value: state.biharmonicIterations,
            onInput: (v) => { state.biharmonicIterations = parseInt(v); update(); }
        });

        const biharmonicGroup = UI.createContainer(
            UI.createSelectRow({
                label: 'Solver',
                options: [
                    { value: 'spsolve', text: 'Direct (Sparse LU)' },
                    { value: 'bicgstab', text: 'Iterative (BiCGStab)' }
                ],
                value: state.biharmonicSolver,
                onChange: (v) => {
                    state.biharmonicSolver = v;
                    UI.toggle(biharmonicIterationsRow, v === 'bicgstab');
                    update();
                }
            }),
            biharmonicIterationsRow
        );
        root.appendChild(biharmonicGroup);

        const harmonicGroup = UI.createContainer(
            UI.createSliderRow({
                label: 'Iterations', min: 10, max: 500, step: 5, value: state.harmonicIterations,
                onInput: (v) => { state.harmonicIterations = parseInt(v); update(); }
            }),
            UI.createSliderRow({
                label: 'SOR Omega', min: 0.5, max: 1.95, step: 0.05, value: state.harmonicOmega,
                onInput: (v) => { state.harmonicOmega = parseFloat(v); update(); }
            })
        );
        root.appendChild(harmonicGroup);

        const solidGroup = UI.createContainer(
            UI.createColorRow({
                label: 'Fill Color', value: state.solidColor,
                onChange: (v) => { state.solidColor = v; update(); }
            })
        );
        root.appendChild(solidGroup);

        UI.toggle(biharmonicGroup, state.method === 'biharmonic');
        UI.toggle(biharmonicIterationsRow, state.biharmonicSolver === 'bicgstab');
        UI.toggle(harmonicGroup, state.method === 'harmonic');
        UI.toggle(solidGroup, state.method === 'solid');

        update();
    }
});
