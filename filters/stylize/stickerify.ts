import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('stickerify', {
    name: 'Stickerify',
    mode: 'pixel',
    menu: {
        path: 'Filter/Stylize',
        label: 'Stickerify...',
        order: 1
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            color1: '#ffffff',
            width1: 16,
            color2: '#000000',
            width2: 4,
            smoothing: 5,
            shadowEnabled: false,
            shadowColor: '#000000',
            shadowOpacity: 70,
            shadowBlur: 15,
            shadowOffsetX: 8,
            shadowOffsetY: 8
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-subtitle', style: { marginTop: '10px' } }, 'Outline 1 (Inner)'));

        container.appendChild(UI.createSliderRow({
            label: 'Width (px)', min: 0, max: 64, step: 1, value: state.width1,
            onInput: v => { state.width1 = parseInt(v); update(); }
        }));

        container.appendChild(UI.createColorRow({
            label: 'Color', value: state.color1,
            onChange: v => { state.color1 = v; update(); }
        }));

        container.appendChild(UI.createNode('div', { className: 'popup-subtitle', style: { marginTop: '20px' } }, 'Outline 2 (Outer)'));

        container.appendChild(UI.createSliderRow({
            label: 'Width (px)', min: 0, max: 64, step: 1, value: state.width2,
            onInput: v => { state.width2 = parseInt(v); update(); }
        }));

        container.appendChild(UI.createColorRow({
            label: 'Color', value: state.color2,
            onChange: v => { state.color2 = v; update(); }
        }));

        container.appendChild(UI.createNode('div', { className: 'popup-subtitle', style: { marginTop: '20px' } }, 'Quality & Smoothing'));

        container.appendChild(UI.createSliderRow({
            label: 'Smoothing', min: 0, max: 10, step: 1, value: state.smoothing,
            onInput: v => { state.smoothing = parseInt(v); update(); }
        }));

        container.appendChild(UI.createNode('div', { className: 'popup-subtitle', style: { marginTop: '20px' } }, 'Drop Shadow'));

        container.appendChild(UI.createCheckbox({label: 'Enable Shadow', value: state.shadowEnabled,
            onChange: v => {
                state.shadowEnabled = v;
                update();
            }
        }));

        container.appendChild(UI.createColorRow({
            label: 'Color', value: state.shadowColor,
            onChange: v => { state.shadowColor = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Opacity (%)', min: 0, max: 100, step: 1, value: state.shadowOpacity,
            onInput: v => { state.shadowOpacity = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Blur Radius (px)', min: 0, max: 50, step: 1, value: state.shadowBlur,
            onInput: v => { state.shadowBlur = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Offset X (px)', min: -50, max: 50, step: 1, value: state.shadowOffsetX,
            onInput: v => { state.shadowOffsetX = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Offset Y (px)', min: -50, max: 50, step: 1, value: state.shadowOffsetY,
            onInput: v => { state.shadowOffsetY = parseInt(v); update(); }
        }));

        container.appendChild(UI.createNode('div', { style: { marginTop: '20px' } }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const parseHex = (hex: string): [number, number, number] => {
            let clean = hex.replace('#', '');
            if (clean.length === 3) {
                clean = clean.split('').map(c => c + c).join('');
            }
            const num = parseInt(clean, 16);
            return [
                (num >> 16) & 255,
                (num >> 8) & 255,
                num & 255
            ];
        };

        const [r1, g1, b1] = parseHex(params.color1 || '#ffffff');
        const [r2, g2, b2] = parseHex(params.color2 || '#000000');
        const [shadowR, shadowG, shadowB] = parseHex(params.shadowColor || '#000000');

        const width1 = params.width1 !== undefined ? params.width1 : 16;
        const width2 = params.width2 !== undefined ? params.width2 : 4;
        const smoothing = params.smoothing !== undefined ? params.smoothing : 5;

        const shadowEnabled = params.shadowEnabled !== undefined ? params.shadowEnabled : true;
        const shadowOpacity = (params.shadowOpacity !== undefined ? params.shadowOpacity : 70) / 100;
        const shadowBlur = params.shadowBlur !== undefined ? params.shadowBlur : 15;
        const shadowOffsetX = params.shadowOffsetX !== undefined ? params.shadowOffsetX : 8;
        const shadowOffsetY = params.shadowOffsetY !== undefined ? params.shadowOffsetY : 8;

        const rad1 = width1;
        const rad2 = width1 + width2;
        const size = w * h;
        const orig = new Uint8ClampedArray(data);
        const closestX = new Int16Array(size);
        const closestY = new Int16Array(size);
        const dists = new Float32Array(size);
        dists.fill(1e9);

        // Initialize coordinates: set distance 0 for original opaque pixels (alpha > 10)
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const alpha = orig[idx * 4 + 3];
                if (alpha > 10) {
                    closestX[idx] = x;
                    closestY[idx] = y;
                    dists[idx] = 0;
                } else {
                    closestX[idx] = -1;
                    closestY[idx] = -1;
                }
            }
        }

        // Pass 1: Forward Sweep (top-to-bottom, left-to-right)
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                let bestX = closestX[idx];
                let bestY = closestY[idx];
                let bestDistSq = (bestX !== -1) ? 0 : 1e18;

                if (x > 0) {
                    const nidx = idx - 1;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }
                if (y > 0) {
                    const nidx = idx - w;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }
                if (x > 0 && y > 0) {
                    const nidx = idx - w - 1;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }
                if (x < w - 1 && y > 0) {
                    const nidx = idx - w + 1;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }

                if (bestX !== -1) {
                    closestX[idx] = bestX;
                    closestY[idx] = bestY;
                }
            }
        }

        // Pass 2: Backward Sweep (bottom-to-top, right-to-left)
        for (let y = h - 1; y >= 0; y--) {
            for (let x = w - 1; x >= 0; x--) {
                const idx = y * w + x;
                let bestX = closestX[idx];
                let bestY = closestY[idx];
                let bestDistSq = (bestX !== -1) ? (x - bestX) * (x - bestX) + (y - bestY) * (y - bestY) : 1e18;

                if (x < w - 1) {
                    const nidx = idx + 1;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }
                if (y < h - 1) {
                    const nidx = idx + w;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }
                if (x < w - 1 && y < h - 1) {
                    const nidx = idx + w + 1;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }
                if (x > 0 && y < h - 1) {
                    const nidx = idx + w - 1;
                    const cx = closestX[nidx];
                    const cy = closestY[nidx];
                    if (cx !== -1) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < bestDistSq) { bestDistSq = dSq; bestX = cx; bestY = cy; }
                    }
                }

                if (bestX !== -1) {
                    closestX[idx] = bestX;
                    closestY[idx] = bestY;
                    dists[idx] = Math.sqrt(bestDistSq);
                }
            }
        }

        // Apply a fast horizontal and vertical low-pass filter to the distance scalar field
        if (smoothing > 0) {
            const temp = new Float32Array(size);
            const radius = Math.min(10, Math.max(1, Math.round(smoothing)));

            // Horizontal Pass
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    let sum = 0;
                    let count = 0;
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        if (nx >= 0 && nx < w) {
                            sum += dists[rowOffset + nx];
                            count++;
                        }
                    }
                    temp[rowOffset + x] = sum / count;
                }
            }

            // Vertical Pass
            for (let x = 0; x < w; x++) {
                for (let y = 0; y < h; y++) {
                    let sum = 0;
                    let count = 0;
                    for (let dy = -radius; dy <= radius; dy++) {
                        const ny = y + dy;
                        if (ny >= 0 && ny < h) {
                            sum += temp[ny * w + x];
                            count++;
                        }
                    }
                    dists[y * w + x] = sum / count;
                }
            }
        }

        // First, compute the final un-shifted sticker mask alpha at every coordinate
        const stickerAlpha = new Float32Array(size);
        const stickerColors = new Uint8ClampedArray(size * 4);

        for (let i = 0; i < size; i++) {
            const d = dists[i];

            // Calculate Outer Outline (Outline 2) coverage (1.5-pixel transition width)
            let out2A = 0;
            if (width2 > 0 && rad2 > 0) {
                if (d <= rad2 - 0.5) {
                    out2A = 1.0;
                } else if (d < rad2 + 1.0) {
                    out2A = (rad2 + 1.0 - d) / 1.5;
                }
            }

            // Calculate Inner Outline (Outline 1) coverage (1.5-pixel transition width)
            let out1A = 0;
            if (width1 > 0 && rad1 > 0) {
                if (d <= rad1 - 0.5) {
                    out1A = 1.0;
                } else if (d < rad1 + 1.0) {
                    out1A = (rad1 + 1.0 - d) / 1.5;
                }
            }

            // Load original pixel
            const origA = orig[i * 4 + 3] / 255;
            const origR = orig[i * 4];
            const origG = orig[i * 4 + 1];
            const origB = orig[i * 4 + 2];

            // Composite layers:
            // Base layer is Outline 2
            let currentR = r2;
            let currentG = g2;
            let currentB = b2;
            let currentA = out2A;

            // Composite Outline 1 over Outline 2
            if (out1A > 0) {
                const nextA = out1A + currentA * (1 - out1A);
                if (nextA > 0) {
                    currentR = (r1 * out1A + currentR * currentA * (1 - out1A)) / nextA;
                    currentG = (g1 * out1A + currentG * currentA * (1 - out1A)) / nextA;
                    currentB = (b1 * out1A + currentB * currentA * (1 - out1A)) / nextA;
                }
                currentA = nextA;
            }

            // Composite Original Image over the outlines
            if (origA > 0) {
                const nextA = origA + currentA * (1 - origA);
                if (nextA > 0) {
                    currentR = (origR * origA + currentR * currentA * (1 - origA)) / nextA;
                    currentG = (origG * origA + currentG * currentA * (1 - origA)) / nextA;
                    currentB = (origB * origA + currentB * currentA * (1 - origA)) / nextA;
                }
                currentA = nextA;
            }

            stickerAlpha[i] = currentA;
            stickerColors[i * 4] = Math.round(currentR);
            stickerColors[i * 4 + 1] = Math.round(currentG);
            stickerColors[i * 4 + 2] = Math.round(currentB);
            stickerColors[i * 4 + 3] = Math.round(currentA * 255);
        }

        // Initialize drop shadow alpha mask and offset it
        const shadowAlpha = new Float32Array(size);
        if (shadowEnabled) {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const sx = x - shadowOffsetX;
                    const sy = y - shadowOffsetY;
                    if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
                        shadowAlpha[y * w + x] = stickerAlpha[sy * w + sx];
                    } else {
                        shadowAlpha[y * w + x] = 0;
                    }
                }
            }
        }

        // Apply constant-time O(1) sliding-window box blur to the shadow mask
        if (shadowEnabled && shadowBlur > 0) {
            const temp = new Float32Array(size);
            const radius = Math.min(50, Math.max(1, Math.round(shadowBlur)));

            // Horizontal Pass
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                let windowSum = 0;
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = Math.min(w - 1, Math.max(0, dx));
                    windowSum += shadowAlpha[rowOffset + nx];
                }
                temp[rowOffset] = windowSum / (2 * radius + 1);

                for (let x = 1; x < w; x++) {
                    const leftX = Math.min(w - 1, Math.max(0, x - radius - 1));
                    const rightX = Math.min(w - 1, Math.max(0, x + radius));
                    windowSum += shadowAlpha[rowOffset + rightX] - shadowAlpha[rowOffset + leftX];
                    temp[rowOffset + x] = windowSum / (2 * radius + 1);
                }
            }

            // Vertical Pass
            for (let x = 0; x < w; x++) {
                let windowSum = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const ny = Math.min(h - 1, Math.max(0, dy));
                    windowSum += temp[ny * w + x];
                }
                shadowAlpha[x] = windowSum / (2 * radius + 1);

                for (let y = 1; y < h; y++) {
                    const leftY = Math.min(h - 1, Math.max(0, y - radius - 1));
                    const rightY = Math.min(h - 1, Math.max(0, y + radius));
                    windowSum += temp[rightY * w + x] - temp[leftY * w + x];
                    shadowAlpha[y * w + x] = windowSum / (2 * radius + 1);
                }
            }
        }

        // Final composition (Back-to-front: Shadow -> Sticker -> Original)
        for (let i = 0; i < size; i++) {
            const stickerA = stickerAlpha[i];
            const shadowA = shadowAlpha[i] * shadowOpacity;

            // Start with Shadow as back layer
            let finalR = shadowR;
            let finalG = shadowG;
            let finalB = shadowB;
            let finalA = shadowA;

            // Blend Sticker over Drop Shadow
            if (stickerA > 0) {
                const sR = stickerColors[i * 4];
                const sG = stickerColors[i * 4 + 1];
                const sB = stickerColors[i * 4 + 2];

                const nextA = stickerA + finalA * (1 - stickerA);
                if (nextA > 0) {
                    finalR = (sR * stickerA + finalR * finalA * (1 - stickerA)) / nextA;
                    finalG = (sG * stickerA + finalG * finalA * (1 - stickerA)) / nextA;
                    finalB = (sB * stickerA + finalB * finalA * (1 - stickerA)) / nextA;
                }
                finalA = nextA;
            }

            // Write back composite to layer buffer
            data[i * 4] = Math.round(finalR);
            data[i * 4 + 1] = Math.round(finalG);
            data[i * 4 + 2] = Math.round(finalB);
            data[i * 4 + 3] = Math.round(finalA * 255);
        }
    }
});