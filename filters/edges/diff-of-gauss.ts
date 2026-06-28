import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('diff-of-gauss', {
    name: 'Difference of Gaussians',
    mode: 'pixel',
    menu: {
        path: 'Filter/Edge Detection',
        label: 'Difference of Gaussians...',
        order: 3
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            sigma1: 0.0,   // Excitatory
            sigma2: 2.0,   // Inhibitory
            strength: 1.0,
            mode: 'gray'   // gray, abs, pos, neg, add, sub
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Band-pass filter. Use "Add to Original" to sharpen specific frequencies.'));

        // Sigma 1 Control
        container.appendChild(UI.createSliderRow({
            label: 'Sigma 1', min: 0.0, max: 20, step: 0.1, value: state.sigma1,
            onInput: v => { state.sigma1 = parseFloat(v); update(); }
        }));

        // Sigma 2 Control
        container.appendChild(UI.createSliderRow({
            label: 'Sigma 2', min: 0.1, max: 20, step: 0.1, value: state.sigma2,
            onInput: v => { state.sigma2 = parseFloat(v); update(); }
        }));

        // Strength Control
        container.appendChild(UI.createSliderRow({
            label: 'Strength', min: 0.1, max: 30.0, step: 0.1, value: state.strength,
            onInput: v => { state.strength = parseFloat(v); update(); }
        }));
        
        // Mode Selector
        container.appendChild(UI.createSelectRow({
            label: 'Output Mode',
            options: [
                { value: 'gray', text: 'Offset (+128)' },
                { value: 'abs', text: 'Absolute Value' },
                { value: 'pos', text: 'Positive Edges' },
                { value: 'neg', text: 'Negative Edges' },
                { value: 'add', text: 'Add to Original' },
                { value: 'sub', text: 'Subtract from Original' }
            ],
            value: state.mode,
            onChange: v => { state.mode = v; update(); }
        }));

        update();
    },

    nextPowerOf2(n: number) { return Math.pow(2, Math.ceil(Math.log2(n))); },

    process(data: Uint8ClampedArray, w: number, h: number, { sigma1, sigma2, strength, mode }: any) {
        if (sigma2 <= 0) return;

        const FFT = Lib.fft;
        const Kernel = Lib.kernel;
        const ImageUtil = Lib.image;

        // Determine Kernel Size based on the wider Gaussian
        const maxSig = Math.max(sigma1, sigma2);
        const kSize = Math.ceil(maxSig * 6) | 1;

        // Generate Gaussians
        const g1 = Kernel.gaussian(kSize, sigma1);
        const g2 = Kernel.gaussian(kSize, sigma2);

        // Create Difference Kernel (DoG)
        // Since g1 and g2 are normalized (sum=1), DoG sum is 0 (DC removal)
        const dogKernel = Array.from({ length: kSize }, (_, y) => 
            new Float32Array(kSize).map((_, x) => g1[y][x] - g2[y][x])
        );

        // FFT Preparation
        const targetW = this.nextPowerOf2(w + kSize);
        const targetH = this.nextPowerOf2(h + kSize);

        const paddedKernel = FFT.prepareKernel(dogKernel, targetW, targetH);
        const H = FFT.fft2d(paddedKernel);

        // Calculate offsets to retrieve the image from the center of the padded FFT buffer
        const padY = Math.floor((targetH - h) / 2);
        const padX = Math.floor((targetW - w) / 2);

        // Apply Filter per Channel
        [0, 1, 2].forEach(ch => {
            const flat = ImageUtil.extractChannel(data, w, h, ch);
            const padded = ImageUtil.padTo2D(flat, w, h, targetW, targetH, 'reflect');
            
            // Convolution in Frequency Domain
            const F = FFT.fft2d(padded);
            const G = FFT.multiply(F, H);
            const res = FFT.ifft2d(G.re, G.im).re;
            
            // Write result back with visualization logic
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4 + ch;
                    
                    // Correct: Read from the centered position
                    const py = y + padY;
                    const px = x + padX;
                    
                    // The difference value
                    const val = res[py][px] * strength;
                    const orig = flat[y * w + x];
                    
                    let out = 0;
                    if (mode === 'add') {
                        out = orig + val;
                    } else if (mode === 'sub') {
                        out = orig - val;
                    } else if (mode === 'gray') {
                        out = val + 128; // Mid-grey for zero crossing
                    } else if (mode === 'abs') {
                        out = Math.abs(val);
                    } else if (mode === 'pos') {
                        out = Math.max(0, val);
                    } else if (mode === 'neg') {
                        out = Math.max(0, -val);
                    }
                    
                    data[idx] = Math.max(0, Math.min(255, out));
                }
            }
        });
        
        // Ensure Alpha is fully opaque
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
    }
});