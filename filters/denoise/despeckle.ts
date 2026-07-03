import { Filters } from '../../filters';
import { UI } from '../../ui';

class DespeckleHistogram {
    elems = new Int32Array(256);
    origs: number[][] = Array.from({ length: 256 }, () => []);
    xmin = 0;
    ymin = 0;
    xmax = 0;
    ymax = 0;

    clean() {
        this.elems.fill(0);
        for (let i = 0; i < 256; i++) {
            this.origs[i].length = 0;
        }
    }
}

Filters.register('despeckle', {
    name: 'Despeckle',
    mode: 'pixel',
    menu: {
        path: 'Filter/Denoise',
        label: 'Despeckle...',
        order: 4
    },
    renderUI(container, layer, hooks) {
        const state = {
            radius: 3,
            adaptive: true,
            recursive: false,
            blackLevel: 7,
            whiteLevel: 248
        };
        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Filters out speckles, dust, or salt-and-pepper noise while preserving edges using adaptive statistics.'
        ));

        container.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 30, step: 1, value: state.radius,
            onInput: (v) => { state.radius = parseInt(v); update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Adaptive', value: state.adaptive,
            onChange: (v) => { state.adaptive = v; update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Recursive', value: state.recursive,
            onChange: (v) => { state.recursive = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Black Level', min: -1, max: 255, step: 1, value: state.blackLevel,
            onInput: (v) => { state.blackLevel = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'White Level', min: 0, max: 256, step: 1, value: state.whiteLevel,
            onInput: (v) => { state.whiteLevel = parseInt(v); update(); }
        }));

        update();
    },
    process(data, w, h, { radius, adaptive, recursive, blackLevel, whiteLevel }) {
        const src = new Uint8ClampedArray(data);
        const dst = data;
        const histogram = new DespeckleHistogram();

        let hist0 = 0;
        let hist255 = 0;
        let histrest = 0;

        // Adds pixel luminance properties and indices to local histogram buckets
        const addVal = (x: number, y: number) => {
            const pos = (y * w + x) * 4;
            const r = src[pos];
            const g = src[pos + 1];
            const b = src[pos + 2];
            const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

            if (luma > blackLevel && luma < whiteLevel) {
                histogram.elems[luma]++;
                histogram.origs[luma].push(pos);
                histrest++;
            } else {
                if (luma <= blackLevel) hist0++;
                if (luma >= whiteLevel) hist255++;
            }
        };

        // Removes pixel properties from local histogram buckets
        const delVal = (x: number, y: number) => {
            const pos = (y * w + x) * 4;
            const r = src[pos];
            const g = src[pos + 1];
            const b = src[pos + 2];
            const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

            if (luma > blackLevel && luma < whiteLevel) {
                histogram.elems[luma]--;
                const idx = histogram.origs[luma].indexOf(pos);
                if (idx !== -1) {
                    histogram.origs[luma].splice(idx, 1);
                }
                histrest--;
            } else {
                if (luma <= blackLevel) hist0--;
                if (luma >= whiteLevel) hist255--;
            }
        };

        const addVals = (xmin: number, ymin: number, xmax: number, ymax: number) => {
            if (xmin > xmax) return;
            for (let y = ymin; y <= ymax; y++) {
                for (let x = xmin; x <= xmax; x++) {
                    addVal(x, y);
                }
            }
        };

        const delVals = (xmin: number, ymin: number, xmax: number, ymax: number) => {
            if (xmin > xmax) return;
            for (let y = ymin; y <= ymax; y++) {
                for (let x = xmin; x <= xmax; x++) {
                    delVal(x, y);
                }
            }
        };

        // Updates dynamic histogram by sliding boundary columns and rows
        const updateHistogram = (xmin: number, ymin: number, xmax: number, ymax: number) => {
            delVals(histogram.xmin, histogram.ymin, xmin - 1, histogram.ymax);
            delVals(xmin, histogram.ymin, xmax, ymin - 1);
            delVals(xmin, ymax + 1, xmax, histogram.ymax);

            addVals(histogram.xmax + 1, ymin, xmax, ymax);
            addVals(xmin, ymin, histogram.xmax, histogram.ymin - 1);
            addVals(histogram.xmin, histogram.ymax + 1, histogram.xmax, ymax);

            histogram.xmin = xmin;
            histogram.ymin = ymin;
            histogram.xmax = xmax;
            histogram.ymax = ymax;
        };

        // Extracts the representative pixel index containing the median luma
        const getMedian = (defaultPos: number): number => {
            if (histrest === 0) return defaultPos;

            const count = Math.floor((histrest + 1) / 2);
            let sum = 0;
            let i = 0;
            while (i < 256) {
                sum += histogram.elems[i];
                if (sum >= count) break;
                i++;
            }
            if (i === 256) i = 255;

            const list = histogram.origs[i];
            if (list.length === 0) return defaultPos;
            const randIdx = Math.floor(Math.random() * list.length);
            return list[randIdx];
        };

        let adapt_radius = radius;
        for (let y = 0; y < h; y++) {
            let x = 0;
            let ymin = Math.max(0, y - adapt_radius);
            let ymax = Math.min(h - 1, y + adapt_radius);
            let xmin = Math.max(0, x - adapt_radius);
            let xmax = Math.min(w - 1, x + adapt_radius);

            hist0 = 0;
            hist255 = 0;
            histrest = 0;
            histogram.clean();
            histogram.xmin = xmin;
            histogram.ymin = ymin;
            histogram.xmax = xmax;
            histogram.ymax = ymax;

            addVals(xmin, ymin, xmax, ymax);

            for (let x = 0; x < w; x++) {
                ymin = Math.max(0, y - adapt_radius);
                ymax = Math.min(h - 1, y + adapt_radius);
                xmin = Math.max(0, x - adapt_radius);
                xmax = Math.min(w - 1, x + adapt_radius);

                updateHistogram(xmin, ymin, xmax, ymax);

                const pos = (y * w + x) * 4;
                const medianPos = getMedian(pos);

                if (recursive) {
                    delVal(x, y);
                    src[pos] = src[medianPos];
                    src[pos + 1] = src[medianPos + 1];
                    src[pos + 2] = src[medianPos + 2];
                    src[pos + 3] = src[medianPos + 3];
                    addVal(x, y);
                }

                dst[pos] = src[medianPos];
                dst[pos + 1] = src[medianPos + 1];
                dst[pos + 2] = src[medianPos + 2];
                dst[pos + 3] = src[medianPos + 3];

                if (adaptive) {
                    if (hist0 >= adapt_radius || hist255 >= adapt_radius) {
                        if (adapt_radius < radius) {
                            adapt_radius++;
                        }
                    } else if (adapt_radius > 1) {
                        adapt_radius--;
                    }
                }
            }
        }
    }
});