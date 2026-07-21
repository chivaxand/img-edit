import { App } from '~/app';
import { UI } from '~/ui';

export const MoveTool = {
    id: 'move' as const,
    icon: '✥',
    title: 'Move',
    requiresEditableLayer: false,
    sortOrder: 2,
    
    onSelect: (panel: HTMLElement) => {
        panel.appendChild(UI.createHint('Click and drag to move layer. Hold Ctrl to move selection.'));
    },

    onMouseDown: (e: MouseEvent) => {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        App.actions.saveState();
        App.state.isDrawing = true;
        const pos = App.utils.getPos(e);
        App.state.movingSelection = (e.ctrlKey || e.metaKey) && App.state.selection.active && App.state.selection.mask !== null;
        if (App.state.movingSelection) {
            App.state.lastMovePos = { x: pos.x, y: pos.y };
        } else {
            App.state.dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
        }
    },

    onMouseMove: (e: MouseEvent) => {
        if (!App.state.isDrawing) return;
        const l = App.utils.getActive();
        if (!l) return;
        const pos = App.utils.getPos(e);
        if (App.state.movingSelection) {
            const dx = pos.x - App.state.lastMovePos.x;
            const dy = pos.y - App.state.lastMovePos.y;
            const ldx = dx * (l.canvas.width / l.width);
            const ldy = dy * (l.canvas.height / l.height);
            const idx = Math.round(ldx);
            const idy = Math.round(ldy);
            if (idx !== 0 || idy !== 0) {
                const sel = App.state.selection;
                const temp = document.createElement('canvas');
                temp.width = sel.mask!.width;
                temp.height = sel.mask!.height;
                const tempCtx = temp.getContext('2d')!;
                tempCtx.drawImage(sel.mask!, idx, idy);
                const mCtx = sel.ctx || sel.mask!.getContext('2d')!;
                mCtx.clearRect(0, 0, sel.mask!.width, sel.mask!.height);
                mCtx.drawImage(temp, 0, 0);
                sel.outline = null;
                App.state.lastMovePos.x += idx * (l.width / l.canvas.width);
                App.state.lastMovePos.y += idy * (l.height / l.canvas.height);
            }
            App.render();
        } else {
            l.x = Math.round(pos.x - App.state.dragOffset.x); 
            l.y = Math.round(pos.y - App.state.dragOffset.y);
            App.emit('layer:props');
        }
    },

    onMouseUp: () => { 
        App.state.isDrawing = false; 
        App.state.movingSelection = false;
    }
};

declare global {
    interface ToolRegistry {
        move: typeof MoveTool;
    }
}

App.registerTool(MoveTool);
