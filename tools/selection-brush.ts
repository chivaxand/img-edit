import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { createBrushCanvas, interpolateDabs, drawActiveBrushCircle } from './basics';

App.registerTool({
    id: 'select-brush',
    icon: '🖍️',
    title: 'Selection Brush',
    settings: { size: 30, hardness: 100, mode: 'add' },

    brushCanvas: null as HTMLCanvasElement | null,
    distanceAccumulator: 0,
    mousePos: null as { x: number, y: number } | null,
    activeDrawMode: 'add' as 'add' | 'sub',

    onSelect(panel: HTMLElement) {
        if (App.els.canvas) {
            App.els.canvas.oncontextmenu = (e: Event) => e.preventDefault();
        }
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
    },

    onDeselect() {
        this.mousePos = null;
        if (App.els.canvas) {
            App.els.canvas.oncontextmenu = null;
        }
    },

    onWheel(e: WheelEvent) {
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
    },

    onContextMenu(e: MouseEvent) {
        e.preventDefault();
    },

    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;

        App.actions.saveState();
        App.state.isDrawing = true;
        const pos = App.utils.getPos(e);

        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        App.state.last = { x: lx, y: ly };

        // Initialize selection mask if not present
        if (!App.state.selection.mask || App.state.selection.layerId !== l.id) {
            App.state.selection.layerId = l.id;
            App.state.selection.mask = document.createElement('canvas');
            App.state.selection.mask.width = l.canvas.width;
            App.state.selection.mask.height = l.canvas.height;
            App.state.selection.ctx = App.state.selection.mask.getContext('2d');
            App.state.selection.outline = null;
        }

        const size = this.settings.size;
        this.brushCanvas = createBrushCanvas(size, this.settings.hardness, '#ffffff');

        const spacingPx = 1;
        this.distanceAccumulator = spacingPx;
        
        // Determine mode: Right-click (button === 2), Alt key, or subtract mode setting
        this.activeDrawMode = (e.button === 2 || e.altKey || this.settings.mode === 'sub') ? 'sub' : 'add';

        this.stampDabs(App.state.selection.mask, App.state.selection.ctx!, App.state.last, App.state.last, true, this.activeDrawMode);
        
        App.state.selection.active = true;
        App.state.selection.outline = null;
        App.render();
    },

    onMouseMove(e: MouseEvent) {
        const pos = App.utils.getPos(e);
        this.mousePos = pos;

        if (!App.state.isDrawing) {
            App.render(); // Redraw overlay to update cursor position
            return;
        }

        const l = App.utils.getActive();
        if (!l) return;
        
        const curr = {
            x: App.utils.toLocal(l, pos.x, 'x'),
            y: App.utils.toLocal(l, pos.y, 'y')
        };

        this.stampDabs(App.state.selection.mask!, App.state.selection.ctx!, App.state.last, curr, false, this.activeDrawMode);

        App.state.last = curr;
        App.state.selection.outline = null;
        App.render();
    },

    onMouseUp() {
        App.state.isDrawing = false;
        this.brushCanvas = null;
        this.distanceAccumulator = 0;
    },

    stampDabs(maskCanvas: HTMLCanvasElement, targetCtx: CanvasRenderingContext2D, p1: {x: number, y: number}, p2: {x: number, y: number}, isInitial: boolean, mode: string) {
        const size = this.settings.size;
        const r = size / 2;
        const spacingPx = 1;

        const stampAt = (px: number, py: number) => {
            targetCtx.save();
            targetCtx.globalCompositeOperation = mode === 'sub' ? 'destination-out' : 'source-over';
            targetCtx.globalAlpha = 1.0;
            if (this.brushCanvas) {
                targetCtx.drawImage(this.brushCanvas, Math.round(px - r), Math.round(py - r));
            }
            targetCtx.restore();
        };

        if (isInitial) {
            stampAt(p1.x, p1.y);
        } else {
            this.distanceAccumulator = interpolateDabs(p1, p2, this.distanceAccumulator, spacingPx, stampAt);
        }
    },

    drawUI() {
        drawActiveBrushCircle(this.settings.size, { dashed: true });
    }
});
