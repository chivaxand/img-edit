import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

(function() {
    // --- Shared private functions ---

    const getPixel = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number, cOff: number) => {
        let sx = Math.floor(x);
        let sy = Math.floor(y);
        if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        return data[(sy * w + sx) * 4 + cOff];
    };

    const sampleNearest = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number, cOff: number) => {
        return getPixel(data, w, h, Math.round(x), Math.round(y), cOff);
    };

    const sampleBilinear = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number, channelOffset: number) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const sx0 = x0 < 0 ? 0 : (x0 >= w ? w - 1 : x0);
        const sx1 = x1 < 0 ? 0 : (x1 >= w ? w - 1 : x1);
        const sy0 = y0 < 0 ? 0 : (y0 >= h ? h - 1 : y0);
        const sy1 = y1 < 0 ? 0 : (y1 >= h ? h - 1 : y1);
        const idx00 = (sy0 * w + sx0) * 4 + channelOffset;
        const idx10 = (sy0 * w + sx1) * 4 + channelOffset;
        const idx01 = (sy1 * w + sx0) * 4 + channelOffset;
        const idx11 = (sy1 * w + sx1) * 4 + channelOffset;
        const dx = x - x0;
        const dy = y - y0;
        const top = data[idx00] * (1 - dx) + data[idx10] * dx;
        const bot = data[idx01] * (1 - dx) + data[idx11] * dx;
        return top * (1 - dy) + bot * dy;
    };

    const sampleBicubic = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number, cOff: number) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const dx = x - x0;
        const dy = y - y0;

        // Catmull-Rom spline
        const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
            return 0.5 * ((2 * p1) + (-p0 + p2) * t + 
                (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + 
                (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        };

        const row = (offsetY: number) => {
            return cubic(
                getPixel(data, w, h, x0 - 1, y0 + offsetY, cOff),
                getPixel(data, w, h, x0,     y0 + offsetY, cOff),
                getPixel(data, w, h, x0 + 1, y0 + offsetY, cOff),
                getPixel(data, w, h, x0 + 2, y0 + offsetY, cOff),
                dx
            );
        };

        const val = cubic(row(-1), row(0), row(1), row(2), dy);
        return Math.max(0, Math.min(255, val));
    };

    const Samplers: Record<string, Function> = {
        'nearest': sampleNearest,
        'bilinear': sampleBilinear,
        'bicubic': sampleBicubic,
    };

    const applyDistortion = (data: Uint8ClampedArray, w: number, h: number, mapFunc: Function, algo = 'bilinear') => {
        const src = new Uint8ClampedArray(data);
        const cx = w / 2;
        const cy = h / 2;
        const sampler = Samplers[algo] || Samplers.bilinear;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const { u, v } = mapFunc(x, y, cx, cy);
                const idx = (y * w + x) * 4;
                if (u < -1 || u > w || v < -1 || v > h) {
                    data[idx] = data[idx+1] = data[idx+2] = data[idx+3] = 0;
                } else {
                    data[idx]     = sampler(src, w, h, u, v, 0);
                    data[idx + 1] = sampler(src, w, h, u, v, 1);
                    data[idx + 2] = sampler(src, w, h, u, v, 2);
                    data[idx + 3] = sampler(src, w, h, u, v, 3);
                }
            }
        }
    };

    // --- Helper for UI ---
    
    const createAlgoSelect = (state: any, update: Function) => {
        return UI.createSelectRow({
            label: 'Interpolation',
            value: state.interpolation || 'bilinear',
            options: [
                { value: 'bilinear', text: 'Bilinear' },
                { value: 'bicubic', text: 'Bicubic' },
                { value: 'nearest', text: 'Nearest Neighbor' }
            ],
            onChange: v => { state.interpolation = v; update(); }
        });
    };

    // --- Filter Registrations ---

    Filters.register('distort-twirl', {
        name: 'Twirl',
        mode: 'pixel',

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { radius: 200, angle: 180, interpolation: 'bilinear' };
            const update = () => hooks.preview(state);

            container.appendChild(UI.createSliderRow({
                label: 'Radius', min: 10, max: 1000, step: 10, value: state.radius,
                onInput: v => { state.radius = parseInt(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Angle', min: -720, max: 720, step: 10, value: state.angle,
                onInput: v => { state.angle = parseInt(v); update(); }
            }));
            container.appendChild(createAlgoSelect(state, update));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { radius, angle, interpolation }: any) {
            const rad = angle * (Math.PI / 180);
            applyDistortion(data, w, h, (x: number, y: number, cx: number, cy: number) => {
                const dx = x - cx;
                const dy = y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist > radius) return { u: x, v: y };

                const factor = (1.0 - dist / radius);
                const a = Math.atan2(dy, dx) + factor * factor * rad;
                
                return {
                    u: cx + Math.cos(a) * dist,
                    v: cy + Math.sin(a) * dist
                };
            }, interpolation);
        }
    });

    Filters.register('distort-ripple', {
        name: 'Ripple',
        mode: 'pixel',

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { mode: 'radial', amplitude: 20, frequency: 20, phase: 0, interpolation: 'bilinear' };
            const update = () => hooks.preview(state);

            container.appendChild(UI.createSelectRow({
                label: 'Type',
                value: state.mode,
                options: [
                    { value: 'radial', text: 'Radial / Circular' },
                    { value: 'linear-x', text: 'Linear Horizontal' },
                    { value: 'linear-y', text: 'Linear Vertical' }
                ],
                onChange: v => { state.mode = v; update(); }
            }));

            container.appendChild(UI.createSliderRow({
                label: 'Amplitude', min: 0, max: 100, step: 1, value: state.amplitude,
                onInput: v => { state.amplitude = parseInt(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Frequency', min: 1, max: 100, step: 1, value: state.frequency,
                onInput: v => { state.frequency = parseInt(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Phase', min: 0, max: 360, step: 10, value: state.phase,
                onInput: v => { state.phase = parseInt(v); update(); }
            }));
            container.appendChild(createAlgoSelect(state, update));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { mode, amplitude, frequency, phase, interpolation }: any) {
            const freq = frequency / 1000; 
            const ph = phase * (Math.PI / 180);
            
            applyDistortion(data, w, h, (x: number, y: number, cx: number, cy: number) => {
                if (mode === 'radial') {
                    const dx = x - cx;
                    const dy = y - cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0.01) {
                        const amount = Math.sin(dist * freq * Math.PI * 2 + ph) * amplitude;
                        return {
                            u: x + (dx / dist) * amount,
                            v: y + (dy / dist) * amount
                        };
                    }
                    return { u: x, v: y };
                } else if (mode === 'linear-y') {
                    return {
                        u: x,
                        v: y + Math.sin(x * freq * Math.PI * 2 + ph) * amplitude
                    };
                } else {
                    return {
                        u: x + Math.sin(y * freq * Math.PI * 2 + ph) * amplitude,
                        v: y
                    };
                }
            }, interpolation);
        }
    });

    Filters.register('distort-water', {
        name: 'Water Surface',
        mode: 'pixel',

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { 
                amplitude: 15, frequency: 15, perspective: 60, speed: 10,
                lacunarity: 1.8, gain: 0.5, interpolation: 'bilinear' 
            };
            const update = () => hooks.preview(state);

            container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
                'Simulates chaotic ocean waves using FBM noise.'));

            container.appendChild(UI.createSliderRow({
                label: 'Choppiness', min: 0, max: 100, step: 0.1, value: state.amplitude,
                onInput: v => { state.amplitude = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Scale', min: 1, max: 100, step: 0.1, value: state.frequency,
                onInput: v => { state.frequency = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Perspective', min: 0, max: 100, step: 0.1, value: state.perspective,
                onInput: v => { state.perspective = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Flow', min: 0, max: 360, step: 0.1, value: state.speed,
                onInput: v => { state.speed = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Lacunarity', min: 1.0, max: 4.0, step: 0.05, value: state.lacunarity,
                onInput: v => { state.lacunarity = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Gain', min: 0.1, max: 0.95, step: 0.05, value: state.gain,
                onInput: v => { state.gain = parseFloat(v); update(); }
            }));
            container.appendChild(createAlgoSelect(state, update));
            
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { amplitude, frequency, perspective, speed, lacunarity, gain, interpolation }: any) {
            if (amplitude === 0) return;

            const iter = 8;
            const time = speed * 0.1;
            const aspect = 1 + (perspective / 30);
            
            const rotAng = 1.75; 
            const cosR = Math.cos(rotAng);
            const sinR = Math.sin(rotAng);
            
            const baseFreqX = frequency / 400;
            const baseFreqY = baseFreqX * aspect;
            const ampFactor = amplitude * 0.5;

            const lac = lacunarity;
            const g = gain;

            applyDistortion(data, w, h, (x: number, y: number) => {
                let u_offset = 0;
                let v_offset = 0;

                let nx = x * baseFreqX;
                let ny = y * baseFreqY;
                let currentAmp = 1.0;

                for (let i = 0; i < iter; i++) {
                    const speedMod = 1 + i * 0.2;
                    const phaseX = nx + time * speedMod;
                    const phaseY = ny + time * speedMod; 
                    
                    u_offset += Math.cos(phaseX) * currentAmp;
                    v_offset += Math.sin(phaseY) * currentAmp; 

                    const rx = nx * cosR - ny * sinR;
                    const ry = nx * sinR + ny * cosR;

                    nx = rx * lac; 
                    ny = ry * lac;
                    currentAmp *= g; 
                }

                return {
                    u: x + u_offset * ampFactor,
                    v: y + v_offset * ampFactor
                };
            }, interpolation);
        }
    });

    Filters.register('distort-spherize', {
        name: 'Spherize / Pinch',
        mode: 'pixel',

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { amount: 50, radius: 0, interpolation: 'bilinear' }; 
            const update = () => hooks.preview(state);

            container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
                'Positive = Sphere, Negative = Pinch'));

            container.appendChild(UI.createSliderRow({
                label: 'Amount', min: -100, max: 100, step: 1, value: state.amount,
                onInput: v => { state.amount = parseInt(v); update(); }
            }));
            
            container.appendChild(UI.createSliderRow({
                label: 'Radius', min: 0, max: 1000, step: 10, value: state.radius,
                onInput: v => { state.radius = parseInt(v); update(); },
                formatter: v => v === 0 ? 'Auto' : String(v)
            }));
            container.appendChild(createAlgoSelect(state, update));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { amount, radius, interpolation }: any) {
            const strength = amount / 100;
            const effectRadius = radius > 0 ? radius : Math.min(w, h) / 2;
            const rSq = effectRadius * effectRadius;

            applyDistortion(data, w, h, (x: number, y: number, cx: number, cy: number) => {
                const dx = x - cx;
                const dy = y - cy;
                const distSq = dx * dx + dy * dy;

                if (distSq >= rSq) return { u: x, v: y };

                const dist = Math.sqrt(distSq);
                const t = dist / effectRadius;
                
                let factor;
                if (strength > 0) {
                    factor = 1.0 - strength * (1.0 - t * t);
                } else {
                    factor = 1.0 + Math.abs(strength) * (1.0 - t);
                }

                const u = cx + dx * factor;
                const v = cy + dy * factor;

                return { u, v };
            }, interpolation);
        }
    });

    Filters.register('distort-lens-correction', {
        name: 'Lens Correction',
        mode: 'pixel',
        dialogOptions: { width: '90%', maxWidth: '600px' },

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { 
                k1: 0, k2: 0, k3: 0, 
                p1: 0, p2: 0, 
                scale: 1.0,
                interpolation: 'bilinear',
                iterations: 1
            };
            const update = () => hooks.preview(state);

            container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
                'Brown-Conrady model. Uses multi-pass coordinate refinement to preserve quality.'));

            // Radial
            container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Radial Distortion'));
            container.appendChild(UI.createSliderRow({
                label: 'k1', min: -1.0, max: 1.0, step: 0.001, value: state.k1,
                onInput: v => { state.k1 = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'k2', min: -1.0, max: 1.0, step: 0.001, value: state.k2,
                onInput: v => { state.k2 = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'k3', min: -1.0, max: 1.0, step: 0.001, value: state.k3,
                onInput: v => { state.k3 = parseFloat(v); update(); }
            }));

            // Tangential
            container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Tangential Distortion'));
            container.appendChild(UI.createSliderRow({
                label: 'p1', min: -0.2, max: 0.2, step: 0.001, value: state.p1,
                onInput: v => { state.p1 = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'p2', min: -0.2, max: 0.2, step: 0.001, value: state.p2,
                onInput: v => { state.p2 = parseFloat(v); update(); }
            }));

            container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'View'));
            container.appendChild(UI.createSliderRow({
                label: 'Scale', min: 0.5, max: 1.5, step: 0.01, value: state.scale,
                onInput: v => { state.scale = parseFloat(v); update(); }
            }));

            // Refinement
            container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Refinement'));
            container.appendChild(UI.createSliderRow({
                label: 'Iterations', min: 1, max: 20, step: 1, value: state.iterations,
                onInput: v => { state.iterations = parseInt(v); update(); }
            }));

            container.appendChild(createAlgoSelect(state, update));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { k1, k2, k3, p1, p2, scale, interpolation, iterations }: any) {
            const norm = Math.min(w, h) / 2;
            const invNorm = 1.0 / norm;
            const iter = Math.max(1, iterations || 1);

            // Divide parameters for sequential integration
            // This spreads the distortion over 'iter' steps to maintain monotonicity
            const s_k1 = k1 / iter;
            const s_k2 = k2 / iter;
            const s_k3 = k3 / iter;
            const s_p1 = p1 / iter;
            const s_p2 = p2 / iter;
            // Scale applies geometrically
            const s_scale = Math.pow(scale, 1 / iter);

            // Calculate coordinate mapping in a single pass
            applyDistortion(data, w, h, (x: number, y: number, cx: number, cy: number) => {
                // Start with normalized ideal coordinates
                let u_curr = (x - cx) * invNorm;
                let v_curr = (y - cy) * invNorm;

                // Apply distortion formula iteratively on coordinates ONLY
                // This prevents pixel resampling degradation
                for (let i = 0; i < iter; i++) {
                    const r2 = u_curr * u_curr + v_curr * v_curr;
                    const r4 = r2 * r2;
                    const r6 = r4 * r2;

                    // Radial component
                    const radial = 1 + s_k1 * r2 + s_k2 * r4 + s_k3 * r6;

                    // Tangential component
                    const du_tan = 2 * s_p1 * u_curr * v_curr + s_p2 * (r2 + 2 * u_curr * u_curr);
                    const dv_tan = s_p1 * (r2 + 2 * v_curr * v_curr) + 2 * s_p2 * u_curr * v_curr;

                    // Update coordinates for next pass
                    let u_next = u_curr * radial + du_tan;
                    let v_next = v_curr * radial + dv_tan;

                    // Apply incremental scale
                    u_curr = u_next / s_scale;
                    v_curr = v_next / s_scale;
                }

                // Map final normalized coordinate back to pixel space
                // The image sampler runs only once here
                return {
                    u: cx + u_curr * norm,
                    v: cy + v_curr * norm
                };
            }, interpolation);
        }
    });
})();