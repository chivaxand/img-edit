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
    Filters.register('distort-twirl', {
        name: 'Twirl',
        mode: 'pixel',
        menu: {
            path: 'Filter/Distort',
            label: 'Twirl...',
            order: 2
        },

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { 
                radius: 200, 
                angle: 180, 
                interpolation: 'bilinear' as InterpolationType,
                boundary: 'constant' as BoundaryMode,
                antialiasing: false
            };
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
            container.appendChild(createBoundarySelect(state, update));
            container.appendChild(UI.createCheckbox({
                label: 'Antialiasing (Super-sampling)',
                value: state.antialiasing,
                onChange: v => { state.antialiasing = v; update(); }
            }));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { radius, angle, interpolation, boundary, antialiasing }: any) {
            const rad = angle * (Math.PI / 180);
            const imageWrapper = { data, width: w, height: h };
            Lib.image.deform(imageWrapper, imageWrapper, (x: number, y: number, cx: number, cy: number) => {
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
            }, { interpolation, boundary, antialiasing });
        }
    });
})();
