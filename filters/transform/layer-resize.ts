import { App, AppActions } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';
import { Filters, FilterContext } from '~/filters';

const _resizeFilters = {
    bicubic(x: number) {
        const a = -0.5; // Catmull-Rom (a = -0.5)
        if (x < 0) x = -x;
        if (x < 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
        if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
        return 0;
    },
    lanczos(x: number, lobes: number) {
        if (x === 0) return 1;
        if (x < 0) x = -x;
        if (x >= lobes) return 0;
        const px = Math.PI * x;
        return (Math.sin(px) / px) * (Math.sin(px / lobes) / (px / lobes));
    }
};

function _resizeSeparable(src: ImageData, w: number, h: number, nw: number, nh: number, filterFn: Function, win: number) {
    const src8 = src.data;
    const intermediate = new Float32Array(nw * h * 4); 
    const dest = new Uint8ClampedArray(nw * nh * 4);

    // Pass 1: Horizontal (W -> NW)
    const scaleX = nw / w;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < nw; x++) {
            const cx = (x + 0.5) / scaleX - 0.5; // Center point in source
            const start = Math.floor(cx - win);
            const end = Math.ceil(cx + win);
            
            let r=0, g=0, b=0, a=0, weightSum=0;
            
            for (let i = start; i <= end; i++) {
                const dist = cx - i;
                const weight = filterFn(dist, win);
                if (weight === 0) continue;
                
                // Clamp Edge
                const sx = Math.min(w - 1, Math.max(0, i));
                const idx = (y * w + sx) * 4;
                
                r += src8[idx] * weight;
                g += src8[idx+1] * weight;
                b += src8[idx+2] * weight;
                a += src8[idx+3] * weight;
                weightSum += weight;
            }
            
            // Normalize weights
            if (weightSum !== 0) { r/=weightSum; g/=weightSum; b/=weightSum; a/=weightSum; }

            const idx = (y * nw + x) * 4;
            intermediate[idx] = r;
            intermediate[idx+1] = g;
            intermediate[idx+2] = b;
            intermediate[idx+3] = a;
        }
    }

    // Pass 2: Vertical (H -> NH)
    const scaleY = nh / h;
    for (let x = 0; x < nw; x++) {
        for (let y = 0; y < nh; y++) {
            const cy = (y + 0.5) / scaleY - 0.5;
            const start = Math.floor(cy - win);
            const end = Math.ceil(cy + win);
            
            let r=0, g=0, b=0, a=0, weightSum=0;
            
            for (let i = start; i <= end; i++) {
                const dist = cy - i;
                const weight = filterFn(dist, win);
                if (weight === 0) continue;

                const sy = Math.min(h - 1, Math.max(0, i));
                const idx = (sy * nw + x) * 4;
                
                r += intermediate[idx] * weight;
                g += intermediate[idx+1] * weight;
                b += intermediate[idx+2] * weight;
                a += intermediate[idx+3] * weight;
                weightSum += weight;
            }
            
            if (weightSum !== 0) { r/=weightSum; g/=weightSum; b/=weightSum; a/=weightSum; }

            const idx = (y * nw + x) * 4;
            dest[idx] = r; 
            dest[idx+1] = g; 
            dest[idx+2] = b; 
            dest[idx+3] = a;
        }
    }

    return new ImageData(dest, nw, nh);
}

