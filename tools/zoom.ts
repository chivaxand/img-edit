import { App } from '~/app';
import { UI } from '~/ui';

export const ZoomTool = {
    id: 'zoom' as const,
    icon: '🔍',
    title: 'Zoom',
    sortOrder: 200,
    requiresEditableLayer: false,
    onSelect: (panel: HTMLElement) => {
        const pct = Math.round(App.state.zoom * 100) + '%';
        panel.appendChild(UI.createRow('Level', UI.createNode('strong', {}, pct)));
        const row = UI.createNode('div', { style:'display:flex; gap:5px; margin-top:10px;' });
        row.appendChild(UI.createNode('button', { className:'btn', textContent:'-', on:{click:() => App.actions.stepZoom(-1)} }));
        row.appendChild(UI.createNode('button', { className:'btn', textContent:'100%', on:{click:() => App.actions.setZoom(1)} }));
        row.appendChild(UI.createNode('button', { className:'btn', textContent:'+', on:{click:() => App.actions.stepZoom(1)} }));
        panel.appendChild(row);
        panel.appendChild(UI.createHint('Right-click or Alt+Click to Zoom Out.', { style: 'margin-top:10px;' }));
        if (App.els.canvas) App.els.canvas.oncontextmenu = (e: Event) => e.preventDefault();
    },
    onDeselect: () => {
        if (App.els.canvas) App.els.canvas.oncontextmenu = null;
    },
    onMouseDown: (e: MouseEvent) => {
        const dir = (e.altKey || e.button === 2) ? -1 : 1;
        App.actions.stepZoom(dir);
    },
    onKeyDown: (e: KeyboardEvent) => {
        if (e.key === '=' || e.key === '+') { App.actions.stepZoom(1); return true; }
        if (e.key === '-') { App.actions.stepZoom(-1); return true; }
        if (e.key === '0' || e.key === '*') { App.actions.setZoom(1); return true; }
        return false;
    }
};

declare global {
    interface ToolRegistry {
        zoom: typeof ZoomTool;
    }
}

App.registerTool(ZoomTool);