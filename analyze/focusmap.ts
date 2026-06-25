import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('focusmap', {
    name: 'Focus Map',
    mode: 'pixel',

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            taps: 64,
            sensitivity: 1.0,
            mode: 'grayscale' // 'grayscale', 'rgb', 'r', 'g', 'b'
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Highlights in-focus areas using a 2D separable FIR high-pass filter.'));

        // Channel Mode Select
        container.appendChild(UI.createSelectRow({
            label: 'Channel',
            options: [
                { value: 'grayscale', text: 'Grayscale' },
                { value: 'rgb', text: 'RGB' },
                { value: 'r', text: 'Red' },
                { value: 'g', text: 'Green' },
                { value: 'b', text: 'Blue' }
            ],
            value: state.mode,
            onChange: (v: any) => { state.mode = v; update(); }
        }));

        // Taps Slider
        container.appendChild(UI.createSliderRow({
            label: 'Filter Size', min: 7, max: 127, step: 2, value: state.taps,
            onInput: (v: any) => { state.taps = parseInt(v); update(); }
        }));

        // Sensitivity Slider
        container.appendChild(UI.createSliderRow({
            label: 'Sensitivity', min: 1.0, max: 100.0, step: 1.0, value: state.sensitivity,
            onInput: (v: any) => { state.sensitivity = parseFloat(v); update(); }
        }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, { taps, sensitivity, mode }: any) {
        const kernel = this.createKernel(taps);
        const len = w * h;

        let sources = [];
        
        if (mode === 'rgb') {
            const r = new Float32Array(len);
            const g = new Float32Array(len);
            const b = new Float32Array(len);
            for (let i = 0; i < len; i++) {
                const idx = i * 4;
                r[i] = data[idx] * 0.00392156862;   // / 255
                g[i] = data[idx+1] * 0.00392156862; 
                b[i] = data[idx+2] * 0.00392156862; 
            }
            sources = [r, g, b];
        } 
        else if (mode === 'grayscale' || !mode) {
            sources = [Lib.image.toGrayscale(data, w, h)];
        } 
        else {
            const chIdx = mode === 'r' ? 0 : (mode === 'g' ? 1 : 2);
            const buf = new Float32Array(len);
            for (let i = 0; i < len; i++) {
                buf[i] = data[i * 4 + chIdx] * 0.00392156862;
            }
            sources = [buf];
        }

        // Perform Convolution (High Pass)
        const results = new Array(sources.length);
        
        for (let k = 0; k < sources.length; k++) {
            const passH = Lib.image.convolve1d(sources[k], w, h, kernel, false);
            results[k] = Lib.image.convolve1d(passH, w, h, kernel, true);
        }

        // Compute Log Magnitude & Global Min/Max
        let minVal = Infinity;
        let maxVal = -Infinity;
        const sensSq = sensitivity * sensitivity;

        for (let k = 0; k < results.length; k++) {
            const arr = results[k];
            for (let i = 0; i < len; i++) {
                const val = Math.log(1 + Math.abs(arr[i]) * sensSq);
                arr[i] = val;
                if (val < minVal) minVal = val;
                if (val > maxVal) maxVal = val;
            }
        }

        // Normalize & Render
        const range = maxVal - minVal;
        const scale = range > 1e-9 ? 255.0 / range : 0;

        if (mode === 'rgb') {
            const [rMap, gMap, bMap] = results;
            for (let i = 0; i < len; i++) {
                const idx = i * 4;
                data[idx]   = (rMap[i] - minVal) * scale;
                data[idx+1] = (gMap[i] - minVal) * scale;
                data[idx+2] = (bMap[i] - minVal) * scale;
                data[idx+3] = 255;
            }
        } else {
            const map = results[0];
            for (let i = 0; i < len; i++) {
                const val = (map[i] - minVal) * scale;
                const idx = i * 4;
                data[idx]   = val;
                data[idx+1] = val;
                data[idx+2] = val;
                data[idx+3] = 255;
            }
        }
    },
    
    // Generate a High-Pass FIR Kernel matching scipy.signal.firwin2
    createKernel(taps: number) {
        // Construct frequency response (Ramp)
        const size = Math.pow(2, Math.ceil(Math.log2(taps * 4)));
        const half = size / 2;
        const re = new Float32Array(size);
        const im = new Float32Array(size);
        
        // Define Ramp in Frequency Domain (0 to 1)
        for(let i=0; i<=half; i++) {
            const freq = i / half;
            const gain = freq;
            re[i] = gain;
            if(i > 0 && i < half) re[size - i] = gain; 
        }

        // IFFT to get impulse response
        const impulse = Lib.fft.ifft1d(Array.from(re), Array.from(im)).re;
        
        // Shift peak to center of kernel and apply Hamming window
        const kernel = new Float32Array(taps);
        const center = Math.floor(taps / 2);
        
        for(let i=0; i<taps; i++) {
            // Center of kernel (i=center) should map to impulse peak (idx=0)
            const rawIdx = (i - center + size) % size;
            
            // Hamming Window
            const win = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
            kernel[i] = impulse[rawIdx] * win;
        }
        
        return kernel;
    }
});
