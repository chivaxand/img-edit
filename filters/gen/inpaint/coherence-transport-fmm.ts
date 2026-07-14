import { Layer } from '~/layers';
import { computeFeatheredMask } from './utils';

// BORNEMANN & MÄRZ COHERENCE TRANSPORT (BCT) INPAINTING ALGORITHM
export namespace CoherenceTransportFMM {
    export class HeapElem {
        constructor(
            public x: number,
            public y: number,
            public t: number,
            public idx: number
        ) {}
    }

    export class PriorityQueue {
        data: HeapElem[] = [];
        push(x: number, y: number, t: number, idx: number) {
            this.data.push(new HeapElem(x, y, t, idx));
            this.up(this.data.length - 1);
        }
        pop(): HeapElem | undefined {
            if (this.data.length === 0) return undefined;
            const top = this.data[0];
            const bottom = this.data.pop();
            if (this.data.length > 0 && bottom) {
                this.data[0] = bottom;
                this.down(0);
            }
            return top;
        }
        up(i: number) {
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (this.compare(this.data[i], this.data[p])) {
                    const tmp = this.data[i];
                    this.data[i] = this.data[p];
                    this.data[p] = tmp;
                    i = p;
                } else {
                    break;
                }
            }
        }
        down(i: number) {
            const len = this.data.length;
            while (true) {
                let minIdx = i;
                const left = (i << 1) + 1;
                const right = (i << 1) + 2;
                if (left < len && this.compare(this.data[left], this.data[minIdx])) {
                    minIdx = left;
                }
                if (right < len && this.compare(this.data[right], this.data[minIdx])) {
                    minIdx = right;
                }
                if (minIdx !== i) {
                    const tmp = this.data[i];
                    this.data[i] = this.data[minIdx];
                    this.data[minIdx] = tmp;
                    i = minIdx;
                } else {
                    break;
                }
            }
        }
        compare(a: HeapElem, b: HeapElem): boolean {
            return a.t < b.t;
        }
    }

    const KNOWN = 0;
    const BAND = 1;
    const INSIDE = 2;

    // Unified 2D Eikonal equation solver.
    // Computes the front distance T based on horizontal and vertical neighbors.
    export function solve(i: number, j: number, f: Uint8Array, t: Float32Array, ecols: number): number {
        const idx = i * ecols + j;
        
        // Exclude unmasked boundary pixels (distance is -1.0) from participating in distance map solving
        const t_top = (f[idx - ecols] !== INSIDE && t[idx - ecols] >= 0.0) ? t[idx - ecols] : 1e6;
        const t_bottom = (f[idx + ecols] !== INSIDE && t[idx + ecols] >= 0.0) ? t[idx + ecols] : 1e6;
        const t_left = (f[idx - 1] !== INSIDE && t[idx - 1] >= 0.0) ? t[idx - 1] : 1e6;
        const t_right = (f[idx + 1] !== INSIDE && t[idx + 1] >= 0.0) ? t[idx + 1] : 1e6;

        const ux = Math.min(t_top, t_bottom);
        const uy = Math.min(t_left, t_right);
        if (ux >= 1e6 && uy >= 1e6) {
            return 1e6;
        }

        const u0 = Math.min(ux, uy);
        const u1 = Math.max(ux, uy);
        const diff = u1 - u0;

        if (diff >= 1.0) {
            return u0 + 1.0;
        } else {
            return (ux + uy + Math.sqrt(2.0 - diff * diff)) * 0.5;
        }
    }

    function get1DGaussianKernel(sigma: number): { kernel: Float32Array; size: number; radius: number } {
        const s = Math.max(Math.round(2 * sigma), 1);
        const size = 2 * s + 1;
        const g = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            const x = i - s;
            g[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        }
        return { kernel: g, size, radius: s };
    }

    function smoothSeparable(
        src: Float32Array | Uint8ClampedArray,
        dst: Float32Array,
        w: number,
        h: number,
        stride: number,
        offset: number,
        gKernel: Float32Array,
        radius: number
    ) {
        const temp = new Float32Array(w * h);
        // Horizontal pass (strictly additive, matching native BCT formulation)
        for (let y = 0; y < h; y++) {
            const yOff = y * w;
            for (let x = 0; x < w; x++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const nx = x + k;
                    if (nx >= 0 && nx < w) {
                        sum += src[(yOff + nx) * stride + offset] * gKernel[k + radius];
                    }
                }
                temp[yOff + x] = sum;
            }
        }
        // Vertical pass
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                let sum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const ny = y + k;
                    if (ny >= 0 && ny < h) {
                        sum += temp[ny * w + x] * gKernel[k + radius];
                    }
                }
                dst[(y * w + x) * stride + offset] = sum;
            }
        }
    }

    export function inpaint(
        layer: Layer,
        maskCanvas: HTMLCanvasElement,
        range: number,
        kappa: number,
        sigma: number,
        tensorRadius: number,
        softness: number
    ) {
        const width = layer.canvas.width;
        const height = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, width, height);
        const outData = imgData.data;

        // Preserve original background pixels before clearing masks
        const originalPixels = new Uint8ClampedArray(outData);

        const mCtx = maskCanvas.getContext('2d')!;
        const mImgData = mCtx.getImageData(0, 0, width, height);
        const mPixels = mImgData.data;

        const ecols = width + 2;
        const erows = height + 2;
        const f = new Uint8Array(erows * ecols);
        const t = new Float32Array(erows * ecols);
        t.fill(1e6);

        let hasMask = false;
        for (let y = 0; y < height; y++) {
            const rowOffset = y * width;
            const paddedRowOffset = (y + 1) * ecols;
            for (let x = 0; x < width; x++) {
                if (mPixels[(rowOffset + x) * 4 + 3] > 10) {
                    f[paddedRowOffset + x + 1] = INSIDE;
                    hasMask = true;
                }
            }
        }

        if (!hasMask) return;

        // Clear masked pixels inside the target image to 0
        // so they do not contaminate pre-smoothing or propagate any original pixels/contours
        for (let i = 0; i < width * height; i++) {
            if (mPixels[i * 4 + 3] > 10) {
                outData[i * 4] = 0;
                outData[i * 4 + 1] = 0;
                outData[i * 4 + 2] = 0;
                outData[i * 4 + 3] = 0;
            }
        }

        // Domain classification
        const Domain = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            Domain[i] = mPixels[i * 4 + 3] > 10 ? 0.0 : 1.0;
        }

        // Initialize unmasked (KNOWN) pixels to t = -1.0 so they are included in structure tensor lookups
        for (let y = 1; y <= height; y++) {
            const paddedRowOffset = y * ecols;
            for (let x = 1; x <= width; x++) {
                const idx = paddedRowOffset + x;
                if (f[idx] === KNOWN) {
                    t[idx] = -1.0;
                }
            }
        }

        // Initialize FMM Band indices
        const bandIndices: number[] = [];
        for (let y = 1; y <= height; y++) {
            for (let x = 1; x <= width; x++) {
                const idx = y * ecols + x;
                if (f[idx] === INSIDE) {
                    const neighbors = [idx - 1, idx + 1, idx - ecols, idx + ecols];
                    let hasKnownNeighbor = false;
                    for (const nIdx of neighbors) {
                        if (f[nIdx] === KNOWN) {
                            hasKnownNeighbor = true;
                            break;
                        }
                    }
                    if (hasKnownNeighbor) {
                        f[idx] = BAND;
                        t[idx] = 0.0;
                        bandIndices.push(idx);
                    }
                }
            }
        }

        // Order mapping via FMM Eikonal equation
        const heap = new PriorityQueue();
        for (const idx of bandIndices) {
            const y = Math.floor(idx / ecols);
            const x = idx % ecols;
            heap.push(x, y, 0.0, idx);
        }

        const ordered_points: { x: number; y: number; t: number; idx: number }[] = [];

        while (heap.data.length > 0) {
            const popped = heap.pop()!;
            const idx = popped.idx;
            if (f[idx] !== BAND) continue;

            f[idx] = KNOWN;
            ordered_points.push({ x: popped.x, y: popped.y, t: popped.t, idx });

            const neighbors = [idx - 1, idx + 1, idx - ecols, idx + ecols];
            for (const nIdx of neighbors) {
                const i = Math.floor(nIdx / ecols);
                const j = nIdx % ecols;
                if (i <= 0 || j <= 0 || i > height || j > width) continue;

                if (f[nIdx] === INSIDE) {
                    f[nIdx] = BAND;
                    const dist = solve(i, j, f, t, ecols);
                    t[nIdx] = dist;
                    heap.push(j, i, dist, nIdx);
                } else if (f[nIdx] === BAND) {
                    const dist = solve(i, j, f, t, ecols);
                    if (dist < t[nIdx]) {
                        t[nIdx] = dist;
                        heap.push(j, i, dist, nIdx);
                    }
                }
            }
        }

        // Initialize pre-smoothed buffers
        const MDomain = new Float32Array(width * height);
        const MImage = new Float32Array(width * height * 4);
        const gKernel = get1DGaussianKernel(sigma);

        smoothSeparable(Domain, MDomain, width, height, 1, 0, gKernel.kernel, gKernel.radius);
        for (let c = 0; c < 4; c++) {
            smoothSeparable(outData, MImage, width, height, 4, c, gKernel.kernel, gKernel.radius);
        }

        // Prepare Tensor Scale Aggregation Gaussian Kernel
        const tKernel = get1DGaussianKernel(tensorRadius);

        const getValNorm = (px: number, py: number, ch: number) => {
            const idx = py * width + px;
            const denom = MDomain[idx];
            if (denom > 1e-15) {
                return MImage[idx * 4 + ch] / denom;
            }
            return 0;
        };

        // Reset tracking states in f for the propagation phase
        f.fill(KNOWN);
        for (let y = 0; y < height; y++) {
            const paddedRowOffset = (y + 1) * ecols;
            for (let x = 0; x < width; x++) {
                if (mPixels[(y * width + x) * 4 + 3] > 10) {
                    f[paddedRowOffset + x + 1] = INSIDE;
                }
            }
        }

        // Implement Parallel Level-Set update mapping
        let kold = 0;
        let Told = ordered_points.length > 0 ? ordered_points[0].t : 0;

        // BCT Inpainting Main Propagator Loop
        for (let k = 0; k < ordered_points.length; k++) {
            const curr = ordered_points[k];
            const Tact = curr.t;

            if (Tact > Told) {
                // Finalize all completed pixels of the previous level set (Told) before computing the next
                for (let kk = kold; kk < k; kk++) {
                    const prev = ordered_points[kk];
                    const px = prev.x - 1;
                    const py = prev.y - 1;
                    const pidx_curr = prev.idx;
                    const p_indexx = py * width + px;

                    Domain[p_indexx] = 1.0;

                    // Smooth Update
                    const s = gKernel.radius;
                    for (let yi = py - s; yi <= py + s; yi++) {
                        if (yi < 0 || yi >= height) continue;
                        const iWeight = gKernel.kernel[py - yi + s];
                        for (let xj = px - s; xj <= px + s; xj++) {
                            if (xj < 0 || xj >= width) continue;
                            const jWeight = gKernel.kernel[px - xj + s];
                            const weight = iWeight * jWeight;

                            const indexy = yi * width + xj;
                            for (let c = 0; c < 4; c++) {
                                MImage[indexy * 4 + c] += weight * outData[p_indexx * 4 + c];
                            }
                            MDomain[indexy] += weight;
                        }
                    }

                    f[pidx_curr] = KNOWN;
                }
                kold = k;
                Told = Tact;
            }

            const x = curr.x - 1; // mapping back to 0-based
            const y = curr.y - 1;
            const idx_curr = curr.idx;
            const indexx = y * width + x;

            // Compute Modified Structure Tensor ST at (x, y)
            let ST11 = 0, ST12 = 0, ST22 = 0;
            let weightSum = 0;

            const tRadius = tKernel.radius;
            for (let dy = -tRadius; dy <= tRadius; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= height) continue;
                for (let dx = -tRadius; dx <= tRadius; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= width) continue;

                    // Condition: neighbor must have been finalized before current point
                    const nIdx_padded = (ny + 1) * ecols + (nx + 1);
                    if (t[nIdx_padded] >= t[idx_curr]) continue;

                    let vs0 = 0, vs1 = 0, vs2 = 0;
                    for (let c = 0; c < 3; c++) { // color channels only (R, G, B)
                        let u0_x = 0;
                        if (nx === 0 || MDomain[ny * width + nx - 1] === 0) {
                            u0_x = getValNorm(nx, ny, c);
                        } else {
                            u0_x = getValNorm(nx - 1, ny, c);
                        }

                        let u1_x = 0;
                        if (nx === width - 1 || MDomain[ny * width + nx + 1] === 0) {
                            u1_x = getValNorm(nx, ny, c);
                        } else {
                            u1_x = getValNorm(nx + 1, ny, c);
                        }
                        const g_x = (u1_x - u0_x) * 0.5;

                        let u0_y = 0;
                        if (ny === 0 || MDomain[(ny - 1) * width + nx] === 0) {
                            u0_y = getValNorm(nx, ny, c);
                        } else {
                            u0_y = getValNorm(nx, ny - 1, c);
                        }

                        let u1_y = 0;
                        if (ny === height - 1 || MDomain[(ny + 1) * width + nx] === 0) {
                            u1_y = getValNorm(nx, ny, c);
                        } else {
                            u1_y = getValNorm(nx, ny + 1, c);
                        }
                        const g_y = (u1_y - u0_y) * 0.5;

                        vs0 += g_x * g_x / 3.0;
                        vs1 += g_x * g_y / 3.0;
                        vs2 += g_y * g_y / 3.0;
                    }

                    const kWeight = tKernel.kernel[dy + tRadius] * tKernel.kernel[dx + tRadius];
                    ST11 += kWeight * vs0;
                    ST12 += kWeight * vs1;
                    ST22 += kWeight * vs2;
                    weightSum += kWeight;
                }
            }

            if (weightSum > 0) {
                ST11 /= weightSum;
                ST12 /= weightSum;
                ST22 /= weightSum;
            }

            // Step 3: Analytical Anisotropic Guidance Tensor G calculation
            const diff = ST11 - ST22;
            const coh_meas = diff * diff + 4 * ST12 * ST12;
            const coh_meas_sqrt = Math.sqrt(coh_meas);

            let confidence = 0;
            if (coh_meas > 1e-15) {
                confidence = Math.exp(-1.0 / coh_meas) / coh_meas_sqrt;
            }

            const G11 = 0.5 * confidence * (diff + coh_meas_sqrt);
            const G12 = confidence * ST12;
            const G22 = 0.5 * confidence * (-diff + coh_meas_sqrt);

            // Step 4: Bilateral Isophote Weighted Blend
            let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
            let weightSumBilateral = 0;

            for (let ny = y - range; ny <= y + range; ny++) {
                if (ny < 0 || ny >= height) continue;
                const v_y = ny - y;
                for (let nx = x - range; nx <= x + range; nx++) {
                    if (nx < 0 || nx >= width) continue;
                    const v_x = nx - x;

                    const rLen = Math.sqrt(v_x * v_x + v_y * v_y);
                    if (rLen > range || rLen < 1e-5) continue;

                    const nIdx_padded = (ny + 1) * ecols + (nx + 1);
                    if (f[nIdx_padded] !== KNOWN) continue;

                    if (t[nIdx_padded] === t[idx_curr]) continue;

                    const z = (kappa / range) * (kappa / range) * (G11 * v_x * v_x + 2 * G12 * v_x * v_y + G22 * v_y * v_y);
                    let w = Math.exp(-z * 0.5) / rLen;

                    w = 1.0 + (1.844674407370955e19 * w);

                    const nIdx = ny * width + nx;
                    rSum += w * outData[nIdx * 4];
                    gSum += w * outData[nIdx * 4 + 1];
                    bSum += w * outData[nIdx * 4 + 2];
                    aSum += w * outData[nIdx * 4 + 3];
                    weightSumBilateral += w;
                }
            }

            if (weightSumBilateral > 0) {
                outData[indexx * 4] = Math.max(0, Math.min(255, Math.round(rSum / weightSumBilateral)));
                outData[indexx * 4 + 1] = Math.max(0, Math.min(255, Math.round(gSum / weightSumBilateral)));
                outData[indexx * 4 + 2] = Math.max(0, Math.min(255, Math.round(bSum / weightSumBilateral)));
                outData[indexx * 4 + 3] = Math.max(0, Math.min(255, Math.round(aSum / weightSumBilateral)));
            }
        }

        // Finalize any remaining trailing group of pixels
        for (let kk = kold; kk < ordered_points.length; kk++) {
            const prev = ordered_points[kk];
            const px = prev.x - 1;
            const py = prev.y - 1;
            const pidx_curr = prev.idx;
            const p_indexx = py * width + px;

            Domain[p_indexx] = 1.0;

            const s = gKernel.radius;
            for (let yi = py - s; yi <= py + s; yi++) {
                if (yi < 0 || yi >= height) continue;
                const iWeight = gKernel.kernel[py - yi + s];
                for (let xj = px - s; xj <= px + s; xj++) {
                    if (xj < 0 || xj >= width) continue;
                    const jWeight = gKernel.kernel[px - xj + s];
                    const weight = iWeight * jWeight;

                    const indexy = yi * width + xj;
                    for (let c = 0; c < 4; c++) {
                        MImage[indexy * 4 + c] += weight * outData[p_indexx * 4 + c];
                    }
                    MDomain[indexy] += weight;
                }
            }
            f[pidx_curr] = KNOWN;
        }

        // Apply feather blend to edges using preserved original background values
        const blendMask = computeFeatheredMask(maskCanvas, width, height, softness);
        for (let i = 0; i < width * height; i++) {
            const weight = blendMask[i];
            if (weight < 1.0) {
                const idx = i * 4;
                outData[idx]     = Math.max(0, Math.min(255, Math.round(originalPixels[idx]     * (1 - weight) + outData[idx]     * weight)));
                outData[idx + 1] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 1] * (1 - weight) + outData[idx + 1] * weight)));
                outData[idx + 2] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 2] * (1 - weight) + outData[idx + 2] * weight)));
                outData[idx + 3] = Math.max(0, Math.min(255, Math.round(originalPixels[idx + 3] * (1 - weight) + outData[idx + 3] * weight)));
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }
}