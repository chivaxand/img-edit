import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('exposure', {
    name: 'Exposure',
    mode: 'pixel',
    menu: {
        path: 'Tone',
        label: 'Exposure...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { exposure: 0, gamma: 2.2, mode: 'natural' };
        
        const update = () => hooks.preview(state);

        // Algorithm Selector
        container.appendChild(UI.createSelectRow({
            label: 'Algorithm',
            value: state.mode,
            options: [
                { value: 'natural', text: 'Natural (trained)' },
                { value: 'linear', text: 'Linear' }
            ],
            onChange: v => {
                state.mode = v;
                gammaRow.style.display = (v === 'natural') ? 'flex' : 'none';
                update();
            }
        }));

        // Exposure Slider
        container.appendChild(UI.createSliderRow({
            label: 'Exposure', min: -5, max: 5, step: 0.1, value: state.exposure,
            onInput: v => { state.exposure = parseFloat(v); update(); }
        }));

        // Gamma Slider (Only for Natural mode)
        const gammaRow = UI.createSliderRow({
            label: 'Gamma', min: 0.1, max: 5, step: 0.01, value: state.gamma,
            onInput: v => { state.gamma = parseFloat(v); update(); }
        });
        container.appendChild(gammaRow);
        
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { exposure, gamma, mode }: any) {
        const lut = new Uint8ClampedArray(256);

        if (mode === 'linear') {
            // --- Algorithm: Linear ---
            const gain = Math.pow(2, exposure);
            for (let i = 0; i < 256; i++) {
                let v = i / 255.0;
                // sRGB -> Linear
                let lin = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                // Apply Exposure
                lin *= gain;
                // Linear -> sRGB
                let out_v = lin <= 0 ? 0 : (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055);
                lut[i] = Math.min(255, Math.max(0, out_v * 255));
            }
        } 
        else {
            // --- Algorithm: Natural (Rational Cubic) ---
            // Rational Function Helper
            const rational = (x: number, p: number[], q: number[]) => {
                const x2 = x * x;
                const x3 = x2 * x;
                const num = p[0] + p[1]*x + p[2]*x2 + p[3]*x3;
                const den = 1.0 + q[0]*x + q[1]*x2 + q[2]*x3;
                return num / (den + 0.000001);
            };

            // Trained Parameters (Order 3)
            const m2_p = [-0.005, 0.343, 0.248, -0.582];
            const m2_q = [2.264, -6.156, 2.896];
            
            const p2_p = [0.004, 4.135, -6.063, 1.957];
            const p2_q = [0.862, -2.471, 0.642];
            
            for (let i = 0; i < 256; i++) {
                const x = i / 255.0;
                let v;

                const v_m2 = rational(x, m2_p, m2_q);
                const v_p2 = rational(x, p2_p, p2_q);
                const v_0  = x; // 0 EV is Identity

                // Interpolate
                if (exposure > 0) {
                    const t = exposure / 2.0;
                    v = v_0 * (1 - t) + v_p2 * t;
                } else {
                    const t = Math.abs(exposure) / 2.0;
                    v = v_0 * (1 - t) + v_m2 * t;
                }

                // Optional gamma correction
                if (gamma > 0 && Math.abs(gamma - 2.2) > 0.01) {
                    v = Math.pow(v, 2.2 / gamma);
                }

                lut[i] = Math.min(255, Math.max(0, v * 255));
            }
        }

        // Apply LUT
        for (let i = 0; i < data.length; i += 4) {
            data[i]   = lut[data[i]];
            data[i+1] = lut[data[i+1]];
            data[i+2] = lut[data[i+2]];
        }
    }
});