import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('palette', {
    name: 'Color Quantization',
    mode: 'pixel',

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            numColors: 256,
            algo: 'k-means', // median-cut, k-means, uniform
            dither: false
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createSelectRow({
            label: 'Algorithm',
            options: [
                { value: 'median-cut', text: 'Median Cut (Fast)' },
                { value: 'k-means', text: 'K-Means (High Quality)' },
                { value: 'uniform', text: 'Uniform (Simple)' }
            ],
            value: state.algo,
            onChange: v => { state.algo = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Colors', min: 2, max: 256, step: 1, value: state.numColors,
            onInput: v => { state.numColors = parseInt(v); update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Apply Dithering',
            value: state.dither,
            onChange: v => { state.dither = v; update(); }
        }));

        hooks.preview(state);
    },

    // --- Core Logic ---

    process(data: Uint8ClampedArray, w: number, h: number, { numColors, algo, dither }: any) {
        if (numColors < 2) return;

        let palette;

        if (algo === 'uniform') {
            palette = this.quantizeUniform(numColors);
        } else {
            const pixels = [];
            for (let i = 0; i < data.length; i += 4) {
                // Ignore fully transparent pixels
                if (data[i+3] > 128) {
                    pixels.push({ r: data[i], g: data[i+1], b: data[i+2] });
                }
            }

            if (pixels.length === 0) return; // Empty image

            // Generate Palette
            palette = this.quantizeMedianCut(pixels, numColors);

            // Refine with K-Means if selected
            if (algo === 'k-means') {
                palette = this.quantizeKMeans(pixels, numColors, palette);
            }
        }

        // Map Pixels to Palette
        if (dither) {
            this.applyDither(data, w, h, palette);
        } else {
            this.applyNearest(data, w, h, palette);
        }
    },

    // --- Uniform Algorithm ---
    quantizeUniform(colorCount: number) {
        const levels = Math.max(2, Math.floor(Math.pow(colorCount, 1/3)));
        const palette = [];
        const step = 255 / (levels - 1);
        for (let r = 0; r < levels; r++) {
            for (let g = 0; g < levels; g++) {
                for (let b = 0; b < levels; b++) {
                    palette.push({
                        r: Math.round(r * step),
                        g: Math.round(g * step),
                        b: Math.round(b * step)
                    });
                }
            }
        }
        return palette;
    },

    // --- Median Cut Algorithm ---
    quantizeMedianCut(pixels: any[], count: number) {
        // VBox class to represent a color space box
        class VBox {
            pxs: any[];
            r!: number; g!: number; b!: number;
            rw!: number; gw!: number; bw!: number;
            maxDim!: number; pop!: number;

            constructor(pxs: any[]) {
                this.pxs = pxs;
                this.calcBounds();
            }
            calcBounds() {
                let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
                this.pxs.forEach(p => {
                    if(p.r < minR) minR = p.r; if(p.r > maxR) maxR = p.r;
                    if(p.g < minG) minG = p.g; if(p.g > maxG) maxG = p.g;
                    if(p.b < minB) minB = p.b; if(p.b > maxB) maxB = p.b;
                });
                this.r = minR; this.g = minG; this.b = minB;
                this.rw = maxR - minR; this.gw = maxG - minG; this.bw = maxB - minB;
                this.maxDim = Math.max(this.rw, this.gw, this.bw);
                this.pop = this.pxs.length;
            }
            color() {
                let r = 0, g = 0, b = 0;
                if (this.pop === 0) return { r: 0, g: 0, b: 0 };
                this.pxs.forEach(p => { r += p.r; g += p.g; b += p.b; });
                return { r: ~~(r/this.pop), g: ~~(g/this.pop), b: ~~(b/this.pop) };
            }
        }

        let boxes = [new VBox([...pixels])];

        // Recursively split
        while (boxes.length < count) {
            // Sort by population (prioritizes dominant colors)
            boxes.sort((a, b) => b.pop - a.pop);
            const box = boxes[0];
            
            if (box.pop <= 1) break; // Can't split anymore

            // Find longest axis to split along
            const axis = (box.rw >= box.gw && box.rw >= box.bw) ? 'r' : (box.gw >= box.rw && box.gw >= box.bw) ? 'g' : 'b';
            
            // Sort pixels along that axis
            box.pxs.sort((a, b) => a[axis] - b[axis]);
            
            // Split at median
            const mid = Math.floor(box.pxs.length / 2);
            const newBox = new VBox(box.pxs.splice(mid));
            box.calcBounds(); // Re-calc bounds for the remaining half

            boxes.push(newBox);
        }

        return boxes.map(b => b.color());
    },

    // --- K-Means Algorithm ---
    quantizeKMeans(pixels: any[], count: number, initialCentroids: any[] = []) {
        let centroids = initialCentroids.map(c => ({ ...c }));

        // Fill remaining slots
        while (centroids.length < count) {
            if (pixels.length > 0) {
                centroids.push({ ...pixels[Math.floor(Math.random() * pixels.length)] });
            } else {
                centroids.push({ r: 0, g: 0, b: 0 });
            }
        }

        const iterations = 5; 
        
        for (let iter = 0; iter < iterations; iter++) {
            const sums = Array(count).fill(0).map(() => ({ r:0, g:0, b:0, count:0 }));

            // Assign pixels to nearest centroid
            for (let i = 0; i < pixels.length; i++) {
                const p = pixels[i];
                let minDist = Infinity;
                let idx = 0;
                // Find nearest centroid
                for (let c = 0; c < count; c++) {
                    const cent = centroids[c];
                    const dr = p.r - cent.r, dg = p.g - cent.g, db = p.b - cent.b;
                    const dist = dr*dr + dg*dg + db*db;
                    if (dist < minDist) { minDist = dist; idx = c; }
                }
                const s = sums[idx];
                s.r += p.r; s.g += p.g; s.b += p.b; s.count++;
            }

            // Recompute Centroids
            let moved = false;
            for (let c = 0; c < count; c++) {
                const s = sums[c];
                if (s.count > 0) {
                    const nr = s.r / s.count, ng = s.g / s.count, nb = s.b / s.count;
                    if (Math.abs(nr - centroids[c].r) > 1 || Math.abs(ng - centroids[c].g) > 1) moved = true;
                    centroids[c] = { r: nr, g: ng, b: nb };
                } else if (pixels.length > 0) {
                    // Re-init empty cluster to a random pixel to avoid dead colors
                    centroids[c] = { ...pixels[Math.floor(Math.random() * pixels.length)] };
                    moved = true;
                }
            }
            if (!moved) break;
        }

        return centroids.map(c => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) }));
    },

    // --- Mapping & Dithering ---

    findNearest(palette: any[], r: number, g: number, b: number) {
        let min = Infinity, idx = 0;
        for (let i = 0; i < palette.length; i++) {
            const p = palette[i];
            const dr = r - p.r, dg = g - p.g, db = b - p.b;
            const dist = dr*dr + dg*dg + db*db;
            if (dist < min) { min = dist; idx = i; }
        }
        return palette[idx];
    },

    applyNearest(data: Uint8ClampedArray, w: number, h: number, palette: any[]) {
        for (let i = 0; i < data.length; i += 4) {
            // Skip transparent pixels
            if (data[i+3] < 128) continue; 

            const c = this.findNearest(palette, data[i], data[i+1], data[i+2]);
            data[i] = c.r;
            data[i+1] = c.g;
            data[i+2] = c.b;
            data[i+3] = 255;
        }
    },

    applyDither(data: Uint8ClampedArray, w: number, h: number, palette: any[]) {
        // Floyd-Steinberg Dithering
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                
                if (data[i+3] < 128) continue;

                const oldR = data[i];
                const oldG = data[i+1];
                const oldB = data[i+2];

                const c = this.findNearest(palette, oldR, oldG, oldB);
                
                data[i] = c.r;
                data[i+1] = c.g;
                data[i+2] = c.b;
                data[i+3] = 255;

                const er = oldR - c.r;
                const eg = oldG - c.g;
                const eb = oldB - c.b;

                const distribute = (dx: number, dy: number, factor: number) => {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < w && ny < h) {
                        const ni = (ny * w + nx) * 4;
                        // Only dither non-transparent pixels
                        if (data[ni+3] > 128) {
                            data[ni]   = Math.max(0, Math.min(255, data[ni]   + er * factor));
                            data[ni+1] = Math.max(0, Math.min(255, data[ni+1] + eg * factor));
                            data[ni+2] = Math.max(0, Math.min(255, data[ni+2] + eb * factor));
                        }
                    }
                };

                distribute(1, 0, 7/16);
                distribute(-1, 1, 3/16);
                distribute(0, 1, 5/16);
                distribute(1, 1, 1/16);
            }
        }
    }
});
