import { App } from '~/app';
import { UI } from '~/ui';
import { performFloodFill } from './bucket'

export const WandTool = {
    id: 'wand' as const,
    icon: '🪄',
    title: 'Magic Wand (W)',
    isSelectionTool: true,
    sortOrder: 50,
    settings: { tolerance: 32, contiguous: true, smoothSelect: false },

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Tolerance', min: 0, max: 255, value: this.settings.tolerance, onInput: (v: string) => this.settings.tolerance = parseInt(v) }));
        panel.appendChild(UI.createCheckbox({ label: 'Contiguous', value: this.settings.contiguous, onChange: (v: boolean) => this.settings.contiguous = v }));
        panel.appendChild(UI.createCheckbox({ label: 'Smooth', value: this.settings.smoothSelect, onChange: (v: boolean) => this.settings.smoothSelect = v }));
        panel.appendChild(UI.createHint('Click to select area.'));
    },

    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        
        const pos = App.utils.getPos(e);
        const mask = performFloodFill(l, pos.x, pos.y, {
            tolerance: this.settings.tolerance,
            contiguous: this.settings.contiguous,
            smooth: this.settings.smoothSelect,
            isSelection: true
        });
        
        if (mask) {
            App.state.selection.layerId = l.id;
            App.state.selection.mask = mask;
            App.state.selection.ctx = mask.getContext('2d', { willReadFrequently: true });
            App.state.selection.active = true;
            App.recordAction(`api.magicWandSelect(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${this.settings.tolerance}, ${this.settings.contiguous}, ${this.settings.smoothSelect});`);
            App.render();
        }
    }
};


declare global {
    interface ToolRegistry {
        wand: typeof WandTool;
    }
}

App.registerTool(WandTool);