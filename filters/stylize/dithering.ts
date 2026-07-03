import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('dither', {
    name: 'Dithering',
    mode: 'pixel',
    menu: {
        path: 'Filter/Stylize',
        label: 'Dithering...',
        order: 3
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { 
            algo: 'stucki', 
            brightness: 0, 
            gamma: 2.2
        };
        const update = () => hooks.preview(state);
        
        container.appendChild(UI.createSelectRow({
            label: 'Algorithm',
            options: [
                // Error Diffusion (Best Detail)
                { value: 'stucki', text: 'Stucki' },
                { value: 'burkes', text: 'Burkes' },
                { value: 'jjn', text: 'Jarvis-Judice-Ninke' },
                { value: 'sierra', text: 'Sierra' },
                { value: 'floyd', text: 'Floyd-Steinberg' },
                { value: 'atkinson', text: 'Atkinson' },
                
                // Fixed Pattern Ordered (Retro/Printer)
                { value: 'ordered_dot', text: 'Ordered (Dot)' },
                { value: 'ordered_line', text: 'Ordered (Line)' },
                { value: 'ordered_bayer', text: 'Ordered (Bayer)' },
                
                // Fast/Rough
                { value: 'sierra_2', text: 'Sierra Two-Row' },
                { value: 'sierra_lite', text: 'Sierra Lite' },
                { value: 'false_floyd', text: 'False Floyd-Steinberg' }
            ],
            value: state.algo,
            onChange: v => { state.algo = v; update(); }
        }));
        
        container.appendChild(UI.createSliderRow({
            label: 'Brightness',
            min: -100, max: 100, step: 1,
            value: state.brightness,
            onInput: v => { state.brightness = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Gamma',
            min: 0.1, max: 4.0, step: 0.1,
            value: state.gamma,
            onInput: v => { state.gamma = parseFloat(v); update(); }
        }));

        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, { algo, brightness, gamma }: any) {
        // Error Diffusion Kernels: [dx, dy, weight, ...]
        const kernels: Record<string, any> = {
            stucki:      { div: 42, map: [1,0,8, 2,0,4, -2,1,2, -1,1,4, 0,1,8, 1,1,4, 2,1,2, -2,2,1, -1,2,2, 0,2,4, 1,2,2, 2,2,1] },
            burkes:      { div: 32, map: [1,0,8, 2,0,4, -2,1,2, -1,1,4, 0,1,8, 1,1,4, 2,1,2] },
            jjn:         { div: 48, map: [1,0,7, 2,0,5, -2,1,3, -1,1,5, 0,1,7, 1,1,5, 2,1,3, -2,2,1, -1,2,3, 0,2,5, 1,2,3, 2,2,1] },
            sierra:      { div: 32, map: [1,0,5, 2,0,3, -2,1,2, -1,1,4, 0,1,5, 1,1,4, 2,1,2, -1,2,2, 0,2,3, 1,2,2] },
            floyd:       { div: 16, map: [1,0,7, -1,1,3, 0,1,5, 1,1,1] },
            sierra_2:    { div: 16, map: [1,0,4, 2,0,3, -2,1,1, -1,1,2, 0,1,3, 1,1,2, 2,1,1] },
            atkinson:    { div: 8,  map: [1,0,1, 2,0,1, -1,1,1, 0,1,1, 1,1,1, 0,2,1] },
            sierra_lite: { div: 4,  map: [1,0,2, -1,1,1, 0,1,1] },
            false_floyd: { div: 8,  map: [1,0,3, 0,1,3, 1,1,2] }
        };

        // Fixed Ordered Patterns (4x4)
        const patterns: Record<string, any> = {
            ordered_bayer: { sz: 4, map: [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5] },
            ordered_dot:   { sz: 4, map: [12,5,6,13, 4,0,1,7, 11,3,2,8, 15,10,9,14] },
            ordered_line:  { sz: 4, map: [0,4,8,12, 12,0,4,8, 8,12,0,4, 4,8,12,0] }
        };

        const lum = new Float32Array(w * h);
        const Rw = 0.2126, Gw = 0.7152, Bw = 0.0722;
        
        // LUT for Gamma Correction + Brightness
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            let val = i + brightness;
            if (val < 0) val = 0;
            if (val > 255) val = 255;
            lut[i] = 255 * Math.pow(val / 255.0, gamma);
        }

        // Convert to Linear Luminance
        for (let i = 0; i < data.length; i += 4) {
            lum[i >> 2] = lut[data[i]] * Rw + lut[data[i+1]] * Gw + lut[data[i+2]] * Bw;
        }

        if (patterns[algo]) {
            // Fixed Ordered Dithering
            const { sz, map } = patterns[algo];
            const len = sz * sz;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const mapVal = map[(y % sz) * sz + (x % sz)];
                    const threshold = ((mapVal + 0.5) / len) * 255;
                    lum[i] = lum[i] > threshold ? 255 : 0;
                }
            }
        } else {
            // Error Diffusion
            const { div, map } = kernels[algo] || kernels.stucki;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const oldVal = lum[i];
                    const newVal = oldVal > 128 ? 255 : 0;
                    const err = (oldVal - newVal) / div;
                    lum[i] = newVal;

                    for (let k = 0; k < map.length; k += 3) {
                        const nx = x + map[k];
                        const ny = y + map[k + 1];
                        if (nx >= 0 && nx < w && ny < h) {
                            lum[ny * w + nx] += err * map[k + 2];
                        }
                    }
                }
            }
        }

        // Write to buffer
        for (let i = 0; i < lum.length; i++) {
            const v = lum[i];
            const idx = i << 2;
            data[idx] = data[idx+1] = data[idx+2] = v;
        }
    }
});