import { App, PointerCompatibleEvent } from '~/app';
import { UI } from '~/ui';
import { Lib } from '~/libs/index';
import { BaseBrushTool, createBrushCanvas, interpolateDabs, drawActiveBrushCircle } from './tools';

export class SelectionBrushToolClass extends BaseBrushTool {
    id = 'selectionBrush' as const;
    icon = '🖍️';
    title = 'Selection Brush';
    isSelectionTool = true;
    sortOrder = 60;
    requiresEditableLayer = false;
    settings = { size: 30, hardness: 100, mode: 'add', spacing: 1 };

    protected accumulateWithinStroke = true;
    protected useFixedOnePixelSpacing = true;
    protected activeDrawMode: 'add' | 'sub' = 'add';

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 200, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createRadioGroup({
            label: 'Mode',
            options: [
                { value: 'add', label: 'Add (+)' },
                { value: 'sub', label: 'Subtract (-)' }
            ],
            value: this.settings.mode,
            layout: 'row',
            onChange: (v: string) => {
                this.settings.mode = v;
            }
        }));
        panel.appendChild(UI.createHint('Paint to adjust selection. Alt/Right-Click draws in Subtract mode. Ctrl+Scroll changes brush size.'));
    }

    onDeselect() {}

    onContextMenu(e: PointerCompatibleEvent) {}

    onMouseDown(e: PointerCompatibleEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;

        // Force initialize selection mask on context layer if not exists
        if (!App.state.selection.mask || App.state.selection.layerId !== l.id) {
            App.state.selection.layerId = l.id;
            const { canvas: mask, ctx: mCtx } = Lib.canvas.create(l.canvas.width, l.canvas.height);
            App.state.selection.mask = mask;
            App.state.selection.ctx = mCtx;
            App.state.selection.outline = null;
        }

        this.activeDrawMode = (e.button === 2 || e.altKey || this.settings.mode === 'sub') ? 'sub' : 'add';

        super.onMouseDown(e);

        App.state.selection.active = true;
        App.state.selection.outline = null;
    }

    protected onStrokeStart() {
        this.brushCanvas = createBrushCanvas(this.settings.size, this.settings.hardness, '#ffffff');
    }

    protected stampDabs(layer: any, p1: any, p2: any, isInitial: any) {
        // Selection brush writes directly to the global selection canvas context
        const maskCanvas = App.state.selection.mask!;
        const targetCtx = App.state.selection.ctx!;
        const size = this.settings.size;
        const r = size / 2;

        const stampAt = (px: number, py: number) => {
            targetCtx.save();
            targetCtx.globalCompositeOperation = this.activeDrawMode === 'sub' ? 'destination-out' : 'source-over';
            targetCtx.globalAlpha = 1.0;
            if (this.brushCanvas) {
                targetCtx.drawImage(this.brushCanvas, Math.round(px - r), Math.round(py - r));
            }
            targetCtx.restore();
        };

        if (isInitial) {
            stampAt(p1.x, p1.y);
        } else {
            this.distanceAccumulator = interpolateDabs(p1, p2, this.distanceAccumulator, 1, stampAt);
        }

        App.state.selection.outline = null;
    }

    protected paintDab() {} // Stamping override is handled completely in stampDabs

    drawUI() {
        drawActiveBrushCircle(this.settings.size, { dashed: true });
    }
}

export const SelectionBrushTool = new SelectionBrushToolClass();

declare global {
    interface ToolRegistry {
        selectionBrush: typeof SelectionBrushTool;
    }
}

App.registerTool(SelectionBrushTool);
