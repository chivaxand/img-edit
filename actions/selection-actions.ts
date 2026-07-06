import { App, AppActions } from '~/app';
import { UI } from '~/ui';

export const selectionActions: Pick<AppActions,
    'deselect' | 'deleteSelection' | 'inverseSelection' | 'updateSelectionOutline' |
    'saveSelection' | 'loadSelection' | 'openSaveSelectionDialog' | 'openLoadSelectionDialog'
> = {
    deselect() {
        App.state.selection.active = false;
        App.state.selection.mask = null;
        App.state.selection.ctx = null;
        App.state.selection.layerId = null;
        App.state.selection.outline = null;
        App.recordAction("api.selectNone();");
        App.render();
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
        App.recordAction("api.deleteSelection();");
        App.emit('layer:content');
    },

    inverseSelection() {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) {
            const l = App.utils.getActive();
            if (!l) return;
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = l.canvas.width;
            maskCanvas.height = l.canvas.height;
            const mCtx = maskCanvas.getContext('2d')!;
            mCtx.fillStyle = 'rgba(255, 255, 255, 255)';
            mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
            sel.active = true;
            sel.mask = maskCanvas;
            sel.ctx = mCtx;
            sel.layerId = l.id;
            sel.outline = null;
            App.actions.updateSelectionOutline();
            App.recordAction("api.inverseSelection();");
            App.render();
            return;
        }

        const w = sel.mask.width;
        const h = sel.mask.height;
        const maskCtx = sel.mask.getContext('2d')!;
        const imgData = maskCtx.getImageData(0, 0, w, h);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            data[i + 3] = 255 - data[i + 3];
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
        }

        maskCtx.putImageData(imgData, 0, 0);
        sel.outline = null;
        App.actions.updateSelectionOutline();
        App.recordAction("api.inverseSelection();");
        App.render();
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
    },

    saveSelection(mode: 'content' | 'mask' = 'content', inverse: boolean = false) {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) {
            alert("No active selection to save.");
            return;
        }
        const selLayer = App.state.layers.find(x => x.id === sel.layerId);
        const activeLayer = App.utils.getActive();

        if (mode === 'content') {
            const l = activeLayer || selLayer;
            if (!l) return;
            App.actions.saveState();
            const c = document.createElement('canvas');
            c.width = l.canvas.width;
            c.height = l.canvas.height;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(l.canvas, 0, 0);
            ctx.globalCompositeOperation = inverse ? 'destination-out' : 'destination-in';
            
            const offX = selLayer ? (selLayer.x - l.x) : 0;
            const offY = selLayer ? (selLayer.y - l.y) : 0;
            ctx.drawImage(sel.mask, offX, offY);

            const newLayer = App.actions.createLayer(`${l.name} Selection`, c);
            if (newLayer) {
                newLayer.x = l.x;
                newLayer.y = l.y;
                App.actions.addLayer(newLayer);
                App.recordAction(`api.saveSelection('${mode}', ${inverse});`);
            }
        } else {
            App.actions.saveState();
            const c = document.createElement('canvas');
            c.width = sel.mask.width;
            c.height = sel.mask.height;
            const cCtx = c.getContext('2d')!;
            const maskCtx = sel.mask.getContext('2d')!;
            const maskData = maskCtx.getImageData(0, 0, sel.mask.width, sel.mask.height).data;
            const outImgData = cCtx.createImageData(sel.mask.width, sel.mask.height);
            const dst = outImgData.data;

            for (let i = 0; i < maskData.length; i += 4) {
                const val = maskData[i + 3];
                const finalVal = inverse ? (255 - val) : val;
                dst[i] = finalVal;
                dst[i + 1] = finalVal;
                dst[i + 2] = finalVal;
                dst[i + 3] = 255;
            }
            cCtx.putImageData(outImgData, 0, 0);

            const newLayer = App.actions.createLayer('Selection Mask', c);
            if (newLayer) {
                newLayer.x = selLayer ? selLayer.x : 0;
                newLayer.y = selLayer ? selLayer.y : 0;
                App.actions.addLayer(newLayer);
                App.recordAction(`api.saveSelection('${mode}', ${inverse});`);
            }
        }
        App.render();
        App.ui.refreshLayers();
    },

    loadSelection(layerIndex: number = 0, mode: 'alpha' | 'grayscale' = 'alpha', inverse: boolean = false) {
        const layer = App.state.layers[layerIndex];
        if (!layer) return;

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = layer.canvas.width;
        maskCanvas.height = layer.canvas.height;
        const mCtx = maskCanvas.getContext('2d')!;
        const imgData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        const data = imgData.data;
        const maskData = mCtx.createImageData(layer.canvas.width, layer.canvas.height);
        const mData = maskData.data;

        if (mode === 'alpha') {
            for (let i = 0; i < data.length; i += 4) {
                const a = data[i + 3];
                mData[i] = 255;
                mData[i + 1] = 255;
                mData[i + 2] = 255;
                mData[i + 3] = inverse ? (255 - a) : a;
            }
        } else {
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                const lum = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * (a / 255));
                mData[i] = 255;
                mData[i + 1] = 255;
                mData[i + 2] = 255;
                mData[i + 3] = inverse ? (255 - lum) : lum;
            }
        }

        mCtx.putImageData(maskData, 0, 0);
        App.state.selection.active = true;
        App.state.selection.mask = maskCanvas;
        App.state.selection.ctx = mCtx;
        App.state.selection.layerId = layer.id;
        App.state.selection.outline = null;
        App.actions.updateSelectionOutline();
        App.recordAction(`api.loadSelection(${layerIndex}, '${mode}', ${inverse});`);
        App.render();
    },

    openSaveSelectionDialog() {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) {
            alert("No active selection to save.");
            return;
        }
        let mode: 'content' | 'mask' = 'content';
        const radioGroup = UI.createRadioGroup({
            label: 'Save Mode',
            options: [
                { value: 'content', label: 'Copy layer content' },
                { value: 'mask', label: 'Alpha mask (grayscale layer)' }
            ],
            value: mode,
            onChange: (v: any) => { mode = v; }
        });

        let inverse = false;
        const inverseCheckbox = UI.createCheckbox({
            label: 'Inverse Selection',
            value: inverse,
            onChange: (v: boolean) => { inverse = v; }
        });

        const layout = UI.createNode('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            UI.createHint('Convert current selection to a new layer.'),
            radioGroup,
            inverseCheckbox,
            UI.createNode('div', { className: 'popup-actions' },
                UI.createButton({ label: 'Cancel', className: 'btn cancel-btn', onClick: () => App.popup!.close() }),
                UI.createButton({ label: 'Save', onClick: () => {
                    App.popup!.close();
                    App.actions.saveSelection(mode, inverse);
                }})
            )
        );

        App.popup!.setHtml('<h3>Save Selection</h3>');
        App.popup!.content.innerHTML = '';
        App.popup!.content.appendChild(layout);
        App.popup!.show();
    },

    openLoadSelectionDialog() {
        if (App.state.layers.length === 0) {
            alert("No layers available to load selection from.");
            return;
        }

        const activeLayer = App.utils.getActive();
        let selectedLayerIndex = activeLayer ? App.state.layers.indexOf(activeLayer) : 0;
        if (selectedLayerIndex < 0) selectedLayerIndex = 0;
        let selectedMode: 'alpha' | 'grayscale' = 'alpha';

        const layerOptions = App.state.layers.map((l, idx) => ({
            value: idx,
            text: `${idx + 1}. ${l.name}`
        }));

        const selectRow = UI.createSelectRow({
            label: 'Source Layer',
            options: layerOptions,
            value: selectedLayerIndex,
            onChange: (v: string) => { selectedLayerIndex = parseInt(v, 10); }
        });

        const radioGroup = UI.createRadioGroup({
            label: 'Load Mode',
            options: [
                { value: 'alpha', label: 'Alpha Channel' },
                { value: 'grayscale', label: 'Grayscale Mask' }
            ],
            value: selectedMode,
            onChange: (v: any) => { selectedMode = v; }
        });

        let inverse = false;
        const inverseCheckbox = UI.createCheckbox({
            label: 'Inverse Selection',
            value: inverse,
            onChange: (v: boolean) => { inverse = v; }
        });

        const layout = UI.createNode('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            UI.createHint('Create a selection mask based on a layer.'),
            selectRow,
            radioGroup,
            inverseCheckbox,
            UI.createNode('div', { className: 'popup-actions' },
                UI.createButton({ label: 'Cancel', className: 'btn cancel-btn', onClick: () => App.popup!.close() }),
                UI.createButton({ label: 'Load', onClick: () => {
                    App.popup!.close();
                    App.actions.loadSelection(selectedLayerIndex, selectedMode, inverse);
                }})
            )
        );

        App.popup!.setHtml('<h3>Load Selection</h3>');
        App.popup!.content.innerHTML = '';
        App.popup!.content.appendChild(layout);
        App.popup!.show();
    }
};