function _resizeFFT(src: ImageData, w: number, h: number, nw: number, nh: number) {
    if (!Lib.fft) {
        alert('FFT library not loaded');
        return src;
    }

    const len = w * h;
    // Separate Channels
    const r = new Float32Array(len);
    const g = new Float32Array(len);
    const b = new Float32Array(len);
    const a = new Float32Array(len);

    for (let i = 0; i < len; i++) {
        r[i] = src.data[i*4];
        g[i] = src.data[i*4+1];
        b[i] = src.data[i*4+2];
        a[i] = src.data[i*4+3];
    }

    // Helper to process one channel
    const processChannel = (chanData: Float32Array) => {
        const input2D: number[][] = [];
        for(let y=0; y<h; y++) input2D.push(Array.from(chanData.subarray(y*w, (y+1)*w)));

        // FFT & Shift
        let spectrum = Lib.fft.fft2d(input2D);
        spectrum = Lib.fft.shift(spectrum);

        // Resize in Frequency Domain (Pad or Crop)
        const newRe = Array.from({ length: nh }, () => new Float32Array(nw).fill(0));
        const newIm = Array.from({ length: nh }, () => new Float32Array(nw).fill(0));

        // Use integer centers to ensure correct alignment of the DC component
        const srcMidY = Math.floor(h / 2);
        const srcMidX = Math.floor(w / 2);
        const dstMidY = Math.floor(nh / 2);
        const dstMidX = Math.floor(nw / 2);

        const copyH = Math.min(h, nh);
        const copyW = Math.min(w, nw);
        
        // Center the window around the DC component
        const halfH = Math.floor(copyH / 2);
        const halfW = Math.floor(copyW / 2);

        const startY = srcMidY - halfH;
        const startX = srcMidX - halfW;
        const targetY = dstMidY - halfH;
        const targetX = dstMidX - halfW;

        // Phase Correction for 0.5px Shift (Pixel Center Alignment)
        // FFT assumes samples at integer coords (0, 1..), but image pixels are area samples (centers 0.5, 1.5..).
        const shiftY = 0.5 * (1 - h / nh);
        const shiftX = 0.5 * (1 - w / nw);

        // Precompute Phasors
        const phasorsY = new Float32Array(copyH * 2);
        for (let y = 0; y < copyH; y++) {
            const fy = (startY + y) - srcMidY;
            const angle = -2 * Math.PI * fy * shiftY / h;
            phasorsY[y*2] = Math.cos(angle);
            phasorsY[y*2+1] = Math.sin(angle);
        }

        const phasorsX = new Float32Array(copyW * 2);
        for (let x = 0; x < copyW; x++) {
            const fx = (startX + x) - srcMidX;
            const angle = -2 * Math.PI * fx * shiftX / w;
            phasorsX[x*2] = Math.cos(angle);
            phasorsX[x*2+1] = Math.sin(angle);
        }

        for (let y = 0; y < copyH; y++) {
            const py_re = phasorsY[y*2];
            const py_im = phasorsY[y*2+1];

            for (let x = 0; x < copyW; x++) {
                const px_re = phasorsX[x*2];
                const px_im = phasorsX[x*2+1];
                const rot_re = py_re * px_re - py_im * px_im;
                const rot_im = py_re * px_im + py_im * px_re;
                
                const valRe = spectrum.re[startY + y][startX + x];
                const valIm = spectrum.im[startY + y][startX + x];

                // Apply Rotation
                newRe[targetY + y][targetX + x] = valRe * rot_re - valIm * rot_im;
                newIm[targetY + y][targetX + x] = valRe * rot_im + valIm * rot_re;
            }
        }

        // Unshift & IFFT
        const padded = { re: newRe, im: newIm };
        const unshifted = Lib.fft.unshift(padded);
        const res = Lib.fft.ifft2d(unshifted.re, unshifted.im);

        // Flatten and Scale
        const scale = (nw * nh) / (w * h);
        const out = new Float32Array(nw * nh);
        
        for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) {
                let val = res.re[y][x] * scale;
                out[y*nw + x] = val;
            }
        }
        return out;
    };

    const nr = processChannel(r);
    const ng = processChannel(g);
    const nb = processChannel(b);
    const na = processChannel(a);

    const dest = new Uint8ClampedArray(nw * nh * 4);
    for (let i = 0; i < nw * nh; i++) {
        dest[i*4]   = nr[i];
        dest[i*4+1] = ng[i];
        dest[i*4+2] = nb[i];
        dest[i*4+3] = na[i];
    }

    return new ImageData(dest, nw, nh);
}

function _resizeLayerObj(l: Layer, w: number, h: number, algo: string = 'bilinear', lobes: number = 3) {
    if (l.type === 'text') {
        const scale = w / l.width;
        l.fontSize = Math.round(l.fontSize * scale);
        App.actions.updateLayer(l, {});
        return;
    }

    // Native / Hardware accelerated
    if (algo === 'nearest' || algo === 'bilinear') {
        const nc = document.createElement('canvas');
        nc.width = w; nc.height = h;
        const ctx = nc.getContext('2d')!;
        ctx.imageSmoothingEnabled = (algo !== 'nearest');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(l.canvas, 0, 0, w, h);
        l.canvas = nc; l.width = w; l.height = h; l.ctx = nc.getContext('2d')!;
        return;
    }

    // High-Quality Software Resize
    const srcCtx = l.canvas.getContext('2d', { willReadFrequently: true })!;
    const srcData = srcCtx.getImageData(0, 0, l.width, l.height);
    
    let resImageData: ImageData | null = null;

    if (algo === 'fft') {
        resImageData = _resizeFFT(srcData, l.width, l.height, w, h);
    } else {
        const filterFn = (algo === 'bicubic') ? _resizeFilters.bicubic : _resizeFilters.lanczos;
        const winSize = (algo === 'bicubic') ? 2 : lobes;
        resImageData = _resizeSeparable(srcData, l.width, l.height, w, h, filterFn, winSize);
    }

    const nc = document.createElement('canvas');
    nc.width = w; nc.height = h;
    const ctx = nc.getContext('2d')!;
    if (resImageData) ctx.putImageData(resImageData, 0, 0);
    
    l.canvas = nc; l.width = w; l.height = h; l.ctx = ctx;
}

