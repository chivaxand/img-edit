import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('blur', {
    name: 'Blur',
    mode: 'pixel',
    menu: {
        path: 'Filter/Blur',
        label: 'Gaussian Blur...',
        order: 1
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            type: 'gaussian', // gaussian, box, disk
            sigma: 5.0,
            radius: 5.0,
            radiusX: 5.0,
            radiusY: 5.0,
            linkRadii: true
        };

        const update = () => hooks.preview(state);

        // Type Selector
        container.appendChild(UI.createSelectRow({
            label: 'Type',
            options: [
                { value: 'gaussian', text: 'Gaussian' },
                { value: 'box', text: 'Box Blur (Rectangle)' },
                { value: 'disk', text: 'Disk (Defocus)' }
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

        // Radius X Control (Box)
        const radiusXControl = UI.createSliderRow({
            label: 'Radius X', min: 1, max: 100, step: 1, value: state.radiusX,
            onInput: (v: string) => {
                state.radiusX = parseFloat(v);
                if (state.linkRadii) {
                    state.radiusY = state.radiusX;
                    const inputY = radiusYControl.querySelector('input');
                    if (inputY) {
                        (inputY as HTMLInputElement).value = v;
                    }
                    const spanY = radiusYControl.querySelector('span');
                    if (spanY) {
                        (spanY as HTMLSpanElement).textContent = v;
                    }
                }
                update();
            }
        });
        container.appendChild(radiusXControl);

        // Radius Y Control (Box)
        const radiusYControl = UI.createSliderRow({
            label: 'Radius Y', min: 1, max: 100, step: 1, value: state.radiusY,
            onInput: (v: string) => {
                state.radiusY = parseFloat(v);
                if (state.linkRadii) {
                    state.radiusX = state.radiusY;
                    const inputX = radiusXControl.querySelector('input');
                    if (inputX) {
                        (inputX as HTMLInputElement).value = v;
                    }
                    const spanX = radiusXControl.querySelector('span');
                    if (spanX) {
                        (spanX as HTMLSpanElement).textContent = v;
                    }
                }
                update();
            }
        });
        container.appendChild(radiusYControl);

        // Link Checkbox (Box)
        const linkControl = UI.createCheckbox({
            label: 'Link Radius X & Y',
            value: state.linkRadii,
            onChange: (v: boolean) => {
                state.linkRadii = v;
                if (v) {
                    state.radiusY = state.radiusX;
                    const inputY = radiusYControl.querySelector('input');
                    if (inputY) {
                        (inputY as HTMLInputElement).value = String(state.radiusX);
                    }
                    const spanY = radiusYControl.querySelector('span');
                    if (spanY) {
                        (spanY as HTMLSpanElement).textContent = String(state.radiusX);
                    }
                }
                update();
            }
        });
        container.appendChild(linkControl);

        const updateControls = () => {
            const t = state.type;
            sigmaControl.style.display = t === 'gaussian' ? 'flex' : 'none';
            radiusControl.style.display = t === 'disk' ? 'flex' : 'none';
            radiusXControl.style.display = t === 'box' ? 'flex' : 'none';
            radiusYControl.style.display = t === 'box' ? 'flex' : 'none';
            linkControl.style.display = t === 'box' ? 'flex' : 'none';
        };

        updateControls();
        update();
    },

    nextPowerOf2(n: number) { return Math.pow(2, Math.ceil(Math.log2(n))); },

    process(data: Uint8ClampedArray, w: number, h: number, { type, sigma, radius, radiusX, radiusY }: any) {
        if (type === 'gaussian' && sigma <= 0) return;
        if (type === 'disk' && radius <= 0) return;
        
        const FFT = Lib.fft;
        const ImageUtil = Lib.image;

        if (type === 'box') {
            const rx = Math.max(0, radiusX);
            const ry = Math.max(0, radiusY);
            if (rx <= 0 && ry <= 0) return;

            const sizeX = Math.round(rx * 2 + 1);
            const kernelX = new Float32Array(sizeX).fill(1 / sizeX);

            const sizeY = Math.round(ry * 2 + 1);
            const kernelY = new Float32Array(sizeY).fill(1 / sizeY);

            [0, 1, 2].forEach(ch => {
                let flat = ImageUtil.extractChannel(data, w, h, ch);
                if (rx > 0) {
                    flat = ImageUtil.convolve1d(flat, w, h, kernelX, false, 'reflect');
                }
                if (ry > 0) {
                    flat = ImageUtil.convolve1d(flat, w, h, kernelY, true, 'reflect');
                }
                const res2D = Array.from({ length: h }, (_, y) => flat.subarray(y * w, (y + 1) * w));
                ImageUtil.writeChannel(data, res2D, w, h, ch);
            });
            return;
        }

        // Calculate required Safe Padding based on blur intensity
        let safePad = 0;
        if (type === 'gaussian') {
            safePad = Math.min(Math.ceil(sigma * 4), 64);
        } else if (type === 'disk') {
            safePad = Math.ceil(radius);
        }

        const targetW = this.nextPowerOf2(w + safePad * 2);
        const targetH = this.nextPowerOf2(h + safePad * 2);

        // Generate Spatial Kernel directly into the full-size buffer (no fftshift needed).
        const kernel = Array.from({ length: targetH }, () => new Float32Array(targetW));
        let sum = 0;

        const cx = targetW / 2;
        const cy = targetH / 2;
        
        const isGauss = type === 'gaussian';
        const s2 = 2 * sigma * sigma; // 2*sigma^2
        const r = radius;

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