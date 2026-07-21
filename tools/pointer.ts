import { App } from '~/app';
import { UI } from '~/ui';

export const PointerTool = {
    id: 'pointer' as const,
    icon: '↖',
    title: 'Pointer',
    requiresEditableLayer: false,
    sortOrder: 1,

    onSelect: (panel: HTMLElement) => {
        panel.appendChild(UI.createHint('Pointer tool. Safe mode, does not modify any layers or selections.'));
    }
};

declare global {
    interface ToolRegistry {
        pointer: typeof PointerTool;
    }
}

App.registerTool(PointerTool);