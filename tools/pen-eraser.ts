import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { BaseBrushTool, createBrushCanvas } from './tools';

// Pen Tool
export class PenToolClass extends BaseBrushTool {
    id = 'pen' as const;
    icon = '✎';
    title = 'Pen';
    sortOrder = 90;
    settings = { size: 5, hardness: 100, alpha: 1.0, spacing: 10 };
    protected accumulateWithinStroke = true;
    protected useFixedOnePixelSpacing = false;

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 100, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Alpha', min: 1, max: 100, value: Math.round(this.settings.alpha * 100), onInput: (v: string) => this.settings.alpha = parseInt(v) / 100 }));
        panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 100, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
        panel.appendChild(UI.createCheckbox({
            label: 'Accumulate Ink',
            value: this.accumulateWithinStroke,
            onChange: (v: boolean) => this.accumulateWithinStroke = v
        }));
    }

    protected onStrokeStart(layer: Layer, startPos: { x: number; y: number }) {
        const color = App.state.fg;
        this.brushCanvas = createBrushCanvas(this.settings.size, this.settings.hardness, color);
    }

    protected paintDab(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number) {
        if (this.brushCanvas) {
            ctx.drawImage(this.brushCanvas, Math.round(sx), Math.round(sy));
        }
    }
}

// Eraser Tool
export class EraserToolClass extends BaseBrushTool {
    id = 'eraser' as const;
    icon = '⌫';
    title = 'Eraser';
    sortOrder = 91;
    settings = { size: 30, hardness: 100, alpha: 1.0, spacing: 10 };
    protected accumulateWithinStroke = false;
    protected strokeCompositeOperation: GlobalCompositeOperation = 'destination-out';

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 100, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Alpha', min: 1, max: 100, value: Math.round(this.settings.alpha * 100), onInput: (v: string) => this.settings.alpha = parseInt(v) / 100 }));
        panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 100, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
    }

    protected onStrokeStart(layer: Layer, startPos: { x: number; y: number }) {
        const color = '#000000';
        this.brushCanvas = createBrushCanvas(this.settings.size, this.settings.hardness, color);
    }

    protected paintDab(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number) {
        if (this.brushCanvas) {
            ctx.drawImage(this.brushCanvas, Math.round(sx), Math.round(sy));
        }
    }
}

export const PenTool = new PenToolClass();
export const EraserTool = new EraserToolClass();

declare global {
    interface ToolRegistry {
        pen: typeof PenTool;
        eraser: typeof EraserTool;
    }
}

App.registerTool(PenTool);
App.registerTool(EraserTool);
