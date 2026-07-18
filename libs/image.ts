export type InterpolationType = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos3';
export type BoundaryMode = 'constant' | 'clamp' | 'wrap' | 'reflect';

export interface ImageRGBA8 {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface DeformOptions {
    interpolation?: InterpolationType;
    boundary?: BoundaryMode;
    cval?: number;
    antialiasing?: boolean; // 2x2 grid super-sampling
}

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + 
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + 
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
};

const l_sinc = (x: number) => {
    if (x === 0) return 1;
    const px = Math.PI * x;
    return Math.sin(px) / px;
};

const l_weight = (x: number) => {
    if (x < 0) x = -x;
    if (x >= 3) return 0;
    return l_sinc(x) * l_sinc(x / 3);
};

export const image = {
    // Converts RGBA ImageData to Float32 Grayscale (0.0 - 1.0)
    // Options: { method: 'rec601' | 'rec709' | 'average', gamma: number }
    toGrayscale(data: Uint8ClampedArray | Uint8Array, w: number, h: number, options: any = {}): Float32Array {
        const { method = 'rec601', gamma = null } = options;
        const allWeights: Record<string, number[]> = {
            rec601:  [0.299, 0.587, 0.114],
            rec709:  [0.2126, 0.7152, 0.0722],
            average: [0.333, 0.333, 0.333]
        };
        const weights = allWeights[method] || allWeights['rec709'];
        const [wR, wG, wB] = weights;
        const gray = new Float32Array(w * h);
        if (!gamma) {
            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                gray[i] = (data[idx] * wR + data[idx + 1] * wG + data[idx + 2] * wB) / 255;
            }
        } else {
            const lut = new Float32Array(256);
            for (let i = 0; i < 256; i++) lut[i] = Math.pow(i / 255, gamma);
            const invG = 1 / gamma;
            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                const lin = lut[data[idx]] * wR + lut[data[idx + 1]] * wG + lut[data[idx + 2]] * wB;
                gray[i] = Math.pow(lin, invG);
            }
        }
        return gray;
    },

    // Calculates a histogram for an array of values with specified bins and range.
    histogram(data: Float32Array | Uint8ClampedArray | Uint8Array | number[], options: { bins?: number; range?: [number, number] } = {}): Uint32Array {
        const bins = options.bins ?? 256;
        const range = options.range ?? [0, 255];
        const [min, max] = range;
        const hist = new Uint32Array(bins);
        const len = data.length;
        const span = max - min;
        if (span <= 0) {
            if (len > 0) {
                const val = data[0];
                if (val >= min && val <= max) {
                    hist[0] = len;
                }
            }
            return hist;
        }
        for (let i = 0; i < len; i++) {
            const v = data[i];
            if (v >= min && v <= max) {
                let binIdx = Math.floor(((v - min) / span) * bins);
                if (binIdx >= bins) binIdx = bins - 1;
                if (binIdx < 0) binIdx = 0;
                hist[binIdx]++;
            }
        }
        return hist;
    },

    // Extracts a single channel from RGBA data into a Float32Array (0-255).
    extractChannel(rgbaData: Uint8ClampedArray | Uint8Array, w: number, h: number, channel: number): Float32Array {
        const out = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
            out[i] = rgbaData[i * 4 + channel];
        }
        return out;
    },

    // Writes a 2D float array (Source) back into a specific channel of RGBA data (Target).
    writeChannel(targetData: Uint8ClampedArray | Uint8Array, source2D: Float32Array[] | number[][], w: number, h: number, channel: number) {
        const sH = source2D.length;
        if (sH === 0) return;
        const sW = source2D[0].length;
        const padY = Math.floor((sH - h) / 2);
        const padX = Math.floor((sW - w) / 2);
        for (let y = 0; y < h; y++) {
            const sy = y + padY;
            if (sy < 0 || sy >= sH) continue;
            const srcRow = source2D[sy];
            for (let x = 0; x < w; x++) {
                const sx = x + padX;
                if (sx < 0 || sx >= sW) continue;
                let val = srcRow[sx];
                targetData[(y * w + x) * 4 + channel] = val < 0 ? 0 : (val > 255 ? 255 : val);
            }
        }
    },

    // Pads a 1D flat image array into a 2D array of specific size. Centers the image.
    // Modes: 'constant' (0), 'symmetric' (repeat edge), 'reflect' (mirror without repeat).
    padTo2D(flatData: Float32Array | Uint8ClampedArray | Uint8Array | number[], srcW: number, srcH: number, targetW: number, targetH: number, mode: string = 'constant'): Float32Array[] {
        const out: Float32Array[] = [];
        const padX = Math.floor((targetW - srcW) / 2);
        const padY = Math.floor((targetH - srcH) / 2);
        const getCoord = (c: number, max: number) => {
            if (c >= 0 && c < max) return c;
            if (mode === 'constant') return -1;
            if (mode === 'symmetric') { // Repeat edge: ba|abc|cb
                const period = 2 * max;
                c = (c % period + period) % period;
                if (c >= max) c = period - 1 - c;
                return c;
            } else if (mode === 'reflect' || mode === 'mirror') { // No repeat: cb|abc|ba
                if (max <= 1) return 0;
                const period = 2 * (max - 1);
                c = (c % period + period) % period;
                if (c >= max) c = period - c;
                return c;
            }
            return Math.max(0, Math.min(max - 1, c));
        };

        for (let y = 0; y < targetH; y++) {
            const row = new Float32Array(targetW);
            const sy = getCoord(y - padY, srcH);
            if (sy === -1) {
                out.push(row);
                continue;
            }
            for (let x = 0; x < targetW; x++) {
                const sx = getCoord(x - padX, srcW);
                if (sx !== -1) {
                    row[x] = flatData[sy * srcW + sx];
                }
            }
            out.push(row);
        }
        return out;
    },

    // 1D Convolution with configurable boundary mode.
    // mode - 'reflect', 'symmetric', 'constant', 'nearest', 'wrap'
    convolve1d(data: Float32Array | number[], w: number, h: number, kernel: Float32Array | number[], vertical: boolean, mode: string = 'reflect'): Float32Array {
        const len = kernel.length, rad = len >> 1;
        const stride = vertical ? w : 1;
        const limit = vertical ? h : w;
        const perp = vertical ? w : h;
        const out = new Float32Array(data.length);
        const isReflect = mode === 'mirror' || mode === 'reflect';
        const isSymmetric = mode === 'symmetric';
        const isWrap = mode === 'wrap';
        const isNearest = mode === 'nearest';
        const isConstant = mode === 'constant';
        const mReflect = isReflect ? (2 * (limit - 1) || 1) : 0;
        const mSym = isSymmetric ? (2 * limit) : 0;

        for (let p = 0; p < perp; p++) {
            const offset = vertical ? p : p * w;
            for (let i = 0; i < limit; i++) {
                let sum = 0;
                for (let k = 0; k < len; k++) {
                    let idx = i + k - rad;
                    if (idx < 0 || idx >= limit) {
                        if (isConstant) continue;
                        if (isNearest) {
                            idx = idx < 0 ? 0 : limit - 1;
                        } else if (isWrap) {
                            idx = (idx % limit + limit) % limit;
                        } else if (isReflect) {
                            idx = (idx % mReflect + mReflect) % mReflect;
                            if (idx >= limit) idx = mReflect - idx;
                        } else if (isSymmetric) {
                            idx = (idx % mSym + mSym) % mSym;
                            if (idx >= limit) idx = mSym - 1 - idx;
                        }
                    }
                    sum += data[offset + idx * stride] * kernel[k];
                }
                out[offset + i * stride] = sum;
            }
        }
        return out;
    },

    rgbToLab(r: number, g: number, b: number): [number, number, number] {
        let r_n = r / 255, g_n = g / 255, b_n = b / 255;
        r_n = r_n > 0.04045 ? Math.pow((r_n + 0.055) / 1.055, 2.4) : r_n / 12.92;
        g_n = g_n > 0.04045 ? Math.pow((g_n + 0.055) / 1.055, 2.4) : g_n / 12.92;
        b_n = b_n > 0.04045 ? Math.pow((b_n + 0.055) / 1.055, 2.4) : b_n / 12.92;
        const x = r_n * 0.4124564 + g_n * 0.3575761 + b_n * 0.1804375;
        const y = r_n * 0.2126729 + g_n * 0.7151522 + b_n * 0.0721750;
        const z = r_n * 0.0193339 + g_n * 0.1191920 + b_n * 0.9503041;
        const xr = x / 0.95047, yr = y / 1.00000, zr = z / 1.08883;
        const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
        const fx = f(xr), fy = f(yr), fz = f(zr);
        const L = fy > 0.008856 ? 116 * fy - 16 : 903.3 * yr;
        const a = 500 * (fx - fy);
        const b_val = 200 * (fy - fz);
        return [L, a, b_val];
    },

    convertRgbToLab(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
        const size = w * h;
        const lab = new Float32Array(size * 3);
        for (let i = 0; i < size; i++) {
            const idx = i * 4;
            const [L, a, b] = this.rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
            lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
        }
        return lab;
    },

    rgbToHsv(r: number, g: number, b: number): [number, number, number] {
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === rn) h = ((gn - bn) / d) % 6;
            else if (max === gn) h = (bn - rn) / d + 2;
            else h = (rn - gn) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return [h, max === 0 ? 0 : d / max, max];
    },

    hsvToRgb(h: number, s: number, v: number): [number, number, number] {
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    },

    sampleNearest(data: Uint8ClampedArray | Uint8Array, w: number, h: number, x: number, y: number, c: number): number {
        let sx = Math.round(x);
        let sy = Math.round(y);
        if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        return data[(sy * w + sx) * 4 + c];
    },

    sampleBilinear(data: Uint8ClampedArray | Uint8Array, w: number, h: number, u: number, v: number, c: number): number {
        const x0 = Math.floor(u);
        const y0 = Math.floor(v);
        const x1 = Math.min(w - 1, x0 + 1);
        const y1 = Math.min(h - 1, y0 + 1);
        const dx = u - x0;
        const dy = v - y0;
        const getVal = (x: number, y: number) => {
            const sx = x < 0 ? 0 : (x >= w ? w - 1 : x);
            const sy = y < 0 ? 0 : (y >= h ? h - 1 : y);
            return data[(sy * w + sx) * 4 + c];
        };
        const top = getVal(x0, y0) * (1 - dx) + getVal(x1, y0) * dx;
        const bot = getVal(x0, y1) * (1 - dx) + getVal(x1, y1) * dx;
        return top * (1 - dy) + bot * dy;
    },

    sampleBicubic(data: Uint8ClampedArray | Uint8Array, w: number, h: number, u: number, v: number, c: number): number {
        const x0 = Math.floor(u);
        const y0 = Math.floor(v);
        const dx = u - x0;
        const dy = v - y0;
        const getVal = (x: number, y: number) => {
            const sx = x < 0 ? 0 : (x >= w ? w - 1 : x);
            const sy = y < 0 ? 0 : (y >= h ? h - 1 : y);
            return data[(sy * w + sx) * 4 + c];
        };
        const r0 = cubic(getVal(x0 - 1, y0 - 1), getVal(x0, y0 - 1), getVal(x0 + 1, y0 - 1), getVal(x0 + 2, y0 - 1), dx);
        const r1 = cubic(getVal(x0 - 1, y0),     getVal(x0, y0),     getVal(x0 + 1, y0),     getVal(x0 + 2, y0),     dx);
        const r2 = cubic(getVal(x0 - 1, y0 + 1), getVal(x0, y0 + 1), getVal(x0 + 1, y0 + 1), getVal(x0 + 2, y0 + 1), dx);
        const r3 = cubic(getVal(x0 - 1, y0 + 2), getVal(x0, y0 + 2), getVal(x0 + 1, y0 + 2), getVal(x0 + 2, y0 + 2), dx);
        const val = cubic(r0, r1, r2, r3, dy);
        return val < 0 ? 0 : (val > 255 ? 255 : val);
    },

    sampleLanczos3(data: Uint8ClampedArray | Uint8Array, w: number, h: number, u: number, v: number, c: number): number {
        const x0 = Math.floor(u);
        const y0 = Math.floor(v);
        let sum = 0, weightSum = 0;
        const getVal = (x: number, y: number) => {
            const sx = x < 0 ? 0 : (x >= w ? w - 1 : x);
            const sy = y < 0 ? 0 : (y >= h ? h - 1 : y);
            return data[(sy * w + sx) * 4 + c];
        };

        for (let j = -2; j <= 3; j++) {
            const sy = y0 + j;
            const wy = l_weight(v - sy);
            if (wy === 0) continue;
            for (let i = -2; i <= 3; i++) {
                const sx = x0 + i;
                const wx = l_weight(u - sx);
                const w_val = wx * wy;
                if (w_val === 0) continue;

                sum += getVal(sx, sy) * w_val;
                weightSum += w_val;
            }
        }

        if (weightSum === 0) return getVal(x0, y0);
        const val = sum / weightSum;
        return val < 0 ? 0 : (val > 255 ? 255 : val);
    },

    boxFilter(data: Float32Array, width: number, height: number, r: number): Float32Array {
        const dest = new Float32Array(data.length);
        const scale = 1 / ((2 * r + 1) * (2 * r + 1));
        const temp = new Float32Array(data.length);
        for (let y = 0; y < height; y++) {
            let sum = 0;
            const offset = y * width;
            for (let x = -r; x <= r; x++) {
                const px = Math.min(width - 1, Math.max(0, x));
                sum += data[offset + px];
            }
            temp[offset] = sum;
            for (let x = 1; x < width; x++) {
                const nextX = Math.min(width - 1, x + r);
                const prevX = Math.max(0, x - r - 1);
                sum += data[offset + nextX] - data[offset + prevX];
                temp[offset + x] = sum;
            }
        }
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let y = -r; y <= r; y++) {
                const py = Math.min(height - 1, Math.max(0, y));
                sum += temp[py * width + x];
            }
            dest[x] = sum * scale;
            for (let y = 1; y < height; y++) {
                const nextY = Math.min(height - 1, y + r);
                const prevY = Math.max(0, y - r - 1);
                sum += temp[nextY * width + x] - temp[prevY * width + x];
                dest[y * width + x] = sum * scale;
            }
        }
        return dest;
    },

    guidedFilterGrayscale(I: Float32Array, p: Float32Array, width: number, height: number, r: number, eps: number): Float32Array {
        const meanI = this.boxFilter(I, width, height, r);
        const meanP = this.boxFilter(p, width, height, r);
        const Ip = new Float32Array(I.length);
        const II = new Float32Array(I.length);
        for (let i = 0; i < I.length; i++) {
            Ip[i] = I[i] * p[i];
            II[i] = I[i] * I[i];
        }
        const meanIp = this.boxFilter(Ip, width, height, r);
        const meanII = this.boxFilter(II, width, height, r);
        const covIp = new Float32Array(I.length);
        const varI = new Float32Array(I.length);
        for (let i = 0; i < I.length; i++) {
            covIp[i] = meanIp[i] - meanI[i] * meanP[i];
            varI[i] = meanII[i] - meanI[i] * meanI[i];
        }
        const a = new Float32Array(I.length);
        const b = new Float32Array(I.length);
        for (let i = 0; i < I.length; i++) {
            a[i] = covIp[i] / (varI[i] + eps);
            b[i] = meanP[i] - a[i] * meanI[i];
        }
        const meanA = this.boxFilter(a, width, height, r);
        const meanB = this.boxFilter(b, width, height, r);
        const q = new Float32Array(I.length);
        for (let i = 0; i < I.length; i++) {
            q[i] = meanA[i] * I[i] + meanB[i];
        }
        return q;
    },

    // Generates a 1D Gaussian kernel optimized for separable convolution.
    getGaussianKernel(radius: number): Float32Array {
        const size = radius * 2 + 1;
        const kernel = new Float32Array(size);
        const sigma = Math.max(radius / 2.0, 0.5);
        let sum = 0;
        for (let i = 0; i < size; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }
        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }
        return kernel;
    },

    // Performs high-fidelity Separable 2D Gaussian Blur over a flat 2D Float32Array.
    gaussianBlur(M: Float32Array, w: number, h: number, radius: number, boundary: string = 'reflect'): Float32Array {
        if (radius <= 0) return new Float32Array(M);
        const kernel = this.getGaussianKernel(radius);
        const temp = this.convolve1d(M, w, h, kernel, false, boundary);
        return this.convolve1d(temp, w, h, kernel, true, boundary);
    },

    // Feathers a 2D mask with high-fidelity inner, outer, or standard blur modes.
    featherMask(
        M: Float32Array,
        w: number,
        h: number,
        softness: number,
        mode: 'inner' | 'outer' | 'standard' = 'inner'
    ): Float32Array {
        if (softness <= 0) {
            return new Float32Array(M);
        }
        const B = this.gaussianBlur(M, w, h, softness, 'reflect');
        if (mode === 'standard') {
            return B;
        }

        const out = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const isInside = M[i] >= 0.01;
            if (mode === 'inner') {
                if (isInside) {
                    // Map the blurred values [0.5, 1.0] to [0.0, 1.0] to match the natural boundary
                    const t = Math.max(0.0, (B[i] - 0.5) / 0.5);
                    // Smoothstep the transition for a buttery-smooth gradient starting at exactly 0.0
                    out[i] = t * t * (3 - 2 * t);
                } else {
                    out[i] = 0.0;
                }
            } else { // outer
                if (isInside) {
                    out[i] = M[i];
                } else {
                    // Map the blurred values [0.0, 0.5] to [0.0, 1.0]
                    const t = Math.max(0.0, Math.min(1.0, B[i] / 0.5));
                    // Smoothstep the transition to meet the inner boundary seamlessly at 1.0
                    out[i] = t * t * (3 - 2 * t);
                }
            }
        }
        return out;
    },

    // Consolidated deformation pipeline with monomorphic sampling blocks
    deform(
        src: ImageRGBA8,
        dst: ImageRGBA8,
        mapFunc: (x: number, y: number, cx: number, cy: number) => { u: number; v: number },
        options: DeformOptions = {}
    ): void {
        const {
            interpolation = 'bilinear',
            boundary = 'clamp',
            cval = 0,
            antialiasing = false
        } = options;
        const srcBuf = (src.data === dst.data) ? new Uint8ClampedArray(src.data) : src.data;
        const sW = src.width;
        const sH = src.height;
        const dW = dst.width;
        const dH = dst.height;
        const cx = dW / 2;
        const cy = dH / 2;

        let getVal: (x: number, y: number, c: number) => number;

        if (boundary === 'constant') {
            getVal = (x, y, c) => {
                const sx = (x >= 0 && x < sW) ? x : -1;
                const sy = (y >= 0 && y < sH) ? y : -1;
                if (sx === -1 || sy === -1) return cval;
                return srcBuf[(sy * sW + sx) * 4 + c];
            };
        } else if (boundary === 'clamp') {
            getVal = (x, y, c) => {
                const sx = x < 0 ? 0 : (x >= sW ? sW - 1 : x);
                const sy = y < 0 ? 0 : (y >= sH ? sH - 1 : y);
                return srcBuf[(sy * sW + sx) * 4 + c];
            };
        } else if (boundary === 'wrap') {
            getVal = (x, y, c) => {
                let sx = x % sW; if (sx < 0) sx += sW;
                let sy = y % sH; if (sy < 0) sy += sH;
                return srcBuf[(sy * sW + sx) * 4 + c];
            };
        } else { // reflect
            getVal = (x, y, c) => {
                let sx = x;
                if (sx < 0 || sx >= sW) {
                    if (sW <= 1) sx = 0;
                    else {
                        const doubleMax = 2 * (sW - 1);
                        sx = (sx % doubleMax + doubleMax) % doubleMax;
                        if (sx >= sW) sx = doubleMax - sx;
                    }
                }
                let sy = y;
                if (sy < 0 || sy >= sH) {
                    if (sH <= 1) sy = 0;
                    else {
                        const doubleMax = 2 * (sH - 1);
                        sy = (sy % doubleMax + doubleMax) % doubleMax;
                        if (sy >= sH) sy = doubleMax - sy;
                    }
                }
                return srcBuf[(sy * sW + sx) * 4 + c];
            };
        }

        // Resolves the sampler into a block-scoped constant to guarantee a monomorphic callsite
        const sample = (() => {
            if (interpolation === 'nearest') {
                return (u: number, v: number, out: Uint8ClampedArray | Float32Array, idx: number) => {
                    const sx = Math.round(u);
                    const sy = Math.round(v);
                    out[idx]     = getVal(sx, sy, 0);
                    out[idx + 1] = getVal(sx, sy, 1);
                    out[idx + 2] = getVal(sx, sy, 2);
                    out[idx + 3] = getVal(sx, sy, 3);
                };
            }
            if (interpolation === 'bicubic') {
                return (u: number, v: number, out: Uint8ClampedArray | Float32Array, idx: number) => {
                    const x0 = Math.floor(u);
                    const y0 = Math.floor(v);
                    const dx = u - x0;
                    const dy = v - y0;
                    for (let c = 0; c < 4; c++) {
                        const r0 = cubic(getVal(x0 - 1, y0 - 1, c), getVal(x0, y0 - 1, c), getVal(x0 + 1, y0 - 1, c), getVal(x0 + 2, y0 - 1, c), dx);
                        const r1 = cubic(getVal(x0 - 1, y0,     c), getVal(x0, y0,     c), getVal(x0 + 1, y0,     c), getVal(x0 + 2, y0,     c), dx);
                        const r2 = cubic(getVal(x0 - 1, y0 + 1, c), getVal(x0, y0 + 1, c), getVal(x0 + 1, y0 + 1, c), getVal(x0 + 2, y0 + 1, c), dx);
                        const r3 = cubic(getVal(x0 - 1, y0 + 2, c), getVal(x0, y0 + 2, c), getVal(x0 + 1, y0 + 2, c), getVal(x0 + 2, y0 + 2, c), dx);
                        const val = cubic(r0, r1, r2, r3, dy);
                        out[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : val);
                    }
                };
            }
            if (interpolation === 'lanczos3') {
                const wxs = new Float32Array(6);
                const wys = new Float32Array(6);
                const sums = new Float32Array(4);
                return (u: number, v: number, out: Uint8ClampedArray | Float32Array, idx: number) => {
                    const x0 = Math.floor(u);
                    const y0 = Math.floor(v);
                    for (let i = -2; i <= 3; i++) {
                        wxs[i + 2] = l_weight(u - (x0 + i));
                        wys[i + 2] = l_weight(v - (y0 + i));
                    }
                    sums[0] = sums[1] = sums[2] = sums[3] = 0;
                    let weightSum = 0;
                    for (let j = -2; j <= 3; j++) {
                        const wy = wys[j + 2];
                        if (wy === 0) continue;
                        const sy = y0 + j;
                        for (let i = -2; i <= 3; i++) {
                            const wx = wxs[i + 2];
                            const w_val = wx * wy;
                            if (w_val === 0) continue;
                            const sx = x0 + i;
                            sums[0] += getVal(sx, sy, 0) * w_val;
                            sums[1] += getVal(sx, sy, 1) * w_val;
                            sums[2] += getVal(sx, sy, 2) * w_val;
                            sums[3] += getVal(sx, sy, 3) * w_val;
                            weightSum += w_val;
                        }
                    }
                    if (weightSum === 0) {
                        out[idx]     = getVal(x0, y0, 0);
                        out[idx + 1] = getVal(x0, y0, 1);
                        out[idx + 2] = getVal(x0, y0, 2);
                        out[idx + 3] = getVal(x0, y0, 3);
                    } else {
                        const invWeight = 1 / weightSum;
                        for (let c = 0; c < 4; c++) {
                            const val = sums[c] * invWeight;
                            out[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : val);
                        }
                    }
                };
            }
            // bilinear fallback
            return (u: number, v: number, out: Uint8ClampedArray | Float32Array, idx: number) => {
                const x0 = Math.floor(u);
                const y0 = Math.floor(v);
                const x1 = x0 + 1;
                const y1 = y0 + 1;
                const dx = u - x0;
                const dy = v - y0;
                const w00 = (1 - dx) * (1 - dy);
                const w10 = dx * (1 - dy);
                const w01 = (1 - dx) * dy;
                const w11 = dx * dy;
                out[idx]     = getVal(x0, y0, 0) * w00 + getVal(x1, y0, 0) * w10 + getVal(x0, y1, 0) * w01 + getVal(x1, y1, 0) * w11;
                out[idx + 1] = getVal(x0, y0, 1) * w00 + getVal(x1, y0, 1) * w10 + getVal(x0, y1, 1) * w01 + getVal(x1, y1, 1) * w11;
                out[idx + 2] = getVal(x0, y0, 2) * w00 + getVal(x1, y0, 2) * w10 + getVal(x0, y1, 2) * w01 + getVal(x1, y1, 2) * w11;
                out[idx + 3] = getVal(x0, y0, 3) * w00 + getVal(x1, y0, 3) * w10 + getVal(x0, y1, 3) * w01 + getVal(x1, y1, 3) * w11;
            };
        })();

        if (antialiasing) {
            const temp = new Float32Array(4);
            const subOffsets = [-0.25, 0.25];
            for (let y = 0; y < dH; y++) {
                for (let x = 0; x < dW; x++) {
                    const idx = (y * dW + x) * 4;
                    let r = 0, g = 0, b = 0, a = 0;

                    for (let dy = 0; dy < 2; dy++) {
                        const py = y + subOffsets[dy];
                        for (let dx = 0; dx < 2; dx++) {
                            const px = x + subOffsets[dx];
                            const { u, v } = mapFunc(px, py, cx, cy);

                            if (boundary === 'constant' && (u < -1 || u > sW || v < -1 || v > sH)) {
                                r += cval; g += cval; b += cval; a += cval;
                            } else {
                                sample(u, v, temp, 0);
                                r += temp[0]; g += temp[1]; b += temp[2]; a += temp[3];
                            }
                        }
                    }

                    dst.data[idx]     = r * 0.25;
                    dst.data[idx + 1] = g * 0.25;
                    dst.data[idx + 2] = b * 0.25;
                    dst.data[idx + 3] = a * 0.25;
                }
            }
        } else {
            for (let y = 0; y < dH; y++) {
                for (let x = 0; x < dW; x++) {
                    const { u, v } = mapFunc(x, y, cx, cy);
                    const idx = (y * dW + x) * 4;
                    if (boundary === 'constant' && (u < -1 || u > sW || v < -1 || v > sH)) {
                        dst.data[idx] = dst.data[idx + 1] = dst.data[idx + 2] = dst.data[idx + 3] = cval;
                        continue;
                    }
                    sample(u, v, dst.data, idx);
                }
            }
        }
    }
};
