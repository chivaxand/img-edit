import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('ramp', {
    name: 'Ramp Filter',
    mode: 'pixel',
    menu: {
        path: 'Filter/Edge Detection',
        label: 'Ramp Filter...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            windowType: 'none', // none, shepp-logan, hamming, hann, cosine
            cutoff: 1.0,        // Cutoff frequency limit
            strength: 1.0,      // Output amplification factor
            mode: 'abs',        // abs, gray, add, sub
            channelMode: 'color' // gray, color
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Applies a frequency-domain |f| ramp filter to sharpen edges and suppress low-frequency blur.'));

        // Window Function selector
        container.appendChild(UI.createSelectRow({
            label: 'Window Function',
            options: [
                { value: 'none', text: 'None (Ideal Ramp)' },
                { value: 'shepp-logan', text: 'Shepp-Logan' },
                { value: 'hamming', text: 'Hamming' },
                { value: 'hann', text: 'Hann' },
                { value: 'cosine', text: 'Cosine' }
            ],
            value: state.windowType,
            onChange: (v: string) => { state.windowType = v; update(); }
        }));

        // Limit the Nyquist range to reject extreme noise
        container.appendChild(UI.createSliderRow({
            label: 'Cutoff Frequency', min: 0.1, max: 1.0, step: 0.05, value: state.cutoff,
            onInput: (v: string) => { state.cutoff = parseFloat(v); update(); }
        }));

        // Scale the output response intensity
        container.appendChild(UI.createSliderRow({
            label: 'Strength', min: 0.1, max: 10.0, step: 0.1, value: state.strength,
            onInput: (v: string) => { state.strength = parseFloat(v); update(); }
        }));

        // Presentation options for zero-crossings or high-boost sharpening
        container.appendChild(UI.createSelectRow({
            label: 'Output Mode',
            options: [
                { value: 'abs', text: 'Absolute Value (Edges)' },
                { value: 'gray', text: 'Offset (+128)' },
                { value: 'add', text: 'Add to Original (Sharpen)' },
                { value: 'sub', text: 'Subtract from Original' }
            ],
            value: state.mode,
            onChange: (v: string) => { state.mode = v; update(); }
        }));

        // Option to process monochromatic components or direct color
        container.appendChild(UI.createSelectRow({
            label: 'Channels',
            options: [
                { value: 'gray', text: 'Grayscale' },
                { value: 'color', text: 'Color (RGB Separated)' }
            ],
            value: state.channelMode,
            onChange: (v: string) => { state.channelMode = v; update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { windowType, cutoff, strength, mode, channelMode }: any) {
        const FFT = Lib.fft;
        const ImageUtil = Lib.image;

        const targetW = FFT.nextPowerOf2(w);
        const targetH = FFT.nextPowerOf2(h);

        const padY = Math.floor((targetH - h) / 2);
        const padX = Math.floor((targetW - w) / 2);
        const cx = Math.floor(targetW / 2);
        const cy = Math.floor(targetH / 2);

        // Core 2D FFT filtering procedure
        const filterChannel = (flat: Float32Array): Float32Array => {
            const padded = ImageUtil.padTo2D(flat, w, h, targetW, targetH, 'reflect');
            const F = FFT.fft2d(padded);
            const F_shifted = FFT.shift(F);

            for (let y = 0; y < targetH; y++) {
                const dy = y - cy;
                const ny = dy / (targetH / 2);
                for (let x = 0; x < targetW; x++) {
                    const dx = x - cx;
                    const nx = dx / (targetW / 2);
                    
                    const r = Math.sqrt(nx * nx + ny * ny);
                    const r_scaled = r / cutoff;
                    
                    let h_val = 0;
                    if (r_scaled <= 1.0) {
                        if (windowType === 'none') {
                            h_val = r_scaled;
                        } else if (windowType === 'shepp-logan') {
                            if (r_scaled === 0) h_val = 0;
                            else h_val = (2 / Math.PI) * Math.sin((Math.PI * r_scaled) / 2);
                        } else if (windowType === 'hamming') {
                            h_val = r_scaled * (0.54 + 0.46 * Math.cos(Math.PI * r_scaled));
                        } else if (windowType === 'hann') {
                            h_val = r_scaled * (0.5 + 0.5 * Math.cos(Math.PI * r_scaled));
                        } else if (windowType === 'cosine') {
                            h_val = r_scaled * Math.cos((Math.PI * r_scaled) / 2);
                        }
                    } else {
                        if (windowType === 'none') {
                            h_val = r_scaled;
                            if (h_val > 1.0) h_val = 1.0;
                        } else {
                            h_val = 0;
                        }
                    }

                    F_shifted.re[y][x] *= h_val;
                    F_shifted.im[y][x] *= h_val;
                }
            }

            const F_filtered = FFT.unshift(F_shifted);
            const res = FFT.ifft2d(F_filtered.re, F_filtered.im).re;
            const cropped = new Float32Array(w * h);

            for (let y = 0; y < h; y++) {
                const py = y + padY;
                const row = res[py];
                const destOffset = y * w;
                for (let x = 0; x < w; x++) {
                    cropped[destOffset + x] = row[x + padX];
                }
            }
            return cropped;
        };

        if (channelMode === 'color') {
            const rChannel = ImageUtil.extractChannel(data, w, h, 0);
            const gChannel = ImageUtil.extractChannel(data, w, h, 1);
            const bChannel = ImageUtil.extractChannel(data, w, h, 2);

            const rFiltered = filterChannel(rChannel);
            const gFiltered = filterChannel(gChannel);
            const bFiltered = filterChannel(bChannel);

            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                const vr = rFiltered[i] * strength;
                const vg = gFiltered[i] * strength;
                const vb = bFiltered[i] * strength;

                let outR = 0, outG = 0, outB = 0;
                if (mode === 'add') {
                    outR = rChannel[i] + vr;
                    outG = gChannel[i] + vg;
                    outB = bChannel[i] + vb;
                } else if (mode === 'sub') {
                    outR = rChannel[i] - vr;
                    outG = gChannel[i] - vg;
                    outB = bChannel[i] - vb;
                } else if (mode === 'gray') {
                    outR = vr + 128;
                    outG = vg + 128;
                    outB = vb + 128;
                } else {
                    outR = Math.abs(vr);
                    outG = Math.abs(vg);
                    outB = Math.abs(vb);
                }

                data[idx]     = Math.max(0, Math.min(255, outR));
                data[idx + 1] = Math.max(0, Math.min(255, outG));
                data[idx + 2] = Math.max(0, Math.min(255, outB));
                data[idx + 3] = 255;
            }
        } else {
            const gray = ImageUtil.toGrayscale(data, w, h, { method: 'rec601' });
            for (let i = 0; i < gray.length; i++) {
                gray[i] *= 255.0;
            }

            const filtered = filterChannel(gray);

            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                const val = filtered[i] * strength;
                const origR = data[idx];
                const origG = data[idx + 1];
                const origB = data[idx + 2];

                let outR = 0, outG = 0, outB = 0;
                if (mode === 'add') {
                    outR = origR + val;
                    outG = origG + val;
                    outB = origB + val;
                } else if (mode === 'sub') {
                    outR = origR - val;
                    outG = origG - val;
                    outB = origB - val;
                } else if (mode === 'gray') {
                    const g = val + 128;
                    outR = g; outG = g; outB = g;
                } else {
                    const g = Math.abs(val);
                    outR = g; outG = g; outB = g;
                }

                data[idx]     = Math.max(0, Math.min(255, outR));
                data[idx + 1] = Math.max(0, Math.min(255, outG));
                data[idx + 2] = Math.max(0, Math.min(255, outB));
                data[idx + 3] = 255;
            }
        }
    }
});