Filters.register('resize', {
    name: 'Resize Layer',
    mode: 'unified',
    menu: {
        path: 'Transform',
        label: 'Resize...',
        order: 1
    },

    apply(context: FilterContext) {
        const l = context.layer;
        const state = context.values;
        const origW = state.origW !== undefined ? state.origW : l.width;
        const origH = state.origH !== undefined ? state.origH : l.height;
        const origX = state.origX !== undefined ? state.origX : l.x;
        const origY = state.origY !== undefined ? state.origY : l.y;

        // Calculate Scale Factors
        const sx = state.w / origW;
        const sy = state.h / origH;

        // Resize Active Layer
        _resizeLayerObj(l, state.w, state.h, state.algo, state.lobes);

        // Handle Others & Positions
        if (state.resizeOthers) {
            // Scale Active Layer Position
            l.x = Math.round(origX * sx);
            l.y = Math.round(origY * sy);

            App.state.layers.forEach(layer => {
                if (layer === l) return;
                
                // Scale Content
                const nw = Math.max(1, Math.round(layer.width * sx));
                const nh = Math.max(1, Math.round(layer.height * sy));
                _resizeLayerObj(layer, nw, nh, state.algo, state.algo === 'lanczos' ? state.lobes : undefined);
                
                // Scale Position (Preserve relative layout)
                layer.x = Math.round(layer.x * sx);
                layer.y = Math.round(layer.y * sy);
            });
        }

        // Resize Canvas
        if (state.resizeCanvas) {
            const newCW = Math.round(App.state.width * sx);
            const newCH = Math.round(App.state.height * sy);
            App.actions.resizeCanvas(newCW, newCH);
        }
    },
    
    renderUI(root: HTMLElement, l: Layer, hooks: any) {
        const state = {
            w: l.width,
            h: l.height,
            resizeCanvas: false,
            resizeOthers: false,
            constrain: true,
            algo: 'lanczos',  // nearest, bilinear, bicubic, lanczos, fft
            lobes: 4,          // for Lanczos
            origW: l.width,
            origH: l.height,
            origX: l.x,
            origY: l.y
        };
        const ratio = l.width / l.height;

        const update = () => hooks.preview(state);

        // Helper to sync inputs
        const updateInputs = (source: string) => {
            if (state.constrain) {
                if (source === 'w') {
                    state.h = Math.round(state.w / ratio);
                    (hInp as HTMLInputElement).value = state.h.toString();
                } else if (source === 'h') {
                    state.w = Math.round(state.h * ratio);
                    (wInp as HTMLInputElement).value = state.w.toString();
                }
            }
        };

        const wInp = UI.createInput('number', { value: state.w }, (t: HTMLInputElement) => {
            state.w = parseFloat(t.value) || 1;
            updateInputs('w');
            update();
        });

        const hInp = UI.createInput('number', { value: state.h }, (t: HTMLInputElement) => {
            state.h = parseFloat(t.value) || 1;
            updateInputs('h');
            update();
        });

        const constrainCheck = UI.createCheckbox({
            label: 'Constrain Proportions',
            value: state.constrain,
            onChange: (v: boolean) => {
                state.constrain = v;
                if (state.constrain) {
                    updateInputs('w');
                    update();
                }
            }
        });

        root.appendChild(UI.createRow('Width', wInp));
        root.appendChild(UI.createRow('Height', hInp));
        root.appendChild(UI.createRow('', constrainCheck));
        
        root.appendChild(UI.createNode('div', {className:'popup-separator'}));

        // Algorithm Selection
        const algoSelect = UI.createSelectRow({
            label: 'Algorithm',
            options: [
                { value: 'nearest', text: 'Nearest Neighbor' },
                { value: 'bilinear', text: 'Bilinear' },
                { value: 'bicubic', text: 'Bicubic' },
                { value: 'lanczos', text: 'Lanczos (Sinc)' },
                { value: 'fft', text: 'FFT' }
            ],
            value: state.algo,
            onChange: (v: string) => {
                state.algo = v;
                lobesRow.style.display = v === 'lanczos' ? 'flex' : 'none';
                update();
            }
        });
        root.appendChild(algoSelect);

        // Lobes (Lanczos only)
        const lobesRow = UI.createSliderRow({
            label: 'Lobes', min: 1, max: 10, step: 1, value: state.lobes,
            onInput: (v: string) => {
                state.lobes = parseInt(v);
                update();
            }
        });
        lobesRow.style.display = state.algo === 'lanczos' ? 'flex' : 'none';
        root.appendChild(lobesRow);

        root.appendChild(UI.createNode('div', {className:'popup-separator'}));

        root.appendChild(UI.createCheckbox({
            label: 'Resize Canvas (Scale)',
            value: state.resizeCanvas,
            onChange: (v: boolean) => {
                state.resizeCanvas = v;
                update();
            }
        }));

        root.appendChild(UI.createCheckbox({
            label: 'Resize Other Layers & Positions',
            value: state.resizeOthers,
            onChange: (v: boolean) => {
                state.resizeOthers = v;
                update();
            }
        }));

        update();
    }
});

export const layerResizeActions: Pick<AppActions, 'openResizeDialog'> = {
    openResizeDialog() {
        const l = App.utils.getActive();
        if (!l) return alert('No active layer selected.');
        Filters.run('resize');
    }
};
