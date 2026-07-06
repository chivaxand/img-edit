import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('smart-sharpen', {
    name: 'Smart Sharpen',
    mode: 'pixel',
    menu: {
        path: 'Filter/Enhance',
        label: 'Smart Sharpen...',
        order: 3
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            mode: 'guided', // guided, bilateral
            radius: 3,
            sigmaR: 10,     // Range sigma (color sensitivity) for Bilateral
            epsilon: 0.01,  // Smoothing factor for Guided
            amount: 100     // Sharpening strength %
        };

        const update = () => hooks.preview(state);
        const updateControls = () => {
            const m = state.mode;
            epsRow.style.display = m === 'guided' ? 'flex' : 'none';
            sigRow.style.display = m === 'bilateral' ? 'flex' : 'none';
        };

        container.appendChild(UI.createSelectRow({
            label: 'Method',
            options: [
                { value: 'guided', text: 'Guided Filter (Fast)' },
                { value: 'bilateral', text: 'Bilateral Filter (High Quality)' }
            ],
            value: state.mode,
            onChange: v => { state.mode = v; updateControls(); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 20, step: 1, value: state.radius,
            onInput: v => { state.radius = parseInt(v); update(); }
        }));

        // Guided Filter Parameter
        const epsRow = UI.createSliderRow({
            label: 'Epsilon (×10⁻³)', min: 1, max: 200, step: 1, value: state.epsilon * 1000,
            onInput: v => { state.epsilon = parseFloat(v) / 1000; update(); }
        });
        container.appendChild(epsRow);

        // Bilateral Filter Parameter
        const sigRow = UI.createSliderRow({
            label: 'Range Sigma', min: 1, max: 100, step: 1, value: state.sigmaR,
            onInput: v => { state.sigmaR = parseFloat(v); update(); }
        });
        container.appendChild(sigRow);

        container.appendChild(UI.createSliderRow({
            label: 'Amount (%)', min: 0, max: 400, step: 10, value: state.amount,
            onInput: v => { state.amount = parseInt(v); update(); }
        }));

        updateControls();
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { mode, radius, sigmaR, epsilon, amount }: any) {
        if (amount === 0) return;

        const ImageUtil = Lib.image;
        
        // Extract channels and normalize to 0-1
        const r = ImageUtil.extractChannel(data, w, h, 0).map((v: number) => v/255);
        const g = ImageUtil.extractChannel(data, w, h, 1).map((v: number) => v/255);
        const b = ImageUtil.extractChannel(data, w, h, 2).map((v: number) => v/255);
        
        const channels = [r, g, b];
        const smoothed: Float32Array[] = [];

        if (mode === 'guided') {
            // Guided Filter: Self-guided (I=p) preserves edges of the image itself
            for (let i = 0; i < 3; i++) {
                smoothed[i] = this.guidedFilter(channels[i], channels[i], w, h, radius, epsilon);
            }
        } else {
            // Bilateral Filter: Weights by spatial distance and intensity difference
            for (let i = 0; i < 3; i++) {
                smoothed[i] = this.bilateralFilter(channels[i], w, h, radius, sigmaR / 255);
            }
        }

        // Apply Unsharp Masking logic
        const k = amount / 100;
        
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            for (let c = 0; c < 3; c++) {
                const orig = channels[c][i];
                const smooth = smoothed[c][i];
                const diff = orig - smooth;
                const val = orig + k * diff;
                data[idx + c] = Math.max(0, Math.min(255, val * 255));
            }
        }
    },

    // --- Helpers ---

    // Box Blur using sliding accumulator
    boxBlurFast(data: Float32Array, w: number, h: number, r: number) {
        const len = data.length;
        const tmp = new Float32Array(len);
        const out = new Float32Array(len);

        // Horizontal Pass
        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            let sum = 0;
            let count = 0;
            
            // Initial Window (0 to r)
            for(let i = 0; i <= r && i < w; i++) { sum += data[rowOffset + i]; count++; }
            
            for (let x = 0; x < w; x++) {
                if (x > 0) {
                    const leaving = x - r - 1;
                    const entering = x + r;
                    if (leaving >= 0) { sum -= data[rowOffset + leaving]; count--; }
                    if (entering < w) { sum += data[rowOffset + entering]; count++; }
                }
                tmp[rowOffset + x] = sum / (count || 1);
            }
        }
        
        // Vertical Pass (on tmp)
        for (let x = 0; x < w; x++) {
            let sum = 0;
            let count = 0;
            
            // Initial Window
            for(let i = 0; i <= r && i < h; i++) { sum += tmp[i * w + x]; count++; }
            
            for (let y = 0; y < h; y++) {
                if (y > 0) {
                    const leaving = y - r - 1;
                    const entering = y + r;
                    if (leaving >= 0) { sum -= tmp[leaving * w + x]; count--; }
                    if (entering < h) { sum += tmp[entering * w + x]; count++; }
                }
                out[y * w + x] = sum / (count || 1);
            }
        }
        return out;
    },

    // Guided Image Filter (He et al.)
    guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number) {
        // I: Guidance image, p: Filtering input image
        
        const meanI = this.boxBlurFast(I, w, h, r);
        const meanP = (I === p) ? meanI : this.boxBlurFast(p, w, h, r);
        
        const meanII = this.boxBlurFast(I.map((v: number) => v*v), w, h, r);
        const meanIp = (I === p) ? meanII : this.boxBlurFast(I.map((v: number, i: number) => v * p[i]), w, h, r);

        // Covariance & Variance
        const len = w * h;
        const a = new Float32Array(len);
        const b = new Float32Array(len);

        for (let i = 0; i < len; i++) {
            const varI = meanII[i] - meanI[i] * meanI[i];
            const covIp = meanIp[i] - meanI[i] * meanP[i];
            const aval = covIp / (varI + eps);
            a[i] = aval;
            b[i] = meanP[i] - aval * meanI[i];
        }

        const meanA = this.boxBlurFast(a, w, h, r);
        const meanB = this.boxBlurFast(b, w, h, r);

        const q = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            q[i] = meanA[i] * I[i] + meanB[i];
        }
        return q;
    },

    // Brute-force Bilateral Filter
    bilateralFilter(src: Float32Array, w: number, h: number, r: number, sigmaR: number) {
        const out = new Float32Array(src.length);
        const sigmaS = r / 2 || 1; 
        const s2 = 2 * sigmaS * sigmaS;
        const r2 = 2 * sigmaR * sigmaR;
        
        // Precompute spatial kernel (Gaussian)
        const kSize = 2 * r + 1;
        const sKernel = new Float32Array(kSize * kSize);
        for(let y=0; y<kSize; y++) {
            for(let x=0; x<kSize; x++) {
                const dy = y - r;
                const dx = x - r;
                sKernel[y*kSize+x] = Math.exp(-(dx*dx + dy*dy)/s2);
            }
        }

        for (let y = 0; y < h; y++) {
            const yMin = Math.max(0, y - r);
            const yMax = Math.min(h - 1, y + r);
            const rowOffset = y * w;
            
            for (let x = 0; x < w; x++) {
                const centerVal = src[rowOffset + x];
                let sum = 0;
                let wSum = 0;
                
                const xMin = Math.max(0, x - r);
                const xMax = Math.min(w - 1, x + r);

                for (let ny = yMin; ny <= yMax; ny++) {
                    const kY = (ny - y) + r;
                    const nRowOffset = ny * w;
                    
                    for (let nx = xMin; nx <= xMax; nx++) {
                        const val = src[nRowOffset + nx];
                        const diff = val - centerVal;
                        
                        // Range Weight: exp(-diff^2 / 2sigmaR^2)
                        const rW = Math.exp(-(diff * diff) / r2);
                        
                        const kX = (nx - x) + r;
                        const sW = sKernel[kY * kSize + kX];
                        
                        const weight = sW * rW;
                        sum += val * weight;
                        wSum += weight;
                    }
                }
                out[rowOffset + x] = sum / (wSum || 1);
            }
        }
        return out;
    }
});
