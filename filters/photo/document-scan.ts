import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('document-scan', {
    name: 'Document Scan / OCR',
    mode: 'pixel',
    menu: {
        path: 'Filter/Photo',
        label: 'Document Scan...',
        order: 2
    },

    dialogOptions: { width: '300px' },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            mode: 'normalize', // 'normalize', 'bin-wolf', 'bin-sauvola'
            color: false,
            bgRadius: 50,
            blackPoint: 100,
            whitePoint: 255,
            gamma: 0.8,
            sharpen: 10,
            window: 31,
            k: 0.20
        };
        const update = () => hooks.preview(state);
        
        container.appendChild(UI.createSelectRow({
            label: 'Mode',
            options: [
                { value: 'normalize', text: 'Normalized' },
                { value: 'bin-wolf', text: 'B&W (Wolf)' },
                { value: 'bin-sauvola', text: 'B&W (Sauvola)' }
            ],
            value: state.mode,
            onChange: v => { state.mode = String(v); updateControls(); update(); }
        }));
        
        const radiusSlider = UI.createSliderRow({ 
            label: 'Blur Radius', 
            min: 5, max: 200, step: 1, value: state.bgRadius, 
            onInput: v => { state.bgRadius = parseInt(String(v)); update(); } 
        });
        container.appendChild(radiusSlider);

        // --- Normalized Controls ---
        const normGroup = UI.createNode('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } });
        
        normGroup.appendChild(UI.createCheckbox({
            label: 'Preserve Colors',
            value: state.color,
            onChange: v => { state.color = v; update(); }
        }));

        normGroup.appendChild(UI.createSliderRow({ 
            label: 'Black Point', 
            min: 0, max: 128, step: 1, value: state.blackPoint, 
            onInput: v => { state.blackPoint = parseInt(String(v)); update(); } 
        }));

        normGroup.appendChild(UI.createSliderRow({ 
            label: 'White Point', 
            min: 128, max: 255, step: 1, value: state.whitePoint, 
            onInput: v => { state.whitePoint = parseInt(String(v)); update(); } 
        }));

        normGroup.appendChild(UI.createSliderRow({ 
            label: 'Gamma', 
            min: 0.1, max: 3.0, step: 0.1, value: state.gamma, 
            onInput: v => { state.gamma = parseFloat(String(v)); update(); } 
        }));

        normGroup.appendChild(UI.createSliderRow({ 
            label: 'Sharpen', 
            min: 0, max: 100, step: 1, value: state.sharpen, 
            onInput: v => { state.sharpen = parseInt(String(v)); update(); } 
        }));
        
        container.appendChild(normGroup);

        // --- Binarization Controls ---
        const binGroup = UI.createNode('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } });

        binGroup.appendChild(UI.createSliderRow({ 
            label: 'Window Size', 
            min: 5, max: 151, step: 2, value: state.window, 
            onInput: v => { state.window = parseInt(String(v)); update(); } 
        }));
        
        binGroup.appendChild(UI.createSliderRow({ 
            label: 'Sensitivity (K)', 
            min: 0.01, max: 0.8, step: 0.01, value: state.k, 
            onInput: v => { state.k = parseFloat(String(v)); update(); } 
        }));

        container.appendChild(binGroup);
        
        const updateControls = () => {
            const isBin = state.mode.startsWith('bin-');
            UI.toggle(normGroup, !isBin, 'flex');
            UI.toggle(binGroup, isBin, 'flex');
        };
        
        updateControls();
        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { mode, color, bgRadius, blackPoint, whitePoint, gamma, sharpen, window, k } = params;
        const isBin = mode.startsWith('bin-');
        const isColor = mode === 'normalize' && color;
        
        // 1. Extract Luma (Grayscale)
        const luma = new Float32Array(w * h);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            luma[j] = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        }
        
        // 2. Hardware-accelerated CSS blur for background lighting estimation
        const tempCvs = document.createElement('canvas');
        tempCvs.width = w; tempCvs.height = h;
        const tempCtx = tempCvs.getContext('2d')!;
        const imgData = new ImageData(new Uint8ClampedArray(data), w, h);
        tempCtx.putImageData(imgData, 0, 0);
        
        const blurCvs = document.createElement('canvas');
        blurCvs.width = w; blurCvs.height = h;
        const blurCtx = blurCvs.getContext('2d')!;
        blurCtx.filter = `blur(${bgRadius}px)`;
        blurCtx.drawImage(tempCvs, 0, 0);
        
        const bgData = blurCtx.getImageData(0, 0, w, h).data;
        
        // 3. Normalize Illumination
        const normLuma = new Float32Array(w * h);
        for (let i = 0, j = 0; i < bgData.length; i += 4, j++) {
            const bgL = bgData[i] * 0.299 + bgData[i+1] * 0.587 + bgData[i+2] * 0.114;
            // Divide original by background to flatten lighting
            normLuma[j] = Math.min(255, Math.max(0, (luma[j] / (bgL + 1e-5)) * 255));
        }

        // 4. Output Generation
        if (isBin) {
            // Adaptive Binarization via Integral Images
            const intImg = new Float64Array(w * h);
            const intSqImg = new Float64Array(w * h);
            let minGray = 255;

            for (let y = 0; y < h; y++) {
                let sum = 0;
                let sqSum = 0;
                for (let x = 0; x < w; x++) {
                    const idx = y * w + x;
                    const val = normLuma[idx];
                    if (val < minGray) minGray = val;
                    
                    sum += val;
                    sqSum += val * val;
                    
                    if (y === 0) {
                        intImg[idx] = sum;
                        intSqImg[idx] = sqSum;
                    } else {
                        const upIdx = (y - 1) * w + x;
                        intImg[idx] = intImg[upIdx] + sum;
                        intSqImg[idx] = intSqImg[upIdx] + sqSum;
                    }
                }
            }
            
            const halfWin = Math.floor(window / 2);
            let maxStdDev = 0;

            // Wolf algorithm requires finding the max standard deviation first
            if (mode === 'bin-wolf') {
                for (let y = 0; y < h; y += 4) { // Sub-sample for speed
                    for (let x = 0; x < w; x += 4) {
                        const x1 = Math.max(0, x - halfWin);
                        const y1 = Math.max(0, y - halfWin);
                        const x2 = Math.min(w - 1, x + halfWin);
                        const y2 = Math.min(h - 1, y + halfWin);
                        const area = (x2 - x1 + 1) * (y2 - y1 + 1);
                        
                        let sum = intImg[y2 * w + x2];
                        let sqSum = intSqImg[y2 * w + x2];
                        if (x1 > 0) { sum -= intImg[y2 * w + (x1 - 1)]; sqSum -= intSqImg[y2 * w + (x1 - 1)]; }
                        if (y1 > 0) { sum -= intImg[(y1 - 1) * w + x2]; sqSum -= intSqImg[(y1 - 1) * w + x2]; }
                        if (x1 > 0 && y1 > 0) { sum += intImg[(y1 - 1) * w + (x1 - 1)]; sqSum += intSqImg[(y1 - 1) * w + (x1 - 1)]; }
                        
                        const mean = sum / area;
                        const variance = (sqSum / area) - (mean * mean);
                        const stddev = Math.sqrt(Math.max(0, variance));
                        if (stddev > maxStdDev) maxStdDev = stddev;
                    }
                }
            }

            const R = mode === 'bin-sauvola' ? 128 : maxStdDev;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const x1 = Math.max(0, x - halfWin);
                    const y1 = Math.max(0, y - halfWin);
                    const x2 = Math.min(w - 1, x + halfWin);
                    const y2 = Math.min(h - 1, y + halfWin);
                    const area = (x2 - x1 + 1) * (y2 - y1 + 1);
                    
                    let sum = intImg[y2 * w + x2];
                    let sqSum = intSqImg[y2 * w + x2];
                    if (x1 > 0) { sum -= intImg[y2 * w + (x1 - 1)]; sqSum -= intSqImg[y2 * w + (x1 - 1)]; }
                    if (y1 > 0) { sum -= intImg[(y1 - 1) * w + x2]; sqSum -= intSqImg[(y1 - 1) * w + x2]; }
                    if (x1 > 0 && y1 > 0) { sum += intImg[(y1 - 1) * w + (x1 - 1)]; sqSum += intSqImg[(y1 - 1) * w + (x1 - 1)]; }
                    
                    const mean = sum / area;
                    const variance = (sqSum / area) - (mean * mean);
                    const stddev = Math.sqrt(Math.max(0, variance));
                    
                    let threshold = 0;
                    if (mode === 'bin-sauvola') {
                        threshold = mean * (1 + k * (stddev / R - 1));
                    } else {
                        // Wolf-Jolion Formula
                        threshold = mean - k * (1 - stddev / R) * (mean - minGray);
                    }
                    
                    const outVal = normLuma[y * w + x] <= threshold ? 0 : 255;
                    const idx4 = (y * w + x) * 4;
                    data[idx4] = data[idx4+1] = data[idx4+2] = outVal;
                    data[idx4+3] = 255;
                }
            }
        } else {
            // Normalized Mode
            const bp = blackPoint;
            const wp = Math.max(bp + 1, whitePoint);
            const range = wp - bp;
            const invGamma = 1 / gamma;
            
            // Temporary buffer if sharpening is needed
            const outPixels = sharpen > 0 ? new Uint8Array(w * h * 3) : null;

            for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                // Apply Black Point, White Point, and Gamma to Luma
                let l = normLuma[j];
                l = Math.max(0, Math.min(255, l));
                let normalized = Math.pow(Math.max(0, l - bp) / range, invGamma) * 255;
                normalized = Math.max(0, Math.min(255, normalized));

                let r = normalized, g = normalized, b = normalized;

                if (isColor) {
                    // Restore color ratio
                    const origL = luma[j] + 1e-5;
                    const ratio = normalized / origL;
                    r = Math.min(255, data[i] * ratio);
                    g = Math.min(255, data[i+1] * ratio);
                    b = Math.min(255, data[i+2] * ratio);
                }

                if (outPixels) {
                    outPixels[j*3] = r;
                    outPixels[j*3+1] = g;
                    outPixels[j*3+2] = b;
                } else {
                    data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = 255;
                }
            }

            // 5. Sharpening Pass (Unsharp Mask style via 3x3 Convolution)
            if (outPixels && sharpen > 0) {
                const amount = sharpen / 100;
                
                for (let y = 1; y < h - 1; y++) {
                    for (let x = 1; x < w - 1; x++) {
                        const idx = y * w + x;
                        const idx4 = idx * 4;
                        
                        for (let c = 0; c < 3; c++) {
                            const val = outPixels[idx * 3 + c];
                            
                            // Simple Laplacian edge detection
                            const top = outPixels[(idx - w) * 3 + c];
                            const left = outPixels[(idx - 1) * 3 + c];
                            const right = outPixels[(idx + 1) * 3 + c];
                            const bottom = outPixels[(idx + w) * 3 + c];
                            
                            const edge = (val * 4) - top - left - right - bottom;
                            
                            // Add edge back to original (Sharpen)
                            data[idx4 + c] = Math.max(0, Math.min(255, val + edge * amount));
                        }
                        data[idx4 + 3] = 255;
                    }
                }
            }
        }
    }
});