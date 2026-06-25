import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('unblur', {
    name: 'Unblur (Wiener Deconvolution)',
    mode: 'pixel',

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            kernelType: 'disk',   // disk, gaussian, line
            kernelSize: 29,       // Diameter or Length
            sigma: 5.0,           // For Gaussian
            angle: 0,             // For Motion Blur
            snr: 0.08             // Signal-to-Noise Ratio
        };

        const update = () => hooks.preview(state);

        // Kernel Type Selector
        container.appendChild(UI.createSelectRow({
            label: 'Kernel',
            options: [
                { value: 'disk', text: 'Disk' },
                { value: 'gaussian', text: 'Gaussian Blur' },
                { value: 'line', text: 'Motion Blur (Linear)' }
            ],
            value: state.kernelType,
            onChange: v => {
                state.kernelType = v;
                updateControls();
                update();
            }
        }));

        // Common Size Slider (Diameter / Length)
        container.appendChild(UI.createSliderRow({
            label: 'Size/Len', min: 3, max: 127, step: 2, value: state.kernelSize,
            onInput: v => { state.kernelSize = parseInt(v); update(); }
        }));

        // Sigma Control (Gaussian only)
        const sigmaControl = UI.createSliderRow({
            label: 'Sigma', min: 0.1, max: 50, step: 0.1, value: state.sigma,
            onInput: v => { state.sigma = parseFloat(v); update(); }
        });
        container.appendChild(sigmaControl);

        // Angle Control (Motion Blur only)
        const angleControl = UI.createSliderRow({
            label: 'Angle (°)', min: 0, max: 180, step: 1, value: state.angle,
            onInput: v => { state.angle = parseInt(v); update(); }
        });
        container.appendChild(angleControl);

        // SNR Control
        container.appendChild(UI.createSliderRow({
            label: 'SNR', min: 0.001, max: 0.3, step: 0.001, value: state.snr,
            onInput: v => { state.snr = parseFloat(v); update(); }
        }));

        // Visibility Logic
        const updateControls = () => {
            sigmaControl.style.display = state.kernelType === 'gaussian' ? 'flex' : 'none';
            angleControl.style.display = state.kernelType === 'line' ? 'flex' : 'none';
        };

        // --- OBD Estimated Kernel Visualization ---
        container.appendChild(UI.createNode('div', {className:'popup-separator'}, ''));
        container.appendChild(UI.createNode('div', {className:'popup-subtitle'}, 'Estimated Kernel (OBD)'));

        const estimateBtn = UI.createNode('button', { style: { width:'100%', margin:'5px 0' }}, 'Estimate Kernel');

        // Canvas (initially hidden)
        const kernelCanvas = document.createElement('canvas');
        kernelCanvas.width = 256;
        kernelCanvas.height = 256;
        kernelCanvas.style.background = '#000';
        kernelCanvas.style.border = '1px solid #444';
        kernelCanvas.style.width = '60%';
        kernelCanvas.style.imageRendering = 'pixelated';
        kernelCanvas.style.display = 'none'; // <-- hidden at start

        const kWrap = UI.createNode('div', { style: { display:'flex', justifyContent:'center', width:'100%' } }, kernelCanvas);
        container.appendChild(estimateBtn);
        container.appendChild(kWrap);
        container.appendChild(
            UI.createNode('div', { className:'popup-hint', style:'text-align:center; margin-top:5px;' }, '64x64 Kernel Estimation')
        );

        // --- Button Handler ---
        estimateBtn.addEventListener('click', () => {
            estimateBtn.style.display = 'none';
            kernelCanvas.style.display = 'block';
            this.onEstimateTap(layer, kernelCanvas);
        });

        // Initialize UI state
        updateControls();
        update();
    },

    nextPowerOf2(n: number) { return Math.pow(2, Math.ceil(Math.log2(n))); },

    process(data: Uint8ClampedArray, w: number, h: number, { kernelType, kernelSize, sigma, angle, snr }: any) {
        const FFT = Lib.fft;
        const Kernel = Lib.kernel;
        
        // Determine Padding (Next Power of 2)
        const targetW = this.nextPowerOf2(w + kernelSize * 2);
        const targetH = this.nextPowerOf2(h + kernelSize * 2);

        // Generate Spatial Kernel (PSF)
        let kernel;
        if (kernelType === 'gaussian') {
            kernel = Kernel.gaussian(kernelSize, sigma);
        } else if (kernelType === 'line') {
            kernel = Kernel.motion(kernelSize, angle);
        } else {
            kernel = Kernel.disk(kernelSize);
        }

        // Prepare Kernel (Pad to target size & Shift Center)
        const paddedKernel = FFT.prepareKernel(kernel, targetW, targetH);
        
        // FFT of Kernel (H)
        const H = FFT.fft2d(paddedKernel);

        // Pre-calculate Wiener Factor: H* / (|H|^2 + SNR^2)
        const H_conj_re = Array.from({ length: targetH }, () => new Float32Array(targetW));
        const H_conj_im = Array.from({ length: targetH }, () => new Float32Array(targetW));
        const Denom = Array.from({ length: targetH }, () => new Float32Array(targetW));
        
        const K = snr * snr; 

        for (let y = 0; y < targetH; y++) {
            for (let x = 0; x < targetW; x++) {
                const hr = H.re[y][x];
                const hi = H.im[y][x];
                const magSq = hr*hr + hi*hi;
                
                H_conj_re[y][x] = hr;
                H_conj_im[y][x] = -hi;
                
                let d = magSq + K;
                if (d < 1e-9) d = 1e-9;
                Denom[y][x] = d;
            }
        }

        // Apply Wiener Filter per channel
        [0, 1, 2].forEach(ch => {
            const flat = Lib.image.extractChannel(data, w, h, ch);
            const padded = Lib.image.padTo2D(flat, w, h, targetW, targetH, 'reflect');
            const F = FFT.fft2d(padded);
            const resRe = Array.from({ length: targetH }, () => new Float32Array(targetW));
            const resIm = Array.from({ length: targetH }, () => new Float32Array(targetW));

            for (let y = 0; y < targetH; y++) {
                for (let x = 0; x < targetW; x++) {
                    const fr = F.re[y][x];
                    const fi = F.im[y][x];
                    const hcr = H_conj_re[y][x];
                    const hci = H_conj_im[y][x];
                    const den = Denom[y][x];

                    // Complex Mult: F * H*
                    const numRe = fr * hcr - fi * hci;
                    const numIm = fr * hci + fi * hcr;

                    resRe[y][x] = numRe / den;
                    resIm[y][x] = numIm / den;
                }
            }

            const res = FFT.ifft2d(resRe, resIm).re;
            Lib.image.writeChannel(data, res, w, h, ch);
        });
    },

    // --- OBD Implementation ---

    onEstimateTap(layer: Layer, kernelCanvas: HTMLCanvasElement) {
        const ctx = kernelCanvas.getContext('2d')!;
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,256,256);
        ctx.fillStyle = '#888'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('Estimating...', 128, 128);

        // Defer execution to let UI render
        setTimeout(() => {
            const w = layer.canvas.width;
            const h = layer.canvas.height;
            const imgData = layer.ctx.getImageData(0, 0, w, h);
            const kernel = this.estimateKernelOBD(imgData.data, w, h);
            Lib.plot.renderMatrix(kernel, kernelCanvas, { palette: 'seismic' });
        }, 10);
    },

    estimateKernelOBD(data: Uint8ClampedArray, w: number, h: number) {
        const FFT = Lib.fft;
        const kSize = 64;
        const iterations = 30; 
        const size = this.nextPowerOf2(Math.max(w, h, 256));
        
        // Extract Luminance & Pad (Constant padding for estimation)
        const grayFlat = Lib.image.toGrayscale(data, w, h);
        const gray = Lib.image.padTo2D(grayFlat, w, h, size, size, 'constant');

        // Compute FFT of Image (X)
        const X_fft = FFT.fft2d(gray);
        const X_conj = { re: X_fft.re, im: X_fft.im.map((row: Float32Array) => row.map(v => -v)) };

        // Compute Nom = Autocorrelation of Y (Constant)
        const Nom_fft = FFT.multiply(X_conj, X_fft);
        const Nom_full = FFT.ifft2d(Nom_fft.re, Nom_fft.im);
        const Nom_shifted = FFT.shift(Nom_full).re;

        // Crop Nom to kSize (Center)
        const start = (size >> 1) - (kSize >> 1);
        const Nom_crop = Array.from({ length: kSize }, (_, y) => 
            Nom_shifted[y + start].slice(start, start + kSize)
        );
        
        // Enforce positivity on Nom
        for(let y=0; y<kSize; y++) for(let x=0; x<kSize; x++) Nom_crop[y][x] = Math.max(0, Nom_crop[y][x]);

        // Initialize f (Uniform)
        let f = Array.from({ length: kSize }, () => new Float32Array(kSize).fill(1/(kSize*kSize)));

        // Multiplicative Update Loop
        for(let iter=0; iter<iterations; iter++) {
            // Pad f for FFT
            const F_pad = FFT.prepareKernel(f, size, size);
            const F_fft = FFT.fft2d(F_pad);
            
            // Y_est = X * f (Convolution)
            const Y_est_fft = FFT.multiply(X_fft, F_fft);
            
            // Denom = X corr Y_est = conj(X) * Y_est
            const Denom_fft = FFT.multiply(X_conj, Y_est_fft);
            const Denom_full = FFT.ifft2d(Denom_fft.re, Denom_fft.im);
            const Denom_shifted = FFT.shift(Denom_full).re;
            
            // Update f
            let sum = 0;
            for(let y=0; y<kSize; y++) {
                for(let x=0; x<kSize; x++) {
                    const n = Nom_crop[y][x];
                    const d = Math.max(0, Denom_shifted[y + start][x + start]);
                    const factor = (n + 1e-10) / (d + 1e-10);
                    f[y][x] *= factor;
                    sum += f[y][x];
                }
            }
            
            // Normalize f
            if(sum > 1e-9) {
                const invSum = 1 / sum;
                for(let y=0; y<kSize; y++) for(let x=0; x<kSize; x++) f[y][x] *= invSum;
            }
        }

        return f;
    }
});
