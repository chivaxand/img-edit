import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('blur', {
    name: 'Blur',
    mode: 'pixel',

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            type: 'gaussian', // gaussian, disk, motion
            sigma: 5.0,
            radius: 5.0,
            length: 20,
            angle: 45
        };

        const update = () => hooks.preview(state);

        // Type Selector
        container.appendChild(UI.createSelectRow({
            label: 'Type',
            options: [
                { value: 'gaussian', text: 'Gaussian' },
                { value: 'disk', text: 'Disk (Defocus)' },
                { value: 'motion', text: 'Motion Blur' }
            ],
            value: state.type,
            onChange: (v: string) => {
                state.type = v;
                updateControls();
                update();
            }
        }));

        // Sigma Control (Gaussian)
        const sigmaControl = UI.createSliderRow({
            label: 'Sigma', min: 0.1, max: 100, step: 0.1, value: state.sigma,
            onInput: (v: string) => { state.sigma = parseFloat(v); update(); }
        });
        container.appendChild(sigmaControl);

        // Radius Control (Disk)
        const radiusControl = UI.createSliderRow({
            label: 'Radius', min: 0.5, max: 100, step: 0.5, value: state.radius,
            onInput: (v: string) => { state.radius = parseFloat(v); update(); }
        });
        container.appendChild(radiusControl);

        // Motion Controls
        const lengthControl = UI.createSliderRow({
            label: 'Length', min: 1, max: 200, step: 1, value: state.length,
            onInput: (v: string) => { state.length = parseInt(v); update(); }
        });
        container.appendChild(lengthControl);

        const angleControl = UI.createSliderRow({
            label: 'Angle', min: 0, max: 180, step: 1, value: state.angle,
            onInput: (v: string) => { state.angle = parseInt(v); update(); }
        });
        container.appendChild(angleControl);

        const updateControls = () => {
            const t = state.type;
            sigmaControl.style.display = t === 'gaussian' ? 'flex' : 'none';
            radiusControl.style.display = t === 'disk' ? 'flex' : 'none';
            lengthControl.style.display = t === 'motion' ? 'flex' : 'none';
            angleControl.style.display = t === 'motion' ? 'flex' : 'none';
        };

        updateControls();
        update();
    },

    nextPowerOf2(n: number) { return Math.pow(2, Math.ceil(Math.log2(n))); },

    process(data: Uint8ClampedArray, w: number, h: number, { type, sigma, radius, length, angle }: any) {
        if ((type === 'gaussian' && sigma <= 0) || (type === 'disk' && radius <= 0) || (type === 'motion' && length <= 0)) return;

        const FFT = Lib.fft;
        const ImageUtil = Lib.image;

        // Calculate required Safe Padding based on blur intensity
        let safePad = 0;
        if (type === 'gaussian') {
            safePad = Math.min(Math.ceil(sigma * 4), 64);
        } else if (type === 'disk') {
            safePad = Math.ceil(radius);
        } else if (type === 'motion') {
            safePad = Math.ceil(length); 
        }

        const targetW = this.nextPowerOf2(w + safePad * 2);
        const targetH = this.nextPowerOf2(h + safePad * 2);

        // Generate Spatial Kernel directly into the full-size buffer (no fftshift needed).
        const kernel = Array.from({ length: targetH }, () => new Float32Array(targetW));
        let sum = 0;

        const cx = targetW / 2;
        const cy = targetH / 2;
        
        const isGauss = type === 'gaussian';
        const isMotion = type === 'motion';
        const s2 = 2 * sigma * sigma; // 2*sigma^2
        const r = radius;

        // Precalc Motion Params
        let lx: number = 0, ly: number = 0, x1: number = 0, y1: number = 0, lenSq: number = 0;
        if (isMotion) {
            const rad = angle * Math.PI / 180;
            const halfLen = (length - 1) / 2;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const x2 = halfLen * cos; 
            const y2 = halfLen * sin;
            x1 = -x2; y1 = -y2;
            lx = x2 - x1; 
            ly = y2 - y1;
            lenSq = lx*lx + ly*ly;
        }

        for (let y = 0; y < targetH; y++) {
            // Calculate wrapped Y distance: 0..H/2 is positive, H/2..H is negative
            const dy = y <= cy ? y : y - targetH;
            const dy2 = dy * dy;

            for (let x = 0; x < targetW; x++) {
                // Calculate wrapped X distance
                const dx = x <= cx ? x : x - targetW;
                
                let val = 0;
                if (isGauss) {
                    // Gaussian Function
                    const distSq = dx * dx + dy2;
                    val = Math.exp(-distSq / s2);
                    if (val < 1e-7) val = 0;
                } else if (isMotion) {
                    // Motion Blur (Antialiased Line)
                    let t = 0.5;
                    if (lenSq > 1e-9) {
                        t = ((dx - x1) * lx + (dy - y1) * ly) / lenSq;
                        t = t < 0 ? 0 : (t > 1 ? 1 : t);
                    }
                    const px = x1 + t * lx;
                    const py = y1 + t * ly;
                    const ddx = dx - px;
                    const ddy = dy - py;
                    const dist = Math.sqrt(ddx*ddx + ddy*ddy);
                    
                    val = Math.max(0, 1.0 - dist);
                } else {
                    // Disk (Defocus) with simple anti-aliasing
                    const distSq = dx * dx + dy2;
                    const dist = Math.sqrt(distSq);
                    val = Math.max(0, Math.min(1, 0.5 - (dist - r)));
                }
                
                kernel[y][x] = val;
                sum += val;
            }
        }

        // Normalize Kernel
        const scale = sum > 0 ? 1 / sum : 1;
        for (let y = 0; y < targetH; y++) {
            for (let x = 0; x < targetW; x++) {
                kernel[y][x] *= scale;
            }
        }

        // FFT of Kernel (H)
        const H = FFT.fft2d(kernel);

        // Apply Blur per channel
        [0, 1, 2].forEach(ch => {
            const flat = ImageUtil.extractChannel(data, w, h, ch);
            // Pad image using 'reflect' to handle edges naturally
            const padded = ImageUtil.padTo2D(flat, w, h, targetW, targetH, 'reflect');
            
            // Convolution
            const F = FFT.fft2d(padded);
            const G = FFT.multiply(F, H);
            const res = FFT.ifft2d(G.re, G.im).re;
            
            // Write back to image data (automatically crops the padding)
            ImageUtil.writeChannel(data, res, w, h, ch);
        });
    }
});
