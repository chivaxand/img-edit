import { Filters } from '../../filters';
import { UI } from '../../ui';
import { Layer } from '../../layers';
import { Lib } from '../../libs/index';

Filters.register('nlm', {
    name: 'Non-Local Means',
    mode: 'pixel',

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            h: 10.0,       // Filtering parameter (decay)
            patchRad: 2,   // Patch size = 2*rad+1 (1 -> 3x3)
            searchRad: 3   // Search window = 2*rad+1 (3 -> 7x7)
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'High quality denoiser. Averages pixels with similar local patches. Computational heavy.'));

        container.appendChild(UI.createSliderRow({
            label: 'Strength (h)', min: 1, max: 50, step: 0.5, value: state.h,
            onChange: (v: string) => { state.h = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Patch Size', min: 1, max: 5, step: 1, value: state.patchRad,
            formatter: (v: string | number) => (Number(v)*2+1)+'x'+(Number(v)*2+1),
            onChange: (v: string) => { state.patchRad = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Search Win', min: 2, max: 12, step: 1, value: state.searchRad,
            formatter: (v: string | number) => (Number(v)*2+1)+'x'+(Number(v)*2+1),
            onChange: (v: string) => { state.searchRad = parseInt(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { h: hParam, patchRad, searchRad }: any) {
        const src = new Uint8ClampedArray(data);
        const h2 = hParam * hParam;
        
        // Generate Gaussian Patch Kernel (sigma = (patch_size - 1) / 4)
        const patchSize = 2 * patchRad + 1;
        const kernel = new Float32Array(patchSize * patchSize);
        const sigma = patchRad > 0 ? (patchSize - 1) / 4.0 : 1.0; 
        const sigma2_2 = 2 * sigma * sigma;

        let kSum = 0;
        let kPtr = 0;
        for (let dy = -patchRad; dy <= patchRad; dy++) {
            for (let dx = -patchRad; dx <= patchRad; dx++) {
                const val = Math.exp(-(dx * dx + dy * dy) / sigma2_2);
                kernel[kPtr++] = val;
                kSum += val;
            }
        }
        // Normalize kernel so it sums to 1
        for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

        // Symmetric padding to eliminate bounds checks in the hot patch loop
        const pW = w + 2 * patchRad;
        const pH = h + 2 * patchRad;
        const paddedSrc = new Uint8ClampedArray(pW * pH * 4);
        for (let y = 0; y < pH; y++) {
            let sy = y - patchRad;
            if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
            const srcRowOffset = sy * w * 4;
            const destRowOffset = y * pW * 4;
            
            for (let x = 0; x < pW; x++) {
                let sx = x - patchRad;
                if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
                const srcIdx = srcRowOffset + sx * 4;
                const destIdx = destRowOffset + x * 4;
                paddedSrc[destIdx] = src[srcIdx];
                paddedSrc[destIdx + 1] = src[srcIdx + 1];
                paddedSrc[destIdx + 2] = src[srcIdx + 2];
                paddedSrc[destIdx + 3] = src[srcIdx + 3];
            }
        }

        // Iterate over every pixel
        for (let y = 0; y < h; y++) {
            const yMin = Math.max(0, y - searchRad);
            const yMax = Math.min(h - 1, y + searchRad);

            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                
                let sumR = 0, sumG = 0, sumB = 0;
                let sumW = 0;
                let maxW = 0; // for self-weighting

                // Search window
                for (let sy = yMin; sy <= yMax; sy++) {
                    const xMin = Math.max(0, x - searchRad);
                    const xMax = Math.min(w - 1, x + searchRad);
                    for (let sx = xMin; sx <= xMax; sx++) {
                        
                        if (sx === x && sy === y) continue; // Handle self later

                        // Calculate Patch Distance (Weighted Sum of Squared Differences)
                        let dist = 0;
                        kPtr = 0; // Reset kernel pointer
                        
                        // Patch Loop
                        for (let dy = -patchRad; dy <= patchRad; dy++) {
                            const pY1 = y + dy + patchRad;
                            const pY2 = sy + dy + patchRad;
                            const r1 = pY1 * pW;
                            const r2 = pY2 * pW;

                            for (let dx = -patchRad; dx <= patchRad; dx++) {
                                const pX1 = x + dx + patchRad;
                                const pX2 = sx + dx + patchRad;

                                const i1 = (r1 + pX1) * 4;
                                const i2 = (r2 + pX2) * 4;

                                const dr = paddedSrc[i1] - paddedSrc[i2];
                                const dg = paddedSrc[i1+1] - paddedSrc[i2+1];
                                const db = paddedSrc[i1+2] - paddedSrc[i2+2];

                                // Apply Gaussian weight
                                dist += (dr*dr + dg*dg + db*db) * kernel[kPtr++];
                            }
                        }

                        // Normalize distance by channels (3.0)
                        const d = dist / 3.0; 
                        
                        // Standard NLM Weight formula
                        const weight = Math.exp(-d / h2);
                        if (weight > maxW) maxW = weight;

                        const sIdx = (sy * w + sx) * 4;
                        sumR += src[sIdx] * weight;
                        sumG += src[sIdx+1] * weight;
                        sumB += src[sIdx+2] * weight;
                        sumW += weight;
                    }
                }

                // Add Self with max weight
                sumR += src[idx] * maxW;
                sumG += src[idx+1] * maxW;
                sumB += src[idx+2] * maxW;
                sumW += maxW;

                if (sumW > 0) {
                    const invW = 1 / sumW;
                    data[idx]   = sumR * invW;
                    data[idx+1] = sumG * invW;
                    data[idx+2] = sumB * invW;
                }
            }
        }
    }
});