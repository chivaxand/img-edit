import { App, AppActions } from '~/app';
import { UI } from '~/ui';
import { Lib } from '~/libs/index';
import { Layer } from '~/layers';

export const selectionActions: Pick<AppActions,
    'deselect' | 'selectAll' | 'deleteSelection' | 'inverseSelection' | 'updateSelectionOutline' |
    'saveSelection' | 'loadSelection' | 'openSaveSelectionDialog' | 'openLoadSelectionDialog'
> = {
    deselect() {
        if (App.state.selection.active) {
            App.actions.saveState("Deselect");
        }
        App.state.selection.active = false;
        App.state.selection.mask = null;
        App.state.selection.ctx = null;
        App.state.selection.layerId = null;
        App.state.selection.outline = null;
        App.recordAction("api.selectNone();");
        App.render();
    },

    selectAll() {
        const l = App.utils.getActive();
        if (!l) return;
        App.actions.saveState("Select All");

        if (!App.state.selection.mask || App.state.selection.layerId !== l.id) {
            App.state.selection.layerId = l.id;
            const { canvas: mask, ctx: mCtx } = Lib.canvas.create(l.canvas.width, l.canvas.height);
            App.state.selection.mask = mask;
            App.state.selection.ctx = mCtx;
            App.state.selection.outline = null;
        }

        const mCtx = App.state.selection.ctx!;
        const imgData = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
        const data = imgData.data;
        const maskData = mCtx.createImageData(l.canvas.width, l.canvas.height);
        const mData = maskData.data;

        // Copy alpha channel values directly to select layer content boundary
        for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            mData[i] = 255;
            mData[i + 1] = 255;
            mData[i + 2] = 255;
            mData[i + 3] = a;
        }

        mCtx.putImageData(maskData, 0, 0);

        App.state.selection.active = true;
        App.state.selection.outline = null;
        App.actions.updateSelectionOutline();
        App.recordAction("api.selectAll();");
        App.render();
    },

    deleteSelection() {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) return;
        const l = App.utils.getActive();
        if (!l || !l.visible || l.id !== sel.layerId) return;
        if (l.type === 'text') { alert('Rasterize text layer to delete selection.'); return; }
        App.actions.saveState("Delete Selection");
        l.ctx.save();
        l.ctx.globalCompositeOperation = 'destination-out';
        l.ctx.drawImage(sel.mask, 0, 0);
        l.ctx.restore();
        sel.outline = null;
        App.recordAction("api.deleteSelection();");
        App.emit('layer:content');
    },

    inverseSelection() {
        App.actions.saveState("Inverse Selection");
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
        const { canvas: outlineCanvas, ctx: oCtx } = Lib.canvas.create(w, h);
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
            const { canvas: c, ctx } = Lib.canvas.create(l.canvas.width, l.canvas.height);
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
            const { canvas: c, ctx: cCtx } = Lib.canvas.create(sel.mask.width, sel.mask.height);
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

    loadSelection(layerIndex: number = 0, mode: 'auto' | 'alpha' | 'grayscale' = 'auto', inverse: boolean = false, targetLayer?: Layer) {
        const layer = App.state.layers[layerIndex];
        if (!layer) return;

        App.actions.saveState("Load Selection");

        const { canvas: maskCanvas, ctx: mCtx } = Lib.canvas.create(layer.canvas.width, layer.canvas.height);
        const imgData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        const data = imgData.data;
        const maskData = mCtx.createImageData(layer.canvas.width, layer.canvas.height);
        const mData = maskData.data;

        let resolvedMode: 'alpha' | 'grayscale' = 'alpha';
        if (mode === 'auto') {
            let hasTransparency = false;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] < 255) {
                    hasTransparency = true;
                    break;
                }
            }
            resolvedMode = hasTransparency ? 'alpha' : 'grayscale';
        } else {
            resolvedMode = mode;
        }

        if (resolvedMode === 'alpha') {
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

        let finalMask = maskCanvas;
        let finalCtx = mCtx;
        let selectionLayerId = layer.id;

        // Map the source mask to target layer space taking relative shift and size into account
        if (targetLayer && targetLayer.id !== layer.id) {
            const { canvas: targetMaskCanvas, ctx: targetMCtx } = Lib.canvas.create(targetLayer.canvas.width, targetLayer.canvas.height);
            const destX = (layer.x - targetLayer.x) * (targetLayer.canvas.width / targetLayer.width);
            const destY = (layer.y - targetLayer.y) * (targetLayer.canvas.height / targetLayer.height);
            const destW = layer.width * (targetLayer.canvas.width / targetLayer.width);
            const destH = layer.height * (targetLayer.canvas.height / targetLayer.height);
            targetMCtx.drawImage(maskCanvas, destX, destY, destW, destH);
            finalMask = targetMaskCanvas;
            finalCtx = targetMCtx;
            selectionLayerId = targetLayer.id;
        }

        App.state.selection.active = true;
        App.state.selection.mask = finalMask;
        App.state.selection.ctx = finalCtx;
        App.state.selection.layerId = selectionLayerId;
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
        let selectedMode: 'auto' | 'alpha' | 'grayscale' = 'auto';

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
                { value: 'auto', label: 'Auto (Detect)' },
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
