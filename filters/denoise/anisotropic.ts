import { Filters } from '../../filters';
import { UI } from '../../ui';
import { Layer } from '../../layers';

Filters.register('anisotropic', {
    name: 'Anisotropic Diffusion',
    mode: 'pixel',
    menu: {
        path: 'Filter/Denoise',
        label: 'Anisotropic Diffusion...',
        order: 5
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            iterations: 15,
            kappa: 30,
            gamma: 0.15,
            option: 1
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createHint(
            'Perona-Malik scale-space edge-preserving diffusion. Iteratively smooths flat areas while blocking diffusion across strong gradients.'
        ));

        container.appendChild(UI.createSliderRow({
            label: 'Iterations', min: 1, max: 50, step: 1, value: state.iterations,
            onInput: (v: string) => { state.iterations = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Conductivity (Kappa)', min: 5, max: 100, step: 1, value: state.kappa,
            onInput: (v: string) => { state.kappa = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Step Size (Gamma)', min: 0.05, max: 0.25, step: 0.01, value: state.gamma,
            onInput: (v: string) => { state.gamma = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createRadioGroup({
            label: 'Diffusion Formula',
            options: [
                { value: 1, text: 'High Contrast Edges (Option 1)' },
                { value: 2, text: 'Wide Flat Regions (Option 2)' }
            ],
            value: state.option,
            onChange: (v: number) => { state.option = v; update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { iterations, kappa, gamma, option }: any) {
        if (iterations <= 0) return;

        const N = w * h;
        const R = new Float32Array(N);
        const G = new Float32Array(N);
        const B = new Float32Array(N);

        for (let i = 0; i < N; i++) {
            R[i] = data[i * 4];
            G[i] = data[i * 4 + 1];
            B[i] = data[i * 4 + 2];
        }

        // Precompute conduction coefficients to avoid millions of Math.exp calls in the hot loop
        const lutSize = 512;
        const condLut = new Float32Array(lutSize);
        if (option === 1) {
            for (let i = 0; i < lutSize; i++) {
                condLut[i] = Math.exp(-((i / kappa) ** 2));
            }
        } else {
            for (let i = 0; i < lutSize; i++) {
                condLut[i] = 1 / (1 + (i / kappa) ** 2);
            }
        }

        const runDiffusion = (channel: Float32Array) => {
            const next = new Float32Array(N);
            for (let iter = 0; iter < iterations; iter++) {
                for (let y = 0; y < h; y++) {
                    const ym1 = y > 0 ? y - 1 : 0;
                    const yp1 = y < h - 1 ? y + 1 : h - 1;
                    const rowIdx = y * w;
                    const rowN = ym1 * w;
                    const rowS = yp1 * w;

                    for (let x = 0; x < w; x++) {
                        const xm1 = x > 0 ? x - 1 : 0;
                        const xp1 = x < w - 1 ? x + 1 : w - 1;

                        const idx = rowIdx + x;
                        const val = channel[idx];

                        const gradN = channel[rowN + x] - val;
                        const gradS = channel[rowS + x] - val;
                        const gradE = channel[rowIdx + xp1] - val;
                        const gradW = channel[rowIdx + xm1] - val;

                        const cN = condLut[Math.min(lutSize - 1, Math.round(Math.abs(gradN)))];
                        const cS = condLut[Math.min(lutSize - 1, Math.round(Math.abs(gradS)))];
                        const cE = condLut[Math.min(lutSize - 1, Math.round(Math.abs(gradE)))];
                        const cW = condLut[Math.min(lutSize - 1, Math.round(Math.abs(gradW)))];

                        next[idx] = val + gamma * (cN * gradN + cS * gradS + cE * gradE + cW * gradW);
                    }
                }
                channel.set(next);
            }
        };

        runDiffusion(R);
        runDiffusion(G);
        runDiffusion(B);

        for (let i = 0; i < N; i++) {
            data[i * 4] = Math.max(0, Math.min(255, Math.round(R[i])));
            data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(G[i])));
            data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(B[i])));
        }
    }
});
