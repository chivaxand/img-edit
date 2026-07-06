import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('dct', {
    name: 'DCT Histogram',
    mode: 'pixel', 
    menu: {
        path: 'Analyze',
        label: 'DCT Histograms...',
        order: 3
    },

    // Zig-Zag Order Map (Block Index -> Sequence Index)
    // Values represent the frequency rank (0=DC, 63=High Freq) at that x,y position.
    zigZag: [
         0,  1,  5,  6, 14, 15, 27, 28,
         2,  4,  7, 13, 16, 26, 29, 42,
         3,  8, 12, 17, 25, 30, 41, 43,
         9, 11, 18, 24, 31, 40, 44, 53,
        10, 19, 23, 32, 39, 45, 52, 54,
        20, 22, 33, 38, 46, 51, 55, 60,
        21, 34, 37, 47, 50, 56, 59, 61,
        35, 36, 48, 49, 57, 58, 62, 63
    ],

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            range: 1024,      // +/- Range for X axis
            scale: 10,        // Visual brightness scale
            log: true,        // Logarithmic scale
            norm: false       // Normalize per row
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint', style: 'white-space: pre-wrap;' }, 
            'Visualizes DCT Coefficient distributions.\nY-Axis: Frequency (Zig-Zag sorted, Top=Low).\nX-Axis: Value.'
        ));

        container.appendChild(UI.createSliderRow({
            label: 'Range +/-', min: 4, max: 1024, step: 4, value: state.range,
            onInput: (v: any) => { state.range = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Brightness', min: 1, max: 100, step: 1, value: state.scale,
            onInput: (v: any) => { state.scale = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Logarithmic Scale', value: state.log,
            onChange: (v: any) => { state.log = v; update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Normalize Per Frequency', value: state.norm,
            onChange: (v: any) => { state.norm = v; update(); }
        }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        this.initDct();
        const { range, scale, log, norm } = params;

        // Histogram Buffer: 64 rows (Frequency Bands), 'w' columns (bins)
        const hist = new Float32Array(64 * w);
        const lumaBlock = new Float32Array(64);
        const coeffs = new Float32Array(64);
        const rangeHalf = range; 

        // 1. Accumulate Histograms from Image
        // Loop over 8x8 blocks
        for (let y = 0; y <= h - 8; y += 8) {
            for (let x = 0; x <= w - 8; x += 8) {
                
                // Extract Luma (Gray) block
                for (let by = 0; by < 8; by++) {
                    const rowOff = (y + by) * w;
                    for (let bx = 0; bx < 8; bx++) {
                        const idx = (rowOff + x + bx) * 4;
                        // RGB to Grayscale, centered at 0 (-128)
                        lumaBlock[by * 8 + bx] = (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114) - 128;
                    }
                }

                // Compute DCT
                this.computeDCT(lumaBlock, coeffs);

                // Add to Histograms
                for (let i = 0; i < 64; i++) {
                    const val = lumaBlock[i];
                    const k = this.zigZag[i]; // Map spatial index i to frequency order k
                    
                    // Map val from [-range, range] to [0, w-1]
                    let bin = Math.floor((val + rangeHalf) / (2 * rangeHalf) * w);
                    if (bin < 0) bin = 0;
                    if (bin >= w) bin = w - 1;

                    hist[k * w + bin]++;
                }
            }
        }

        // 2. Prepare Visualization
        // Find Max values for normalization
        let globalMax = 1;
        const rowMax = new Float32Array(64);
        
        for (let k = 0; k < 64; k++) {
            let rMax = 0;
            for (let x = 0; x < w; x++) {
                let count = hist[k * w + x];
                if (log) {
                    count = Math.log(1 + count);
                    hist[k * w + x] = count;
                }
                if (count > rMax) rMax = count;
            }
            rowMax[k] = rMax || 1;
            if (rMax > globalMax) globalMax = rMax;
        }

        // 3. Render Heatmap to Data Buffer
        // We stretch 64 rows to fill image Height 'h'
        
        const rowHeight = h / 64;
        const gain = scale / 10.0;
        
        // Clear background
        data.fill(0);

        for (let y = 0; y < h; y++) {
            const k = Math.floor(y / rowHeight); // Map pixel Y to Frequency Index k
            if (k >= 64) break;

            const rMax = norm ? rowMax[k] : globalMax;
            const normFactor = (rMax > 0) ? (1.0 / rMax) : 0;
            const rowOffset = k * w;

            for (let x = 0; x < w; x++) {
                const count = hist[rowOffset + x];
                let val = count * normFactor * gain;
                
                // Color Mapping
                let r, g, b;
                if (typeof Lib !== 'undefined' && Lib.plot) {
                    const rgba = Lib.plot.getColor(val, 'hot');
                    r = rgba[0]; g = rgba[1]; b = rgba[2];
                } else {
                    val = Math.min(1, val) * 255;
                    r = val; g = val; b = val;
                }

                const idx = (y * w + x) * 4;
                data[idx] = r;
                data[idx+1] = g;
                data[idx+2] = b;
                data[idx+3] = 255;
            }
        }
    },

    // --- Helpers ---

    initDct(this: any) {
        if (this.dctCosLUT) return;
        this.dctCosLUT = new Float32Array(64);
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                this.dctCosLUT[i * 8 + j] = Math.cos(((2 * i + 1) * j * Math.PI) / 16);
            }
        }
        this.dctAlpha = new Float32Array(8);
        this.dctAlpha[0] = 1 / Math.sqrt(8);
        const sq28 = Math.sqrt(2 / 8);
        for(let i=1; i<8; i++) this.dctAlpha[i] = sq28;
    },

    // Computes 8x8 DCT on 'block' in-place.
    computeDCT(this: any, block: Float32Array, tempBuf: Float32Array) {
        // 1. DCT Rows
        for (let i = 0; i < 8; i++) {
            for (let u = 0; u < 8; u++) {
                let sum = 0;
                for (let k = 0; k < 8; k++) {
                    sum += block[i * 8 + k] * this.dctCosLUT[k * 8 + u];
                }
                tempBuf[i * 8 + u] = sum * this.dctAlpha[u];
            }
        }
        // 2. DCT Cols
        for (let j = 0; j < 8; j++) {
            for (let v = 0; v < 8; v++) {
                let sum = 0;
                for (let k = 0; k < 8; k++) {
                    sum += tempBuf[k * 8 + j] * this.dctCosLUT[k * 8 + v];
                }
                block[v * 8 + j] = sum * this.dctAlpha[v];
            }
        }
    }
});
