import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';

Filters.register('distance-fill', {
    name: 'Distance Fill',
    mode: 'unified',
    menu: {
        path: 'Generate',
        label: 'Distance Fill...',
        order: 10
    },

    apply(context: FilterContext) {
        const { layer, values, selection } = context;
        if (!selection.active || !selection.mask) {
            alert('Please select an area first.');
            return;
        }

        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const maskData = selection.mask.getContext('2d')!.getImageData(0, 0, w, h).data;
        const targetData = layer.ctx.getImageData(0, 0, w, h);
        const pixels = targetData.data;

        // 1. Initialize Distance Grid (Infinity for background, 0 for selection borders)
        const size = w * h;
        const dist = new Float32Array(size);
        const maxDistValue = 1e9;
        dist.fill(maxDistValue);

        // A pixel is on the border if it's selected and adjacent to a non-selected pixel (or image bounds)
        const isSelected = (x: number, y: number): boolean => {
            if (x < 0 || x >= w || y < 0 || y >= h) return false;
            return maskData[(y * w + x) * 4 + 3] > 128;
        };

        for (let y = 0; y < h; y++) {
            const yOffset = y * w;
            for (let x = 0; x < w; x++) {
                const u = yOffset + x;
                if (isSelected(x, y)) {
                    const isBorder = !isSelected(x - 1, y) || !isSelected(x + 1, y) || 
                                     !isSelected(x, y - 1) || !isSelected(x, y + 1);
                    if (isBorder) {
                        dist[u] = 0;
                    }
                }
            }
        }

        // 2. Perform Chamfer Distance Transform (2-pass linear scan)
        // Pass 1: Top-Left to Bottom-Right
        for (let y = 0; y < h; y++) {
            const yOffset = y * w;
            for (let x = 0; x < w; x++) {
                const u = yOffset + x;
                if (!isSelected(x, y)) continue;

                let d = dist[u];
                if (x > 0) d = Math.min(d, dist[u - 1] + 1); // Left
                if (y > 0) d = Math.min(d, dist[u - w] + 1); // Top
                if (x > 0 && y > 0) d = Math.min(d, dist[u - w - 1] + 1.414); // Top-Left
                if (x < w - 1 && y > 0) d = Math.min(d, dist[u - w + 1] + 1.414); // Top-Right
                dist[u] = d;
            }
        }

        // Pass 2: Bottom-Right to Top-Left
        for (let y = h - 1; y >= 0; y--) {
            const yOffset = y * w;
            for (let x = w - 1; x >= 0; x--) {
                const u = yOffset + x;
                if (!isSelected(x, y)) continue;

                let d = dist[u];
                if (x < w - 1) d = Math.min(d, dist[u + 1] + 1); // Right
                if (y < h - 1) d = Math.min(d, dist[u + w] + 1); // Bottom
                if (x > 0 && y < h - 1) d = Math.min(d, dist[u + w - 1] + 1.414); // Bottom-Left
                if (x < w - 1 && y < h - 1) d = Math.min(d, dist[u + w + 1] + 1.414); // Bottom-Right
                dist[u] = d;
            }
        }

        // 3. Find maximum distance inside selection to normalize values
        let maxD = 0.01;
        for (let i = 0; i < size; i++) {
            if (dist[i] < maxDistValue && dist[i] > maxD) {
                maxD = dist[i];
            }
        }

        // Convert hex colors to rgb
        const parseHex = (hex: string) => {
            const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [0, 0, 0];
        };

        const colorStart = parseHex(values.colorStart);
        const colorEnd = parseHex(values.colorEnd);

        // 4. Draw normalized distance values as gradient colors
        for (let y = 0; y < h; y++) {
            const yOffset = y * w;
            for (let x = 0; x < w; x++) {
                const u = yOffset + x;
                if (isSelected(x, y)) {
                    const idx = u * 4;
                    const d = dist[u];
                    const norm = Math.min(1.0, d / (values.range === 'max' ? maxD : values.customMax));

                    // Linear interpolation between colors
                    pixels[idx]     = Math.round(colorStart[0] * (1 - norm) + colorEnd[0] * norm);
                    pixels[idx + 1] = Math.round(colorStart[1] * (1 - norm) + colorEnd[1] * norm);
                    pixels[idx + 2] = Math.round(colorStart[2] * (1 - norm) + colorEnd[2] * norm);
                    pixels[idx + 3] = 255;
                }
            }
        }

        layer.ctx.putImageData(targetData, 0, 0);
    },

    renderUI(root: HTMLElement, layer: any, hooks: any) {
        const state = {
            colorStart: '#007acc',
            colorEnd: '#ffeb3b',
            range: 'max',
            customMax: 30
        };

        const update = () => hooks.preview(state);

        root.appendChild(UI.createColorRow({
            label: 'Border Color', value: state.colorStart,
            onChange: (v) => { state.colorStart = v; update(); }
        }));

        root.appendChild(UI.createColorRow({
            label: 'Center Color', value: state.colorEnd,
            onChange: (v) => { state.colorEnd = v; update(); }
        }));

        root.appendChild(UI.createRadioGroup({
            label: 'Normalization',
            options: [
                { value: 'max', text: 'Fit to deepest point' },
                { value: 'custom', text: 'Fixed radius' }
            ],
            value: state.range,
            onChange: (v) => {
                state.range = v;
                UI.toggle(sliderRow, v === 'custom');
                update();
            }
        }));

        const sliderRow = UI.createSliderRow({
            label: 'Radius (px)', min: 2, max: 200, step: 1, value: state.customMax,
            onInput: (v) => { state.customMax = parseInt(v); update(); }
        });
        UI.toggle(sliderRow, state.range === 'custom');
        root.appendChild(sliderRow);

        update();
    }
});