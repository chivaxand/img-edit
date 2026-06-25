import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('forensic', {
    name: 'Forensic Analysis',
    mode: 'pixel',

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            mode: 'ela',       // 'ela', 'noise', 'sweep', 'gradient', 'highpass', 'variance', 'bits', 'channel'
            scale: 20,         // Amplification (ELA/Noise/HighPass)
            quality: 0.95,     // JPEG Quality for ELA
            refData: null as Uint8ClampedArray | null, // Reference data for ELA
            
            // High Pass
            hpUseSqrt: true,   // Square root scaling
            hpColorScale: 4.0, // Color contrast boost

            // Level Sweep
            sweepPos: 0.5,     // 0.0 - 1.0
            sweepWidth: 32,    // Window width

            // Gradient / Map Analysis
            gradSource: 'luma', // 'luma', 'hue', 'sat', 'cb', 'cr'
            gradScale: 5.0,     // Gradient intensity
            gradNormalize: true,// Normalize vector
            gradRaw: false,     // Show raw map instead of gradient
            gradSatMask: 0.01,  // Min saturation for Hue

            // Variance
            varScale: 10.0,    // Amplification
            varWindow: 1,      // Window radius (1 = 3x3)

            // Bit Plane
            bitLayer: 3,       // 0-7
            bitChannel: 'all', // 'all', 'r', 'g', 'b'

            // Channel Inspector
            inspectCh: 'r',    // 'r','g','b','a','l','cb','cr'
        };

        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const status = UI.createNode('div', { className: 'popup-hint', style: 'white-space: pre-wrap;' }, 'Ready');

        // Prepare Reference for ELA
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = w;
        sourceCanvas.height = h;
        const sourceCtx = sourceCanvas.getContext('2d');
        sourceCtx!.drawImage(layer.canvas, 0, 0);

        const generateReference = () => {
            if (state.mode !== 'ela') {
                state.refData = null;
                hooks.preview(state);
                return;
            }
            status.textContent = 'Generating re-compressed reference...';
            const tmp = document.createElement('canvas');
            tmp.width = w; tmp.height = h;
            const ctx = tmp.getContext('2d');
            ctx!.drawImage(sourceCanvas, 0, 0);
            const url = tmp.toDataURL('image/jpeg', state.quality);
            const img = new Image();
            img.src = url;
            img.onload = () => {
                ctx!.clearRect(0, 0, w, h);
                ctx!.drawImage(img, 0, 0);
                state.refData = ctx!.getImageData(0, 0, w, h).data;
                status.textContent = `ELA Reference: JPEG Q${Math.round(state.quality*100)}`;
                hooks.preview(state);
            };
        };

        const updateControls = () => {
            const m = state.mode;
            
            // Toggle Groups
            elaControls.style.display = m === 'ela' ? 'block' : 'none';
            noiseControls.style.display = (m === 'ela' || m === 'noise' || m === 'highpass') ? 'block' : 'none';
            hpControls.style.display = m === 'highpass' ? 'block' : 'none';
            sweepControls.style.display = m === 'sweep' ? 'block' : 'none';
            gradControls.style.display = m === 'gradient' ? 'block' : 'none';
            varControls.style.display = m === 'variance' ? 'block' : 'none';
            bitControls.style.display = m === 'bits' ? 'block' : 'none';
            chanControls.style.display = m === 'channel' ? 'block' : 'none';
            
            // Dynamic Hints
            if (m === 'sweep') status.textContent = 'Sweeps intensity levels to find hidden noise/details.';
            else if (m === 'gradient') {
                const s = state.gradSource;
                if (state.gradRaw) status.textContent = `Visualizing raw ${s} channel.`;
                else status.textContent = `Visualizing ${s} gradient (Edges/Direction).`;
                // Show Hue Mask slider only for Hue
                hueMaskRow.style.display = (s === 'hue') ? 'flex' : 'none';
            }
            else if (m === 'noise') status.textContent = 'Separates noise from structure via Median Filter.';
            else if (m === 'highpass') status.textContent = 'Isolates High-Frequency details (Edges/Noise).';
            else if (m === 'variance') status.textContent = 'Local Variance (Complexity). Bright = Texture.';
            else if (m === 'bits') status.textContent = 'Visualizes specific bits of color data.';
            else if (m === 'channel') status.textContent = 'Inspects individual color channels.';
            else status.textContent = 'Amplifies compression artifact differences.';
        };

        container.appendChild(UI.createSelectRow({
            label: 'Mode',
            options: [
                { value: 'ela', text: 'Error Level Analysis (ELA)' },
                { value: 'highpass', text: 'High Pass Filter' },
                { value: 'noise', text: 'Noise Analysis (Median)' },
                { value: 'variance', text: 'Local Variance' },
                { value: 'sweep', text: 'Level Sweep' },
                { value: 'gradient', text: 'Gradient / Map Analysis' },
                { value: 'channel', text: 'Channel Inspection' },
                { value: 'bits', text: 'Bit Plane Slicing' }
            ],
            value: state.mode,
            onChange: (v: any) => { state.mode = v; updateControls(); generateReference(); }
        }));

        // Group: ELA/Noise/HighPass Shared Slider
        const noiseControls = UI.createNode('div', {});
        noiseControls.appendChild(UI.createSliderRow({
            label: 'Amplify', min: 1, max: 100, step: 1, value: state.scale,
            onInput: (v: any) => { state.scale = parseInt(v); hooks.preview(state); }
        }));

        // Group: ELA Specific
        const elaControls = UI.createNode('div', {});
        elaControls.appendChild(UI.createSliderRow({
            label: 'JPEG Q', min: 0.5, max: 0.99, step: 0.01, value: state.quality,
            onInput: (v: any) => { state.quality = parseFloat(v); generateReference();  }
        }));
        noiseControls.appendChild(elaControls);

        // Group: High Pass Specific
        const hpControls = UI.createNode('div', { style: 'display:none' });
        hpControls.appendChild(UI.createSliderRow({
            label: 'Color Contrast', min: 0, max: 10, step: 0.1, value: state.hpColorScale,
            onInput: (v: any) => { state.hpColorScale = parseFloat(v); hooks.preview(state); }
        }));
        hpControls.appendChild(UI.createCheckbox({
            label: 'Sqrt Scaling', value: state.hpUseSqrt,
            onChange: (v: any) => { state.hpUseSqrt = v; hooks.preview(state); }
        }));

        // -- Gradient --
        const gradControls = UI.createNode('div', { style: 'display:none' });
        gradControls.appendChild(UI.createSelectRow({
            label: 'Source',
            options: [
                { value: 'luma', text: 'Luminance' },
                { value: 'hue', text: 'Hue' },
                { value: 'sat', text: 'Saturation' },
                { value: 'cb', text: 'Cb (Blue Diff)' },
                { value: 'cr', text: 'Cr (Red Diff)' },
            ],
            value: state.gradSource,
            onChange: (v: any) => { state.gradSource = v; updateControls(); hooks.preview(state); }
        }));
        gradControls.appendChild(UI.createSliderRow({
            label: 'Intensity', min: 1, max: 50, step: 1, value: state.gradScale,
            onInput: (v: any) => { state.gradScale = parseFloat(v); hooks.preview(state); }
        }));
        gradControls.appendChild(UI.createCheckbox({
            label: 'Normalize (Surface)', value: state.gradNormalize,
            onChange: (v: any) => { state.gradNormalize = v; hooks.preview(state); }
        }));
        gradControls.appendChild(UI.createCheckbox({
            label: 'Show Raw Map', value: state.gradRaw,
            onChange: (v: any) => { state.gradRaw = v; updateControls(); hooks.preview(state); }
        }));
        const hueMaskRow = UI.createSliderRow({
            label: 'Min Saturation', min: 0.0, max: 0.5, step: 0.01, value: state.gradSatMask,
            onInput: (v: any) => { state.gradSatMask = parseFloat(v); hooks.preview(state); }
        });
        gradControls.appendChild(hueMaskRow);

        // -- Sweep --
        const sweepControls = UI.createNode('div', { style: 'display:none' });
        sweepControls.appendChild(UI.createSliderRow({
            label: 'Sweep', min: 0, max: 1, step: 0.01, value: state.sweepPos,
            onInput: (v: any) => { state.sweepPos = parseFloat(v); hooks.preview(state); }
        }));
        sweepControls.appendChild(UI.createSliderRow({
            label: 'Width', min: 2, max: 128, step: 1, value: state.sweepWidth,
            onInput: (v: any) => { state.sweepWidth = parseInt(v); hooks.preview(state); }
        }));

        // -- Variance --
        const varControls = UI.createNode('div', { style: 'display:none' });
        varControls.appendChild(UI.createSliderRow({
            label: 'Scale', min: 1, max: 50, step: 1, value: state.varScale,
            onInput: (v: any) => { state.varScale = parseFloat(v); hooks.preview(state); }
        }));
        varControls.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 5, step: 1, value: state.varWindow,
            onInput: (v: any) => { state.varWindow = parseInt(v); hooks.preview(state); }
        }));

        // -- Bits --
        const bitControls = UI.createNode('div', { style: 'display:none' });
        bitControls.appendChild(UI.createSliderRow({
            label: 'Layer', min: 0, max: 7, step: 1, value: state.bitLayer,
            onInput: (v: any) => { state.bitLayer = parseInt(v); hooks.preview(state); },
            formatter: (v: any) => {
                const i = parseInt(v);
                if (i === 0) return '0 (LSB)';
                if (i === 7) return '7 (MSB)';
                return String(i);
            }
        }));
        bitControls.appendChild(UI.createSelectRow({
            label: 'Channel',
            options: [
                { value: 'all', text: 'All (RGB)' },
                { value: 'gray', text: 'Gray' },
                { value: 'r', text: 'Red' },
                { value: 'g', text: 'Green' },
                { value: 'b', text: 'Blue' }
            ],
            value: state.bitChannel,
            onChange: (v: any) => { state.bitChannel = v; hooks.preview(state); }
        }));

        // -- Channel Inspector --
        const chanControls = UI.createNode('div', { style: 'display:none' });
        chanControls.appendChild(UI.createSelectRow({
            label: 'Channel',
            options: [
                { value: 'r', text: 'Red' },
                { value: 'g', text: 'Green' },
                { value: 'b', text: 'Blue' },
                { value: 'a', text: 'Alpha' },
                { value: 'l', text: 'Luminance' },
                { value: 'cb', text: 'Cb (Blue-Diff)' },
                { value: 'cr', text: 'Cr (Red-Diff)' }
            ],
            value: state.inspectCh,
            onChange: (v: any) => { state.inspectCh = v; hooks.preview(state); }
        }));

        container.appendChild(noiseControls);
        container.appendChild(hpControls);
        container.appendChild(gradControls);
        container.appendChild(sweepControls);
        container.appendChild(varControls);
        container.appendChild(bitControls);
        container.appendChild(chanControls);
        container.appendChild(status);

        updateControls();
        generateReference();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { mode, scale, refData } = params;
        const len = w * h;
        
        if (mode === 'ela' && refData && refData.length === data.length) {
            this.computeELA(data, refData, scale);
        } 
        else if (mode === 'noise') {
            this.computeNoise(data, w, h, scale);
        }
        else if (mode === 'highpass') {
            const { hpUseSqrt, hpColorScale } = params;
            this.computeHighPass(data, w, h, scale, hpUseSqrt, hpColorScale);
        }
        else if (mode === 'gradient') {
            this.computeGradientMap(data, w, h, params);
        }
        else if (mode === 'variance') {
            const { varWindow, varScale } = params;
            this.computeVariance(data, w, h, varWindow, varScale);
        }
        else if (mode === 'sweep') {
            const { sweepPos, sweepWidth } = params;
            this.computeSweep(data, len, sweepPos, sweepWidth);
        }
        else if (mode === 'bits') {
            const { bitLayer, bitChannel } = params;
            this.computeBitPlane(data, len, bitLayer, bitChannel);
        }
        else if (mode === 'channel') {
            const { inspectCh } = params;
            this.inspectChannel(data, len, inspectCh);
        }
    },

    // --- Core Processing Methods ---

    computeELA(data: Uint8ClampedArray, refData: Uint8ClampedArray, scale: number) {
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
            const rD = Math.abs(data[i] - refData[i]) * scale;
            const gD = Math.abs(data[i+1] - refData[i+1]) * scale;
            const bD = Math.abs(data[i+2] - refData[i+2]) * scale;
            data[i]   = rD > 255 ? 255 : rD; 
            data[i+1] = gD > 255 ? 255 : gD; 
            data[i+2] = bD > 255 ? 255 : bD; 
            data[i+3] = 255;
        }
    },

    computeNoise(data: Uint8ClampedArray, w: number, h: number, scale: number) {
        const src = new Uint8ClampedArray(data);
        const neighbors = new Uint8Array(9);
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                    let nCount = 0;
                    for (let ky = -1; ky <= 1; ky++) {
                        const ny = y + ky;
                        if(ny < 0 || ny >= h) continue;
                        const rowOff = ny * w * 4;
                        for (let kx = -1; kx <= 1; kx++) {
                            const nx = x + kx;
                            if(nx < 0 || nx >= w) continue;
                            neighbors[nCount++] = src[rowOff + nx * 4 + c];
                        }
                    }
                    const subarray = neighbors.subarray(0, nCount);
                    subarray.sort();
                    const median = subarray[Math.floor(nCount / 2)];
                    const diff = Math.abs(src[idx + c] - median) * scale;
                    data[idx + c] = diff > 255 ? 255 : diff;
                }
                data[idx+3] = 255;
            }
        }
    },

    computeHighPass(data: Uint8ClampedArray, w: number, h: number, scale: number, useSqrt: boolean, colorContrast: number) {
        const src = new Uint8ClampedArray(data);
        const stride = w * 4;
        const effScale = useSqrt ? scale : (scale / 5.0);

        const getKernelVal = (i: number) => {
            const center = src[i] * 8;
            const surround = 
                src[i - stride - 4] + src[i - stride] + src[i - stride + 4] +
                src[i - 4]          +                   src[i + 4] +
                src[i + stride - 4] + src[i + stride] + src[i + stride + 4];
            const diff = Math.abs(center - surround);
            return (useSqrt ? Math.sqrt(diff) : diff) * effScale;
        };

        const clamp = (v: number) => v < 0 ? 0 : (v > 255 ? 255 : v);

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = (y * w + x) * 4;
                let r = getKernelVal(i);
                let g = getKernelVal(i + 1);
                let b = getKernelVal(i + 2);

                // Apply Color Contrast
                if (colorContrast !== 1.0) {
                    const avg = (r + g + b) / 3;
                    r = avg + (r - avg) * colorContrast;
                    g = avg + (g - avg) * colorContrast;
                    b = avg + (b - avg) * colorContrast;
                }

                data[i] = clamp(r);
                data[i + 1] = clamp(g);
                data[i + 2] = clamp(b);
                data[i + 3] = 255;
            }
        }
    },

    computeGradientMap(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { gradSource, gradScale, gradNormalize, gradRaw, gradSatMask } = params;
        const len = w * h;
        const map = new Float32Array(len);
        const satMap = (gradSource === 'hue') ? new Float32Array(len) : null;
        
        // 1. Extract Map
        this.getMap(data, len, gradSource, map, satMap);

        // 2. Render Raw OR Gradient
        if (gradRaw) {
            if (gradSource === 'hue') {
                // Render Rainbow for Hue
                for (let i = 0; i < len; i++) {
                    const idx = i * 4;
                    if (satMap && satMap[i] < gradSatMask) {
                        continue; // Keep original
                    }
                    const rgb = this.hsvToRgb(map[i], 1, 1);
                    data[idx] = rgb[0];
                    data[idx+1] = rgb[1];
                    data[idx+2] = rgb[2];
                    data[idx+3] = 255;
                }
            } else {
                // Render Grayscale
                const mult = (gradSource === 'sat') ? 255 : 1; // Sat is 0..1, others 0..255
                for (let i = 0; i < len; i++) {
                    const idx = i * 4;
                    const v = map[i] * mult;
                    data[idx] = data[idx+1] = data[idx+2] = v;
                    data[idx+3] = 255;
                }
            }
        } else {
            // Compute Gradient
            const inputMax = (gradSource === 'hue' || gradSource === 'sat') ? 1.0 : 255.0;
            const isCircular = (gradSource === 'hue');

            // Render Gradient to temporary buffer
            const gradBuffer = new Uint8ClampedArray(len * 4);
            this.computeGradient(map, gradBuffer, w, h, {
                scale: gradScale,
                normalize: gradNormalize,
                inputMax,
                isCircular
            });

            // Copy to data (handling masks if any)
            for (let i = 0; i < len; i++) {
                const idx = i * 4;
                // Hue mask logic
                if (gradSource === 'hue' && satMap && satMap[i] < gradSatMask) {
                    continue; // Skip low saturation
                }
                data[idx]   = gradBuffer[idx];
                data[idx+1] = gradBuffer[idx+1];
                data[idx+2] = gradBuffer[idx+2];
                data[idx+3] = 255;
            }
        }
    },

    computeGradient(src: Float32Array, dest: Uint8ClampedArray, w: number, h: number, { scale, normalize, inputMax, isCircular }: any) {
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                const idx = i * 4;
                
                // Calculate Derivatives
                const vL = src[i - 1];
                const vR = src[i + 1];
                const vU = src[i - w];
                const vD = src[i + w];

                let dx, dy;

                if (isCircular) {
                    // Shortest distance on circular domain (0..inputMax)
                    const half = inputMax * 0.5;
                    // Horizontal
                    let dxRaw = vR - vL;
                    if (dxRaw > half) dxRaw -= inputMax;
                    if (dxRaw < -half) dxRaw += inputMax;
                    dx = dxRaw;
                    // Vertical
                    let dyRaw = vD - vU;
                    if (dyRaw > half) dyRaw -= inputMax;
                    if (dyRaw < -half) dyRaw += inputMax;
                    dy = dyRaw;
                } else {
                    dx = vR - vL;
                    dy = vD - vU;
                }

                // Normalize input domain to 0..1
                dx /= inputMax;
                dy /= inputMax;

                let dz, len;
                if (normalize) {
                    dz = 0.5; 
                    const magSq = dx * dx + dy * dy + dz * dz;
                    len = (magSq > 0) ? 1.0 / Math.sqrt(magSq) : 0;
                } else {
                    dz = -1.0;
                    len = 1.0;
                }

                const r = 127.5 + (dx * len * 255 * scale);
                const g = 127.5 + (dy * len * 255 * scale);
                const b = 127.5 + (dz * len * 255 * scale);
                
                dest[idx]   = r < 0 ? 0 : (r > 255 ? 255 : r);
                dest[idx+1] = g < 0 ? 0 : (g > 255 ? 255 : g);
                dest[idx+2] = b < 0 ? 0 : (b > 255 ? 255 : b);
                dest[idx+3] = 255;
            }
        }
    },

    getMap(this: any, data: Uint8ClampedArray, len: number, type: string, map: Float32Array, satMap: Float32Array | null) {
        for (let i = 0; i < len; i++) {
            const idx = i * 4;
            const r = data[idx], g = data[idx+1], b = data[idx+2];
            
            if (type === 'luma') {
                map[i] = r * 0.299 + g * 0.587 + b * 0.114;
            } else if (type === 'cb') {
                map[i] = 128 + (-0.1687 * r - 0.3313 * g + 0.5 * b);
            } else if (type === 'cr') {
                map[i] = 128 + (0.5 * r - 0.4187 * g - 0.0813 * b);
            } else if (type === 'hue' || type === 'sat') {
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const d = max - min;
                const sat = max === 0 ? 0 : d / max;
                
                if (satMap) satMap[i] = sat;

                if (type === 'sat') {
                    map[i] = sat;
                } else {
                    let hue = 0;
                    if (max !== min) {
                        switch (max) {
                            case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
                            case g: hue = (b - r) / d + 2; break;
                            case b: hue = (r - g) / d + 4; break;
                        }
                        hue /= 6;
                    }
                    map[i] = hue;
                }
            }
        }
    },

    computeVariance(data: Uint8ClampedArray, w: number, h: number, radius: number, scale: number) {
        const src = new Uint8ClampedArray(data);
        const size = (2 * radius + 1) * (2 * radius + 1);

        for (let y = radius; y < h - radius; y++) {
            for (let x = radius; x < w - radius; x++) {
                const i = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                    let sum = 0;
                    for (let ky = -radius; ky <= radius; ky++) {
                        for (let kx = -radius; kx <= radius; kx++) {
                            const off = ((y + ky) * w + (x + kx)) * 4 + c;
                            sum += src[off];
                        }
                    }
                    const mean = sum / size;
                    let varSum = 0;
                    for (let ky = -radius; ky <= radius; ky++) {
                        for (let kx = -radius; kx <= radius; kx++) {
                            const off = ((y + ky) * w + (x + kx)) * 4 + c;
                            const diff = src[off] - mean;
                            varSum += diff * diff;
                        }
                    }
                    const stdDev = Math.sqrt(varSum / size);
                    let val = stdDev * scale;
                    data[i + c] = val > 255 ? 255 : val;
                }
                data[i + 3] = 255;
            }
        }
    },

    computeSweep(data: Uint8ClampedArray, len: number, sweepPos: number, sweepWidth: number) {
        const start = sweepPos * (255 - sweepWidth);
        const factor = 255 / sweepWidth;

        for (let i = 0; i < len * 4; i += 4) {
            for (let c = 0; c < 3; c++) {
                let val = data[i+c];
                val = (val - start) * factor;
                data[i+c] = val < 0 ? 0 : (val > 255 ? 255 : val);
            }
            data[i+3] = 255;
        }
    },

    computeBitPlane(data: Uint8ClampedArray, len: number, bitLayer: number, bitChannel: string) {
        const shift = bitLayer; 
        for (let i = 0; i < len * 4; i += 4) {
            const r = (data[i] >> shift) & 1;
            const g = (data[i+1] >> shift) & 1;
            const b = (data[i+2] >> shift) & 1;
            const bits = { r, g, b };
            if (bitChannel === 'all') {
                data[i] = r * 255;
                data[i+1] = g * 255;
                data[i+2] = b * 255;
            } else {
                let val;
                if (bitChannel === 'gray') {
                    val = (r * 0.2126 + g * 0.7152 + b * 0.0722) >= 0.5 ? 255 : 0;
                } else {
                    val = (bits as any)[bitChannel] * 255;
                }
                data[i] = data[i+1] = data[i+2] = val;
            }
            data[i+3] = 255;
        }
    },

    inspectChannel(data: Uint8ClampedArray, len: number, inspectCh: string) {
        for (let i = 0; i < len * 4; i += 4) {
            let v = 0;
            const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
            if (inspectCh === 'r') v = r;
            else if (inspectCh === 'g') v = g;
            else if (inspectCh === 'b') v = b;
            else if (inspectCh === 'a') v = a;
            else if (inspectCh === 'l') v = r * 0.299 + g * 0.587 + b * 0.114;
            else if (inspectCh === 'cb') v = 128 + (-0.1687*r - 0.3313*g + 0.5*b);
            else if (inspectCh === 'cr') v = 128 + (0.5*r - 0.4187*g - 0.0813*b);
            
            data[i] = data[i+1] = data[i+2] = v;
            data[i+3] = 255;
        }
    },

    hsvToRgb(h: number, s: number, v: number) {
        let r = 0, g = 0, b = 0;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
});