import { App } from '~/app';
import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('vignette', {
    name: 'Vignette',
    mode: 'pixel',
    menu: {
        path: 'Filter/Photo',
        label: 'Vignette...',
        order: 1
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { amount: 50, size: 80, feather: 50, roundness: 50, color: '#000000' };
        const update = () => hooks.preview(state);

        container.appendChild(UI.createSliderRow({ label: 'Amount', min: -100, max: 100, value: state.amount, onInput: v => { state.amount = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Midpoint (%)', min: 0, max: 100, value: state.size, onInput: v => { state.size = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Feather', min: 0, max: 100, value: state.feather, onInput: v => { state.feather = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Roundness', min: 0, max: 100, value: state.roundness, onInput: v => { state.roundness = parseInt(v); update(); } }));
        container.appendChild(UI.createColorRow({ label: 'Color', value: state.color, onChange: v => { state.color = v; update(); } }));

        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, { amount, size, feather, roundness, color }: any) {
        if (amount === 0) return;

        const rgb = App.utils.hexToRgb(color)!;
        const intensity = amount / 100; // Range -1 to 1
        const midpoint = size / 100; 
        const softness = Math.max(0.01, feather / 100);
        const rnd = roundness / 100;

        const cx = w / 2;
        const cy = h / 2;
        
        // Calculate radii divisors based on Roundness
        const maxRad = Math.max(cx, cy);
        const rx = cx * (1 - rnd) + maxRad * rnd;
        const ry = cy * (1 - rnd) + maxRad * rnd;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;

                // Normalized distance from center
                const dx = (x - cx) / rx;
                const dy = (y - cy) / ry;
                const dist = Math.sqrt(dx*dx + dy*dy);

                let vFactor = 0;
                
                if (dist > midpoint) {
                    vFactor = (dist - midpoint) / softness;
                    vFactor = Math.min(1, Math.max(0, vFactor));
                    vFactor = vFactor * vFactor * (3 - 2 * vFactor); // Smoothstep
                }

                if (vFactor > 0) {
                    if (intensity > 0) {
                        // Positive: Blend towards Color (Add Vignette)
                        const alpha = vFactor * intensity;
                        const invA = 1 - alpha;

                        data[idx]   = data[idx]   * invA + rgb.r * alpha;
                        data[idx+1] = data[idx+1] * invA + rgb.g * alpha;
                        data[idx+2] = data[idx+2] * invA + rgb.b * alpha;
                    } else {
                        // Negative: Brighten (Remove Vignette / Lens Correction)
                        const gain = vFactor * Math.abs(intensity) * 2.0;
                        data[idx]   = Math.min(255, data[idx]   * (1 + gain));
                        data[idx+1] = Math.min(255, data[idx+1] * (1 + gain));
                        data[idx+2] = Math.min(255, data[idx+2] * (1 + gain));
                    }
                }
            }
        }
    }
});
