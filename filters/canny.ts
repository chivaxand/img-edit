import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('canny', {
    name: 'Canny Edge Detector',
    mode: 'pixel',

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            sigma: 0.5,
            operator: 'sobel', // sobel, scharr, prewitt, roberts
            aperture: 5,       // 3, 5, 7
            lowThreshold: 10,
            highThreshold: 25,
            connectivity: 8    // 4, 8
        };

        const update = () => {
            // Validate Logic: Low < High
            if (state.lowThreshold > state.highThreshold) {
                state.lowThreshold = state.highThreshold;
            }
            hooks.preview(state);
        };

        const updateControls = () => {
            (apertureRow as HTMLElement).style.display = (state.operator === 'sobel') ? 'flex' : 'none';
        };

        // --- UI Construction ---
        container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Noise Reduction'));
        container.appendChild(UI.createSliderRow({
            label: 'Sigma', min: 0.1, max: 10.0, step: 0.1, value: state.sigma,
            onInput: (v: string) => { state.sigma = parseFloat(v); update(); }
        }));

        // --- Gradient Calculation ---
        container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Gradient Calculation'));
        container.appendChild(UI.createSelectRow({
            label: 'Operator',
            options: [
                { value: 'sobel', text: 'Sobel (Standard)' },
                { value: 'scharr', text: 'Scharr (Optimized)' },
                { value: 'prewitt', text: 'Prewitt (Simple)' },
                { value: 'roberts', text: 'Roberts Cross (Fast)' }
            ],
            value: state.operator,
            onChange: (v: string) => { state.operator = v; updateControls(); update(); }
        }));

        const apertureRow = UI.createSelectRow({
            label: 'Kernel Size',
            options: [3, 5, 7],
            value: state.aperture,
            onChange: (v: string) => { state.aperture = parseInt(v); update(); }
        });
        container.appendChild(apertureRow);

        // --- Hysteresis ---
        container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Hysteresis Thresholding'));
        container.appendChild(UI.createSliderRow({
            label: 'High Thresh', min: 0, max: 255, step: 1, value: state.highThreshold,
            onInput: (v: string) => { state.highThreshold = parseFloat(v); update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Low Thresh', min: 0, max: 255, step: 1, value: state.lowThreshold,
            onInput: (v: string) => { state.lowThreshold = parseFloat(v); update(); }
        }));
        
        container.appendChild(UI.createSelectRow({
            label: 'Connectivity',
            options: [
                { value: 4, text: '4-Way (Orthogonal)' },
                { value: 8, text: '8-Way (Include Diagonals)' }
            ],
            value: state.connectivity,
            onChange: (v: string) => { state.connectivity = parseInt(v); update(); }
        }));

        updateControls();
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { sigma, operator, aperture, lowThreshold, highThreshold, connectivity }: any) {
        const FFT = Lib.fft;
        const ImageUtil = Lib.image;

        // 1. Convert to Grayscale & Normalize
        const gray = ImageUtil.toGrayscale(data, w, h, { method: 'rec601' });
        for(let i = 0; i < gray.length; i++) gray[i] *= 255.0;

        // 2. Gaussian Blur (FFT based)
        const targetW = FFT.nextPowerOf2(w);
        const targetH = FFT.nextPowerOf2(h);
        
        // Kernel size ~ 6*sigma
        const kSize = Math.ceil(sigma * 6) | 1;
        const gKernel = Lib.kernel.gaussian(kSize, sigma);
        const paddedKernel = FFT.prepareKernel(gKernel, targetW, targetH);
        const paddedImg = ImageUtil.padTo2D(gray, w, h, targetW, targetH, 'reflect');

        // Convolution via FFT
        const F = FFT.fft2d(paddedImg);
        const H = FFT.fft2d(paddedKernel);
        const G = FFT.multiply(F, H);
        const blurredFull = FFT.ifft2d(G.re, G.im).re;

        const blurred = new Float32Array(w * h);
        const padY = Math.floor((targetH - h) / 2);
        const padX = Math.floor((targetW - w) / 2);
        for(let y=0; y<h; y++) {
            const rowOffset = (y + padY) * targetW + padX;
            const destOffset = y * w;
            for(let x=0; x<w; x++) {
                blurred[destOffset + x] = blurredFull[y+padY][x+padX];
            }
        }

        // 3. Compute Gradients
        let kx: number[][], ky: number[][];
        if (operator === 'roberts') {
            kx = [[1, 0], [0, -1]];
            ky = [[0, 1], [-1, 0]];
        } else if (operator === 'scharr') {
            kx = [[-3, 0, 3], [-10, 0, 10], [-3, 0, 3]];
            ky = [[-3, -10, -3], [0, 0, 0], [3, 10, 3]];
        } else if (operator === 'prewitt') {
            kx = [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]];
            ky = [[-1, -1, -1], [0, 0, 0], [1, 1, 1]];
        } else {
            // Sobel
            if (aperture === 3) {
                kx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
                ky = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
            } else {
                // Generalized Sobel generation (Binomial Smooth x Diff)
                const poly = (n: number): number[] => {
                    if (n===1) return [1, 1];
                    const prev = poly(n-1);
                    const res = [1];
                    for(let i=0; i<prev.length-1; i++) res.push(prev[i]+prev[i+1]);
                    res.push(1);
                    return res;
                };
                
                const smoothVec = poly(aperture - 1);
                const diffVec = (aperture === 5) ? [-1, -2, 0, 2, 1] : [-1, -4, -5, 0, 5, 4, 1];
                
                kx = []; ky = [];
                for(let y=0; y<aperture; y++) {
                    const rowX: number[] = [], rowY: number[] = [];
                    for(let x=0; x<aperture; x++) {
                        rowX.push(smoothVec[y] * diffVec[x]);
                        rowY.push(diffVec[y] * smoothVec[x]);
                    }
                    kx.push(rowX);
                    ky.push(rowY);
                }
            }
        }

        // Normalize Gradient Kernels (Important for consistent thresholds)
        let posSum = 0;
        for(let r of kx) for(let v of r) if(v > 0) posSum += v;
        const scale = posSum > 0 ? (1.0 / posSum) : 1.0;
        kx = kx.map(row => row.map(v => v * scale));
        ky = ky.map(row => row.map(v => v * scale));

        // Spatial Convolution
        const convolve = (src: Float32Array, w: number, h: number, kernel: number[][]) => {
            const kh = kernel.length, kw = kernel[0].length;
            const cy = kh >> 1, cx = kw >> 1;
            const res = new Float32Array(w * h);
            
            // Hoist size checks
            const hMinus1 = h - 1;
            const wMinus1 = w - 1;

            for(let y=0; y<h; y++) {
                for(let x=0; x<w; x++) {
                    let sum = 0;
                    for(let ky=0; ky<kh; ky++) {
                        let py = y + ky - cy;
                        // Reflect boundary
                        if(py < 0) py = -py; else if(py > hMinus1) py = hMinus1 + (hMinus1 - py);
                        
                        const rowOffset = py * w;
                        const kRow = kernel[ky];
                        
                        for(let kx=0; kx<kw; kx++) {
                            let px = x + kx - cx;
                            if(px < 0) px = -px; else if(px > wMinus1) px = wMinus1 + (wMinus1 - px);
                            sum += src[rowOffset + px] * kRow[kx];
                        }
                    }
                    res[y*w+x] = sum;
                }
            }
            return res;
        };

        const dx = convolve(blurred, w, h, kx);
        const dy = convolve(blurred, w, h, ky);

        const magnitude = new Float32Array(w * h);
        const direction = new Uint8Array(w * h);
        const toRad = 180 / Math.PI;

        for (let i = 0; i < w * h; i++) {
            const vx = dx[i];
            const vy = dy[i];
            
            magnitude[i] = Math.hypot(vx, vy);

            // Angle in degrees [-180, 180]
            let angle = Math.atan2(vy, vx) * toRad; 
            // Normalize to [0, 180]
            if (angle < 0) angle += 180;
            
            // Quantize direction
            // 0: Horizontal Edge (Vertical Gradient)
            // 1: 45 Deg Edge (135 Deg Gradient)
            // 2: Vertical Edge (Horizontal Gradient)
            // 3: 135 Deg Edge (45 Deg Gradient)
            
            let q = 0;
            if (angle >= 157.5 || angle < 22.5) q = 0;      // 0 deg (East/West)
            else if (angle >= 22.5 && angle < 67.5) q = 1;  // 45 deg (South-East)
            else if (angle >= 67.5 && angle < 112.5) q = 2; // 90 deg (South)
            else if (angle >= 112.5 && angle < 157.5) q = 3;// 135 deg (South-West)
            
            direction[i] = q;
        }

        // 4. Non-Maximum Suppression
        const nms = new Float32Array(w * h);
        
        // Offset mapping for efficiency
        const offUp = -w, offDown = w;
        const offLeft = -1, offRight = 1;

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                const mag = magnitude[i];
                if (mag === 0) continue;

                const dir = direction[i];
                let m1 = 0, m2 = 0;

                // NMS checks neighbors ALONG the gradient direction
                if (dir === 0) { 
                    // Gradient: Horizontal (0 deg). Check Left/Right.
                    m1 = magnitude[i + offLeft];
                    m2 = magnitude[i + offRight];
                } else if (dir === 1) { 
                    // Gradient: 45 deg (Down-Right). 
                    // Check Up-Left and Down-Right.
                    m1 = magnitude[i + offUp + offLeft];
                    m2 = magnitude[i + offDown + offRight];
                } else if (dir === 2) { 
                    // Gradient: 90 deg (Vertical). Check Up/Down.
                    m1 = magnitude[i + offUp];
                    m2 = magnitude[i + offDown];
                } else if (dir === 3) { 
                    // Gradient: 135 deg (Down-Left). 
                    // Check Up-Right and Down-Left.
                    m1 = magnitude[i + offUp + offRight];
                    m2 = magnitude[i + offDown + offLeft];
                }

                // Strict thinning
                if (mag > m1 && mag >= m2) {
                    nms[i] = mag;
                }
            }
        }

        // 5. Hysteresis
        const edges = new Uint8Array(w * h); // 0=bg, 1=weak, 2=strong
        const stack: number[] = [];

        for (let i = 0; i < w * h; i++) {
            const v = nms[i];
            // Ignore flat regions even if lowThreshold is 0. 
            if (v === 0) continue; 
            if (v >= highThreshold) {
                edges[i] = 2;
                stack.push(i);
            } else if (v >= lowThreshold) {
                edges[i] = 1;
            }
        }

        const nOffsets = (connectivity === 8) 
            ? [-w-1, -w, -w+1, -1, 1, w-1, w, w+1]
            : [-w, -1, 1, w];

        while (stack.length > 0) {
            const idx = stack.pop()!;
            const cx = idx % w;
            
            for (let off of nOffsets) {
                const n = idx + off;
                if (n >= 0 && n < w * h) {
                    const nx = n % w;
                    // Check wrap-around
                    if (Math.abs(nx - cx) > 1) continue;

                    if (edges[n] === 1) {
                        edges[n] = 2; // Promote weak to strong
                        stack.push(n);
                    }
                }
            }
        }

        // 6. Write Output
        for (let i = 0; i < w * h; i++) {
            const val = edges[i] === 2 ? 255 : 0;
            const idx = i * 4;
            data[idx] = val;
            data[idx + 1] = val;
            data[idx + 2] = val;
            data[idx + 3] = 255; 
        }
    }
});
