import { Layer } from '~/layers';
import { computeFeatheredMask } from './utils';

// TELEA FAST MARCHING METHOD (FMM) INPAINTING SOLVER
export namespace TeleaFMM {
    export class HeapElem {
        constructor(
            public x: number,
            public y: number,
            public t: number,
            public order: number
        ) {}
    }

    export class PriorityQueue {
        data: HeapElem[] = [];
        push(x: number, y: number, t: number, order: number) {
            this.data.push(new HeapElem(x, y, t, order));
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
            if (a.t !== b.t) return a.t < b.t;
            return a.order < b.order;
        }
    }

    const KNOWN = 0;
    const BAND = 1;
    const INSIDE = 2;
    const CHANGE = 3;

    function min4(a: number, b: number, c: number, d: number): number {
        return Math.min(Math.min(a, b), Math.min(c, d));
    }

    export function fastMarchingSolve(i1: number, j1: number, i2: number, j2: number, f: Uint8Array, t: Float32Array, ecols: number): number {
        const idx1 = i1 * ecols + j1;
        const idx2 = i2 * ecols + j2;
        const a11 = t[idx1];
        const a22 = t[idx2];
        const m12 = Math.min(a11, a22);

        if (f[idx1] !== INSIDE) {
            if (f[idx2] !== INSIDE) {
                if (Math.abs(a11 - a22) >= 1.0) {
                    return 1.0 + m12;
                } else {
                    return (a11 + a22 + Math.sqrt(2.0 - (a11 - a22) * (a11 - a22))) * 0.5;
                }
            } else {
                return 1.0 + a11;
            }
        } else if (f[idx2] !== INSIDE) {
            return 1.0 + a22;
        } else {
            return 1.0 + m12;
        }
    }

    export function inpaint(
        layer: Layer,
        maskCanvas: HTMLCanvasElement,
        range: number,
        softness: number
    ) {
        const width = layer.canvas.width;
        const height = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, width, height);
        const outData = imgData.data;

        const mCtx = maskCanvas.getContext('2d')!;
        const mImgData = mCtx.getImageData(0, 0, width, height);
        const mPixels = mImgData.data;

        const ecols = width + 2;
        const erows = height + 2;
        const f = new Uint8Array(erows * ecols);
        const t = new Float32Array(erows * ecols);
        t.fill(1e6);

        const out = new Uint8Array(erows * ecols);

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

        const bandIndices: number[] = [];
        for (let y = 1; y <= height; y++) {
            for (let x = 1; x <= width; x++) {
                const idx = y * ecols + x;
                if (f[idx] === KNOWN) {
                    if (f[idx - 1] === INSIDE || f[idx + 1] === INSIDE || f[idx - ecols] === INSIDE || f[idx + ecols] === INSIDE) {
                        bandIndices.push(idx);
                    }
                }
            }
        }

        let order = 0;
        const Heap = new PriorityQueue();
        const OutHeap = new PriorityQueue();

        for (const idx of bandIndices) {
            f[idx] = BAND;
            t[idx] = 0;
            const y = Math.floor(idx / ecols);
            const x = idx % ecols;
            Heap.push(x, y, 0, order);
            OutHeap.push(x, y, 0, order);
            order++;
        }

        for (let i = 0; i < out.length; i++) {
            if (f[i] === KNOWN) {
                out[i] = INSIDE;
            } else {
                out[i] = KNOWN;
            }
        }

        while (true) {
            const popped = OutHeap.pop();
            if (!popped) break;
            const ii = popped.y;
            const jj = popped.x;
            const distVal = popped.t;
            if (distVal > range) continue;

            out[ii * ecols + jj] = CHANGE;

            const neighbors = [
                { y: ii - 1, x: jj },
                { y: ii, x: jj - 1 },
                { y: ii + 1, x: jj },
                { y: ii, x: jj + 1 }
            ];

            for (const { y: i, x: j } of neighbors) {
                if (i <= 0 || j <= 0 || i > height || j > width) continue;
                const idx = i * ecols + j;
                if (out[idx] === INSIDE) {
                    const dist = min4(
                        fastMarchingSolve(i - 1, j, i, j - 1, out, t, ecols),
                        fastMarchingSolve(i + 1, j, i, j - 1, out, t, ecols),
                        fastMarchingSolve(i - 1, j, i, j + 1, out, t, ecols),
                        fastMarchingSolve(i + 1, j, i, j + 1, out, t, ecols)
                    );
                    if (dist <= range) {
                        t[idx] = dist;
                        out[idx] = BAND;
                        OutHeap.push(j, i, dist, order++);
                    }
                }
            }
        }

        for (let i = 0; i < erows; i++) {
            for (let j = 0; j < ecols; j++) {
                const idx = i * ecols + j;
                if (out[idx] === CHANGE || out[idx] === BAND) {
                    out[idx] = KNOWN;
                    t[idx] = -t[idx];
                }
            }
        }

        const getPixel = (y: number, x: number, c: number) => outData[(y * width + x) * 4 + c];
        const originalPixels = new Uint8ClampedArray(outData);

