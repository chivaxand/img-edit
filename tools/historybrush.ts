import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { BaseBrushTool, createBrushCanvas } from './tools';

export class HistoryBrushToolClass extends BaseBrushTool {
    id = 'historybrush' as const;
    icon = '⏳';
    title = 'History Brush';
    sortOrder = 195;
    settings = { size: 30, hardness: 50, alpha: 1.0, spacing: 10, sourceStateId: null as number | null };
    protected accumulateWithinStroke = true;

    protected sourceCanvas: HTMLCanvasElement | null = null;

    protected getSourceState() {
        if (App.history.stack.length === 0) return null;
        let state = App.history.stack.find(s => s.id === this.settings.sourceStateId);
        if (!state) {
            state = App.history.stack[0];
            this.settings.sourceStateId = state.id;
        }
        return state;
    }

    onSelect(panel: HTMLElement) {
        const stateOptions = App.history.stack.map((state, idx) => ({
            value: state.id,
            text: `${idx + 1}. ${state.label}`
        }));
        if (stateOptions.length === 0) {
            stateOptions.push({ value: -1, text: 'No History States' });
        }

        panel.appendChild(UI.createSelectRow({
            label: 'Source State',
            value: this.settings.sourceStateId ?? (App.history.stack[0]?.id ?? -1),
            options: stateOptions,
            onChange: (v: string) => {
                const id = parseInt(v);
                this.settings.sourceStateId = id === -1 ? null : id;
                App.ui.updateToolSettings();
            }
        }));

        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 150, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Opacity', min: 1, max: 100, value: Math.round(this.settings.alpha * 100), onInput: (v: string) => this.settings.alpha = parseInt(v) / 100 }));
        panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 100, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
    }

    protected onStrokeStart(layer: Layer) {
        this.brushCanvas = createBrushCanvas(this.settings.size, this.settings.hardness);
        
        const sourceState = this.getSourceState();
        if (!sourceState) {
            this.sourceCanvas = null;
            return;
        }

        let srcLayer = sourceState.layers.find((l: any) => l.id === layer.id);
        if (!srcLayer) {
            const activeIdx = App.state.layers.indexOf(layer);
            if (activeIdx >= 0 && activeIdx < sourceState.layers.length) {
                srcLayer = sourceState.layers[activeIdx];
            } else {
                srcLayer = sourceState.layers[0];
            }
        }

        this.sourceCanvas = srcLayer ? srcLayer.canvas : null;
    }

    protected onStrokeEnd() {
        this.sourceCanvas = null;
    }

    protected paintDab(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number, size: number) {
        if (!this.sourceCanvas) return;
        const sourceImg = this.sourceCanvas;

        const srcPiece = document.createElement('canvas');
        srcPiece.width = size;
        srcPiece.height = size;
        const sCtx = srcPiece.getContext('2d')!;
        sCtx.drawImage(sourceImg, Math.round(sx), Math.round(sy), size, size, 0, 0, size, size);

        const maskPiece = document.createElement('canvas');
        maskPiece.width = size;
        maskPiece.height = size;
        const mCtx = maskPiece.getContext('2d')!;
        mCtx.drawImage(srcPiece, 0, 0);
        mCtx.globalCompositeOperation = 'destination-in';
        mCtx.drawImage(this.brushCanvas!, 0, 0);

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(maskPiece, Math.round(sx), Math.round(sy));
        ctx.restore();
    }
}

export const HistoryBrushTool = new HistoryBrushToolClass();

declare global {
    interface ToolRegistry {
        historybrush: typeof HistoryBrushTool;
    }
}

App.registerTool(HistoryBrushTool);