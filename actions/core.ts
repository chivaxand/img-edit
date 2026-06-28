import { App, AppActions } from '~/app';

export const coreActions: Pick<AppActions, 
    'saveState' | 'undo' | 'resizeCanvas' | 'fitCanvasToLayers' | 
    'setTool' | 'setColor' | 'download' | 'deselect' | 'setZoom' | 
    'stepZoom' | 'exportBase64' | 'deleteSelection' | 'updateSelectionOutline'
> = {
    saveState() { App.history.push(App.state); },

    undo() {
        const h = App.history.pop();
        if (!h) return;
        App.state.width = h.w; App.state.height = h.h; App.state.layers = h.layers;
        if (!App.state.layers.find(l => l.id === App.state.activeLayerId)) App.state.activeLayerId = App.state.layers[0]?.id;
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

    setTool(t: string) {
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

    deselect() {
        App.state.selection.active = false;
        App.state.selection.mask = null;
        App.state.selection.ctx = null;
        App.state.selection.layerId = null;
        App.state.selection.outline = null;
        App.recordAction("api.selectNone();");
        App.render();
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
            <textarea rows="10">${data}</textarea>
            <button onclick="App.popup.close()">Close</button>
        `);
        App.popup!.show();
    },

    deleteSelection() {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) return;
        const l = App.utils.getActive();
        if (!l || !l.visible || l.id !== sel.layerId) return;
        if (l.type === 'text') { alert('Rasterize text layer to delete selection.'); return; }
        App.actions.saveState();
        l.ctx.save();
        l.ctx.globalCompositeOperation = 'destination-out';
        l.ctx.drawImage(sel.mask, 0, 0);
        l.ctx.restore();
        sel.outline = null;
        App.emit('layer:content');
    },

    updateSelectionOutline() {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) return;
        const l = App.state.layers.find(x => x.id === sel.layerId);
        if (!l) return;
        const w = sel.mask.width;
        const h = sel.mask.height;
        const outlineCanvas = document.createElement('canvas');
        outlineCanvas.width = w;
        outlineCanvas.height = h;
        const oCtx = outlineCanvas.getContext('2d')!;
        const maskCtx = sel.mask.getContext('2d')!;
        const imgData = maskCtx.getImageData(0, 0, w, h);
        const src = imgData.data;
        const dstImgData = oCtx.createImageData(w, h);
        const dst = dstImgData.data;
        const threshold = 128;
        const isSelected = (x: number, y: number): boolean => {
            if (x < 0 || x >= w || y < 0 || y >= h) return false;
            return src[((y * w) + x) * 4 + 3] >= threshold;
        };

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (isSelected(x, y)) {
                    const isEdge = !isSelected(x - 1, y) || !isSelected(x + 1, y) || !isSelected(x, y - 1) || !isSelected(x, y + 1);
                    if (isEdge) {
                        const idx = (y * w + x) * 4;
                        dst[idx] = 255;
                        dst[idx + 1] = 255;
                        dst[idx + 2] = 255;
                        dst[idx + 3] = 255;
                    }
                }
            }
        }

        oCtx.putImageData(dstImgData, 0, 0);
        sel.outline = outlineCanvas;
    }
};