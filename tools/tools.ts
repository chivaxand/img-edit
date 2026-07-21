import { App, ToolDef, PointerCompatibleEvent } from '~/app';
import { Layer } from '~/layers';

// Draws circular boundaries with fallback options
export function drawBrushCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, options: { dashed?: boolean; color1?: string; color2?: string } = {}) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = options.color1 || '#ffffff';
    ctx.lineWidth = 1.5;
    if (options.dashed) {
        ctx.setLineDash([4, 4]);
    } else {
        ctx.setLineDash([]);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = options.color2 || '#000000';
    ctx.lineWidth = 1.0;
    if (options.dashed) {
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = 4;
    } else {
        ctx.setLineDash([4, 4]);
    }
    ctx.stroke();
    ctx.restore();
}

// Draws size circle tracking cursor position
export function drawActiveBrushCircle(size: number, options: { dashed?: boolean; color1?: string; color2?: string } = {}) {
    if (App.state.mousePos) {
        const ctx = App.els.ctx;
        const l = App.utils.getActive();
        const scale = (l && l.canvas && l.canvas.width) ? (l.width / l.canvas.width) : 1;
        const radius = (size / 2) * scale;
        drawBrushCircle(ctx, App.state.mousePos.x, App.state.mousePos.y, radius, options);
    }
}

// Generates procedural radial gradient brush tip canvas
export function createBrushCanvas(size: number, hardness: number, color?: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    const stop0 = Math.max(0, Math.min(1, hardness / 100));
    
    if (color) {
        const rgb = App.utils.hexToRgb(color) || { r: 0, g: 0, b: 0 };
        grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
        if (stop0 < 1 && stop0 > 0) grad.addColorStop(stop0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
        if (stop0 < 1) grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    } else {
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        if (stop0 < 1 && stop0 > 0) grad.addColorStop(stop0, 'rgba(0,0,0,1)');
        if (stop0 < 1) grad.addColorStop(1, 'rgba(0,0,0,0)');
    }
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
}

// Interpolates sub-pixel coordinates for consecutive brush dabs
export function interpolateDabs(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    accumulator: number,
    spacing: number,
    stamp: (x: number, y: number) => void
): number {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist > 0) {
        const dx = (p2.x - p1.x) / dist;
        const dy = (p2.y - p1.y) / dist;
        let d = accumulator;
        while (d <= dist) {
            stamp(p1.x + dx * d, p1.y + dy * d);
            d += spacing;
        }
        return d - dist;
    }
    return accumulator;
}

// Unified abstract base class for high-performance brush rendering
export abstract class BaseBrushTool implements ToolDef {
    abstract id: any;
    abstract icon: string;
    abstract title: string;
    abstract settings: Record<string, any>;
    requiresEditableLayer = true;
    sortOrder = 90;

    // Behavioral flags customizable by subclasses
    protected accumulateWithinStroke = false;
    protected useFixedOnePixelSpacing = false;
    protected strokeCompositeOperation: GlobalCompositeOperation = 'source-over';

    // Transient brush state
    protected brushCanvas: HTMLCanvasElement | null = null;
    protected brushCtx: CanvasRenderingContext2D | null = null;
    protected distanceAccumulator = 0;

    // Buffer canvases for non-accumulative stroke compositing and selection constraints
    protected strokeCanvas: HTMLCanvasElement | null = null;
    protected strokeCtx: CanvasRenderingContext2D | null = null;
    protected scratchCanvas: HTMLCanvasElement | null = null;
    protected scratchCtx: CanvasRenderingContext2D | null = null;

    drawUI() {
        drawActiveBrushCircle(this.settings.size);
    }

