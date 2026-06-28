import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('pixelate', {
    name: 'Pixelate / Mosaic',
    mode: 'pixel',
    menu: {
        path: 'Filter/Stylize',
        label: 'Pixelate / Mosaic...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            shape: 'square', // square, circle, diamond, hexagon
            size: 10,
            spacing: 0,      // Gap between tiles (0-50%)
            average: true    // Average color vs Center pixel
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createSelectRow({
            label: 'Shape',
            options: [
                { value: 'square', text: 'Square (Grid)' },
                { value: 'circle', text: 'Circle (Dots)' },
                { value: 'diamond', text: 'Diamond' },
                { value: 'hexagon', text: 'Hexagon (Honeycomb)' },
                { value: 'voronoi', text: 'Voronoi (Mosaic)' }
            ],
            value: state.shape,
            onChange: v => { state.shape = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Size', min: 2, max: 100, step: 1, value: state.size,
            onInput: v => { state.size = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Gap (%)', min: 0, max: 50, step: 1, value: state.spacing,
            onInput: v => { state.spacing = parseInt(v); update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Average Area Color', value: state.average,
            onChange: v => { state.average = v; update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { shape, size, spacing, average }: any) {
        const srcCopy = new Uint8ClampedArray(data);

        if (shape === 'voronoi') {
            const S = size;
            const numPixels = w * h;
            const centers: { x: number; y: number; r: number; g: number; b: number; a: number }[] = [];

            // Generate jittered grid centers as Voronoi seeds
            for (let y = S / 2; y < h; y += S) {
                for (let x = S / 2; x < w; x += S) {
                    const jx = x + (Math.random() - 0.5) * (S / 2);
                    const jy = y + (Math.random() - 0.5) * (S / 2);
                    const kx = Math.max(0, Math.min(w - 1, Math.floor(jx)));
                    const ky = Math.max(0, Math.min(h - 1, Math.floor(jy)));
                    const idx = (ky * w + kx) * 4;
                    centers.push({
                        x: kx,
                        y: ky,
                        r: srcCopy[idx],
                        g: srcCopy[idx + 1],
                        b: srcCopy[idx + 2],
                        a: srcCopy[idx + 3]
                    });
                }
            }

            const nearestSeed = new Int32Array(numPixels);
            const d1Array = new Float32Array(numPixels);
            const d2Array = new Float32Array(numPixels);

            // Compute closest and second closest seeds for each pixel
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = rowOffset + x;
                    let d1 = 1e10;
                    let d2 = 1e10;
                    let bestId = 0;

                    for (let i = 0; i < centers.length; i++) {
                        const c = centers[i];
                        const dx = x - c.x;
                        const dy = y - c.y;
                        const distSq = dx * dx + dy * dy;

                        if (distSq < d1) {
                            d2 = d1;
                            d1 = distSq;
                            bestId = i;
                        } else if (distSq < d2) {
                            d2 = distSq;
                        }
                    }

                    nearestSeed[idx] = bestId;
                    d1Array[idx] = Math.sqrt(d1);
                    d2Array[idx] = Math.sqrt(d2);
                }
            }

            // Calculate mean colors if average mode is enabled
            const avgR = new Float32Array(centers.length);
            const avgG = new Float32Array(centers.length);
            const avgB = new Float32Array(centers.length);
            const avgA = new Float32Array(centers.length);
            const count = new Int32Array(centers.length);

            for (let i = 0; i < numPixels; i++) {
                const sid = nearestSeed[i];
                const pidx = i * 4;
                avgR[sid] += srcCopy[pidx];
                avgG[sid] += srcCopy[pidx + 1];
                avgB[sid] += srcCopy[pidx + 2];
                avgA[sid] += srcCopy[pidx + 3];
                count[sid]++;
            }

            for (let i = 0; i < centers.length; i++) {
                const cnt = count[i];
                if (cnt > 0) {
                    avgR[i] /= cnt;
                    avgG[i] /= cnt;
                    avgB[i] /= cnt;
                    avgA[i] /= cnt;
                }
            }

            // Clear original pixels to allow transparent boundaries
            data.fill(0);

            const gapThreshold = (spacing / 100) * (size / 2);

            for (let idx = 0; idx < numPixels; idx++) {
                if (spacing > 0 && (d2Array[idx] - d1Array[idx]) < gapThreshold) {
                    continue;
                }

                const sid = nearestSeed[idx];
                const pidx = idx * 4;
                if (average) {
                    data[pidx]     = avgR[sid];
                    data[pidx + 1] = avgG[sid];
                    data[pidx + 2] = avgB[sid];
                    data[pidx + 3] = avgA[sid];
                } else {
                    const c = centers[sid];
                    data[pidx]     = c.r;
                    data[pidx + 1] = c.g;
                    data[pidx + 2] = c.b;
                    data[pidx + 3] = c.a;
                }
            }
        } else {
            const cvs = document.createElement('canvas');
            cvs.width = w;
            cvs.height = h;
            const ctx = cvs.getContext('2d')!;
            const gap = (spacing / 100) * size;
            const drawSize = Math.max(1, size - gap);
            
            // Background is transparent
            ctx.clearRect(0, 0, w, h);

            if (shape === 'square') {
                for (let y = 0; y < h; y += size) {
                    for (let x = 0; x < w; x += size) {
                        const cx = x + size/2;
                        const cy = y + size/2;
                        
                        let c: {r: number, g: number, b: number, a: number};
                        if (average) c = this.getAverageColor(srcCopy, w, h, cx, cy, size);
                        else {
                            const idx = (Math.floor(cy) * w + Math.floor(cx)) * 4;
                            c = { r:srcCopy[idx], g:srcCopy[idx+1], b:srcCopy[idx+2], a:srcCopy[idx+3] };
                        }

                        ctx.fillStyle = `rgba(${c.r|0},${c.g|0},${c.b|0},${c.a/255})`;
                        // Center the drawn rect within the grid cell
                        ctx.fillRect(x + gap/2, y + gap/2, drawSize, drawSize);
                    }
                }
            } 
            else if (shape === 'circle') {
                const radius = drawSize / 2;
                for (let y = 0; y < h; y += size) {
                    for (let x = 0; x < w; x += size) {
                        const cx = x + size/2;
                        const cy = y + size/2;
                        
                        let c: {r: number, g: number, b: number, a: number};
                        if (average) c = this.getAverageColor(srcCopy, w, h, cx, cy, size);
                        else {
                            const idx = (Math.floor(cy) * w + Math.floor(cx)) * 4;
                            c = { r:srcCopy[idx], g:srcCopy[idx+1], b:srcCopy[idx+2], a:srcCopy[idx+3] };
                        }

                        ctx.fillStyle = `rgba(${c.r|0},${c.g|0},${c.b|0},${c.a/255})`;
                        ctx.beginPath();
                        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
            else if (shape === 'diamond') {
                for (let y = 0; y < h; y += size) {
                    for (let x = 0; x < w; x += size) {
                        const cx = x + size/2;
                        const cy = y + size/2;
                        
                        let c: {r: number, g: number, b: number, a: number};
                        if (average) c = this.getAverageColor(srcCopy, w, h, cx, cy, size);
                        else {
                            const idx = (Math.floor(cy) * w + Math.floor(cx)) * 4;
                            c = { r:srcCopy[idx], g:srcCopy[idx+1], b:srcCopy[idx+2], a:srcCopy[idx+3] };
                        }

                        ctx.fillStyle = `rgba(${c.r|0},${c.g|0},${c.b|0},${c.a/255})`;
                        ctx.save();
                        ctx.translate(cx, cy);
                        ctx.rotate(Math.PI / 4); // 45 deg
                        const s = (drawSize / Math.sqrt(2)); // Fit inside cell
                        ctx.fillRect(-s/2, -s/2, s, s);
                        ctx.restore();
                    }
                }
            }
            else if (shape === 'hexagon') {
                // Hexagon Grid Math
                const r = size / Math.sqrt(3); // Outer radius
                const hStep = size;
                const vStep = r * 1.5;
                
                // Effective drawing radius (minus gap)
                const effR = r * (1 - spacing/100);

                for (let y = 0; y < h + size; y += vStep) {
                    const rowIndex = Math.round(y / vStep);
                    const offset = (rowIndex % 2 === 1) ? size / 2 : 0;
                    
                    for (let x = -size; x < w + size; x += hStep) {
                        const cx = x + offset;
                        const cy = y;
                        let c: {r: number, g: number, b: number, a: number};
                        // Use a smaller sample area for hex to avoid bleeding too much
                        if (average) c = this.getAverageColor(srcCopy, w, h, cx, cy, size * 0.6);
                        else {
                            const sx = Math.max(0, Math.min(w-1, cx));
                            const sy = Math.max(0, Math.min(h-1, cy));
                            const idx = (Math.floor(sy) * w + Math.floor(sx)) * 4;
                            c = { r:srcCopy[idx], g:srcCopy[idx+1], b:srcCopy[idx+2], a:srcCopy[idx+3] };
                        }

                        ctx.fillStyle = `rgba(${c.r|0},${c.g|0},${c.b|0},${c.a/255})`;
                        this.drawHexagon(ctx, cx, cy, effR);
                    }
                }
            }

            // Write back to layer buffer
            const finalData = ctx.getImageData(0, 0, w, h).data;
            data.set(finalData);
        }
    },

    getAverageColor(data: Uint8ClampedArray, w: number, h: number, x: number, y: number, size: number) {
        const x0 = Math.max(0, Math.floor(x - size / 2));
        const y0 = Math.max(0, Math.floor(y - size / 2));
        const x1 = Math.min(w, Math.ceil(x + size / 2));
        const y1 = Math.min(h, Math.ceil(y + size / 2));
        
        let r=0, g=0, b=0, a=0, count=0;
        
        // Sparse sampling for performance if size is large
        const step = size > 10 ? 2 : 1; 

        for (let py = y0; py < y1; py += step) {
            const rowOff = py * w;
            for (let px = x0; px < x1; px += step) {
                const i = (rowOff + px) * 4;
                r += data[i];
                g += data[i+1];
                b += data[i+2];
                a += data[i+3];
                count++;
            }
        }
        
        if (count === 0) return { r:0, g:0, b:0, a:0 };
        return { r: r/count, g: g/count, b: b/count, a: a/count };
    },

    drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (2 * Math.PI / 6) * (i + 0.5); 
            const px = x + r * Math.cos(angle);
            const py = y + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }
});