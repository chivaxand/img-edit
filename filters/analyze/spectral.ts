import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';
import { PaletteName } from '~/libs/plot';

Filters.register('spectral', {
    name: 'Spectral Analysis',
    mode: 'pixel',
    menu: {
        path: 'Analyze',
        label: 'Spectral Analysis...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            mode: 'spectrum',       // 'spectrum', 'radial', 'polar'
            spectrumType: 'magnitude', // 'magnitude', 'real', 'imag', 'phase'
            channel: 'gray',        // 'gray', 'red', 'green', 'blue'
            analyzeDiff: false,     // Pre-process with Edge Detection
            logScale: true,         // Use Log Magnitude
            contrast: 1.0,          // Visual contrast
            cmap: 'ironbow' as PaletteName, // Colormap
            windowType: 'hamming',  // 'none', 'hann', 'hamming', 'blackman', 'kaiser'
            kaiserBeta: 6.0,        // Kaiser window beta parameter
            circularPlot: false,    // Circular radar plot for Polar mode
            showJpegGrid: false,    // Overlay Grid markers
            gridW: 8,               // Grid Block Width (default 8 for JPEG)
            gridH: 8,               // Grid Block Height
            angleMarker: 0,         // Guide line for angle detection
            scaleMode: 'auto',      // 'auto', 'manual'
            manualLimit: 10.0       // Custom clipping/limit value
        };

        const update = () => {
            const isPolar = state.mode === 'polar';
            const isSpectrum = state.mode === 'spectrum';
            const isKaiser = state.windowType === 'kaiser';
            const isManualScale = state.scaleMode === 'manual';
            
            circularCheckbox.style.display = isPolar ? 'flex' : 'none';
            angleRow.style.display = isPolar ? 'flex' : 'none';
            jpegCheckbox.style.display = isSpectrum ? 'flex' : 'none';
            gridConfig.style.display = (isSpectrum && state.showJpegGrid) ? 'block' : 'none';
            betaRow.style.display = isKaiser ? 'flex' : 'none';
            typeRow.style.display = isSpectrum ? 'flex' : 'none';
            scaleRow.style.display = isSpectrum ? 'flex' : 'none';
            limitRow.style.display = (isSpectrum && isManualScale) ? 'flex' : 'none';
            
            hooks.preview(state);
        };

        container.appendChild(UI.createNode('div', { className: 'popup-hint', style: 'white-space: pre-wrap;' }, 
            'Analyzes Frequency Domain.\n• Spectrum: 2D FFT Grid.\n• Radial: Full Mean Profile.\n• Polar: Energy vs Direction.'
        ));

        // --- Main Controls ---
        
        container.appendChild(UI.createSelectRow({
            label: 'View Mode',
            options: [
                { value: 'spectrum', text: '2D Spectrum (Cartesian)' },
                { value: 'radial', text: 'Radial Profile (Frequency)' },
                { value: 'polar', text: 'Polar Plot (Direction)' }
            ],
            value: state.mode,
            onChange: (v: any) => { state.mode = v; update(); }
        }));

        container.appendChild(UI.createSelectRow({
            label: 'Channel',
            options: [
                { value: 'gray', text: 'Grayscale (Luminosity)' },
                { value: 'red', text: 'Red' },
                { value: 'green', text: 'Green' },
                { value: 'blue', text: 'Blue' }
            ],
            value: state.channel,
            onChange: (v: any) => { state.channel = v; update(); }
        }));

        const typeRow = UI.createSelectRow({
            label: 'Spectrum Type',
            options: [
                { value: 'magnitude', text: 'Magnitude' },
                { value: 'real', text: 'Cosine Component (Real)' },
                { value: 'imag', text: 'Sine Component (Imaginary)' },
                { value: 'phase', text: 'Phase Angle' }
            ],
            value: state.spectrumType,
            onChange: (v: any) => { state.spectrumType = v; update(); }
        });
        container.appendChild(typeRow);

        container.appendChild(UI.createSelectRow({
            label: 'Window func',
            options: [
                { value: 'none', text: 'None (Rectangular)' },
                { value: 'hann', text: 'Hanning (Hann)' },
                { value: 'hamming', text: 'Hamming' },
                { value: 'blackman', text: 'Blackman' },
                { value: 'kaiser', text: 'Kaiser (Adjustable)' }
            ],
            value: state.windowType,
            onChange: (v: any) => { state.windowType = v; update(); }
        }));

        const scaleRow = UI.createSelectRow({
            label: 'Scale Mode',
            options: [
                { value: 'auto', text: 'Auto' },
                { value: 'manual', text: 'Manual' }
            ],
            value: state.scaleMode,
            onChange: (v: any) => { state.scaleMode = v; update(); }
        });
        container.appendChild(scaleRow);

        const limitRow = UI.createSliderRow({
            label: 'Manual Limit', min: 0.1, max: 100.0, step: 0.1, value: state.manualLimit,
            onInput: (v: any) => { state.manualLimit = parseFloat(v); update(); }
        });
        container.appendChild(limitRow);

        container.appendChild(UI.createPaletteSelectRow({
            label: 'Colormap',
            value: state.cmap,
            onChange: (v: PaletteName) => { state.cmap = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Contrast', min: 1, max: 20, step: 0.5, value: state.contrast,
            onInput: (v: any) => { state.contrast = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Analyze Edges (Diff)', value: state.analyzeDiff,
            onChange: (v: any) => { state.analyzeDiff = v; update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Log Scale', value: state.logScale,
            onChange: (v: any) => { state.logScale = v; update(); }
        }));

        const betaRow = UI.createSliderRow({
            label: 'Kaiser Beta', min: 0.1, max: 20, step: 0.1, value: state.kaiserBeta,
            onInput: (v: any) => { state.kaiserBeta = parseFloat(v); update(); }
        });
        container.appendChild(betaRow);

        // --- Contextual Controls ---

        const circularCheckbox = UI.createCheckbox({
            style: 'display:none',
            label: 'Circular Plot', value: state.circularPlot,
            onChange: (v: any) => { state.circularPlot = v; update(); }
        });
        container.appendChild(circularCheckbox);

        const angleRow = UI.createAngleRow({
            style: 'display:none',
            label: 'Angle Guide',
            value: state.angleMarker,
            min: 0, max: 180, step: 1, mode: '180',
            onInput: (v: number) => { state.angleMarker = v; update(); }
        });
        container.appendChild(angleRow);

        const jpegCheckbox = UI.createCheckbox({
            style: 'display:none',
            label: 'Show Grid Markers', value: state.showJpegGrid,
            onChange: (v: any) => { state.showJpegGrid = v; update(); }
        });
        container.appendChild(jpegCheckbox);

        // --- Grid Configuration (Hidden by default) ---
        
        const gridConfig = UI.createNode('div', { style:'display:none; padding-left:15px; margin-bottom:10px; border-left:2px solid #555;' });
        const inputW = UI.createInput('number', { value: state.gridW, min:2, max:128, style:'width:100%' }, (t: HTMLInputElement) => {
            state.gridW = parseInt(t.value) || 8; update();
        });
        const inputH = UI.createInput('number', { value: state.gridH, min:2, max:128, style:'width:100%' }, (t: HTMLInputElement) => {
            state.gridH = parseInt(t.value) || 8; update();
        });

        gridConfig.appendChild(UI.createRow('Block W', inputW));
        gridConfig.appendChild(UI.createRow('Block H', inputH));
        container.appendChild(gridConfig);

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const rawGray = new Float32Array(w * h);
        const len = w * h;
        const channel = params.channel || 'gray';

        // Select Channel
        if (channel === 'red') {
            for (let i = 0; i < len; i++) rawGray[i] = data[i * 4] / 255.0;
        } else if (channel === 'green') {
            for (let i = 0; i < len; i++) rawGray[i] = data[i * 4 + 1] / 255.0;
        } else if (channel === 'blue') {
            for (let i = 0; i < len; i++) rawGray[i] = data[i * 4 + 2] / 255.0;
        } else {
            // Default Grayscale (Luminosity)
            for (let i = 0; i < len; i++) {
                const idx = i * 4;
                rawGray[i] = (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114) / 255.0;
            }
        }

        // Edge Detection
        // Kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
        if (params.analyzeDiff) {
            const diff = new Float32Array(w * h);
            for (let y = 1; y < h - 1; y++) {
                const row = y * w;
                for (let x = 1; x < w - 1; x++) {
                    const i = row + x;
                    const val = rawGray[i - w] + rawGray[i + w] + rawGray[i - 1] + rawGray[i + 1] - 4 * rawGray[i];
                    diff[i] = val / 256;
                }
            }
            rawGray.set(diff);
        }

        // Apply Windowing
        const winType = params.windowType || (params.windowing ? 'hann' : 'none');
        const gray = new Float32Array(w * h);
        let winX = null, winY = null;
        
        if (winType !== 'none') {
            winX = new Float32Array(w);
            winY = new Float32Array(h);
            const beta = params.kaiserBeta || 6.0;

            const genWindow = (arr: Float32Array, size: number) => {
                const M = size > 1 ? size - 1 : 1;
                
                if (winType === 'hann') {
                    for(let i=0; i<size; i++) {
                        arr[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / M));
                    }
                } 
                else if (winType === 'hamming') {
                    for(let i=0; i<size; i++) {
                        arr[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / M);
                    }
                }
                else if (winType === 'blackman') {
                    for(let i=0; i<size; i++) {
                        arr[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / M) + 0.08 * Math.cos(4 * Math.PI * i / M);
                    }
                }
                else if (winType === 'kaiser') {
                    const i0Beta = this._besselI0(beta);
                    for(let i=0; i<size; i++) {
                        const k = (2 * i / M) - 1;
                        const arg = Math.sqrt(Math.max(0, 1 - k * k));
                        arr[i] = this._besselI0(beta * arg) / i0Beta;
                    }
                }
            };
            
            genWindow(winX, w);
            genWindow(winY, h);
        }

        for (let y = 0; y < h; y++) {
            const wy = (winY) ? winY[y] : 1.0;
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                const val = rawGray[rowOffset + x];
                const wx = (winX) ? winX[x] : 1.0;
                gray[rowOffset + x] = val * wy * wx;
            }
        }

        // Perform 2D FFT
        const input2D = [];
        for(let y=0; y<h; y++) input2D.push(Array.from(gray.subarray(y*w, (y+1)*w)));

        const fftRes = Lib.fft.fft2d(input2D);
        const shifted = Lib.fft.shift(fftRes);
        
        // Compute chosen spectrum component
        const specType = params.spectrumType || 'magnitude';
        const mag = new Float32Array(w * h);
        let maxVal = 0;

        for(let y=0; y<h; y++) {
            for(let x=0; x<w; x++) {
                const re = shifted.re[y][x];
                const im = shifted.im[y][x];
                let m = 0;
                
                if (specType === 'magnitude') {
                    m = Math.sqrt(re*re + im*im);
                } else if (specType === 'real') {
                    m = re;
                } else if (specType === 'imag') {
                    m = im;
                } else if (specType === 'phase') {
                    m = Math.atan2(im, re);
                }

                if (params.logScale && specType !== 'phase') {
                    if (m < 0) {
                        m = -Math.log(1 - m);
                    } else {
                        m = Math.log(1 + m);
                    }
                }
                mag[y*w + x] = m;
                const absM = Math.abs(m);
                if (absM > maxVal) maxVal = absM;
            }
        }

        // Render Output
        if (params.mode === 'spectrum') {
            this.renderSpectrum2D(data, mag, w, h, maxVal, params.contrast, params.showJpegGrid, params.gridW, params.gridH, params.cmap, params);
        } 
        else if (params.mode === 'radial') {
            this.renderRadialProfile(data, mag, w, h, maxVal);
        } 
        else if (params.mode === 'polar') {
            this.renderPolarTransform(data, mag, w, h, maxVal, params.contrast, params.circularPlot, params.cmap, params.angleMarker);
        }
    },

    // --- Renderers ---

    renderSpectrum2D(this: any, data: Uint8ClampedArray, mag: Float32Array, w: number, h: number, maxVal: number, contrast: number, showGrid: boolean, gridW: number, gridH: number, cmap: PaletteName, params: any = {}) {
        data.fill(20); 
        const specType = params.spectrumType || 'magnitude';
        const isManual = params.scaleMode === 'manual';
        const limitVal = isManual ? (params.manualLimit || 10.0) : maxVal;
        
        const scale = (1.0 / (limitVal || 1)) * contrast;
        const len = w * h;
        const pal = cmap || 'ironbow';
        
        for (let i = 0; i < len; i++) {
            const m = mag[i];
            let v = 0;
            
            if (specType === 'phase') {
                // Phase ranges from -PI to PI; map to [0, 1]
                v = (m / Math.PI) * 0.5 + 0.5;
            } else if (specType === 'real' || specType === 'imag') {
                // Real and imaginary can be signed; map centered around 0.5
                v = (m * scale) * 0.5 + 0.5;
            } else {
                v = m * scale;
            }
            
            const rgba = Lib.plot.getColor(v, pal);
            const idx = i * 4;
            data[idx]   = rgba[0]; 
            data[idx+1] = rgba[1]; 
            data[idx+2] = rgba[2]; 
            data[idx+3] = 255;
        }

        // Overlay Grid Block Harmonics (e.g., JPEG 8x8)
        if (showGrid) {
            const cx = w / 2;
            const cy = h / 2;
            const gridColor = [0, 255, 255]; // Cyan
            const gw = gridW || 8;
            const gh = gridH || 8;
            const countW = Math.floor(gw / 2);
            const countH = Math.floor(gh / 2);

            for (let kx = 0; kx <= countW; kx++) {
                for (let ky = 0; ky <= countH; ky++) {
                    if (kx === 0 && ky === 0) continue; // Skip DC (center)
                    const offX = (w / gw) * kx;
                    const offY = (h / gh) * ky;
                    this.drawMarker(data, w, h, cx + offX, cy + offY, gridColor);
                    this.drawMarker(data, w, h, cx - offX, cy - offY, gridColor);
                    this.drawMarker(data, w, h, cx + offX, cy - offY, gridColor);
                    this.drawMarker(data, w, h, cx - offX, cy + offY, gridColor);
                }
            }
        }
    },

    renderRadialProfile(this: any, data: Uint8ClampedArray, mag: Float32Array, w: number, h: number, maxVal: number) {
        const bgVal = 26;
        for(let i=0; i<data.length; i+=4) {
            data[i] = bgVal; data[i+1] = bgVal; data[i+2] = bgVal; data[i+3] = 255;
        }

        const cx = w / 2, cy = h / 2;
        // Use normalized frequency for Aspect-Ratio independent radial profile
        const scale = Math.max(w, h);
        const maxDist = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);
        const maxBin = Math.ceil(maxDist * scale);
        const bins = new Float32Array(maxBin + 1);
        const counts = new Uint32Array(maxBin + 1);

        // Accumulate Energy
        for (let y = 0; y < h; y++) {
            const dy = (y - cy) / h;
            for (let x = 0; x < w; x++) {
                const dx = (x - cx) / w;
                // Elliptical sampling based on normalized frequency
                const rVal = Math.sqrt(dx * dx + dy * dy);
                const r = Math.round(rVal * scale);
                
                if (r < bins.length) {
                    bins[r] += mag[y * w + x];
                    counts[r]++;
                }
            }
        }

        // Normalize
        let profileMax = 0;
        for (let i = 0; i < bins.length; i++) {
            if (counts[i] > 0) {
                bins[i] = Math.log(1 + bins[i] / counts[i]);
            }
            if (bins[i] > profileMax) profileMax = bins[i];
        }

        // Calculate Smooth Profile (Simple Moving Average)
        const smoothBins = new Float32Array(bins.length);
        const smoothRadius = 20;
        const len = bins.length;
        for (let i = 0; i < len; i++) {
            let sum = 0, count = 0;
            const start = Math.max(0, i - smoothRadius);
            const end = Math.min(len - 1, i + smoothRadius);
            for (let k = start; k <= end; k++) {
                sum += bins[k];
                count++;
            }
            smoothBins[i] = sum / count;
        }

        this.drawGraph(data, w, h, [
            { values: smoothBins, color: [255, 0, 0] },
            { values: bins, color: [0, 255, 0] }
        ], { maxVal: profileMax });
        
        // Draw safe zone marker (isotropic)
        const pad = 10;
        const limitBin = 0.5 * scale;
        const safeX = pad + (limitBin / maxBin) * (w - 2 * pad);
        this.drawDashedLine(data, w, h, safeX, pad, safeX, h - pad, [100, 100, 100]);
    },

    renderPolarTransform(this: any, data: Uint8ClampedArray, mag: Float32Array, w: number, h: number, maxVal: number, contrast: number, isCircular: boolean, cmap: PaletteName, angleMarker?: number) {
        const bgVal = 26;
        for(let i=0; i<data.length; i+=4) {
            data[i] = bgVal; data[i+1] = bgVal; data[i+2] = bgVal; data[i+3] = 255;
        }

        const cx = w / 2;
        const cy = h / 2;
        const polarH = h;
        const polarW = w;
        const angleSums = new Float32Array(polarW); 
        let maxAngleSum = 0;

        const scale = (1.0 / (maxVal || 1)) * contrast;
        const pal = cmap || 'ironbow';

        // Iterate Polar Output Pixels
        for (let px = 0; px < polarW; px++) {
            // Scans 180 degrees (FFT symmetry covers the opposite side)
            const angle = (px / polarW) * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            let colSum = 0;

            for (let py = 0; py < polarH; py++) {
                // Normalize radius to Nyquist limit (0.0 to 1.0)
                // Maps the plot height to the edge of the frequency ellipse
                const rRel = py / polarH;

                // Elliptical Sampling (Aspect Ratio Corrected)
                // We scale X by cx and Y by cy to sample true frequency direction
                const srcX = cx + (rRel * cx) * cos;
                const srcY = cy + (rRel * cy) * sin;

                const val = this.sampleBilinear(mag, w, h, srcX, srcY);
                let dispVal = val * scale;
                const rgba = Lib.plot.getColor(dispVal, pal);
                
                const idx = (py * w + px) * 4;
                data[idx]   = rgba[0];
                data[idx+1] = rgba[1];
                data[idx+2] = rgba[2];

                colSum += val; 
            }
            
            angleSums[px] = colSum;
            if (colSum > maxAngleSum) maxAngleSum = colSum;
        }

        if (isCircular) {
            this.drawRadarGraph(data, w, h, angleSums, maxAngleSum, angleMarker);
        } else {
            this.drawLinearGraph(data, w, h, angleSums, maxAngleSum, angleMarker);
        }
    },

    // --- Helpers ---

    sampleBilinear(data: Float32Array, w: number, h: number, x: number, y: number) {
        if (x < 0 || x >= w - 1 || y < 0 || y >= h - 1) return 0;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const dx = x - x0, dy = y - y0;
        const i00 = y0 * w + x0;
        const i10 = (y0 + 1) * w + x0;
        const top = data[i00] * (1 - dx) + data[i00 + 1] * dx;
        const bot = data[i10] * (1 - dx) + data[i10 + 1] * dx;
        return top * (1 - dy) + bot * dy;
    },

    drawGraph(this: any, data: Uint8ClampedArray, w: number, h: number, seriesList: any[], options: any = {}) {
        const {
            maxVal = 1,
            pad = 10,
            gridSteps = 10,
            gridColor = [60, 60, 60]
        } = options;

        const graphW = w - pad * 2;
        const graphH = h - pad * 2;

        for(let i=0; i<=gridSteps; i++) {
            const t = i / gridSteps;
            const gx = Math.round(pad + t * graphW);
            const gy = Math.round(pad + t * graphH);
            this.drawLine(data, w, h, gx, pad, gx, h-pad, gridColor);
            this.drawLine(data, w, h, pad, gy, w-pad, gy, gridColor);
        }

        seriesList.forEach(series => {
            if (!series.values) return;
            const vals = series.values;
            const color = series.color || [255, 255, 255];
            const len = vals.length;
            if (len < 2) return;
            let prevX = -1, prevY = -1;
            for (let i = 0; i < len; i++) {
                const x = pad + (i / (len - 1)) * graphW;
                const norm = vals[i] / (maxVal || 1);
                const y = (h - pad) - Math.max(0, Math.min(1, norm)) * graphH;
                
                if (prevX !== -1) {
                    this.drawLine(data, w, h, prevX, prevY, x, y, color);
                }
                prevX = x; prevY = y;
            }
        });
    },

    drawLinearGraph(this: any, data: Uint8ClampedArray, w: number, h: number, values: Float32Array, maxVal: number, angleMarker?: number) {
        const graphColor = [0, 255, 0]; 
        const baseLine = h - 1;
        let prevY = -1;
        const plotHeight = h * 0.25;

        for (let x = 0; x < w; x++) {
            const norm = values[x] / (maxVal || 1);
            const y = baseLine - (norm * plotHeight);

            if (prevY !== -1) {
                this.drawLine(data, w, h, x - 1, prevY, x, y, graphColor);
            }
            prevY = y;
            
            // Vertical Guides
            const deg = (x / w) * 180;
            if (Math.abs(deg % 15) < (180/w)) {
                this.drawDashedLine(data, w, h, x, 0, x, h, [80, 80, 80]);
            }
        }
        
        if (angleMarker !== undefined) {
            const markerX = Math.round((angleMarker / 180) * w);
            this.drawLine(data, w, h, markerX, 0, markerX, h, [255, 255, 0]);
        }
    },

    drawRadarGraph(this: any, data: Uint8ClampedArray, w: number, h: number, values: Float32Array, maxVal: number, angleMarker?: number) {
        const cx = w / 2;
        const cy = h / 2;
        const maxRadius = Math.min(cx, cy) - 10;
        const lineColor = [0, 255, 0];
        const guideColor = [80, 80, 80];

        // Draw Circular Guides
        for(let k=1; k<=4; k++) {
            this.drawCircle(data, w, h, cx, cy, maxRadius * (k/4), guideColor);
        }

        // Draw Angular Guides
        for(let ang=0; ang<180; ang+=15) {
            const rad = ang * Math.PI / 180;
            const dx = Math.cos(rad) * maxRadius;
            const dy = Math.sin(rad) * maxRadius;
            this.drawDashedLine(data, w, h, cx-dx, cy-dy, cx+dx, cy+dy, guideColor);
        }

        // Draw Data Polygon
        const len = values.length;
        let prevX = -1, prevY = -1;
        let startX = -1, startY = -1;
        
        for (let i = 0; i < len; i++) {
            const angle = (i / len) * Math.PI;
            const val = values[i] / (maxVal || 1);
            const r = val * maxRadius;
            
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            
            if (i === 0) { startX = x; startY = y; }
            if (prevX !== -1) this.drawLine(data, w, h, prevX, prevY, x, y, lineColor);
            prevX = x; prevY = y;
        }

        for (let i = 0; i < len; i++) {
            const angle = Math.PI + (i / len) * Math.PI;
            const val = values[i] / (maxVal || 1);
            const r = val * maxRadius;

            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            
            this.drawLine(data, w, h, prevX, prevY, x, y, lineColor);
            prevX = x; prevY = y;
        }
        
        if (startX !== -1) {
            this.drawLine(data, w, h, prevX, prevY, startX, startY, lineColor);
        }

        if (angleMarker !== undefined) {
            const rad = angleMarker * Math.PI / 180;
            const dx = Math.cos(rad) * maxRadius;
            const dy = Math.sin(rad) * maxRadius;
            this.drawLine(data, w, h, cx - dx, cy - dy, cx + dx, cy + dy, [255, 255, 0]);
        }
    },

    drawMarker(this: any, data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, rgb: number[]) {
        this.drawCircle(data, w, h, cx, cy, 2, rgb);
    },

    drawLine(data: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, rgb: number[]) {
        let x = x0, y = y0;
        const dx = x1 - x0, dy = y1 - y0;
        const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
        const xInc = dx / (steps || 1), yInc = dy / (steps || 1);
        for (let i = 0; i <= steps; i++) {
            const px = Math.round(x), py = Math.round(y);
            if (px >= 0 && px < w && py >= 0 && py < h) {
                const idx = (py * w + px) * 4;
                data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255;
            }
            x += xInc; y += yInc;
        }
    },

    drawDashedLine(data: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, rgb: number[]) {
        const dx = x1 - x0, dy = y1 - y0;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const steps = Math.ceil(dist);
        const xInc = dx / (steps || 1), yInc = dy / (steps || 1);
        let x = x0, y = y0;
        for(let i=0; i<=steps; i++) {
            if ((i % 10) < 5) {
                const px = Math.round(x), py = Math.round(y);
                if (px >= 0 && px < w && py >= 0 && py < h) {
                    const idx = (py * w + px) * 4;
                    data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255;
                }
            }
            x += xInc; y += yInc;
        }
    },

    drawCircle(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number, rgb: number[]) {
        const circum = 2 * Math.PI * r;
        const steps = Math.ceil(circum);
        for(let i=0; i<steps; i++) {
            const theta = (i / steps) * 2 * Math.PI;
            const x = Math.round(cx + Math.cos(theta) * r);
            const y = Math.round(cy + Math.sin(theta) * r);
            if (x >= 0 && x < w && y >= 0 && y < h) {
                const idx = (y * w + x) * 4;
                data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255;
            }
        }
    },

    _besselI0(x: number) {
        let sum = 1.0;
        let term = 1.0;
        const halfx = x * 0.5;
        for (let k = 1; k <= 25; k++) {
            term *= (halfx / k);
            sum += term * term;
            if (term < 1e-10) break;
        }
        return sum;
    }
});
