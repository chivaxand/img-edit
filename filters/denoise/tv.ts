import { Filters } from '../../filters';
import { UI } from '../../ui';
import { Layer } from '../../layers';
import { Lib } from '../../libs/index';

Filters.register('tv', {
    name: 'Total Variation',
    mode: 'pixel',
    menu: {
        path: 'Filter/Denoise',
        label: 'Total Variation...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            weight: 10,
            iter: 10,
            tau: 0.25
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Iterative optimization (Chambolle) to minimize total variation. Preserves edges well but flattens textures.'));

        container.appendChild(UI.createSliderRow({
            label: 'Denoise Amount', min: 1, max: 100, step: 1, value: state.weight,
            onInput: (v: string) => { state.weight = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Iterations', min: 1, max: 30, step: 1, value: state.iter,
            onInput: (v: string) => { state.iter = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Step Size (tau)', min: 0.01, max: 0.3, step: 0.01, value: state.tau,
            onInput: (v: string) => { state.tau = parseFloat(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { weight, iter, tau }: any) {
        // Process each channel independently
        [0, 1, 2].forEach(ch => {
            const f = Lib.image.extractChannel(data, w, h, ch); // Returns 0-255 Float32
            const res = this.denoiseChannel(f, w, h, weight, iter, tau);
            
            for (let i = 0; i < w * h; i++) {
                let val = res[i];
                val = val < 0 ? 0 : (val > 255 ? 255 : val);
                data[i * 4 + ch] = val;
            }
        });
    },

    denoiseChannel(img: Float32Array, w: number, h: number, weight: number, iterations: number, tau: number) {
        const count = w * h;
        
        // Dual variables px and py
        const px = new Float32Array(count);
        const py = new Float32Array(count);
        
        // Output image u
        const u = new Float32Array(img); // Start with input image

        for (let i = 0; i < iterations; i++) {
            // 1. Update Primal Variable u
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = rowOffset + x;
                    
                    // X-axis: px[x-1] - px[x]
                    const valX = (x > 0 ? px[idx - 1] : 0) - px[idx];
                    
                    // Y-axis: py[y-1] - py[y]
                    const valY = (y > 0 ? py[idx - w] : 0) - py[idx];
                    
                    u[idx] = img[idx] + valX + valY;
                }
            }

            // 2. Compute Gradient of u (Forward Difference) & Update Dual Variables p
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = rowOffset + x;
                    const val = u[idx];
                    
                    // Forward difference (Neumann boundary: if x is last, diff is 0)
                    const gradX = (x < w - 1 ? u[idx + 1] : val) - val;
                    const gradY = (y < h - 1 ? u[idx + w] : val) - val;
                    const gMag = Math.sqrt(gradX * gradX + gradY * gradY);
                    
                    // Projection factor
                    const norm = 1.0 + (tau / weight) * gMag;
                    const invNorm = 1.0 / norm;
                    
                    // Update p (Gradient Ascent on Dual)
                    px[idx] = (px[idx] - tau * gradX) * invNorm;
                    py[idx] = (py[idx] - tau * gradY) * invNorm;
                }
            }
        }

        return u;
    }
});