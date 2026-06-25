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
            const syRaw = y - padY;
            const sy = getCoord(syRaw, srcH);
            if (sy === -1) {
                out.push(row);
                continue;
            }
            for (let x = 0; x < targetW; x++) {
                const sxRaw = x - padX;
                const sx = getCoord(sxRaw, srcW);
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

    // Computes Edges/Gradients. Returns 2D array of Magnitude.
    // Uses Central Difference: (f(x+1) - f(x-1)) / 2
    computeGradients(flatData: Float32Array | number[], w: number, h: number, targetSize: number, useWindow: boolean = true): Float32Array[] {
        const out: Float32Array[] = [];
        for(let y = 0; y < targetSize; y++) out.push(new Float32Array(targetSize));
        if (w < 3 || h < 3) return out;
        const offY = Math.floor((targetSize - h) / 2);
        const offX = Math.floor((targetSize - w) / 2);
        for(let y = 1; y < h - 1; y++) {
            const outY = y + offY;
            if (outY < 0 || outY >= targetSize) continue;
            const winY = useWindow ? 0.5 * (1 - Math.cos(2 * Math.PI * y / (h - 1))) : 1.0;
            const rowStart = y * w;
            for(let x = 1; x < w - 1; x++) {
                const outX = x + offX;
                if (outX < 0 || outX >= targetSize) continue;
                const winX = useWindow ? 0.5 * (1 - Math.cos(2 * Math.PI * x / (w - 1))) : 1.0;
                const i = rowStart + x;
                const gx = (flatData[i + 1] - flatData[i - 1]) * 0.5;
                const gy = (flatData[i + w] - flatData[i - w]) * 0.5;
                const mag = Math.sqrt(gx * gx + gy * gy);
                out[outY][outX] = mag * winY * winX;
            }
        }
        return out;
    }
};