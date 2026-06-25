export const fft = {
    _twiddleCache: new Map<number, Float32Array[]>(),
    _chirpCache: new Map<number, { real: Float32Array; imag: Float32Array }>(),

    /**
     * Performs 2D FFT on a 2D array.
     * @param {number[][]} real - 2D Real part
     * @param {number[][]} [imag] - 2D Imaginary part (optional, defaults to 0)
     * @returns {{re: Float32Array[], im: Float32Array[]}}
     */
    fft2d(real: number[][] | Float32Array[], imag: number[][] | Float32Array[] | null = null): { re: Float32Array[]; im: Float32Array[] } {
        const rows = real.length, cols = real[0].length;
        
        const safeImag = imag || this._create2D(rows, cols);

        let realResult: Float32Array[] = new Array(rows);
        let imagResult: Float32Array[] = new Array(rows);

        // FFT on rows
        for (let i = 0; i < rows; i++) {
            const rowFFT = this.fft1d(real[i], safeImag[i]);
            realResult[i] = rowFFT.re;
            imagResult[i] = rowFFT.im;
        }

        // FFT on columns
        let realCol = new Float32Array(rows), imagCol = new Float32Array(rows);
        for (let j = 0; j < cols; j++) {
            for (let i = 0; i < rows; i++) {
                realCol[i] = realResult[i][j];
                imagCol[i] = imagResult[i][j];
            }
            const colFFT = this.fft1d(realCol, imagCol);
            for (let i = 0; i < rows; i++) {
                realResult[i][j] = colFFT.re[i];
                imagResult[i][j] = colFFT.im[i];
            }
        }
        return { re: realResult, im: imagResult };
    },

    /**
     * Performs 2D Inverse FFT.
     * @returns {{re: Float32Array[], im: Float32Array[]}}
     */
    ifft2d(real: number[][] | Float32Array[], imag: number[][] | Float32Array[]): { re: Float32Array[]; im: Float32Array[] } {
        const rows = real.length, cols = real[0].length;
        
        // Negate imaginary part
        let imagNegated = this._create2D(rows, cols);
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) imagNegated[i][j] = -imag[i][j];
        }

        let fftResult = this.fft2d(real, imagNegated);
        const scale = 1 / (rows * cols);
        
        // Apply scale
        const resRe: Float32Array[] = new Array(rows), resIm: Float32Array[] = new Array(rows);
        for (let i = 0; i < rows; i++) {
            let rRe = fftResult.re[i], rIm = fftResult.im[i];
            let outRe = new Float32Array(cols), outIm = new Float32Array(cols);
            for (let j = 0; j < cols; j++) {
                outRe[j] = rRe[j] * scale;
                outIm[j] = -rIm[j] * scale;
            }
            resRe[i] = outRe;
            resIm[i] = outIm;
        }
        return { re: resRe, im: resIm };
    },

    /**
     * 1D FFT handling both Power-of-2 and Arbitrary sizes.
     */
    fft1d(real: Float32Array | number[], imag: Float32Array | number[]): { re: Float32Array; im: Float32Array } {
        if (!real || !real.length || !imag || !imag.length) throw new Error("Invalid input");
        const n = real.length;
        return this.isPowerOf2(n) ? this._fft1dRadix2(real, imag) : this._dft1dBluestein(real, imag);
    },

    /**
     * 1D Inverse FFT.
     */
    ifft1d(real: Float32Array | number[], imag: Float32Array | number[]): { re: Float32Array; im: Float32Array } {
        const n = real.length;
        let imagCopy = new Float32Array(n);
        for (let i = 0; i < n; i++) imagCopy[i] = -imag[i];
        
        let fftResult = this.isPowerOf2(n)
            ? this._fft1dRadix2(real, imagCopy) 
            : this._dft1dBluestein(real, imagCopy);
        
        const scale = 1 / n;
        const outRe = new Float32Array(n), outIm = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            outRe[i] = fftResult.re[i] * scale;
            outIm[i] = -fftResult.im[i] * scale;
        }
        return { re: outRe, im: outIm };
    },

    // --- DCT ---

    // Computes 1D DCT-II using the existing FFT method (O(N log N)).
    dct1d(input: Float32Array | number[]): Float32Array {
        const n = input.length;
        // Reorder input: [a, b, c, d] -> [a, c, d, b]
        const v = new Float32Array(n);
        let evenPtr = 0, oddPtr = n - 1;
        for (let i = 0; i < n; i += 2) {
            v[evenPtr++] = input[i];
            if (i + 1 < n) v[oddPtr--] = input[i + 1];
        }

        const fftRes = this.fft1d(v, new Float32Array(n));
        const dct = new Float32Array(n);
        const factor = Math.PI / (2 * n);
        const scale0 = Math.sqrt(1 / n), scaleK = Math.sqrt(2 / n);       

        for (let k = 0; k < n; k++) {
            const angle = k * factor;
            const value = (fftRes.re[k] * Math.cos(angle)) + (fftRes.im[k] * Math.sin(angle));
            dct[k] = value * (k === 0 ? scale0 : scaleK);
        }
        return dct;
    },

    // Computes 1D Inverse DCT (DCT-III) using IFFT
    idct1d(input: Float32Array | number[]): Float32Array {
        const n = input.length;
        const factor = Math.PI / (2 * n);
        const scale0 = Math.sqrt(1 / n), scaleK = Math.sqrt(2 / n);
        const complexRe = new Float32Array(n), complexIm = new Float32Array(n);

        for (let k = 0; k < n; k++) {
            const s = (k === 0) ? scale0 : scaleK;
            const val = input[k] * s;
            const angle = k * factor;
            complexRe[k] = val * Math.cos(angle);
            complexIm[k] = val * Math.sin(angle);
        }

        const ifftRes = this.ifft1d(complexRe, complexIm);
        const output = new Float32Array(n);
        let ptr = 0;
        for (let i = 0; i < n; i += 2) output[i] = ifftRes.re[ptr++] * n; 
        
        const startOdd = (n % 2 === 0) ? n - 1 : n - 2;
        for (let i = startOdd; i >= 0; i -= 2) output[i] = ifftRes.re[ptr++] * n;

        return output;
    },

    // Computes 2D DCT
    dct2d(input: number[][] | Float32Array[]): Float32Array[] { return this._separableTransform2d(input, this.dct1d); },

    // Computes 2D Inverse DCT
    idct2d(input: number[][] | Float32Array[]): Float32Array[] { return this._separableTransform2d(input, this.idct1d); },

    // --- Utility Methods for Image Processing ---

    nextPowerOf2(n: number): number { return Math.pow(2, Math.ceil(Math.log2(n))); },
    isPowerOf2(n: number): boolean { return (n & (n - 1)) === 0 && n !== 0; },

    // Standard FFT Shift: Moves zero-frequency component to the center of the spectrum. Swaps quadrants.
    shift(data: { re: Float32Array[] | number[][]; im: Float32Array[] | number[][] }): { re: Float32Array[]; im: Float32Array[] } {
        return this._shift2d(data.re, data.im, Math.floor(data.re.length / 2), Math.floor(data.re[0].length / 2));
    },

    // Inverse FFT Shift: Moves zero-frequency component back to (0,0).
    unshift(data: { re: Float32Array[] | number[][]; im: Float32Array[] | number[][] }): { re: Float32Array[]; im: Float32Array[] } {
        return this._shift2d(data.re, data.im, Math.ceil(data.re.length / 2), Math.ceil(data.re[0].length / 2));
    },

    /**
     * Pads a spatial kernel (odd size) to image dimensions and rolls it 
     * so the center is at (0,0). Essential for FFT-based convolution.
     */
    prepareKernel(kernel: number[][] | Float32Array[], width: number, height: number): Float32Array[] {
        const padded = this._create2D(height, width);
        const kh = kernel.length, kw = kernel[0].length;
        const centerY = Math.floor(kh / 2), centerX = Math.floor(kw / 2);

        for (let y = 0; y < kh; y++) {
            for (let x = 0; x < kw; x++) {
                const targetY = (y - centerY + height) % height;
                const targetX = (x - centerX + width) % width;
                padded[targetY][targetX] = kernel[y][x];
            }
        }
        return padded;
    },

    multiply(a: any, b: any): { re: Float32Array[]; im: Float32Array[] } {
        const rows = a.re.length, cols = a.re[0].length;
        const resRe = this._create2D(rows, cols);
        const resIm = this._create2D(rows, cols);

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const ar = a.re[y][x], ai = a.im[y][x];
                const br = b.re[y][x], bi = b.im[y][x];
                resRe[y][x] = ar * br - ai * bi;
                resIm[y][x] = ar * bi + ai * br;
            }
        }
        return { re: resRe, im: resIm };
    },

    scaleBy(a: any, scalar: number): { re: Float32Array[]; im: Float32Array[] } {
        const rows = a.re.length;
        const cols = a.re[0].length;
        const resRe = this._create2D(rows, cols);
        const resIm = this._create2D(rows, cols);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                resRe[y][x] = a.re[y][x] * scalar;
                resIm[y][x] = a.im[y][x] * scalar;
            }
        }
        return { re: resRe, im: resIm };
    },

    // Calculates Magnitude of complex array. |Z|
    magnitude(data: any): Float32Array[] {
        const rows = data.re.length, cols = data.re[0].length;
        const mag = this._create2D(rows, cols);
        for(let i = 0; i < rows; i++) {
            for(let j = 0; j < cols; j++) {
                const val = data.re[i][j], img = data.im[i][j];
                mag[i][j] = Math.sqrt(val * val + img * img);
            }
        }
        return mag;
    },

    // Calculates Log-Magnitude: log(1 + |Z|)
    logMagnitude(data: any): Float32Array[] {
        const rows = data.re.length, cols = data.re[0].length;
        const logMag = this._create2D(rows, cols);
        for(let i = 0; i < rows; i++) {
            for(let j = 0; j < cols; j++) {
                const val = data.re[i][j], img = data.im[i][j];
                logMag[i][j] = Math.log(1 + Math.sqrt(val * val + img * img));
            }
        }
        return logMag;
    },

    // --- Private Methods ---

    _create2D(rows: number, cols: number): Float32Array[] {
        const arr = new Array(rows);
        for(let i = 0; i < rows; i++) arr[i] = new Float32Array(cols);
        return arr;
    },

    _separableTransform2d(input: any, transformFunc: Function): Float32Array[] {
        const rows = input.length, cols = input[0].length;
        const res = new Array(rows);
        // Row pass
        for (let i = 0; i < rows; i++) res[i] = transformFunc.call(this, input[i]);
        // Col pass
        const colData = new Float32Array(rows);
        for (let j = 0; j < cols; j++) {
            for (let i = 0; i < rows; i++) colData[i] = res[i][j];
            const colRes = transformFunc.call(this, colData);
            for (let i = 0; i < rows; i++) res[i][j] = colRes[i];
        }
        return res;
    },

    _shift2d(re: any, im: any, offsetRow: number, offsetCol: number): { re: Float32Array[]; im: Float32Array[] } {
        const rows = re.length;
        if (rows === 0) return { re: [], im: [] };
        const cols = re[0].length;
        const newRe = this._create2D(rows, cols);
        const newIm = this._create2D(rows, cols);
        const hasIm = im && im.length === rows && im[0];
        
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const newI = (i + offsetRow) % rows;
                const newJ = (j + offsetCol) % cols;
                newRe[newI][newJ] = re[i][j];
                newIm[newI][newJ] = hasIm ? im[i][j] : 0;
            }
        }
        return { re: newRe, im: newIm };
    },

    // Recursive Cooley-Tukey (Radix-2) for Power of 2
    _fft1dRadix2(real: Float32Array | number[], imag: Float32Array | number[]): { re: Float32Array; im: Float32Array } {
        const n = real.length;
        const logN = Math.log2(n);
        let realCopy = new Float32Array(real);
        let imagCopy = new Float32Array(imag);

        for (let i = 0; i < n; i++) {
            let j = 0;
            for (let k = 0; k < logN; k++) {
                j = (j << 1) | ((i >> k) & 1);
            }
            if (i < j) {
                const tr = realCopy[i]; realCopy[i] = realCopy[j]; realCopy[j] = tr;
                const ti = imagCopy[i]; imagCopy[i] = imagCopy[j]; imagCopy[j] = ti;
            }
        }

        const twiddles = this._getTwiddleFactors(n);

        for (let s = 1; s <= logN; s++) {
            const m = 1 << s;
            const m2 = m >> 1;
            const twiddleLevel = twiddles[s - 1];
            
            for (let k = 0; k < m2; k++) {
                const cosW = twiddleLevel[k * 2];
                const sinW = twiddleLevel[k * 2 + 1];
                
                for (let j = k; j < n; j += m) {
                    const jm = j + m2;
                    const tRe = cosW * realCopy[jm] - sinW * imagCopy[jm];
                    const tIm = cosW * imagCopy[jm] + sinW * realCopy[jm];
                    realCopy[jm] = realCopy[j] - tRe;
                    imagCopy[jm] = imagCopy[j] - tIm;
                    realCopy[j] += tRe;
                    imagCopy[j] += tIm;
                }
            }
        }
        return { re: realCopy, im: imagCopy };
    },

    // Bluestein's Algorithm (Chirp Z-transform) for arbitrary sizes
    _dft1dBluestein(real: Float32Array | number[], imag: Float32Array | number[]): { re: Float32Array; im: Float32Array } {
        const N = real.length;
        const M = this.nextPowerOf2(2 * N - 1);

        // Get cached chirp factors
        const chirp = this._getChirpFactors(N);
        const chirpConjReal = chirp.real;
        const chirpConjImag = chirp.imag;

        // Prepare input: A[k] * exp(-j...)
        let bReal = new Float32Array(M), bImag = new Float32Array(M);
        for (let k = 0; k < N; k++) {
            const realK = real[k], imagK = imag[k];
            const chirpRe = chirpConjReal[k], chirpIm = chirpConjImag[k];
            bReal[k] = realK * chirpRe - imagK * chirpIm;
            bImag[k] = realK * chirpIm + imagK * chirpRe;
        }

        // Prepare convolution kernel
        let cReal = new Float32Array(M), cImag = new Float32Array(M);
        cReal[0] = chirpConjReal[0];
        cImag[0] = -chirpConjImag[0];
        for (let k = 1; k < N; k++) {
            const cRe = chirpConjReal[k];
            const cIm = -chirpConjImag[k];
            cReal[k] = cRe;
            cImag[k] = cIm;
            cReal[M - k] = cRe;
            cImag[M - k] = cIm;
        }

        // Convolution via FFT
        let B = this._fft1dRadix2(bReal, bImag);
        let C = this._fft1dRadix2(cReal, cImag);

        let DReal = new Float32Array(M), DImag = new Float32Array(M);
        for (let k = 0; k < M; k++) {
            const bRe = B.re[k], bIm = B.im[k];
            const cRe = C.re[k], cIm = C.im[k];
            DReal[k] = bRe * cRe - bIm * cIm;
            DImag[k] = bRe * cIm + bIm * cRe;
        }

        let d = this.ifft1d(DReal, DImag);
        
        let resultReal = new Float32Array(N), resultImag = new Float32Array(N);
        for (let k = 0; k < N; k++) {
            const dRe = d.re[k], dIm = d.im[k];
            const chirpRe = chirpConjReal[k], chirpIm = chirpConjImag[k];
            resultReal[k] = dRe * chirpRe - dIm * chirpIm;
            resultImag[k] = dRe * chirpIm + dIm * chirpRe;
        }

        return { re: resultReal, im: resultImag };
    },
    
    _getTwiddleFactors(n: number): Float32Array[] {
        if (this._twiddleCache.has(n)) return this._twiddleCache.get(n)!;
        const logN = Math.log2(n);
        const twiddles: Float32Array[] = [];
        for (let s = 1; s <= logN; s++) {
            const m = 1 << s;
            const m2 = m >> 1;
            const wAngleInc = -2 * Math.PI / m;
            const twiddleLevel = new Float32Array(m2 * 2); // [cos, sin] pairs
            for (let k = 0; k < m2; k++) {
                const wAngle = k * wAngleInc;
                twiddleLevel[k * 2] = Math.cos(wAngle);
                twiddleLevel[k * 2 + 1] = Math.sin(wAngle);
            }
            twiddles.push(twiddleLevel);
        }
        this._twiddleCache.set(n, twiddles);
        return twiddles;
    },

    _getChirpFactors(N: number): { real: Float32Array; imag: Float32Array } {
        if (this._chirpCache.has(N)) return this._chirpCache.get(N)!;
        const chirpConjReal = new Float32Array(N);
        const chirpConjImag = new Float32Array(N);
        for (let k = 0; k < N; k++) {
            const angle = Math.PI * (k * k) / N;
            chirpConjReal[k] = Math.cos(angle);
            chirpConjImag[k] = -Math.sin(angle);
        }
        const result = { real: chirpConjReal, imag: chirpConjImag };
        this._chirpCache.set(N, result);
        return result;
    }
};
