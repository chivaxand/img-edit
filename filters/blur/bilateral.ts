import { Filters } from '../../filters';
import { UI } from '../../ui';
import { Layer } from '../../layers';

Filters.register('bilateral', {
    name: 'Bilateral Filter',
    mode: 'pixel',
    menu: {
        path: 'Filter/Blur',
        label: 'Bilateral Filter...',
        order: 3
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            radius: 3,
            sigmaColor: 25,
            sigmaSpace: 3
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createHint(
            'Smooths flat regions while preserving sharp edges by combining spatial closeness and color similarity.'
        ));

        container.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 10, step: 1, value: state.radius,
            onInput: (v: string) => { state.radius = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Color Sigma', min: 5, max: 150, step: 1, value: state.sigmaColor,
            onInput: (v: string) => { state.sigmaColor = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Space Sigma', min: 1, max: 10, step: 1, value: state.sigmaSpace,
            onInput: (v: string) => { state.sigmaSpace = parseInt(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { radius, sigmaColor, sigmaSpace }: any) {
        if (radius <= 0) return;
        const src = new Uint8ClampedArray(data);

        // Precompute spatial Gaussian weights
        const spaceWeight = new Float32Array((2 * radius + 1) * (2 * radius + 1));
        const gaussSpaceCoeff = -0.5 / (sigmaSpace * sigmaSpace);
        let sIdx = 0;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                spaceWeight[sIdx++] = Math.exp((dx * dx + dy * dy) * gaussSpaceCoeff);
            }
        }

        // Precompute color Gaussian weights for performance
        const colorWeight = new Float32Array(3 * 255 * 255 + 1);
        const gaussColorCoeff = -0.5 / (sigmaColor * sigmaColor);
        for (let i = 0; i < colorWeight.length; i++) {
            colorWeight[i] = Math.exp(i * gaussColorCoeff);
        }

        for (let y = 0; y < h; y++) {
            const yMin = Math.max(0, y - radius);
            const yMax = Math.min(h - 1, y + radius);

            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const r0 = src[idx];
                const g0 = src[idx + 1];
                const b0 = src[idx + 2];
                const a0 = src[idx + 3];

                const xMin = Math.max(0, x - radius);
                const xMax = Math.min(w - 1, x + radius);

                let sumR = 0;
                let sumG = 0;
                let sumB = 0;
                let sumW = 0;

                for (let ny = yMin; ny <= yMax; ny++) {
                    const rowOffset = ny * w;
                    const dy = ny - y;
                    const spaceRowOffset = (dy + radius) * (2 * radius + 1);
                    let spaceIdx = spaceRowOffset + (xMin - x + radius);

                    for (let nx = xMin; nx <= xMax; nx++) {
                        const nIdx = (rowOffset + nx) * 4;
                        const r = src[nIdx];
                        const g = src[nIdx + 1];
                        const b = src[nIdx + 2];

                        const sW = spaceWeight[spaceIdx++];

                        // Compute Euclidean color distance in 3D space
                        const diffSq = (r - r0) ** 2 + (g - g0) ** 2 + (b - b0) ** 2;
                        const cW = colorWeight[diffSq];

                        const wTotal = sW * cW;
                        sumR += r * wTotal;
                        sumG += g * wTotal;
                        sumB += b * wTotal;
                        sumW += wTotal;
                    }
                }

                if (sumW > 0) {
                    data[idx] = Math.round(sumR / sumW);
                    data[idx + 1] = Math.round(sumG / sumW);
                    data[idx + 2] = Math.round(sumB / sumW);
                    data[idx + 3] = a0;
                }
            }
        }
    }
});
