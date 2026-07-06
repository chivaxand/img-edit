export type ColorRGB = [number, number, number];
export type ColorRGBA = [number, number, number, number];
export type ListPalette = Array<[number, ColorRGB]>;
export type ChannelDefinition = ((value: number) => number) | Array<[number, number, number]>;

export interface ChannelPalette {
    red: ChannelDefinition;
    green: ChannelDefinition;
    blue: ChannelDefinition;
}

export type Palette = ListPalette | ChannelPalette;
export type PaletteName = 'seismic' | 'bwr' | 'hot' | 'grayscale' | 'bone';

export interface RenderOptions {
    palette?: PaletteName;
    gamma?: number;
    ignoreDC?: boolean;
    logScale?: boolean;
}

export const plot = {
    palettes: {
        seismic: [[0, [0, 0, 77]], [0.25, [0, 0, 255]], [0.5, [255, 255, 255]], [0.75, [255, 0, 0]], [1, [128, 0, 0]]],
        bwr: [[0, [0, 0, 255]], [0.5, [255, 255, 255]], [1, [255, 0, 0]]],
        hot: [[0.0, [0, 0, 0]], [0.3, [255, 0, 0]], [0.6, [255, 255, 0]], [1.0, [255, 255, 255]]],
        grayscale: [[0, [0,0,0]], [1, [255,255,255]]],
        bone: {
            red: [[0, 0, 0], [0.746032, 0.652778, 0.652778], [1, 1, 1]],
            green: [[0, 0, 0], [0.365079, 0.319444, 0.319444], [0.746032, 0.777778, 0.777778], [1, 1, 1]],
            blue: [[0, 0, 0], [0.365079, 0.444444, 0.444444], [1, 1, 1]]
        },
    } as Record<string, Palette>,

    getColor(value: number, paletteName: PaletteName): ColorRGBA {
        value = Math.max(0, Math.min(1, value));
        const data = this.palettes[paletteName] || this.palettes.seismic;
        // Array-based standard stops
        if (Array.isArray(data)) {
            return this._getListedColor(value, data);
        }
        // Channel-independent logic
        return [
            Math.round(Math.max(0, Math.min(1, this._resolveChannel(value, data.red))) * 255),
            Math.round(Math.max(0, Math.min(1, this._resolveChannel(value, data.green))) * 255),
            Math.round(Math.max(0, Math.min(1, this._resolveChannel(value, data.blue))) * 255),
            255
        ];
    },

    drawPalettePreview(canvas: HTMLCanvasElement, paletteName: PaletteName): void {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const { width, height } = canvas;
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;
        for (let x = 0; x < width; x++) {
            const [r, g, b] = this.getColor(x / (width - 1), paletteName);
            for (let y = 0; y < height; y++) {
                const idx = (y * width + x) * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
    },

    renderMatrix(data: number[][] | Float32Array[], canvas: HTMLCanvasElement, options: RenderOptions = {}) {
        const { palette = 'seismic', gamma = 1.0, ignoreDC = false, logScale = false } = options;
        if (!data || !data.length) return;
        const h = data.length, w = data[0].length;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const viewW = canvas.width, viewH = canvas.height;

        // Find Min/Max
        let min = Infinity, max = -Infinity;
        const cx = w >> 1, cy = h >> 1;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (ignoreDC && Math.abs(y - cy) <= 1 && Math.abs(x - cx) <= 1) continue;
                let val = data[y][x];
                if (logScale) val = Math.log(1 + val);
                if (val > max) max = val;
                if (val < min) min = val;
            }
        }

        if (max <= min) {
            if (max === -Infinity) { min = 0; max = 1; }
            else max = min + 1e-9;
        }
        const invRange = 1 / (max - min);

        // Render to Canvas
        const imgData = ctx.createImageData(viewW, viewH);
        const pixels = imgData.data;

        for (let y = 0; y < viewH; y++) {
            const dy = Math.floor(y * h / viewH);
            for (let x = 0; x < viewW; x++) {
                const dx = Math.floor(x * w / viewW);
                let val = data[dy][dx];
                if (logScale) val = Math.log(1 + val);

                let t = (val - min) * invRange;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                if (gamma !== 1.0) t = Math.pow(t, gamma);

                const rgb = this.getColor(t, palette);
                const idx = (y * viewW + x) * 4;
                pixels[idx] = rgb[0];
                pixels[idx + 1] = rgb[1];
                pixels[idx + 2] = rgb[2];
                pixels[idx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
    },

    _getListedColor(value: number, colorScale: ListPalette): ColorRGBA {
        for (let i = 1; i < colorScale.length; i++) {
            if (value <= colorScale[i][0]) {
                const [percent1, color1] = colorScale[i-1];
                const [percent2, color2] = colorScale[i];
                const dist = percent2 - percent1;
                const t = dist === 0 ? 0 : (value - percent1) / dist;
                return [
                    Math.round(color1[0] * (1 - t) + color2[0] * t),
                    Math.round(color1[1] * (1 - t) + color2[1] * t),
                    Math.round(color1[2] * (1 - t) + color2[2] * t),
                    255
                ];
            }
        }
        const last = colorScale[colorScale.length - 1][1];
        return [last[0], last[1], last[2], 255];
    },

    _resolveChannel(value: number, definition: ChannelDefinition): number {
        if (typeof definition === 'function') {
            return definition(value);
        }
        if (Array.isArray(definition)) {
            return this._interpolateSegment(value, definition);
        }
        return 0;
    },

    _interpolateSegment(val: number, segments: Array<[number, number, number]>): number {
        for (let i = 0; i < segments.length - 1; i++) {
            const s1 = segments[i];
            const s2 = segments[i+1];
            if (val >= s1[0] && val <= s2[0]) {
                const dist = s2[0] - s1[0];
                const t = dist === 0 ? 0 : (val - s1[0]) / dist;
                return s1[1] * (1 - t) + s2[1] * t;
            }
        }
        return segments[segments.length - 1][1];
    }
};