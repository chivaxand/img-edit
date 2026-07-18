import { Filters } from '../../filters';
import { UI } from '../../ui';
import { Layer } from '../../layers';

Filters.register('guided', {
    name: 'Guided Filter',
    mode: 'pixel',
    menu: {
        path: 'Filter/Blur',
        label: 'Guided Filter...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            radius: 4,
            eps: 0.02
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createHint(
            'Edge-preserving smoothing using the image structure itself as a guidance map. Extremely fast and avoids gradient reversal artifacts.'
        ));

        container.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 20, step: 1, value: state.radius,
            onInput: (v: string) => { state.radius = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Regularization (Eps)', min: 0.001, max: 0.5, step: 0.001, value: state.eps,
            onInput: (v: string) => { state.eps = parseFloat(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { radius, eps }: any) {
        if (radius <= 0) return;

        const N = w * h;
        const R = new Float32Array(N);
        const G = new Float32Array(N);
        const B = new Float32Array(N);

        // Normalize color channels to 0-1 for stability
        for (let i = 0; i < N; i++) {
            R[i] = data[i * 4] / 255.0;
            G[i] = data[i * 4 + 1] / 255.0;
            B[i] = data[i * 4 + 2] / 255.0;
        }

        const outR = new Float32Array(N);
        const outG = new Float32Array(N);
        const outB = new Float32Array(N);

        // Perform self-guided filtering on each channel
        filterChannel(R, w, h, radius, eps, outR);
        filterChannel(G, w, h, radius, eps, outG);
        filterChannel(B, w, h, radius, eps, outB);

        for (let i = 0; i < N; i++) {
            data[i * 4] = Math.max(0, Math.min(255, Math.round(outR[i] * 255.0)));
            data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(outG[i] * 255.0)));
            data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(outB[i] * 255.0)));
        }
    }
});

// Fast O(1) box filter using summed-area table
function boxFilter(src: Float32Array, w: number, h: number, r: number, dest: Float32Array) {
    const sat = new Float64Array((w + 1) * (h + 1));
    const stride = w + 1;
    for (let y = 0; y < h; y++) {
        let rowSum = 0;
        const satRowIdx = (y + 1) * stride;
        const prevSatRowIdx = y * stride;
        const srcRowIdx = y * w;
        for (let x = 0; x < w; x++) {
            rowSum += src[srcRowIdx + x];
            sat[satRowIdx + x + 1] = sat[prevSatRowIdx + x + 1] + rowSum;
        }
    }
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h - 1, y + r);
        const rowIdx = y * w;
        const satY1Idx = (y1 + 1) * stride;
        const satY0Idx = y0 * stride;
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r);
            const x1 = Math.min(w - 1, x + r);
            const count = (y1 - y0 + 1) * (x1 - x0 + 1);
            const sum = sat[satY1Idx + x1 + 1]
                      - sat[satY0Idx + x1 + 1]
                      - sat[satY1Idx + x0]
                      + sat[satY0Idx + x0];
            dest[rowIdx + x] = sum / count;
        }
    }
}

function filterChannel(I: Float32Array, w: number, h: number, r: number, eps: number, out: Float32Array) {
    const N = w * h;
    const mean_I = new Float32Array(N);
    const mean_II = new Float32Array(N);
    const I_sq = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        I_sq[i] = I[i] * I[i];
    }

    boxFilter(I, w, h, r, mean_I);
    boxFilter(I_sq, w, h, r, mean_II);

    const a = new Float32Array(N);
    const b = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const var_I = Math.max(0, mean_II[i] - mean_I[i] * mean_I[i]);
        a[i] = var_I / (var_I + eps);
        b[i] = mean_I[i] - a[i] * mean_I[i];
    }

    const mean_a = new Float32Array(N);
    const mean_b = new Float32Array(N);
    boxFilter(a, w, h, r, mean_a);
    boxFilter(b, w, h, r, mean_b);

    for (let i = 0; i < N; i++) {
        out[i] = mean_a[i] * I[i] + mean_b[i];
    }
}
