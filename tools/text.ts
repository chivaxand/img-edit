import { App } from '~/app';
import { UI } from '~/ui';
import { Layer, Layers } from '~/layers';

App.registerTool({
    id: 'text',
    icon: 'T',
    title: 'Text',
    settings: { fontSize: 24, font: 'Arial', text: 'Text' },
    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createHint('Click canvas to add text.'));
        
        // Reuse UI logic from Layer definition
        const def = Layers.get('text');
        if (def && def.buildUI) {
            def.buildUI(panel, this.settings, (k: string, v: any) => this.settings[k] = v);
        }
    },
    onMouseDown(e: MouseEvent) {
        const pos = App.utils.getPos(e);
        App.actions.addTextLayer(pos.x, pos.y, this.settings);
    }
});
