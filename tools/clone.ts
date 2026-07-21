import { App, PointerCompatibleEvent } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { BaseBrushTool, drawBrushCircle, createBrushCanvas } from './tools';

export class CloneToolClass extends BaseBrushTool {
    id = 'clone' as const;
    icon = '⧉';
    title = 'Clone Stamp';
    sortOrder = 100;
    settings = { size: 40, hardness: 50, spacing: 10, alignment: 'none', alpha: 1.0 };
    protected accumulateWithinStroke = false;

    protected sourceAnchor: { x: number, y: number, layer: Layer } | null = null;
    protected offset: { dx: number, dy: number } | null = null;
    protected tempCanvas: HTMLCanvasElement | null = null;

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createHint('Alt+Click to set source. Draw to copy pixels.'));
        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 200, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 200, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Alpha', min: 1, max: 100, value: Math.round(this.settings.alpha * 100), onInput: (v: string) => this.settings.alpha = parseInt(v) / 100 }));
        panel.appendChild(UI.createSelectRow({
            label: 'Align',
            value: this.settings.alignment,
            options: [
                { value: 'aligned', text: 'Aligned' },
                { value: 'none', text: 'None' }
            ],
            onChange: (v: string) => this.settings.alignment = v
        }));
    }

    onMouseDown(e: PointerCompatibleEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;

        const pos = App.utils.getPos(e);
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        // Capture Source point
        if (e.altKey) {
            this.sourceAnchor = { x: lx, y: ly, layer: l };
            this.offset = null; 
            App.render();
            return;
        }

        if (!this.sourceAnchor) {
            alert('Alt+Click to set a source point first.');
            return;
        }

        // Align offset logic
        if (this.settings.alignment === 'none' || !this.offset) {
            this.offset = {
                dx: lx - this.sourceAnchor.x,
                dy: ly - this.sourceAnchor.y
            };
        }

        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = this.settings.size;
        this.tempCanvas.height = this.settings.size;

        super.onMouseDown(e);
    }

    protected onStrokeEnd() {
        this.tempCanvas = null;
    }

    protected paintDab(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number, size: number) {
        if (!this.offset || !this.sourceAnchor || !this.tempCanvas || !this.brushCanvas) return;

        const sourceX = cx - this.offset.dx;
        const sourceY = cy - this.offset.dy;
        const r = size / 2;

        const tCtx = this.tempCanvas.getContext('2d', { willReadFrequently: true })!;
        tCtx.clearRect(0, 0, size, size);

        // 1. Draw source
        tCtx.drawImage(
            this.sourceAnchor.layer.canvas, 
            Math.round(sourceX - r), Math.round(sourceY - r), size, size, 
            0, 0, size, size
        );

        // 2. Composite with brush mask hardness profile
        tCtx.globalCompositeOperation = 'destination-in';
        tCtx.drawImage(this.brushCanvas, 0, 0);
        tCtx.globalCompositeOperation = 'source-over';

        // 3. Stamp to canvas
        ctx.drawImage(this.tempCanvas, Math.round(sx), Math.round(sy));
    }

    drawUI() {
        if (this.sourceAnchor) {
            const ctx = App.els.ctx;
            const l = this.sourceAnchor.layer;
            if (l.visible) {
                let lx = this.sourceAnchor.x;
                let ly = this.sourceAnchor.y;
                
                if (this.offset && App.state.isDrawing) {
                    lx = App.state.last.x - this.offset.dx;
                    ly = App.state.last.y - this.offset.dy;
                }

                const gx = lx * (l.width / l.canvas.width) + l.x;
                const gy = ly * (l.height / l.canvas.height) + l.y;

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(gx - 6, gy);
                ctx.lineTo(gx + 6, gy);
                ctx.moveTo(gx, gy - 6);
                ctx.lineTo(gx, gy + 6);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                if (lx === this.sourceAnchor.x && ly === this.sourceAnchor.y) {
                    ctx.beginPath();
                    ctx.arc(gx, gy, this.settings.size / 2 * (l.width / l.canvas.width), 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                    ctx.setLineDash([4, 4]);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }
        super.drawUI();
    }
}

export const CloneTool = new CloneToolClass();

declare global {
    interface ToolRegistry {
        clone: typeof CloneTool;
    }
}

App.registerTool(CloneTool);
