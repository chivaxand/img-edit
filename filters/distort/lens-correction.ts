import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

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
            onChange: v => { state.interpolation = v; update(); }
        });
    };

    // --- Filter Registrations ---

    Filters.register('distort-lens-correction', {
        name: 'Lens Correction',
        mode: 'pixel',
        menu: {
            path: 'Filter/Distort',
            label: 'Lens Correction...',
            order: 1
        },

        dialogOptions: { width: '90%', maxWidth: '600px' },

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { 
                k1: 0, k2: 0, k3: 0, 
                p1: 0, p2: 0, 
                scale: 1.0,
                interpolation: 'bilinear',
                iterations: 1,
                antialiasing: false
            };
            const update = () => hooks.preview(state);

            container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
                'Brown-Conrady model. Uses multi-pass coordinate refinement to preserve quality.'));

            // Radial
            container.appendChild(UI.createSubheading('Radial Distortion'));
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
            container.appendChild(UI.createSubheading('Tangential Distortion'));
            container.appendChild(UI.createSliderRow({
                label: 'p1', min: -0.2, max: 0.2, step: 0.001, value: state.p1,
                onInput: v => { state.p1 = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'p2', min: -0.2, max: 0.2, step: 0.001, value: state.p2,
                onInput: v => { state.p2 = parseFloat(v); update(); }
            }));

            container.appendChild(UI.createSubheading('View'));
            container.appendChild(UI.createSliderRow({
                label: 'Scale', min: 0.5, max: 1.5, step: 0.01, value: state.scale,
                onInput: v => { state.scale = parseFloat(v); update(); }
            }));

            // Refinement
            container.appendChild(UI.createSubheading('Refinement'));
            container.appendChild(UI.createSliderRow({
                label: 'Iterations', min: 1, max: 20, step: 1, value: state.iterations,
                onInput: v => { state.iterations = parseInt(v); update(); }
            }));

            container.appendChild(createAlgoSelect(state, update));
            container.appendChild(UI.createCheckbox({
                label: 'Antialiasing (Super-sampling)',
                value: state.antialiasing,
                onChange: v => { state.antialiasing = v; update(); }
            }));
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { k1, k2, k3, p1, p2, scale, interpolation, iterations, antialiasing }: any) {
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

            const imageWrapper = { data, width: w, height: h };
            // Calculate coordinate mapping in a single pass using the consolidated deform pipeline
            Lib.image.deform(imageWrapper, imageWrapper, (x: number, y: number, cx: number, cy: number) => {
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
            }, { interpolation: interpolation || 'bilinear', boundary: 'constant', antialiasing });
        }
    });
})();
