import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('bilateral', {
    name: 'Bilateral Blur',
    mode: 'pixel',
    menu: {
        path: 'Filter/Blur',
        label: 'Bilateral Blur...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            radius: 3,
            sigmaSpace: 3.0,
            sigmaRange: 20.0, // 0-255 scale
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Edge-preserving blur. High "Range Sigma" behaves like Gaussian blur.'));

        // Radius (Window Size)
        container.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 20, step: 1, value: state.radius,
            onInput: (v: string) => { state.radius = parseInt(v); update(); }
        }));

        // Sigma Space (Spatial falloff)
        container.appendChild(UI.createSliderRow({
            label: 'Space Sigma', min: 0.1, max: 20.0, step: 0.1, value: state.sigmaSpace,
            onInput: (v: string) => { state.sigmaSpace = parseFloat(v); update(); }
        }));

        // Sigma Range (Color falloff)
        container.appendChild(UI.createSliderRow({
            label: 'Range Sigma', min: 1, max: 150, step: 1, value: state.sigmaRange,
            onInput: (v: string) => { state.sigmaRange = parseFloat(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { radius, sigmaSpace, sigmaRange }: any) {
        if (radius <= 0) return;

        const src = new Uint8ClampedArray(data);
        
        // 1. Precompute Spatial Gaussian Kernel (Distance weights)
        const kSize = radius * 2 + 1;
        const kernelSpace = new Float32Array(kSize * kSize);
        const ss2 = 2 * sigmaSpace * sigmaSpace;
        const safeSS2 = ss2 < 1e-5 ? 1e-5 : ss2;

        for (let y = 0; y < kSize; y++) {
            for (let x = 0; x < kSize; x++) {
                const dy = y - radius;
                const dx = x - radius;
                kernelSpace[y * kSize + x] = Math.exp(-(dx*dx + dy*dy) / safeSS2);
            }
        }

        // 2. Precompute Range Gaussian LUT (Intensity difference weights)
        // Since input is 8-bit, differences are integers -255 to 255. 
        // We use absolute difference 0 to 255.
        const rangeLUT = new Float32Array(256);
        const sr2 = 2 * sigmaRange * sigmaRange;
        const safeSR2 = sr2 < 1e-5 ? 1e-5 : sr2;

        for (let i = 0; i < 256; i++) {
            rangeLUT[i] = Math.exp(-(i*i) / safeSR2);
        }

        // 3. Apply Filter
        for (let y = 0; y < h; y++) {
            const yMin = Math.max(0, y - radius);
            const yMax = Math.min(h - 1, y + radius);
            const rowOffset = y * w;

            for (let x = 0; x < w; x++) {
                const idx = (rowOffset + x) * 4;
                
                // Center pixel values
                const r0 = src[idx];
                const g0 = src[idx+1];
                const b0 = src[idx+2];

                let sumR = 0, sumG = 0, sumB = 0;
                let normR = 0, normG = 0, normB = 0;

                const xMin = Math.max(0, x - radius);
                const xMax = Math.min(w - 1, x + radius);

                // Convolve
                for (let ny = yMin; ny <= yMax; ny++) {
                    const ky = ny - y + radius;
                    const kRowOffset = ky * kSize;
                    const nRowOffset = ny * w;

                    for (let nx = xMin; nx <= xMax; nx++) {
                        const nIdx = (nRowOffset + nx) * 4;
                        
                        const r = src[nIdx];
                        const g = src[nIdx+1];
                        const b = src[nIdx+2];

                        // Spatial Weight
                        const kx = nx - x + radius;
                        const wSpace = kernelSpace[kRowOffset + kx];

                        // Range Weight (Intensity difference per channel)
                        const wR = rangeLUT[Math.abs(r - r0)];
                        const wG = rangeLUT[Math.abs(g - g0)];
                        const wB = rangeLUT[Math.abs(b - b0)];

                        // Combined Weights
                        const wFinalR = wSpace * wR;
                        const wFinalG = wSpace * wG;
                        const wFinalB = wSpace * wB;

                        sumR += r * wFinalR;
                        normR += wFinalR;

                        sumG += g * wFinalG;
                        normG += wFinalG;

                        sumB += b * wFinalB;
                        normB += wFinalB;
                    }
                }

                data[idx]   = normR > 0 ? sumR / normR : r0;
                data[idx+1] = normG > 0 ? sumG / normG : g0;
                data[idx+2] = normB > 0 ? sumB / normB : b0;
            }
        }
    }
});