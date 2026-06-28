import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('tone', {
    name: 'Shadows / Mids / Highlights',
    mode: 'pixel',
    menu: {
        path: 'Tone',
        label: 'Shadows & Highlights...',
        order: 7
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { shadows: 0, mids: 0, highlights: 0, algo: 'smooth' };
        const update = () => hooks.preview(state);

        // Algorithm Selector
        container.appendChild(UI.createSelectRow({
            label: 'Algorithm', 
            options: [
                { value: 'smooth', text: 'Smooth' },
                { value: 'deep', text: 'Deep' }
            ],
            value: state.algo, 
            onChange: v => { state.algo = v; update(); }
        }));

        // Sliders
        container.appendChild(UI.createSliderRow({ label: 'Shadows', min: -100, max: 100, value: state.shadows, onInput: v => { state.shadows = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Midtones', min: -100, max: 100, value: state.mids, onInput: v => { state.mids = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Highlights', min: -100, max: 100, value: state.highlights, onInput: v => { state.highlights = parseInt(v); update(); } }));
        
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { shadows, mids, highlights, algo }: any) {
        // Convert inputs to -1..1 range
        const s = shadows / 100;
        const m = mids / 100;
        const h_val = highlights / 100;

        // Prepare the Lookup Table (LUT) for Luminance
        const lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) {
            const x = i / 255;
            let offset = 0;

            if (algo === 'deep') {
                // Algorithm 2: Sharper cubic curves
                const vShad = Math.pow(1 - x, 3) * x; 
                const vHigh = Math.pow(x, 3) * (1 - x);
                const vMid = Math.sin(Math.PI * x);
                offset = (s * vShad * 6.0) + (h_val * vHigh * 4.0) + (m * vMid * 0.25);
            } else {
                // Algorithm 1: Smooth quadratic curves (Default)
                const vShad = (1 - x) * (1 - x) * x; 
                const vHigh = x * x * (1 - x);
                const vMid = Math.sin(Math.PI * x);
                offset = (s * vShad * 2.0) + (h_val * vHigh * 2.0) + (m * vMid * 0.25);
            }
            
            lut[i] = Math.min(255, Math.max(0, (x + offset) * 255));
        }

        // Apply LUT using Luminance Ratio
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

            const targetLuma = lut[luma];
            if (luma === targetLuma) continue;

            // Apply Gain Ratio
            const ratio = (luma > 0) ? (targetLuma / luma) : 1;
            data[i]   = Math.min(255, r * ratio);
            data[i+1] = Math.min(255, g * ratio);
            data[i+2] = Math.min(255, b * ratio);
        }
    }
});
