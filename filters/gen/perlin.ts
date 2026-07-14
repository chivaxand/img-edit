import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';

Filters.register('perlin-noise', {
    name: 'Perlin Noise',
    mode: 'pixel',
    menu: {
        path: 'Generate',
        label: 'Perlin Noise...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            scale: 64,
            phase: 0,
            seed: Math.floor(Math.random() * 65536),
            octaves: 4,
            persistence: 0.5,
            contrast: 100,
            brightness: 0,
            blend: 'replace',
            opacity: 100
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Fractal Perlin noise. Use Phase to animate/shift patterns.'));

        // Basic Controls
        container.appendChild(UI.createSliderRow({
            label: 'Scale', min: 4, max: 200, step: 1, value: state.scale,
            onInput: (v: any) => { state.scale = parseFloat(v); update(); }
        }));
        
        container.appendChild(UI.createSliderRow({
            label: 'Phase', min: 0, max: 10, step: 0.1, value: state.phase,
            onInput: (v: any) => { state.phase = parseFloat(v); update(); }
        }));

        // Fractal Controls
        container.appendChild(UI.createSliderRow({
            label: 'Octaves', min: 1, max: 8, step: 1, value: state.octaves,
            onInput: (v: any) => { state.octaves = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Persistence', min: 0, max: 1, step: 0.05, value: state.persistence,
            onInput: (v: any) => { state.persistence = parseFloat(v); update(); }
        }));

        // Seed
        const seedInput = UI.createInput('number', { value: state.seed, style: {width:'80px'} }, (t: any) => {
            state.seed = parseInt(t.value);
            update();
        });
        const seedBtn = UI.createNode('button', { className:'btn', textContent:'Rand', style:'margin:0; padding:4px 8px;', 
            on: { click: () => { 
                state.seed = Math.floor(Math.random() * 65536); 
                (seedInput as HTMLInputElement).value = String(state.seed); 
                update(); 
            }} 
        });
        container.appendChild(UI.createRow('Seed', UI.createNode('div', {style:{display:'flex', gap:'5px'}}, seedInput, seedBtn)));

        container.appendChild(UI.createNode('div', { className: 'popup-separator' }));

        // Post-Processing
        container.appendChild(UI.createSliderRow({
            label: 'Contrast', min: 0, max: 200, value: state.contrast,
            onInput: (v: any) => { state.contrast = parseInt(v); update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Brightness', min: -100, max: 100, value: state.brightness,
            onInput: (v: any) => { state.brightness = parseInt(v); update(); }
        }));

        // Blending Controls
        container.appendChild(UI.createSubheading('Blending'));
        container.appendChild(UI.createSelectRow({
            label: 'Mode', 
            options: [
                { value: 'replace', text: 'Replace' },
                { value: 'mix', text: 'Mix (Normal)' },
                { value: 'overlay', text: 'Overlay' },
                { value: 'multiply', text: 'Multiply' },
                { value: 'add', text: 'Add' },
                { value: 'screen', text: 'Screen' }
            ],
            value: state.blend,
            onChange: (v: any) => { state.blend = v; update(); }
        }));
        
        container.appendChild(UI.createSliderRow({ 
            label: 'Opacity', min: 0, max: 100, value: state.opacity, 
            onInput: (v: any) => { state.opacity = parseInt(v); update(); } 
        }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, { scale, phase, seed, octaves, persistence, contrast, brightness, blend, opacity }: any) {
        // Pseudo-random hash for deterministic gradients
        const hash = (x: number, y: number, s: number) => {
            const k = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453;
            return k - Math.floor(k);
        };

        const lerp = (a: number, b: number, t: number) => a + t * (b - a);
        const smoothstep = (t: number) => t * t * (3 - 2 * t);

        const getGradient = (x: number, y: number, s: number) => {
            // Get a random angle based on coordinates and seed
            const angle = hash(x, y, s) * 2 * Math.PI + phase;
            return { x: Math.cos(angle), y: Math.sin(angle) };
        };

        const noise = (x: number, y: number, s: number) => {
            const X = Math.floor(x);
            const Y = Math.floor(y);
            const fx = x - X;
            const fy = y - Y;

            // Corners
            const n00 = getGradient(X, Y, s);
            const n10 = getGradient(X + 1, Y, s);
            const n01 = getGradient(X, Y + 1, s);
            const n11 = getGradient(X + 1, Y + 1, s);

            // Dot products
            const v00 = n00.x * fx + n00.y * fy;
            const v10 = n10.x * (fx - 1) + n10.y * fy;
            const v01 = n01.x * fx + n01.y * (fy - 1);
            const v11 = n11.x * (fx - 1) + n11.y * (fy - 1);

            // Interpolate
            const u = smoothstep(fx);
            const v = smoothstep(fy);

            return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
        };

        const alpha = opacity / 100;
        const cFactor = contrast / 100;
        const bOffset = brightness / 100;

        const applyBlend = (bg: number, fg: number) => {
            if (blend === 'replace') return fg;
            let res = fg;
            if (blend === 'add') {
                res = bg + fg;
            } else if (blend === 'multiply') {
                res = (bg * fg) / 255;
            } else if (blend === 'screen') {
                res = 255 - (255 - bg) * (255 - fg) / 255;
            } else if (blend === 'overlay') {
                res = bg < 128 
                    ? (2 * bg * fg / 255) 
                    : (255 - 2 * (255 - bg) * (255 - fg) / 255);
            }
            // Mix/Normal logic combined with alpha
            return bg * (1 - alpha) + res * alpha;
        };

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let total = 0;
                let frequency = 1;
                let amplitude = 1;
                let maxValue = 0;

                for (let i = 0; i < octaves; i++) {
                    // Use different seed offset for each octave to decorrelate
                    total += noise(x / scale * frequency, y / scale * frequency, seed + i * 13) * amplitude;
                    maxValue += amplitude;
                    amplitude *= persistence;
                    frequency *= 2;
                }

                // Normalize roughly to -1..1 range
                let val = total / maxValue;
                val = (val * 0.7) + 0.5; // Map approx -0.7..0.7 to 0..1
                val = (val - 0.5) * cFactor + 0.5 + bOffset; // Contrast & Brightness
                
                const noiseVal = Math.max(0, Math.min(255, val * 255));
                const idx = (y * w + x) * 4;

                if (blend === 'replace' && alpha === 1) {
                    data[idx] = noiseVal;
                    data[idx + 1] = noiseVal;
                    data[idx + 2] = noiseVal;
                    data[idx + 3] = 255;
                } else {
                    data[idx] = applyBlend(data[idx], noiseVal);
                    data[idx+1] = applyBlend(data[idx+1], noiseVal);
                    data[idx+2] = applyBlend(data[idx+2], noiseVal);
                    if (blend === 'replace') data[idx+3] = 255; 
                }
            }
        }
    }
});
