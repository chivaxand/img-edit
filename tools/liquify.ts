import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { drawActiveBrushCircle } from './tools';

export const LiquifyTool = {
    id: 'liquify' as const,
    icon: '🌀',
    title: 'Liquify Brush',
    sortOrder: 160,
    settings: { size: 60, strength: 50 },
    requiresEditableLayer: true,

    lastPos: null as { x: number, y: number } | null,
    origCanvas: null as HTMLCanvasElement | null,
    origData: null as Uint8ClampedArray | null,
    disX: null as Float32Array | null,
    disY: null as Float32Array | null,

    drawUI() {
        drawActiveBrushCircle(this.settings.size);
    },

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 10, max: 200, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Strength', min: 1, max: 100, value: this.settings.strength, onInput: (v: string) => this.settings.strength = parseInt(v) }));
    },

    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        if (!App.utils.layerIs(l, 'editable')) { 
            alert('Layer is not editable.'); 
            return; 
        }

        App.actions.saveState();
        App.state.isDrawing = true;

        const pos = App.utils.getPos(e);
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');
        this.lastPos = { x: lx, y: ly };

        const w = l.canvas.width;
        const h = l.canvas.height;

        this.origCanvas = document.createElement('canvas');
        this.origCanvas.width = w;
        this.origCanvas.height = h;
        const oCtx = this.origCanvas.getContext('2d')!;
        oCtx.drawImage(l.canvas, 0, 0);
        this.origData = oCtx.getImageData(0, 0, w, h).data;

        this.disX = new Float32Array(w * h);
        this.disY = new Float32Array(w * h);
    },

    onMouseMove(e: MouseEvent) {
        if (!App.state.isDrawing || !this.lastPos) return;
        const l = App.utils.getActive();
        if (!l) return;

        const pos = App.utils.getPos(e);
        const curr = {
            x: App.utils.toLocal(l, pos.x, 'x'),
            y: App.utils.toLocal(l, pos.y, 'y')
        };

        const dx = curr.x - this.lastPos.x;
        const dy = curr.y - this.lastPos.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 0.1) {
            this.warp(l, this.lastPos.x, this.lastPos.y, curr.x, curr.y, dx, dy);
            this.lastPos = curr;
            App.emit('render');
        }
    },

    onMouseUp() {
        if (App.state.isDrawing) {
            App.state.isDrawing = false;
            this.lastPos = null;
            this.origCanvas = null;
            this.origData = null;
            this.disX = null;
            this.disY = null;
        }
    },

    warp(layer: Layer, cx: number, cy: number, currX: number, currY: number, dx: number, dy: number) {
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const size = this.settings.size;
        const r = size / 2;
        const str = this.settings.strength / 100;

        const sx = Math.floor(cx - r);
        const sy = Math.floor(cy - r);
        const ex = Math.ceil(cx + r);
        const ey = Math.ceil(cy + r);

        const xStart = Math.max(0, sx);
        const yStart = Math.max(0, sy);
        const xEnd = Math.min(w, ex);
        const yEnd = Math.min(h, ey);

        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === layer.id;

        // Update displacement fields inside brush radius with Gaussian falloff
        for (let y = yStart; y < yEnd; y++) {
            const dy_pixel = y - cy;
            for (let x = xStart; x < xEnd; x++) {
                const dx_pixel = x - cx;
                const distToCenter = Math.hypot(dx_pixel, dy_pixel);
                if (distToCenter < r) {
                    const sigma = r / 2.5;
                    const influence = Math.exp(-(distToCenter * distToCenter) / (2 * sigma * sigma));
                    const idx = y * w + x;
                    this.disX![idx] += dx * influence * str;
                    this.disY![idx] += dy * influence * str;
                }
            }
        }

        // Determine dirty bounding box for updating the layer
        const minX = Math.max(0, Math.floor(Math.min(cx, currX) - r - 2));
        const minY = Math.max(0, Math.floor(Math.min(cy, currY) - r - 2));
        const maxX = Math.min(w, Math.ceil(Math.max(cx, currX) + r + 2));
        const maxY = Math.min(h, Math.ceil(Math.max(cy, currY) + r + 2));

        const dWidth = maxX - minX;
        const dHeight = maxY - minY;
        if (dWidth <= 0 || dHeight <= 0) return;

        const imgData = layer.ctx.getImageData(minX, minY, dWidth, dHeight);
        const data = imgData.data;

        let selData: Uint8ClampedArray | null = null;
        if (hasSel && sel.mask) {
            const sCtx = sel.mask.getContext('2d') || sel.ctx;
            if (sCtx) {
                selData = sCtx.getImageData(minX, minY, dWidth, dHeight).data;
            }
        }

        // Catmull-Rom cubic spline interpolator
        const cubicSpline = (p0: number, p1: number, p2: number, p3: number, t: number) => {
            return 0.5 * ((2 * p1) + (-p0 + p2) * t + 
                (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + 
                (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        };

        // 4x4 clamp-to-edge boundary sampler
        const getPixelVal = (px: number, py: number, c: number) => {
            let x = Math.floor(px);
            let y = Math.floor(py);
            if (x < 0) x = 0; else if (x >= w) x = w - 1;
            if (y < 0) y = 0; else if (y >= h) y = h - 1;
            return this.origData![(y * w + x) * 4 + c];
        };

        // High quality bicubic sampling
        const getBicubicGlobal = (px: number, py: number, c: number) => {
            const x0 = Math.floor(px);
            const y0 = Math.floor(py);
            const tx = px - x0;
            const ty = py - y0;

            const row = (offsetY: number) => {
                return cubicSpline(
                    getPixelVal(x0 - 1, y0 + offsetY, c),
                    getPixelVal(x0,     y0 + offsetY, c),
                    getPixelVal(x0 + 1, y0 + offsetY, c),
                    getPixelVal(x0 + 2, y0 + offsetY, c),
                    tx
                );
            };

            const val = cubicSpline(row(-1), row(0), row(1), row(2), ty);
            return Math.max(0, Math.min(255, val));
        };

        for (let y = minY; y < maxY; y++) {
            const localY = y - minY;
            for (let x = minX; x < maxX; x++) {
                const localX = x - minX;
                const globalIdx = y * w + x;
                const localIdx = (localY * dWidth + localX) * 4;

                let displaceX = this.disX![globalIdx];
                let displaceY = this.disY![globalIdx];

                if (selData) {
                    const selAlpha = selData[localIdx + 3] / 255;
                    displaceX *= selAlpha;
                    displaceY *= selAlpha;
                }

                const srcX = x - displaceX;
                const srcY = y - displaceY;

                data[localIdx]     = getBicubicGlobal(srcX, srcY, 0);
                data[localIdx + 1] = getBicubicGlobal(srcX, srcY, 1);
                data[localIdx + 2] = getBicubicGlobal(srcX, srcY, 2);
                data[localIdx + 3] = getBicubicGlobal(srcX, srcY, 3);
            }
        }

        layer.ctx.putImageData(imgData, minX, minY);
    }
};


declare global {
    interface ToolRegistry {
        liquify: typeof LiquifyTool;
    }
}

App.registerTool(LiquifyTool);