        while (true) {
            const popped = Heap.pop();
            if (!popped) break;
            const ii = popped.y;
            const jj = popped.x;

            f[ii * ecols + jj] = KNOWN;

            const neighbors = [
                { y: ii - 1, x: jj },
                { y: ii, x: jj - 1 },
                { y: ii + 1, x: jj },
                { y: ii, x: jj + 1 }
            ];

            for (const { y: i, x: j } of neighbors) {
                if (i <= 0 || j <= 0 || i > height || j > width) continue;
                const idx = i * ecols + j;

                if (f[idx] === INSIDE) {
                    const dist = min4(
                        fastMarchingSolve(i - 1, j, i, j - 1, f, t, ecols),
                        fastMarchingSolve(i + 1, j, i, j - 1, f, t, ecols),
                        fastMarchingSolve(i - 1, j, i, j + 1, f, t, ecols),
                        fastMarchingSolve(i + 1, j, i, j + 1, f, t, ecols)
                    );
                    t[idx] = dist;

                    const gradT = [0, 0];
                    if (f[i * ecols + j + 1] !== INSIDE) {
                        if (f[i * ecols + j - 1] !== INSIDE) {
                            gradT[0] = (t[i * ecols + j + 1] - t[i * ecols + j - 1]) * 0.5;
                        } else {
                            gradT[0] = t[i * ecols + j + 1] - t[idx];
                        }
                    } else {
                        if (f[i * ecols + j - 1] !== INSIDE) {
                            gradT[0] = t[idx] - t[i * ecols + j - 1];
                        } else {
                            gradT[0] = 0;
                        }
                    }

                    if (f[(i + 1) * ecols + j] !== INSIDE) {
                        if (f[(i - 1) * ecols + j] !== INSIDE) {
                            gradT[1] = (t[(i + 1) * ecols + j] - t[(i - 1) * ecols + j]) * 0.5;
                        } else {
                            gradT[1] = t[(i + 1) * ecols + j] - t[idx];
                        }
                    } else {
                        if (f[(i - 1) * ecols + j] !== INSIDE) {
                            gradT[1] = t[idx] - t[(i - 1) * ecols + j];
                        } else {
                            gradT[1] = 0;
                        }
                    }

                    const gradI = [0, 0];
                    const Jx = [0, 0, 0], Jy = [0, 0, 0], Ia = [0, 0, 0], s = [1e-20, 1e-20, 1e-20];

                    for (let k = i - range; k <= i + range; k++) {
                        const y = k - 1;
                        const ym = y + (y === 0 ? 1 : 0);
                        const yp = y - (y === height - 1 ? 1 : 0);
                        
                        for (let l = j - range; l <= j + range; l++) {
                            const x = l - 1;
                            const xm = x + (x === 0 ? 1 : 0);
                            const xp = x - (x === width - 1 ? 1 : 0);

                            if (k > 0 && l > 0 && k <= height && l <= width) {
                                if (f[k * ecols + l] !== INSIDE && (l - j) * (l - j) + (k - i) * (k - i) <= range * range) {
                                    const r_y = i - k;
                                    const r_x = j - l;
                                    const rLenSq = r_x * r_x + r_y * r_y;
                                    const rLen = Math.sqrt(rLenSq);
                                    
                                    const dst = 1.0 / (rLen * rLenSq);
                                    const lev = 1.0 / (1.0 + Math.abs(t[k * ecols + l] - t[idx]));
                                    let dir = Math.abs(r_x * gradT[0] + r_y * gradT[1]);
                                    if (dir <= 0.01) dir = 0.000001;
                                    const weight = Math.abs(dst * lev * dir);

                                    for (let c = 0; c <= 2; c++) {
                                        if (f[k * ecols + l + 1] !== INSIDE) {
                                            if (f[k * ecols + l - 1] !== INSIDE) {
                                                gradI[0] = (getPixel(ym, xp + 1, c) - getPixel(ym, xm - 1, c)) * 2.0;
                                            } else {
                                                gradI[0] = getPixel(ym, xp + 1, c) - getPixel(ym, xm, c);
                                            }
                                        } else {
                                            if (f[k * ecols + l - 1] !== INSIDE) {
                                                gradI[0] = getPixel(ym, xp, c) - getPixel(ym, xm - 1, c);
                                            } else {
                                                gradI[0] = 0;
                                            }
                                        }
                                        if (f[(k + 1) * ecols + l] !== INSIDE) {
                                            if (f[(k - 1) * ecols + l] !== INSIDE) {
                                                gradI[1] = (getPixel(yp + 1, xm, c) - getPixel(ym - 1, xm, c)) * 2.0;
                                            } else {
                                                gradI[1] = getPixel(yp + 1, xm, c) - getPixel(ym, xm, c);
                                            }
                                        } else {
                                            if (f[(k - 1) * ecols + l] !== INSIDE) {
                                                gradI[1] = getPixel(yp, xm, c) - getPixel(ym - 1, xm, c);
                                            } else {
                                                gradI[1] = 0;
                                            }
                                        }
                                        Ia[c] += weight * getPixel(y, x, c);
                                        Jx[c] -= weight * gradI[0] * r_x;
                                        Jy[c] -= weight * gradI[1] * r_y;
                                        s[c] += weight;
                                    }
                                }
                            }
                        }
                    }

                    for (let c = 0; c <= 2; c++) {
                        const sat = Ia[c] / s[c] + (Jx[c] + Jy[c]) / (Math.sqrt(Jx[c] * Jx[c] + Jy[c] * Jy[c]) + 1e-20);
                        const finalColor = Math.max(0, Math.min(255, Math.round(sat)));
                        outData[((i - 1) * width + (j - 1)) * 4 + c] = finalColor;
                    }
                    outData[((i - 1) * width + (j - 1)) * 4 + 3] = 255;

                    f[idx] = BAND;
                    Heap.push(j, i, dist, order++);
                }
            }
        }

        // Apply feather blend
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