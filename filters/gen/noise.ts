import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';

Filters.register('noise', {
    name: 'Generate Noise',
    mode: 'pixel',
    menu: {
        path: 'Generate',
        label: 'Noise (White)...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            type: 'gray',    // bw, gray, rgb
            dist: 'uniform', // uniform, gaussian
            blend: 'mix',    // replace, mix, overlay, multiply, add
            opacity: 100,    // 0-100
            min: 0,
            max: 255,
            sigma: 20
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createSelectRow({
            label: 'Type', 
            options: [
                { value: 'bw', text: 'Binary (Min/Max)' },
                { value: 'gray', text: 'Grayscale' },
                { value: 'rgb', text: 'Color (RGB)' }
            ],
            value: state.type,
            onChange: (v: any) => { state.type = v; update(); }
        }));

        const rowSigma = UI.createSliderRow({ label: 'Sigma', min: 1, max: 100, value: state.sigma, onInput: (v: any) => { state.sigma = parseInt(v); update(); } });
        rowSigma.style.display = 'none';

        container.appendChild(UI.createSelectRow({
            label: 'Dist',
            options: [
                { value: 'uniform', text: 'Uniform' },
                { value: 'gaussian', text: 'Gaussian' }
            ],
            value: state.dist,
            onChange: (v: any) => { 
                state.dist = v; 
                rowSigma.style.display = state.dist === 'gaussian' ? 'flex' : 'none';
                update(); 
            }
        }));

        // --- Values ---
        container.appendChild(UI.createSubheading('Values'));
        container.appendChild(UI.createSliderRow({ label: 'Min / C1', min: 0, max: 255, value: state.min, onInput: (v: any) => { state.min = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Max / C2', min: 0, max: 255, value: state.max, onInput: (v: any) => { state.max = parseInt(v); update(); } }));
        container.appendChild(rowSigma);

        // --- Blending Controls ---
        container.appendChild(UI.createSubheading('Blending'));
        container.appendChild(UI.createSelectRow({
            label: 'Mode', 
            options: [
                { value: 'replace', text: 'Replace (Generator)' },
                { value: 'mix', text: 'Mix (Normal)' },
                { value: 'overlay', text: 'Overlay (Grain)' },
                { value: 'multiply', text: 'Multiply' },
                { value: 'add', text: 'Add (Linear Dodge)' }
            ],
            value: state.blend,
            onChange: (v: any) => { state.blend = v; update(); }
        }));
        
        container.appendChild(UI.createSliderRow({ label: 'Opacity', min: 0, max: 100, value: state.opacity, onInput: (v: any) => { state.opacity = parseInt(v); update(); } }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { type, dist, min, max, sigma, blend, opacity } = params;
        const range = max - min;
        const mean = min + range / 2;
        const alpha = opacity / 100;
        let gaussStoredVal: number | null = null;

        const gauss = () => {
            if (gaussStoredVal !== null) {
                const val = gaussStoredVal;
                gaussStoredVal = null;
                return val;
            }
            let u = 0, v = 0;
            while(u === 0) u = Math.random();
            while(v === 0) v = Math.random();
            // Box-Muller transform
            const mul = Math.sqrt(-2.0 * Math.log(u));
            gaussStoredVal = mul * Math.sin(2.0 * Math.PI * v);
            return mul * Math.cos(2.0 * Math.PI * v);
        };

        const getNoiseVal = () => {
            let val;
            if (dist === 'uniform') {
                val = Math.floor(Math.random() * (range + 1)) + min;
            } else {
                // Gaussian centered between Min/Max
                val = mean + gauss() * sigma;
            }
            val = val < 0 ? 0 : (val > 255 ? 255 : val);
            if (type === 'bw') { return val < mean ? min : max; }
            return val;
        };

        const applyBlend = (bg: number, fg: number) => {
            if (blend === 'replace') return fg;
            let res = 0;
            if (blend === 'mix') {
                res = fg; 
            } else if (blend === 'add') {
                res = bg + fg;
            } else if (blend === 'multiply') {
                res = (bg * fg) / 255;
            } else if (blend === 'overlay') {
                res = bg < 128 
                    ? (2 * bg * fg / 255) 
                    : (255 - 2 * (255 - bg) * (255 - fg) / 255);
            }
            return bg * (1 - alpha) + res * alpha;
        };

        for (let i = 0; i < data.length; i += 4) {
            // Generate noise
            let nR, nG, nB;
            if (type === 'rgb') {
                nR = getNoiseVal(); nG = getNoiseVal(); nB = getNoiseVal();
            } else {
                const v = getNoiseVal();
                nR = v; nG = v; nB = v;
            }

            // Blend with image
            if (blend === 'replace' && alpha === 1) {
                data[i] = nR; data[i+1] = nG; data[i+2] = nB; data[i+3] = 255;
            } else {
                data[i]     = applyBlend(data[i], nR);
                data[i + 1] = applyBlend(data[i+1], nG);
                data[i + 2] = applyBlend(data[i+2], nB);
                if (blend === 'replace') data[i+3] = 255; 
            }
        }
    }
});