    onWheel(e: WheelEvent): boolean {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const step = e.deltaY < 0 ? 2 : -2;
            const newSize = Math.max(1, Math.min(200, this.settings.size + step));
            if (newSize !== this.settings.size) {
                this.settings.size = newSize;
                App.ui.updateToolSettings();
                App.render();
            }
            return true;
        }
        return false;
    }

    onMouseDown(e: PointerCompatibleEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        if (this.requiresEditableLayer && !App.utils.layerIs(l, 'editable')) {
            alert('Layer is not editable.');
            return;
        }

        App.actions.saveState(this.title);
        App.state.isDrawing = true;

        const pos = App.utils.getPos(e);
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        App.state.last = { x: lx, y: ly };

        const size = this.settings.size;
        const hardness = this.settings.hardness ?? 100;
        this.brushCanvas = createBrushCanvas(size, hardness);
        this.brushCtx = this.brushCanvas.getContext('2d')!;

        // Prepare Selection Constraint Mask
        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === l.id;
        if (hasSel) {
            this.scratchCanvas = document.createElement('canvas');
            this.scratchCanvas.width = l.canvas.width;
            this.scratchCanvas.height = l.canvas.height;
            this.scratchCtx = this.scratchCanvas.getContext('2d')!;
        } else {
            this.scratchCanvas = null;
            this.scratchCtx = null;
        }

        // Prepare Stroke Buffer for Capped Opacity
        if (!this.accumulateWithinStroke) {
            this.strokeCanvas = document.createElement('canvas');
            this.strokeCanvas.width = l.canvas.width;
            this.strokeCanvas.height = l.canvas.height;
            this.strokeCtx = this.strokeCanvas.getContext('2d')!;
        } else {
            this.strokeCanvas = null;
            this.strokeCtx = null;
        }

        this.onStrokeStart(l, App.state.last, e);

        // Determine spacing limit
        const spacingPercent = this.settings.spacing ?? 10;
        const spacingPx = this.useFixedOnePixelSpacing ? 1 : Math.max(1, size * (spacingPercent / 100));
        this.distanceAccumulator = spacingPx;

        this.stampDabs(l, App.state.last, App.state.last, true);
        App.emit('render');
    }

    onMouseMove(e: PointerCompatibleEvent) {
        if (!App.state.isDrawing) return;
        const l = App.utils.getActive();
        if (!l) return;

        const pos = App.utils.getPos(e);
        const curr = {
            x: App.utils.toLocal(l, pos.x, 'x'),
            y: App.utils.toLocal(l, pos.y, 'y')
        };

        this.stampDabs(l, App.state.last, curr, false);
        App.state.last = curr;
        App.emit('render');
    }

    onMouseUp(e: PointerCompatibleEvent) {
        if (App.state.isDrawing) {
            App.state.isDrawing = false;
            const l = App.utils.getActive();
            if (l) {
                this.onStrokeEnd(l);
            }
            this.brushCanvas = null;
            this.brushCtx = null;
            this.strokeCanvas = null;
            this.strokeCtx = null;
            this.scratchCanvas = null;
            this.scratchCtx = null;
            this.distanceAccumulator = 0;
            App.emit('render');
        }
    }

    protected stampDabs(layer: Layer, p1: { x: number; y: number }, p2: { x: number; y: number }, isInitial: boolean) {
        const size = this.settings.size;
        const r = size / 2;
        const spacingPercent = this.settings.spacing ?? 10;
        const spacingPx = this.useFixedOnePixelSpacing ? 1 : Math.max(1, size * (spacingPercent / 100));

        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === layer.id;

        // Route stamping to corresponding context
        let renderTargetCtx: CanvasRenderingContext2D;
        if (this.strokeCtx) {
            renderTargetCtx = this.strokeCtx;
        } else if (this.scratchCtx) {
            renderTargetCtx = this.scratchCtx;
        } else {
            renderTargetCtx = layer.ctx;
        }

        const alpha = this.settings.alpha ?? 1.0;

        const stampAt = (px: number, py: number) => {
            renderTargetCtx.save();
            if (this.strokeCtx || this.scratchCtx) {
                renderTargetCtx.globalCompositeOperation = 'source-over';
                renderTargetCtx.globalAlpha = 1.0;
            } else {
                renderTargetCtx.globalCompositeOperation = this.strokeCompositeOperation;
                renderTargetCtx.globalAlpha = alpha;
            }
            this.paintDab(renderTargetCtx, px, py, px - r, py - r, size);
            renderTargetCtx.restore();
        };

        if (isInitial) {
            stampAt(p1.x, p1.y);
        } else {
            this.distanceAccumulator = interpolateDabs(p1, p2, this.distanceAccumulator, spacingPx, stampAt);
        }

        // Blit and blend buffered stroke canvases onto main Layer
        if (!this.accumulateWithinStroke && this.strokeCanvas) {
            const destCtx = this.scratchCtx ? this.scratchCtx : layer.ctx;
            if (this.scratchCtx) {
                this.scratchCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            }

            destCtx.save();
            if (this.scratchCtx) {
                destCtx.globalCompositeOperation = 'source-over';
                destCtx.globalAlpha = 1.0;
            } else {
                destCtx.globalCompositeOperation = this.strokeCompositeOperation;
                destCtx.globalAlpha = alpha;
            }
            destCtx.drawImage(this.strokeCanvas, 0, 0);
            destCtx.restore();
        }

        if (hasSel && this.scratchCanvas) {
            this.scratchCtx!.save();
            this.scratchCtx!.globalCompositeOperation = 'destination-in';
            this.scratchCtx!.drawImage(sel.mask!, 0, 0);
            this.scratchCtx!.restore();

            layer.ctx.save();
            layer.ctx.globalCompositeOperation = this.strokeCompositeOperation;
            layer.ctx.globalAlpha = alpha;
            layer.ctx.drawImage(this.scratchCanvas, 0, 0);
            layer.ctx.restore();
        }
    }

    // Secondary hooks for tools to override
    protected onStrokeStart(layer: Layer, startPos: { x: number; y: number }, e: PointerCompatibleEvent) {}
    protected onStrokeEnd(layer: Layer) {}
    protected abstract paintDab(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number, size: number): void;
}
