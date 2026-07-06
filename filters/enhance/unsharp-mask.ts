import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('unsharp-mask', {
    name: 'Unsharp Mask',
    mode: 'pixel',
    menu: {
        path: 'Filter/Enhance',
        label: 'Unsharp Mask...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { 
            type: 'gaussian', // gaussian, disk
            radius: 1.2, 
            strength: 50, 
            threshold: 5, 
            linear: false 
        };
        const update = () => hooks.preview(state);

        // Kernel Type Selector
        container.appendChild(UI.createSelectRow({
            label: 'Kernel',
            options: [
                { value: 'gaussian', text: 'Gaussian' },
                { value: 'disk', text: 'Disk (Defocus)' }
            ],
            value: state.type,
            onChange: v => { state.type = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({ label: 'Radius (px)', min: 0.1, max: 50, step: 0.1, value: state.radius, onInput: v => { state.radius = parseFloat(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Strength (%)', min: 0, max: 300, value: state.strength, onInput: v => { state.strength = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Threshold', min: 0, max: 50, value: state.threshold, onInput: v => { state.threshold = parseInt(v); update(); } }));
        container.appendChild(UI.createCheckbox({ label: 'Process in Linear Space', value: state.linear, onChange: v => { state.linear = v; update(); } }));

        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, { type, radius, strength, threshold, linear }: any) {
        if (strength === 0 || radius <= 0) return;

        let blurredData: Uint8ClampedArray | null = null;

        // --- Generate Blurred Version ---

        if (type === 'disk') {
            // Use 'blur' filter for Disk Blur (FFT based)
            const blurFilter = Filters.registry.blur;
            if (blurFilter && blurFilter.process) {
                const copy = new Uint8ClampedArray(data);
                blurFilter.process(copy, w, h, {
                    type: 'disk',
                    radius: radius,
                    sigma: 0, length: 0, angle: 0
                });
                blurredData = copy;
            } else {
                console.error('Disk blur unavailable (blur.js missing?), falling back to Gaussian.');
            }
        }

        // Gaussian)
        if (!blurredData) {
            const tempCvs = document.createElement('canvas');
            tempCvs.width = w; 
            tempCvs.height = h;
            const tempCtx = tempCvs.getContext('2d')!;
            const imgData = new ImageData(new Uint8ClampedArray(data), w, h);
            tempCtx.putImageData(imgData, 0, 0);

            const blurCvs = document.createElement('canvas');
            blurCvs.width = w; blurCvs.height = h;
            const blurCtx = blurCvs.getContext('2d')!;
            // CSS filter blur() uses a Gaussian approximation
            blurCtx.filter = `blur(${radius}px)`;
            blurCtx.drawImage(tempCvs, 0, 0);
            
            blurredData = blurCtx.getImageData(0, 0, w, h).data;
        }

        // --- Apply Difference (Sharpen) ---

        const amount = strength / 100;
        const thresh = threshold;
        
        // Rec. 709 Luminance Coefficients
        const Rw = 0.2126, Gw = 0.7152, Bw = 0.0722;

        // Lookup Table for sRGB -> Linear (Speed optimization)
        let toLin: Float32Array | null = null;
        if (linear) {
            toLin = new Float32Array(256);
            for(let i=0; i<256; i++) toLin[i] = Math.pow(i/255, 2.2);
        }

        // Helper for Linear -> sRGB
        const toGamma = (v: number) => {
            if (v <= 0) return 0;
            if (v >= 1) return 255;
            return Math.pow(v, 1/2.2) * 255;
        };

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];

            const br = blurredData[i];
            const bg = blurredData[i+1];
            const bb = blurredData[i+2];

            // Threshold Check (Noise Masking)
            if (thresh > 0) {
                const lumOrig = r * Rw + g * Gw + b * Bw;
                const lumBlur = br * Rw + bg * Gw + bb * Bw;
                if (Math.abs(lumOrig - lumBlur) < thresh) continue;
            }

            // Apply Unsharp Mask
            if (linear) {
                // --- Linear Space ---
                const rl = toLin![r], gl = toLin![g], bl = toLin![b];
                const bl_r = toLin![br], bl_g = toLin![bg], bl_b = toLin![bb];

                // Result = Original + Amount * (Original - Blurred)
                const resR = rl + (rl - bl_r) * amount;
                const resG = gl + (gl - bl_g) * amount;
                const resB = bl + (bl - bl_b) * amount;

                data[i]   = toGamma(resR);
                data[i+1] = toGamma(resG);
                data[i+2] = toGamma(resB);
            } else {
                // --- sRGB Space ---
                data[i]   = Math.min(255, Math.max(0, r + (r - br) * amount));
                data[i+1] = Math.min(255, Math.max(0, g + (g - bg) * amount));
                data[i+2] = Math.min(255, Math.max(0, b + (b - bb) * amount));
            }
        }
    }
});
