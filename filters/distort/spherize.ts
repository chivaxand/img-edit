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
    Filters.register('distort-spherize', {
        name: 'Spherize / Pinch',
        mode: 'pixel',
        menu: {
            path: 'Filter/Distort',
            label: 'Spherize / Pinch...',
            order: 5
        },

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { 
                amount: 50, 
                radius: 0, 
                interpolation: 'bilinear' as InterpolationType,
                boundary: 'constant' as BoundaryMode,
                antialiasing: false
            }; 
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
            container.appendChild(createBoundarySelect(state, update));
            container.appendChild(UI.createCheckbox({
                label: 'Antialiasing (Super-sampling)',
                value: state.antialiasing,
                onChange: v => { state.antialiasing = v; update(); }
            }));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { amount, radius, interpolation, boundary, antialiasing }: any) {
            const strength = amount / 100;
            const effectRadius = radius > 0 ? radius : Math.min(w, h) / 2;
            const rSq = effectRadius * effectRadius;

            const imageWrapper = { data, width: w, height: h };
            Lib.image.deform(imageWrapper, imageWrapper, (x: number, y: number, cx: number, cy: number) => {
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
            }, { interpolation, boundary, antialiasing });
        }
    });
})();
