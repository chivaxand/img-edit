import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

export const SelectionRectTool = {
    id: 'selectionRect' as const,
    icon: '⬚',
    title: 'Rectangle Select',
    isSelectionTool: true,
    sortOrder: 30,
    settings: { mode: 'new' },

    // State
    start: null as any,
    mode: 'new', // new, add, sub

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createRadioGroup({
            label: 'Mode',
            options: [
                { value: 'new', label: 'New' },
                { value: 'add', label: 'Add (+)' },
                { value: 'sub', label: 'Subtract (-)' }
            ],
            value: this.settings.mode,
            layout: 'row',
            onChange: (v: string) => {
                this.settings.mode = v;
            }
        }));
        panel.appendChild(UI.createHint('Drag to select. Shift=Add, Alt=Subtract. Ctrl+D to Deselect.'));
    },

    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l) return;

        App.state.isDrawing = true;
        this.start = App.utils.getPos(e);
        
        // Determine mode based on keys
        if (e.shiftKey) this.mode = 'add';
        else if (e.altKey) this.mode = 'sub';
        else this.mode = this.settings.mode || 'new';
    },

    onMouseMove(e: MouseEvent) {
        if (!App.state.isDrawing) return;
        App.render(); // Clear previous drag preview
        
        const pos = App.utils.getPos(e);
        const ctx = App.els.ctx;
        
        // Draw Selection Preview Box (Global Coords for visual feedback)
        const x = Math.min(this.start.x, pos.x);
        const y = Math.min(this.start.y, pos.y);
        const w = Math.abs(pos.x - this.start.x);
        const h = Math.abs(pos.y - this.start.y);

        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = '#000';
        ctx.lineDashOffset = 4;
        ctx.strokeRect(x, y, w, h);
        
        // Mode indicator
        const sym = this.mode === 'add' ? '+' : (this.mode === 'sub' ? '-' : '');
        if (sym) {
            ctx.fillStyle = '#fff'; ctx.font = '20px Arial';
            ctx.fillText(sym, pos.x + 10, pos.y + 20);
        }
        ctx.restore();
    },

    onMouseUp(e: MouseEvent) {
        if (!App.state.isDrawing) return;
        App.state.isDrawing = false;
        
        const l = App.utils.getActive();
        if (!l) return;

        const pos = App.utils.getPos(e);
        
        // Calculate Global Rect
        const gx = Math.min(this.start.x, pos.x);
        const gy = Math.min(this.start.y, pos.y);
        const gw = Math.abs(pos.x - this.start.x);
        const gh = Math.abs(pos.y - this.start.y);

        if (gw < 1 || gh < 1) {
            return;
        }

        App.actions.saveState();

        // Initialize mask if needed
        if (!App.state.selection.mask || App.state.selection.layerId !== l.id) {
            App.state.selection.layerId = l.id;
            App.state.selection.mask = document.createElement('canvas');
            App.state.selection.mask.width = l.canvas.width;
            App.state.selection.mask.height = l.canvas.height;
            App.state.selection.ctx = App.state.selection.mask.getContext('2d');
            App.state.selection.outline = null;
        }

        // Convert to Layer Local Coordinates
        const lx = App.utils.toLocal(l, gx, 'x');
        const ly = App.utils.toLocal(l, gy, 'y');
        // Scale width/height from Display to Canvas pixels
        const lw = gw * (l.canvas.width / l.width);
        const lh = gh * (l.canvas.height / l.height);

        const ctx = App.state.selection.ctx!;

        if (this.mode === 'new') {
            ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(lx, ly, lw, lh);
            App.state.selection.active = true;
        } else if (this.mode === 'add') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(lx, ly, lw, lh);
            App.state.selection.active = true;
        } else if (this.mode === 'sub') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(lx, ly, lw, lh);
            ctx.globalCompositeOperation = 'source-over';
        }

        // Clear outline cache to trigger rebuild
        App.state.selection.outline = null;

        App.render();
    }
};


declare global {
    interface ToolRegistry {
        selectionRect: typeof SelectionRectTool;
    }
}

App.registerTool(SelectionRectTool);