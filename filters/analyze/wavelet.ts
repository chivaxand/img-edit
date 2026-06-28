import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('wavelet', {
    name: 'Wavelet Decomposition',
    mode: 'pixel',
    menu: {
        path: 'Analyze',
        label: 'Wavelet Decomposition...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            levels: 0,        // 0 = Auto
            channel: 'rgb',   // 'rgb', 'gray', 'r', 'g', 'b'
            contrast: 1.0,    // Visual contrast for details
            mode: 'gray',     // 'gray', 'abs', 'heat'
            layout: 'mallat', // 'mallat', 'superposition'
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint', style: 'white-space: pre-wrap;' }, 
            'Multilevel 2D Discrete Wavelet Transform (Haar).\nRecursively decomposes image into Frequency quadrants.'
        ));

        container.appendChild(UI.createSelectRow({
            label: 'Channel',
            options: [
                { value: 'rgb', text: 'RGB (Full Color)' },
                { value: 'gray', text: 'Grayscale (Luma)' },
                { value: 'r', text: 'Red Channel' },
                { value: 'g', text: 'Green Channel' },
                { value: 'b', text: 'Blue Channel' }
            ],
            value: state.channel,
            onChange: (v: any) => { state.channel = v; update(); }
        }));

        container.appendChild(UI.createRadioGroup({
            label: 'Display',
            layout: 'row',
            options: [
                { value: 'mallat', label: 'Mallat' },
                { value: 'superposition', label: 'Superpos' }
            ],
            value: state.layout,
            onChange: (v: any) => { state.layout = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Levels', min: 0, max: 12, step: 1, value: state.levels,
            onInput: (v: any) => { state.levels = parseInt(v); update(); },
            formatter: (v: any) => v === 0 ? 'Auto' : v
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Contrast', min: 0.1, max: 50, step: 0.1, value: state.contrast,
            onInput: (v: any) => { state.contrast = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createRadioGroup({
            label: 'View Mode',
            layout: 'row',
            options: [
                { value: 'gray', label: 'Gray' },
                { value: 'abs', label: 'Abs' },
                { value: 'heat', label: 'Heat' }
            ],
            value: state.mode,
            onChange: (v: any) => { state.mode = v; update(); }
        }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { levels, channel, layout } = params;

        for(let i=3; i<data.length; i+=4) data[i] = 255;

        if (layout === 'superposition') {
            const buffer = new Float32Array(w * h);
            const chMap: Record<string, number> = { r: 0, g: 1, b: 2 };
            const srcCh = chMap[channel];
            if (srcCh !== undefined) {
                for (let i = 0; i < w * h; i++) {
                    buffer[i] = data[i * 4 + srcCh];
                }
            } else {
                for (let i = 0; i < w * h; i++) {
                    const idx = i * 4;
                    buffer[i] = data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114;
                }
            }

            const coeffs = Lib.wavelet.wavedec2(buffer, w, h, levels || 12);

            // Render Visualization (Red=Horiz, Green=Vert, Blue=128)
            this.renderSuperposition(data, w, h, coeffs, params);
            return;
        }

        // --- Standard Mallat Mode ---
        const jobs = [];
        if (channel === 'rgb') {
            jobs.push({ srcCh: 0, dstCh: 0 }); // R
            jobs.push({ srcCh: 1, dstCh: 1 }); // G
            jobs.push({ srcCh: 2, dstCh: 2 }); // B
        } else if (channel === 'gray') {
            jobs.push({ srcCh: -1, dstCh: -1 }); // Luma -> All
        } else {
            const map: Record<string, number> = { r: 0, g: 1, b: 2 };
            jobs.push({ srcCh: map[channel], dstCh: -1 }); // Single -> All
        }

        jobs.forEach(job => {
            const buffer = new Float32Array(w * h);
            if (job.srcCh === -1) {
                for (let i = 0; i < w * h; i++) {
                    const idx = i * 4;
                    buffer[i] = data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114;
                }
            } else {
                for (let i = 0; i < w * h; i++) {
                    buffer[i] = data[i * 4 + job.srcCh];
                }
            }

            const coeffs = Lib.wavelet.wavedec2(buffer, w, h, levels || 12);
            this.renderCoeffs(data, w, h, coeffs, job.dstCh, params);
        });
    },

    // --- Visualization ---
    renderCoeffs(dest: Uint8ClampedArray, w: number, h: number, coeffs: any[], dstCh: number, { contrast, mode }: any) {
        const tl = coeffs.length - 1;
        const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;

        const draw = (buf: Float32Array, bw: number, bh: number, dx: number, dy: number, scale: number, isDetail: boolean) => {
            for (let y = 0; y < bh; y++) {
                const dIdx = ((dy + y) * w + dx) * 4; // Destination row start
                const sIdx = y * bw;                  // Source row start
                
                for (let x = 0; x < bw; x++) {
                    const val = buf[sIdx + x] * scale;
                    let r, g, b;

                    if (!isDetail) {
                        // LL: Normalized approximation
                        r = g = b = clamp(Math.abs(val));
                    } else if (mode === 'abs') {
                        r = g = b = clamp(Math.abs(val) * contrast);
                    } else if (mode === 'heat' && dstCh === -1) {
                        // Heatmap (Red +, Blue -) for full color
                        const norm = val * contrast;
                        const mag = Math.min(255, Math.abs(norm));
                        const pos = norm > 0;
                        r = clamp(128 + (pos ? mag : -mag));
                        g = clamp(128 - mag);
                        b = clamp(128 + (pos ? -mag : mag));
                    } else {
                        // Gray or Single-Channel Fallback
                        r = g = b = clamp(128 + val * contrast);
                    }

                    const px = dIdx + (x << 2);
                    if (dstCh === -1) {
                        dest[px] = r; dest[px+1] = g; dest[px+2] = b; dest[px+3] = 255;
                    } else {
                        dest[px + dstCh] = r;
                    }
                }
            }
        };

        // Draw Final Approximation (LL)
        const ll = coeffs[0];
        draw(ll.data, ll.w, ll.h, 0, 0, 1 / (2 ** tl), false);

        // Recursively Tile Details (Mallat Layout)
        for (let i = 1; i <= tl; i++) {
            const { nw, nh, HL, LH, HH } = coeffs[i];
            // Orthonormal Haar doubles energy every level (x2)
            const gain = 1 / (Math.pow(2, tl - i + 1));
            
            draw(HL, nw, nh, nw, 0, gain, true);
            draw(LH, nw, nh, 0, nh, gain, true);
            draw(HH, nw, nh, nw, nh, gain, true);
        }
    },

    renderSuperposition(this: any, dest: Uint8ClampedArray, w: number, h: number, coeffs: any[], params: any) {
        const { contrast } = params;
            
        const sumH = new Float32Array(w * h);
        const sumV = new Float32Array(w * h);
        const maxLevel = coeffs.length - 1;

        // Iterate levels from finest (level 1) to coarsest
        for (let i = coeffs.length - 1; i >= 1; i--) {
            const d = coeffs[i];
            const scale = 1.0 / Math.pow(2, (maxLevel - i)*2);

            // Upscale and accumulate HL and LH
            this.accumulateUpscaled(d.HL, d.nw, d.nh, sumH, w, h, scale);
            this.accumulateUpscaled(d.LH, d.nw, d.nh, sumV, w, h, scale);
        }

        const signedLog = (x: number) => Math.sign(x) * Math.log(1 + Math.abs(x));

        // Render to RGB: R = Horizontal, G = Vertical, B = 128
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            const hVal = signedLog(sumH[i]);
            const vVal = signedLog(sumV[i]);
            let valH = 128 + (hVal * contrast * 8);
            let valV = 128 + (vVal * contrast * 8);
            valH = valH < 0 ? 0 : (valH > 255 ? 255 : valH);
            valV = valV < 0 ? 0 : (valV > 255 ? 255 : valV);
            dest[idx]     = valH;
            dest[idx + 1] = valV;
            dest[idx + 2] = 128;
            dest[idx + 3] = 255;
        }
    },

    accumulateUpscaled(src: Float32Array, sw: number, sh: number, dst: Float32Array, dw: number, dh: number, weight: number) {
        const xRatio = sw / dw;
        const yRatio = sh / dh;
        for (let y = 0; y < dh; y++) {
            const sy = y * yRatio;
            const y0 = Math.floor(sy);
            const y1 = Math.min(y0 + 1, sh - 1);
            const dyVal = sy - y0;
            const r0 = y0 * sw;
            const r1 = y1 * sw;
            const dstRow = y * dw;
            for (let x = 0; x < dw; x++) {
                const sx = x * xRatio;
                const x0 = Math.floor(sx);
                const x1 = Math.min(x0 + 1, sw - 1);
                const dxVal = sx - x0;
                const p00 = src[r0 + x0];
                const p01 = src[r0 + x1];
                const p10 = src[r1 + x0];
                const p11 = src[r1 + x1];
                const top = p00 + (p01 - p00) * dxVal;
                const bottom = p10 + (p11 - p10) * dxVal;
                const val = top + (bottom - top) * dyVal;
                dst[dstRow + x] += val * weight;
            }
        }
    }
});