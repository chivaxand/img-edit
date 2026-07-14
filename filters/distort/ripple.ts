import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';
import { InterpolationType, BoundaryMode } from '~/libs/image';

(function() {
    // --- Helper for UI ---
    const createAlgoSelect = (state: any, update: Function) => {
        return UI.createSelectRow({
            label: 'Interpolation',
            value: state.interpolation || 'bilinear',
            options: [
                { value: 'nearest', text: 'Nearest Neighbor' },
                { value: 'bilinear', text: 'Bilinear' },
                { value: 'bicubic', text: 'Bicubic' },
                { value: 'lanczos3', text: 'Lanczos3' }
            ],
            onChange: v => { state.interpolation = v as InterpolationType; update(); }
        });
    };

    const createBoundarySelect = (state: any, update: Function) => {
        return UI.createSelectRow({
            label: 'Boundary Mode',
            value: state.boundary || 'constant',
            options: [
                { value: 'constant', text: 'Constant (Transparent)' },
                { value: 'clamp', text: 'Clamp (Repeat Edge)' },
                { value: 'wrap', text: 'Wrap (Tiled)' },
                { value: 'reflect', text: 'Reflect' }
            ],
            onChange: v => { state.boundary = v as BoundaryMode; update(); }
        });
    };

    // --- Filter Registrations ---
    Filters.register('distort-ripple', {
        name: 'Ripple',
        mode: 'pixel',
        menu: {
            path: 'Filter/Distort',
            label: 'Ripple...',
            order: 3
        },

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { 
                mode: 'radial', 
                amplitude: 20, 
                frequency: 20, 
                phase: 0, 
                interpolation: 'bilinear' as InterpolationType,
                boundary: 'constant' as BoundaryMode,
                antialiasing: false
            };
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
            container.appendChild(createBoundarySelect(state, update));
            container.appendChild(UI.createCheckbox({
                label: 'Antialiasing (Super-sampling)',
                value: state.antialiasing,
                onChange: v => { state.antialiasing = v; update(); }
            }));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { mode, amplitude, frequency, phase, interpolation, boundary, antialiasing }: any) {
            const freq = frequency / 1000; 
            const ph = phase * (Math.PI / 180);
            
            const imageWrapper = { data, width: w, height: h };
            Lib.image.deform(imageWrapper, imageWrapper, (x: number, y: number, cx: number, cy: number) => {
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
            }, { interpolation, boundary, antialiasing });
        }
    });
})();
