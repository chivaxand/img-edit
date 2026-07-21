import { App } from '~/app';
import { UI } from '~/ui';

export const EyedropperTool = {
    id: 'eyedropper' as const,
    icon: '👁️‍🗨️',
    title: 'Eyedropper',
    sortOrder: 80,

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createHint('Left-click for FG, Right-click for BG color.'));
        if (App.els.canvas) App.els.canvas.oncontextmenu = (e: Event) => e.preventDefault();
    },

    onDeselect() {
        if (App.els.canvas) App.els.canvas.oncontextmenu = null;
    },
    
    onMouseDown(e: MouseEvent) {
        const pos = App.utils.getPos(e);
        const ctx = App.els.ctx; // Main display context
        const p = ctx.getImageData(pos.x, pos.y, 1, 1).data;
        const hex = App.utils.rgbToHex(p[0], p[1], p[2]);
        
        if (e.button === 2 || e.altKey) {
            App.actions.setColor('bg', hex);
        } else {
            App.actions.setColor('fg', hex);
        }
    }
};


declare global {
    interface ToolRegistry {
        eyedropper: typeof EyedropperTool;
    }
}

App.registerTool(EyedropperTool);