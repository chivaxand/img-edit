import { App, AppActions, ToolId } from '~/app';
import { UI } from '~/ui';
import { Lib } from '~/libs/index';

export const coreActions: Pick<AppActions, 
    'saveState' | 'undo' | 'resizeCanvas' | 'fitCanvasToLayers' | 
    'setTool' | 'setColor' | 'download' | 'setZoom' | 
    'stepZoom' | 'exportBase64' | 'closeImage' | 'openRevertHistoryDialog'
> = {
    saveState(label?: string) { App.history.push(App.state, label); },

    undo() {
        const h = App.history.pop();
        if (!h) return;
        App.state.width = h.w; App.state.height = h.h; App.state.layers = h.layers;
        if (!App.state.layers.find(l => l.id === App.state.activeLayerId)) App.state.activeLayerId = App.state.layers[0]?.id;
        
        // Restore selection state safely
        if (h.selection) {
            App.state.selection.active = h.selection.active;
            App.state.selection.layerId = h.selection.layerId;
            if (h.selection.mask) {
                App.state.selection.mask = h.selection.mask;
                App.state.selection.ctx = h.selection.mask.getContext('2d');
            } else {
                App.state.selection.mask = null;
                App.state.selection.ctx = null;
            }
            App.state.selection.outline = null; // Triggers rebuild on next render
        } else {
            App.state.selection.active = false;
            App.state.selection.mask = null;
            App.state.selection.ctx = null;
            App.state.selection.layerId = null;
            App.state.selection.outline = null;
        }

        App.actions.resizeCanvas(h.w, h.h);
        App.actions.setActiveLayer(App.state.activeLayerId!);
    },

    resizeCanvas(w: string | number | null, h: string | number | null) {
        if(w) App.state.width = typeof w === 'string' ? parseInt(w) : w;
        if(h) App.state.height = typeof h === 'string' ? parseInt(h) : h;
        App.els.canvas.width = App.state.width;
        App.els.canvas.height = App.state.height;
        if (App.els.overlay) { App.els.overlay.width = App.state.width; App.els.overlay.height = App.state.height; }
        App.emit('canvas:resize');
    },

    fitCanvasToLayers() {
        if (App.state.layers.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasLayers = false;

        App.state.layers.forEach(l => {
            hasLayers = true;
            const r = l.x + l.width;
            const b = l.y + l.height;
            if (l.x < minX) minX = l.x;
            if (l.y < minY) minY = l.y;
            if (r > maxX) maxX = r;
            if (b > maxY) maxY = b;
        });

        if (!hasLayers || minX === Infinity) return;
        App.actions.saveState();

        const newW = Math.max(1, Math.ceil(maxX - minX));
        const newH = Math.max(1, Math.ceil(maxY - minY));
        App.state.layers.forEach(l => { l.x -= minX; l.y -= minY; });
        App.actions.resizeCanvas(newW, newH);
        App.emit('layers:structure');
        App.emit('layer:props');
    },

    setTool(t: ToolId) {
        const oldTool = App.getTool();
        if (oldTool && oldTool.onDeselect) oldTool.onDeselect();
        App.state.tool = t;
        App.emit('tool:change');
    },

    setColor(type: string, val: string) {
        App.state[type] = val;
        document.getElementById(`${type}-wrap`)!.style.background = val;
        const l = App.utils.getActive();
        if(l && l.type === 'text' && type === 'fg') App.actions.updateLayer(l, {color: val});
        App.recordAction(`api.setColor('${type}', '${val}');`);
    },

    download() {
        App.render({ forExport: true });
        const now = new Date();
        const secondsVal = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const paddedSeconds = ("00000" + secondsVal).slice(-5);
        const link = document.createElement('a');
        link.download = `img-${paddedSeconds}.png`;
        link.href = App.els.canvas.toDataURL();
        link.click();
        App.render();
        App.recordAction("api.exportPNG();");
    },

    setZoom(level: string | number) {
        const z = Math.max(0.01, Math.min(20, typeof level === 'string' ? parseFloat(level) : level));
        App.state.zoom = z;
        App.emit('zoom:change');
    },

    stepZoom(dir: number) {
        const levels = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16];
        const curr = App.state.zoom;
        let next = curr;
        if (dir > 0) next = levels.find(l => l > curr + 0.001) || levels[levels.length - 1];
        else {
            for (let i = levels.length - 1; i >= 0; i--) {
                if (levels[i] < curr - 0.001) { next = levels[i]; break; }
            }
            if (next === curr) next = levels[0];
        }
        App.actions.setZoom(next);
    },

    exportBase64() {
        App.render({ forExport: true });
        const data = App.els.canvas.toDataURL();
        App.render();
        App.popup!.setHtml(`
            <h3>Base64 Export</h3>
            <textarea class="ui-textarea" rows="10">${data}</textarea>
            <div class="popup-actions"><button class="btn cancel-btn" onclick="App.popup.close()">Close</button></div>
        `);
        App.popup!.show();
    },

    closeImage() {
        if (!confirm("Are you sure you want to close the current image? Unsaved changes will be lost.")) return;

        // Reset history, layers, and selections
        App.history.stack = [];
        App.state.layers = [];
        App.state.activeLayerId = null;
        App.state.zoom = 1;

        App.state.selection.active = false;
        App.state.selection.mask = null;
        App.state.selection.ctx = null;
        App.state.selection.layerId = null;
        App.state.selection.outline = null;

        // Restore canvas framework to default size 800x600 and seed default empty layer
        App.actions.resizeCanvas(800, 600);
        const firstLayer = App.actions.createLayer("Layer 1");
        if (firstLayer) {
            App.state.layers = [firstLayer];
            App.actions.setActiveLayer(firstLayer.id);
        }
        App.actions.setTool('pointer');

        App.emit('layers:structure');
        App.emit('layer:props');
        App.render();
    },

    openRevertHistoryDialog() {
        if (App.history.stack.length === 0) {
            alert("No history states recorded yet.");
            return;
        }

        const stateOptions = App.history.stack.map((state, idx) => ({
            value: state.id,
            text: `${idx + 1}. ${state.label}`
        }));

        let selectedStateId = App.history.stack[App.history.stack.length - 1].id;

        const selectRow = UI.createSelectRow({
            label: 'Revert before', options: stateOptions, value: selectedStateId,
            onChange: (v: string) => { selectedStateId = parseInt(v, 10); }
        });

        let addCurrentActive = true;
        const addCurrentCheckbox = UI.createCheckbox({
            label: 'Add current active layer as a new layer after revert',
            value: addCurrentActive,
            onChange: (v: boolean) => { addCurrentActive = v; }
        });

        const layout = UI.createNode('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            UI.createHint('Revert the image to a selected history state.'),
            selectRow,
            addCurrentCheckbox,
            UI.createNode('div', { className: 'popup-actions' },
                UI.createButton({ label: 'Cancel', className: 'btn cancel-btn', onClick: () => App.popup!.close() }),
                UI.createButton({ label: 'Revert', onClick: () => {
                    const chosenState = App.history.stack.find(s => s.id === selectedStateId);
                    if (!chosenState) {
                        alert("Invalid history state selected.");
                        return;
                    }
                    App.popup!.close();

                    // Save state so the revert action itself is undoable
                    App.actions.saveState(`Revert to ${chosenState.label}`);

                    // Deep copy of the current active layer before reverting
                    const activeL = App.utils.getActive();
                    let clonedActiveLayer: any = null;
                    if (activeL) {
                        const canvasCopy = document.createElement('canvas');
                        canvasCopy.width = activeL.canvas.width;
                        canvasCopy.height = activeL.canvas.height;
                        canvasCopy.getContext('2d')!.drawImage(activeL.canvas, 0, 0);
                        
                        clonedActiveLayer = {
                            ...activeL,
                            id: Date.now() + Math.random(),
                            name: `${activeL.name} (Snapshot)`,
                            canvas: canvasCopy,
                            ctx: canvasCopy.getContext('2d')!
                        };
                    }

                    // Revert to chosenState
                    App.state.width = chosenState.w;
                    App.state.height = chosenState.h;
                    App.state.layers = chosenState.layers.map((l: any) => {
                        const c = document.createElement('canvas');
                        c.width = l.canvas.width;
                        c.height = l.canvas.height;
                        c.getContext('2d')!.drawImage(l.canvas, 0, 0);
                        return { ...l, canvas: c, ctx: c.getContext('2d')! };
                    });

                    // Restore selection state safely
                    if (chosenState.selection) {
                        App.state.selection.active = chosenState.selection.active;
                        App.state.selection.layerId = chosenState.selection.layerId;
                        if (chosenState.selection.mask) {
                            const maskCopy = document.createElement('canvas');
                            maskCopy.width = chosenState.selection.mask.width;
                            maskCopy.height = chosenState.selection.mask.height;
                            maskCopy.getContext('2d')!.drawImage(chosenState.selection.mask, 0, 0);
                            App.state.selection.mask = maskCopy;
                            App.state.selection.ctx = maskCopy.getContext('2d');
                        } else {
                            App.state.selection.mask = null;
                            App.state.selection.ctx = null;
                        }
                        App.state.selection.outline = null;
                    } else {
                        App.state.selection.active = false;
                        App.state.selection.mask = null;
                        App.state.selection.ctx = null;
                        App.state.selection.layerId = null;
                        App.state.selection.outline = null;
                    }

                    App.actions.resizeCanvas(chosenState.w, chosenState.h);

                    // Add current active layer copy back if checked
                    if (addCurrentActive && clonedActiveLayer) {
                        App.state.layers.unshift(clonedActiveLayer);
                        App.actions.setActiveLayer(clonedActiveLayer.id);
                    } else if (App.state.layers.length > 0) {
                        App.actions.setActiveLayer(App.state.layers[0].id);
                    }

                    App.emit('layers:structure');
                    App.emit('layer:props');
                    App.render();
                }})
            )
        );

        App.popup!.setHtml('<h3>Revert to History State</h3>');
        App.popup!.content.innerHTML = '';
        App.popup!.content.appendChild(layout);
        App.popup!.show();
    }
};
