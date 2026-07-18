import { Layers } from '~/layers';

export const canvas = {
    create(w: number, h: number) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        return { canvas: c, ctx };
    },

    clone(c: HTMLCanvasElement): HTMLCanvasElement {
        const copy = document.createElement('canvas');
        copy.width = c.width;
        copy.height = c.height;
        copy.getContext('2d')!.drawImage(c, 0, 0);
        return copy;
    },

    getIntersection(l: { x: number; y: number; width: number; height: number }, canvasW: number, canvasH: number) {
        const ix = Math.max(0, l.x);
        const iy = Math.max(0, l.y);
        const ir = Math.min(canvasW, l.x + l.width);
        const ib = Math.min(canvasH, l.y + l.height);
        return {
            x: ix,
            y: iy,
            w: ir - ix,
            h: ib - iy,
            sx: ix - l.x,
            sy: iy - l.y
        };
    },

    getContentBoundingBox(c: HTMLCanvasElement, threshold = 10) {
        const ctx = c.getContext('2d')!;
        const w = c.width;
        const h = c.height;
        const data = ctx.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = 0, maxY = 0;
        let hasPixels = false;
        for (let y = 0; y < h; y++) {
            const yOffset = y * w;
            for (let x = 0; x < w; x++) {
                if (data[(yOffset + x) * 4 + 3] > threshold) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                    hasPixels = true;
                }
            }
        }
        return hasPixels ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
    },

    renderMerged(layers: any[], width: number, height: number, options: { bgColor?: string; forExport?: boolean } = {}) {
        const { canvas: c, ctx } = this.create(width, height);
        if (options.bgColor) {
            ctx.fillStyle = options.bgColor;
            ctx.fillRect(0, 0, width, height);
        }
        for (let i = layers.length - 1; i >= 0; i--) {
            const l = layers[i];
            if (!l.visible) continue;
            ctx.save();
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = (l.blend || 'source-over') as GlobalCompositeOperation;
            if (options.forExport) {
                Layers.render(ctx, l);
            } else {
                ctx.drawImage(l.canvas, l.x, l.y, l.width, l.height);
            }
            ctx.restore();
        }
        return c;
    },

    drawSelectionMasked(layer: any, sel: any, drawFn: (ctx: CanvasRenderingContext2D) => void) {
        const hasSel = sel && sel.active && sel.mask && sel.layerId === layer.id;
        if (hasSel) {
            const { canvas: scratch, ctx: scratchCtx } = this.create(layer.canvas.width, layer.canvas.height);
            drawFn(scratchCtx);
            scratchCtx.save();
            scratchCtx.globalCompositeOperation = 'destination-in';
            scratchCtx.drawImage(sel.mask, 0, 0);
            scratchCtx.restore();
            layer.ctx.save();
            layer.ctx.globalCompositeOperation = 'source-over';
            layer.ctx.drawImage(scratch, 0, 0);
            layer.ctx.restore();
        } else {
            layer.ctx.save();
            drawFn(layer.ctx);
            layer.ctx.restore();
        }
    },

    drawHandle(
        ctx: CanvasRenderingContext2D,
        x: number, y: number, width: number, height: number,
        type: 'triangle' | 'left-half' | 'right-half',
        fillColor: string, strokeColor: string
    ) {
        ctx.save();
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const halfW = width / 2;
        if (type === 'triangle') {
            ctx.moveTo(x, y);
            ctx.lineTo(x - halfW, y + height);
            ctx.lineTo(x + halfW, y + height);
        } else if (type === 'left-half') {
            ctx.moveTo(x, y);
            ctx.lineTo(x - halfW, y + height);
            ctx.lineTo(x, y + height);
        } else if (type === 'right-half') {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + height);
            ctx.lineTo(x + halfW, y + height);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    },

    drawSliderTrack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, background: string | string[]) {
        ctx.save();
        if (Array.isArray(background)) {
            const grad = ctx.createLinearGradient(x, y, x + w, y);
            background.forEach((color, idx) => {
                grad.addColorStop(idx / (background.length - 1), color);
            });
            ctx.fillStyle = grad;
        } else {
            ctx.fillStyle = background;
        }
        ctx.fillRect(x, y, w, h);
        ctx.restore();
    },

    setupDynamicResolution(
        canvasEl: HTMLCanvasElement,
        onResize: (width: number, height: number, dpr: number) => void,
        fixedHeight?: number
    ): () => void {
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                const height = fixedHeight !== undefined ? fixedHeight : entry.contentRect.height;
                if (width === 0 || height === 0) continue;
                const dpr = window.devicePixelRatio || 1;
                canvasEl.width = Math.round(width * dpr);
                canvasEl.height = Math.round(height * dpr);
                canvasEl.style.width = `${width}px`;
                canvasEl.style.height = `${height}px`;
                const ctx = canvasEl.getContext('2d');
                if (ctx) {
                    ctx.resetTransform();
                    ctx.scale(dpr, dpr);
                    onResize(width, height, dpr);
                }
            }
        });
        resizeObserver.observe(canvasEl.parentElement || canvasEl);
        return () => resizeObserver.disconnect();
    }
};
