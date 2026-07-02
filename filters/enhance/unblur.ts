import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('unblur', {
    name: 'Unblur (Wiener Deconvolution)',
    mode: 'pixel',
    menu: {
        path: 'Filter/Enhance',
        label: 'Unblur (Wiener)...',
        order: 1
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        // Snapshot of the original blurred image before any previews are processed
        const originalW = layer.canvas.width;
        const originalH = layer.canvas.height;
        const originalCtx = layer.canvas.getContext('2d')!;
        const originalImgData = originalCtx.getImageData(0, 0, originalW, originalH);

        const state = {
            kernelType: 'disk',   // disk, gaussian, line
            kernelSize: 29,       // Diameter or Length
            sigma: 5.0,           // For Gaussian
            angle: 0,             // For Motion Blur
            length: 10,           // For Motion Blur (Length in pixels)
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
        const sizeControl = UI.createSliderRow({
            label: 'Size', min: 3, max: 127, step: 2, value: state.kernelSize,
            onInput: v => { state.kernelSize = parseInt(v); update(); }
        });
        container.appendChild(sizeControl);

        // Sigma Control (Gaussian only)
        const sigmaControl = UI.createSliderRow({
            label: 'Sigma', min: 0.1, max: 50, step: 0.1, value: state.sigma,
            onInput: v => { state.sigma = parseFloat(v); update(); }
        });
        container.appendChild(sigmaControl);

        // Length Control (Motion Blur only)
        const lengthControl = UI.createSliderRow({
            label: 'Length (px)', min: 1, max: 100, step: 1, value: state.length,
            onInput: v => { state.length = parseInt(v); update(); }
        });
        container.appendChild(lengthControl);

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
            sizeControl.style.display = state.kernelType === 'line' ? 'none' : 'flex';
            sigmaControl.style.display = state.kernelType === 'gaussian' ? 'flex' : 'none';
            lengthControl.style.display = state.kernelType === 'line' ? 'flex' : 'none';
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
            this.onEstimateTap(layer, kernelCanvas, originalImgData);
        });

        // Initialize UI state
        updateControls();
        update();
    },

    nextPowerOf2(n: number) { return Math.pow(2, Math.ceil(Math.log2(n))); },

    process(data: Uint8ClampedArray, w: number, h: number, { kernelType, kernelSize, sigma, angle, length, snr }: any) {
        const FFT = Lib.fft;
        const Kernel = Lib.kernel;
        
        // Determine the actual kernel matrix size to use
        let effKernelSize = kernelSize;
        if (kernelType === 'line') {
            effKernelSize = Math.max(3, (Math.ceil(length) + 2) | 1);
        }

        // Determine Padding (Next Power of 2)
        const targetW = this.nextPowerOf2(w + effKernelSize * 2);
        const targetH = this.nextPowerOf2(h + effKernelSize * 2);

        // Generate Spatial Kernel (PSF)
        let kernel;
        if (kernelType === 'gaussian') {
            kernel = Kernel.gaussian(effKernelSize, sigma);
        } else if (kernelType === 'line') {
            kernel = Kernel.motion(effKernelSize, angle, length);
        } else {
            kernel = Kernel.disk(effKernelSize);
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

    onEstimateTap(layer: Layer, kernelCanvas: HTMLCanvasElement, originalImgData: ImageData) {
        const ctx = kernelCanvas.getContext('2d')!;
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,256,256);
        ctx.fillStyle = '#888'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('Estimating...', 128, 128);

        // Defer execution to let UI render
        setTimeout(() => {
            const w = originalImgData.width;
            const h = originalImgData.height;
            const kernel = this.estimateKernelOBD(originalImgData.data, w, h);
            Lib.plot.renderMatrix(kernel, kernelCanvas, { palette: 'seismic' });
        }, 10);
    },

    estimateKernelOBD(data: Uint8ClampedArray, w: number, h: number) {
        const FFT = Lib.fft;
        const kSize = 64;
        const iterations = 1; 
        const size = 256;
        
        // Extract and pad fixed size patch from the center
        const grayFlat = Lib.image.toGrayscale(data, w, h);
        const patch = new Float32Array(size * size);
        const cx = w >> 1, cy = h >> 1;
        const startX = cx - (size >> 1);
        const startY = cy - (size >> 1);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const srcX = Math.max(0, Math.min(w - 1, startX + x));
                const srcY = Math.max(0, Math.min(h - 1, startY + y));
                patch[y * size + x] = grayFlat[srcY * w + srcX];
            }
        }

        // Precompute Hanning window to prevent frequency cross-artifacts at boundaries
        const window1D = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            window1D[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
        }

        const Bx = new Array(size).fill(0).map(() => new Float32Array(size));
        const By = new Array(size).fill(0).map(() => new Float32Array(size));
        const patchWindowed = new Array(size).fill(0).map(() => new Float32Array(size));

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const p = patch[y * size + x];
                const px = x + 1 < size ? patch[y * size + x + 1] : p;
                const py = y + 1 < size ? patch[(y + 1) * size + x] : p;
                
                const win = window1D[y] * window1D[x];
                Bx[y][x] = (px - p) * win;
                By[y][x] = (py - p) * win;
                patchWindowed[y][x] = p * win;
            }
        }

        const Bx_fft = FFT.fft2d(Bx);
        const By_fft = FFT.fft2d(By);
        const B_fft = FFT.fft2d(patchWindowed);

        const k_spatial = new Array(kSize).fill(0).map(() => new Float32Array(kSize));

        // Initialize kernel shape using Autocorrelation of the image gradients
        const K_init_re = new Array(size).fill(0).map(() => new Float32Array(size));
        const K_init_im = new Array(size).fill(0).map(() => new Float32Array(size));
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const bxr = Bx_fft.re[y][x], bxi = Bx_fft.im[y][x];
                const byr = By_fft.re[y][x], byi = By_fft.im[y][x];
                K_init_re[y][x] = bxr*bxr + bxi*bxi + byr*byr + byi*byi;
            }
        }
        
        const K_init_full = FFT.ifft2d(K_init_re, K_init_im).re;
        
        let sumInit = 0;
        for (let y = 0; y < kSize; y++) {
            for (let x = 0; x < kSize; x++) {
                const srcY = (y - (kSize >> 1) + size) % size;
                const srcX = (x - (kSize >> 1) + size) % size;
                let val = K_init_full[srcY][srcX];
                if (val < 0) val = 0;
                
                // Soft spatial taper to favor central main structure
                const dy = y - (kSize >> 1);
                const dx = x - (kSize >> 1);
                const distSq = dx*dx + dy*dy;
                const spatialWin = Math.exp(-distSq / (2 * 15 * 15));
                
                k_spatial[y][x] = val * spatialWin;
                sumInit += k_spatial[y][x];
            }
        }

        if (sumInit > 0) {
            for (let y = 0; y < kSize; y++) {
                for (let x = 0; x < kSize; x++) {
                    k_spatial[y][x] /= sumInit;
                }
            }
        }

        let noise_var = 0.05;

        // Alternating minimization loop for Blind Deconvolution
        for (let iter = 0; iter < iterations; iter++) {
            const K_padded = FFT.prepareKernel(k_spatial, size, size);
            const K_fft = FFT.fft2d(K_padded);

            // Step A: Wiener filter estimation of the sharp image
            const S_fft_re = new Array(size).fill(0).map(() => new Float32Array(size));
            const S_fft_im = new Array(size).fill(0).map(() => new Float32Array(size));
            
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const kr = K_fft.re[y][x], ki = K_fft.im[y][x];
                    const br = B_fft.re[y][x], bi = B_fft.im[y][x];
                    const den = kr*kr + ki*ki + noise_var;
                    S_fft_re[y][x] = (br * kr + bi * ki) / den;
                    S_fft_im[y][x] = (bi * kr - br * ki) / den;
                }
            }
            
            const S = FFT.ifft2d(S_fft_re, S_fft_im).re;

            // Step B: Extract gradient features
            const Sx = new Array(size).fill(0).map(() => new Float32Array(size));
            const Sy = new Array(size).fill(0).map(() => new Float32Array(size));
            const mag = new Float32Array(size * size);
            
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const p = S[y][x];
                    const px = x + 1 < size ? S[y][x + 1] : p;
                    const py = y + 1 < size ? S[y + 1][x] : p;
                    const gx = px - p;
                    const gy = py - p;
                    const win = window1D[y] * window1D[x];
                    Sx[y][x] = gx * win;
                    Sy[y][x] = gy * win;
                    mag[y * size + x] = Math.sqrt(gx*gx + gy*gy) * win;
                }
            }

            // Step C: Strict shock thresholding to keep ONLY sharp natural edges
            const sortedMag = new Float32Array(mag);
            sortedMag.sort();
            const threshold = Math.max(1e-5, sortedMag[Math.floor(size * size * 0.90)]); // Top 10%
            
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    if (mag[y * size + x] < threshold) {
                        Sx[y][x] = 0;
                        Sy[y][x] = 0;
                    }
                }
            }

            const Sx_fft = FFT.fft2d(Sx);
            const Sy_fft = FFT.fft2d(Sy);
            
            const K_est_re = new Array(size).fill(0).map(() => new Float32Array(size));
            const K_est_im = new Array(size).fill(0).map(() => new Float32Array(size));
            
            let maxDen = 0;
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const sxr = Sx_fft.re[y][x], sxi = Sx_fft.im[y][x];
                    const syr = Sy_fft.re[y][x], syi = Sy_fft.im[y][x];
                    const den = sxr*sxr + sxi*sxi + syr*syr + syi*syi;
                    if(den > maxDen) maxDen = den;
                }
            }
            
            const gamma = Math.max(1e-9, maxDen * 0.02); // Tikhonov Regularization (2% base)

            // Step D: Solve Inverse Matrix formulation for the blur kernel
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const sxr = Sx_fft.re[y][x], sxi = Sx_fft.im[y][x];
                    const syr = Sy_fft.re[y][x], syi = Sy_fft.im[y][x];
                    const bxr = Bx_fft.re[y][x], bxi = Bx_fft.im[y][x];
                    const byr = By_fft.re[y][x], byi = By_fft.im[y][x];

                    const num_re = (bxr*sxr + bxi*sxi) + (byr*syr + byi*syi);
                    const num_im = (bxi*sxr - bxr*sxi) + (byi*syr - byr*syi);
                    const den = sxr*sxr + sxi*sxi + syr*syr + syi*syi + gamma;

                    K_est_re[y][x] = num_re / den;
                    K_est_im[y][x] = num_im / den;
                }
            }

            const K_est_full = FFT.ifft2d(K_est_re, K_est_im).re;
            
            let sumK = 0;
            for (let y = 0; y < kSize; y++) {
                for (let x = 0; x < kSize; x++) {
                    // Extract properly shifted kernel mapping from the FFT output
                    const srcY = (y - (kSize >> 1) + size) % size;
                    const srcX = (x - (kSize >> 1) + size) % size;
                    let val = K_est_full[srcY][srcX];
                    if (val < 0) val = 0; // Kernel must be strictly positive
                    k_spatial[y][x] = val;
                    sumK += val;
                }
            }
            
            if (sumK > 1e-9) {
                for (let y = 0; y < kSize; y++) {
                    for (let x = 0; x < kSize; x++) {
                        k_spatial[y][x] /= sumK;
                    }
                }
            }
            
            // Incrementally lower Wiener filter damping to force convergence in the later steps
            noise_var = Math.max(0.005, noise_var * 0.8);
        }

        return k_spatial;
    }
});