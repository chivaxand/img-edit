import { App } from '~/app';
import { UI } from '~/ui';
import { Layer, Layers } from '~/layers';

export const TextTool = {
    id: 'text' as const,
    icon: 'T',
    title: 'Text',
    sortOrder: 170,
    settings: { fontSize: 24, font: 'Arial', text: 'Text' },
    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createHint('Click canvas to add text.'));
        
        // Reuse UI logic from Layer definition
        const def = Layers.get('text');
        if (def && def.buildUI) {
            def.buildUI(panel, this.settings, (k: string, v: any) => (this.settings as any)[k] = v);
        }
    },
    onMouseDown(e: MouseEvent) {
        const pos = App.utils.getPos(e);
        App.actions.addTextLayer(pos.x, pos.y, this.settings);
    }
};


declare global {
    interface ToolRegistry {
        text: typeof TextTool;
    }
}

App.registerTool(TextTool);
