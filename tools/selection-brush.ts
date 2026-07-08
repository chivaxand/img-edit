import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

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
        this.brushCanvas = document.createElement('canvas');
        this.brushCanvas.width = size;
        this.brushCanvas.height = size;
        const bCtx = this.brushCanvas.getContext('2d')!;
        const imgData = bCtx.createImageData(size, size);
        const data = imgData.data;
        const r = size / 2;
        const hLimit = this.settings.hardness / 100;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = (x + 0.5) - r;
                const dy = (y + 0.5) - r;
                const dist = Math.hypot(dx, dy);
                let normDist = dist / r;

                let alpha = 0;
                if (this.settings.hardness === 100) {
                    alpha = normDist <= 1.0 ? 1.0 : 0.0;
                } else {
                    if (normDist <= hLimit) {
                        alpha = 1.0;
                    } else if (normDist > 1.0) {
                        alpha = 0.0;
                    } else {
                        alpha = 1.0 - (normDist - hLimit) / (1.0 - hLimit);
                    }
                }

                const idx = (y * size + x) * 4;
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = Math.round(alpha * 255);
            }
        }
        bCtx.putImageData(imgData, 0, 0);

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
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (dist > 0) {
                const dx = (p2.x - p1.x) / dist;
                const dy = (p2.y - p1.y) / dist;

                let d = this.distanceAccumulator;
                while (d <= dist) {
                    stampAt(p1.x + dx * d, p1.y + dy * d);
                    d += spacingPx;
                }
                this.distanceAccumulator = d - dist;
            }
        }
    },

    drawUI() {
        if (!this.mousePos) return;
        const ctx = App.els.ctx;
        ctx.save();
        ctx.beginPath();
        const l = App.utils.getActive();
        let displayRadius = this.settings.size / 2;
        if (l) {
            displayRadius = (this.settings.size / 2) * (l.width / l.canvas.width);
        }
        ctx.arc(this.mousePos.x, this.mousePos.y, displayRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(this.mousePos.x, this.mousePos.y, displayRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
    }
});
