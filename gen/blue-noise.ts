import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';

Filters.register('blue-noise', {
    name: 'Blue Noise (Void & Cluster)',
    mode: 'pixel',

    // Cache the last generated mask to avoid re-computing on every redraw
    cache: {
        params: null as string | null,
        mask: null as Uint8Array | null
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            size: 64,       // Standard size for dither masks
            sigma: 1.9,     // Gaussian sigma for energy distribution
            opacity: 100
        };

        const update = () => hooks.preview(state);
        
        const regenerate = () => {
            this.cache.mask = null;
            update();
        };

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Generates tileable Blue Noise using Void-and-Cluster approximation.\nWarning: Generation is computationally expensive.'));

        container.appendChild(UI.createSelectRow({
            label: 'Size',
            options: [
                { value: 64, text: '64 x 64' },
                { value: 128, text: '128 x 128' },
                { value: 256, text: '256 x 256 (Slow)' }
            ],
            value: state.size,
            onChange: (v: any) => { state.size = parseInt(v); regenerate(); }
        }));

        // Use onChange (MouseUp) for Sigma to avoid lag while dragging
        container.appendChild(UI.createSliderRow({
            label: 'Sigma', min: 1.0, max: 3.0, step: 0.1, value: state.sigma,
            onInput: (v: any) => { /* Update label only */ },
            onChange: (v: any) => { state.sigma = parseFloat(v); regenerate(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Opacity', min: 0, max: 100, step: 1, value: state.opacity,
            onInput: (v: any) => { state.opacity = parseInt(v); update(); }
        }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { size, sigma, opacity } = params;
        const alpha = opacity / 100;

        // Generate or retrieve cached mask
        let mask = this.getMask(size, sigma);

        // Tile the mask over the image
        for (let y = 0; y < h; y++) {
            const ty = y % size;
            const rowOffset = ty * size;
            const destRow = y * w;
            
            for (let x = 0; x < w; x++) {
                const tx = x % size;
                const noiseVal = mask[rowOffset + tx];
                const idx = (destRow + x) * 4;
                const r = noiseVal;
                const g = noiseVal;
                const b = noiseVal;

                data[idx]   = data[idx]   * (1 - alpha) + r * alpha;
                data[idx+1] = data[idx+1] * (1 - alpha) + g * alpha;
                data[idx+2] = data[idx+2] * (1 - alpha) + b * alpha;
                data[idx+3] = 255;
            }
        }
    },

    getMask(this: any, size: number, sigma: number) {
        // Check cache
        const cacheKey = `${size}_${sigma}`;
        if (this.cache.mask && this.cache.params === cacheKey) {
            return this.cache.mask;
        }

        // Generate
        const mask = this.generateVoidAndCluster(size, sigma);
        this.cache.mask = mask;
        this.cache.params = cacheKey;
        return mask;
    },

    // Generates a progressive Blue Noise texture using Energy Minimization
    generateVoidAndCluster(this: any, size: number, sigma: number) {
        const totalPixels = size * size;
        const ranks = new Int32Array(totalPixels).fill(-1);
        const energyMap = new Float32Array(totalPixels);
        const brush = this.createGaussianBrush(size, sigma);

        // Initial random seed (optional, helps break symmetry)
        const startX = Math.floor(Math.random() * size);
        const startY = Math.floor(Math.random() * size);
        const startIdx = startY * size + startX;
        
        ranks[startIdx] = 0;
        this.applyBrush(energyMap, brush, startX, startY, size);

        // Fill remaining pixels based on lowest energy (Largest Void)
        // Optimization: This is O(N^2). For 64x64 = 4096 pixels. ~16M ops.
        for (let rank = 1; rank < totalPixels; rank++) {
            let minEnergy = Infinity;
            let bestIdx = -1;

            for (let i = 0; i < totalPixels; i++) {
                if (ranks[i] === -1) {
                    if (energyMap[i] < minEnergy) {
                        minEnergy = energyMap[i];
                        bestIdx = i;
                    }
                }
            }

            ranks[bestIdx] = rank;
            
            const bx = bestIdx % size;
            const by = Math.floor(bestIdx / size);
            this.applyBrush(energyMap, brush, bx, by, size);
        }

        // Normalize Ranks to 0-255 (Uint8)
        const output = new Uint8Array(totalPixels);
        const scale = 255 / (totalPixels - 1);
        for (let i = 0; i < totalPixels; i++) {
            output[i] = Math.floor(ranks[i] * scale);
        }

        return output;
    },

    createGaussianBrush(size: number, sigma: number) {
        const brush = new Float32Array(size * size);
        const center = size / 2;
        const coeff = 1 / (2 * sigma * sigma);
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                // Toroidal Distance (Wrap around)
                let dx = Math.abs(x);
                if (dx > size / 2) dx = size - dx;
                let dy = Math.abs(y);
                if (dy > size / 2) dy = size - dy;
                
                const distSq = dx*dx + dy*dy;
                brush[y * size + x] = Math.exp(-distSq * coeff);
            }
        }
        return brush;
    },

    applyBrush(energyMap: Float32Array, brush: Float32Array, ox: number, oy: number, size: number) {
        // Add brush to energy map with wrapping
        for (let y = 0; y < size; y++) {
            // Wrap Y index
            let sy = y - oy;
            if (sy < 0) sy += size; 
            
            const brushRow = sy * size;
            const mapRow = y * size;

            for (let x = 0; x < size; x++) {
                // Wrap X index
                let sx = x - ox;
                if (sx < 0) sx += size;

                energyMap[mapRow + x] += brush[brushRow + sx];
            }
        }
    }
});