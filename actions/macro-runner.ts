import { App, AppActions } from '~/app';
import { UI } from '~/ui';
import { Filters } from '~/filters';
import { JpegExport } from './jpeg-export';
import { GifExport } from './gif-export';
import { SvgExport } from './svg-export';
import { Lib } from '~/libs/index';

export interface IScriptAPI {
    resizeCanvas(w: number, h: number): void;
    increaseCanvasSize(percent: number): void;
    addEmptyLayer(): void;
    duplicateActiveLayer(): void;
    deleteActiveLayer(): void;
    setActiveLayerIndex(index: number): void;
    setActiveLayerOpacity(op: number): void;
    setActiveLayerName(name: string): void;
    translateActiveLayer(dx: number, dy: number): void;
    mergeActiveLayerDown(): void;
    moveActiveLayer(dir: number): void;
    selectNone(): void;
    selectAll(): void;
    selectLayerAlpha(): void;
    deleteSelection(): void;
    inverseSelection(): void;
    saveSelection(mode?: 'content' | 'mask', inverse?: boolean): void;
    loadSelection(layerIndex?: number, mode?: 'alpha' | 'grayscale', inverse?: boolean): void;
    growSelection(px: number): void;
    fillSelection(colorHex: string): void;
    applyFilter(filterId: string, params?: Record<string, any>): void;
    setColor(type: string, val: string): void;
    floodFill(x: number, y: number, colorHex: string, tolerance: number, contiguous: boolean, smooth: boolean, cut?: boolean): void;
    magicWandSelect(x: number, y: number, tolerance: number, contiguous: boolean, smooth: boolean): void;
    crop(x: number, y: number, w: number, h: number): void;
    drawLine(sx: number, sy: number, ex: number, ey: number, strokeWidth: number, startCap: string, endCap: string, colorHex: string): void;
    drawShape(type: 'rect' | 'circle', sx: number, sy: number, ex: number, ey: number, strokeWidth: number, fill: boolean, useStroke: boolean, radius: number): void;
    exportPNG(): void;
    exportJPEG(quality: number, bgColor: string): void;
    exportGIF(loop: number, frames: Array<{ id: number; include: boolean; delay: number }>): void;
    exportSVG(settings: {
        width?: number;
        height?: number;
        unit?: 'mm' | 'cm' | 'in' | 'mil' | 'px';
        dpi?: number;
        keepRatio?: boolean;
        format?: 'image/png' | 'image/jpeg';
        quality?: number;
        bgColor?: string;
    }): void;
}

export const ScriptAPI: IScriptAPI = {
    // --- Canvas Dimensions ---
    resizeCanvas(w: number, h: number) {
        App.actions.resizeCanvas(w, h);
    },
    increaseCanvasSize(percent: number) {
        const wIncrease = Math.round(App.state.width * (percent / 100));
        const hIncrease = Math.round(App.state.height * (percent / 100));
        const newW = App.state.width + wIncrease;
        const newH = App.state.height + hIncrease;
        const dx = Math.round(wIncrease / 2);
        const dy = Math.round(hIncrease / 2);
        App.state.layers.forEach(l => { l.x += dx; l.y += dy; });
        App.actions.resizeCanvas(newW, newH);
        App.emit('layers:structure');
    },

    // --- Layer Operations ---
    addEmptyLayer() {
        App.actions.addEmptyLayer();
    },
    duplicateActiveLayer() {
        App.actions.duplicateLayer();
    },
    deleteActiveLayer() {
        App.actions.deleteLayer();
    },
    setActiveLayerIndex(index: number) {
        if (index >= 0 && index < App.state.layers.length) {
            App.actions.setActiveLayer(App.state.layers[index].id);
        }
    },
    setActiveLayerOpacity(op: number) {
        const l = App.utils.getActive();
        if (l) { 
            l.opacity = op > 1 ? op / 100 : op; 
            App.emit('layer:props'); 
        }
    },
    setActiveLayerName(name: string) {
        const l = App.utils.getActive();
        if (l) { 
            l.name = name; 
            App.emit('layers:structure'); 
        }
    },
    translateActiveLayer(dx: number, dy: number) {
        const l = App.utils.getActive();
        if (l) { 
            l.x += dx; 
            l.y += dy; 
            App.emit('layer:props'); 
        }
    },
    mergeActiveLayerDown() {
        App.actions.mergeLayerDown();
    },
    moveActiveLayer(dir: number) {
        App.actions.moveLayer(dir);
    },

    // --- Selection Operations ---
    selectNone() {
        App.actions.deselect();
    },
    selectAll() {
        App.actions.selectAll();
    },
    selectLayerAlpha() {
        const l = App.utils.getActive();
        if (!l) return;
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = l.canvas.width;
        maskCanvas.height = l.canvas.height;
        const mCtx = maskCanvas.getContext('2d')!;
        const imgData = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
        const data = imgData.data;
        const maskData = mCtx.createImageData(l.canvas.width, l.canvas.height);
        const mData = maskData.data;
        for (let i = 0; i < data.length; i += 4) {
            const a = data[i+3];
            if (a > 10) {
                mData[i] = 255; mData[i+1] = 255; mData[i+2] = 255; mData[i+3] = 255;
            } else {
                mData[i] = 0; mData[i+1] = 0; mData[i+2] = 0; mData[i+3] = 0;
            }
        }
        mCtx.putImageData(maskData, 0, 0);
        App.state.selection.active = true;
        App.state.selection.mask = maskCanvas;
        App.state.selection.ctx = mCtx;
        App.state.selection.layerId = l.id;
        App.state.selection.outline = null;
        App.actions.updateSelectionOutline();
        App.render();
    },
    deleteSelection() {
        App.actions.deleteSelection();
    },
    inverseSelection() {
        App.actions.inverseSelection();
    },
    saveSelection(mode: 'content' | 'mask' = 'content', inverse: boolean = false) {
        App.actions.saveSelection(mode, inverse);
    },
    loadSelection(layerIndex: number = 0, mode: 'alpha' | 'grayscale' = 'alpha', inverse: boolean = false) {
        App.actions.loadSelection(layerIndex, mode, inverse);
    },
    growSelection(px: number) {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) return;
        const w = sel.mask.width;
        const h = sel.mask.height;
        const srcCtx = sel.mask.getContext('2d')!;
        const src = srcCtx.getImageData(0, 0, w, h).data;
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = w; 
        dstCanvas.height = h;
        const dstCtx = dstCanvas.getContext('2d')!;
        const dstData = dstCtx.createImageData(w, h);
        const dst = dstData.data;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                if (src[idx+3] > 128) {
                    dst[idx] = 255; dst[idx+1] = 255; dst[idx+2] = 255; dst[idx+3] = 255;
                    continue;
                }
                let found = false;
                for (let dy = -px; dy <= px; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= h) continue;
                    const maxDx = Math.round(Math.sqrt(px*px - dy*dy));
                    for (let dx = -maxDx; dx <= maxDx; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= w) continue;
                        if (src[(ny * w + nx) * 4 + 3] > 128) { found = true; break; }
                    }
                    if (found) break;
                }
                if (found) { dst[idx] = 255; dst[idx+1] = 255; dst[idx+2] = 255; dst[idx+3] = 255; }
            }
        }
        dstCtx.putImageData(dstData, 0, 0);
        sel.mask = dstCanvas; 
        sel.ctx = dstCtx; 
        sel.outline = null;
        App.actions.updateSelectionOutline();
        App.render();
    },
    fillSelection(colorHex: string) {
        const sel = App.state.selection;
        if (!sel.active || !sel.mask) return;
        const l = App.utils.getActive();
        if (!l) return;
        l.ctx.save();
        const temp = document.createElement('canvas');
        temp.width = l.canvas.width; 
        temp.height = l.canvas.height;
        const tCtx = temp.getContext('2d')!;
        tCtx.fillStyle = colorHex; 
        tCtx.fillRect(0, 0, temp.width, temp.height);
        tCtx.globalCompositeOperation = 'destination-in';
        tCtx.drawImage(sel.mask, 0, 0);
        l.ctx.drawImage(temp, 0, 0);
        l.ctx.restore();
        App.emit('layer:content');
    },

    // --- Filters & Image Effects ---
    applyFilter(filterId: string, params: Record<string, any> = {}) {
        const l = App.utils.getActive();
        if (!l) return;
        const def = Filters.registry[filterId];
        if (!def) throw new Error("Filter not found: " + filterId);
        Filters.applyEffect(l, def, params, false);
    },

    setColor(type: string, val: string) {
        App.actions.setColor(type, val);
    },

    floodFill(x: number, y: number, colorHex: string, tolerance: number, contiguous: boolean, smooth: boolean, cut?: boolean) {
        const l = App.utils.getActive();
        if (!l) return;
        const rgb = App.utils.hexToRgb(colorHex) || { r: 0, g: 0, b: 0 };
        const performFloodFill = (App.utils as any).performFloodFill;
        if (performFloodFill) {
            performFloodFill(l, x, y, {
                color: rgb,
                tolerance,
                contiguous,
                smooth,
                isSelection: false,
                cut: !!cut
            });
        }
    },

    magicWandSelect(x: number, y: number, tolerance: number, contiguous: boolean, smooth: boolean) {
        const l = App.utils.getActive();
        if (!l) return;
        const performFloodFill = (App.utils as any).performFloodFill;
        if (performFloodFill) {
            const mask = performFloodFill(l, x, y, {
                tolerance,
                contiguous,
                smooth,
                isSelection: true
            });
            if (mask) {
                App.state.selection.layerId = l.id;
                App.state.selection.mask = mask;
                App.state.selection.ctx = mask.getContext('2d', { willReadFrequently: true });
                App.state.selection.active = true;
                App.render();
            }
        }
    },

    crop(x: number, y: number, w: number, h: number) {
        App.state.layers.forEach(l => {
            l.x -= x;
            l.y -= y;
        });
        App.actions.resizeCanvas(w, h);
    },

    drawLine(sx: number, sy: number, ex: number, ey: number, strokeWidth: number, startCap: string, endCap: string, colorHex: string) {
        const l = App.utils.getActive();
        if (!l) return;
        const lineTool = App.tools.find(t => t.id === 'line');
        if (lineTool && lineTool.drawLineWithCaps) {
            Lib.canvas.drawSelectionMasked(l, App.state.selection, (ctx) => {
                lineTool.drawLineWithCaps(ctx, sx, sy, ex, ey, strokeWidth, startCap, endCap, colorHex);
            });
        }
    },

    drawShape(type: 'rect' | 'circle', sx: number, sy: number, ex: number, ey: number, strokeWidth: number, fill: boolean, useStroke: boolean, radius: number) {
        const l = App.utils.getActive();
        if (!l) return;
        Lib.canvas.drawSelectionMasked(l, App.state.selection, (ctx) => {
            ctx.strokeStyle = App.state.fg;
            ctx.fillStyle = App.state.bg;
            ctx.lineWidth = strokeWidth;
            ctx.beginPath();
            const w = ex - sx, h = ey - sy;
            if (type === 'rect') {
                if (ctx.roundRect) ctx.roundRect(sx, sy, w, h, radius);
                else ctx.rect(sx, sy, w, h);
            } else {
                ctx.ellipse(sx + w/2, sy + h/2, Math.abs(w)/2, Math.abs(h)/2, 0, 0, Math.PI*2);
            }
            if (fill) ctx.fill();
            if (useStroke) ctx.stroke();
        });
    },

    exportPNG() {
        App.actions.download();
    },

    exportJPEG(quality: number, bgColor: string) {
        JpegExport.settings.quality = quality;
        JpegExport.settings.bgColor = bgColor;
        JpegExport.generate();
    },

    exportGIF(loop: number, frames: Array<{ id: number; include: boolean; delay: number }>) {
        GifExport.settings.loop = loop;
        GifExport.frames = App.state.layers.map(l => {
            const target = frames.find(f => f.id === l.id) || { include: l.visible, delay: 100 };
            return {
                id: l.id,
                layer: l,
                include: target.include,
                delay: target.delay
            };
        });
        GifExport.generate();
    },

    exportSVG(settings: {
        width?: number;
        height?: number;
        unit?: 'mm' | 'cm' | 'in' | 'mil' | 'px';
        dpi?: number;
        keepRatio?: boolean;
        format?: 'image/png' | 'image/jpeg';
        quality?: number;
        bgColor?: string;
    }) {
        Object.assign(SvgExport.settings, settings);
        SvgExport.generate();
    }
};

export const scriptActions: Pick<AppActions, 'openMacroRunner' | 'toggleRecording' | 'clearRecording'> = {
    toggleRecording() {
        App.state.recording = !App.state.recording;
        if (App.state.recording) {
            App.state.recordedSteps = [];
            App.emit('record:update');
        } else {
            App.emit('record:update');
            App.actions.openMacroRunner();
        }
    },

    clearRecording() {
        App.state.recordedSteps = [];
        App.emit('record:update');
        alert("Recorded action buffer cleared.");
    },

    openMacroRunner() {
        let defaultCode = "";
        if (App.state.recordedSteps && App.state.recordedSteps.length > 0) {
            defaultCode = "// Recorded Actions:\n" + App.state.recordedSteps.join("\n");
        } else {
            defaultCode = `// Example
const resize = false;
const black_grow = 3;
const white_grow = 12;
const shadow = true;
const canvas_increase = 0;

if (resize) {
    let new_w = 512;
    let new_h = 512;
    if (App.state.width > App.state.height) {
        new_h = Math.round(App.state.height * (512 / App.state.width));
    } else {
        new_w = Math.round(App.state.width * (512 / App.state.height));
    }
    api.resizeCanvas(new_w, new_h);
}

if (canvas_increase > 0) {
    api.increaseCanvasSize(canvas_increase);
}

// Duplicate active layer (this copies original image)
api.duplicateActiveLayer();

// Select original layer (index 1) to build background outline
api.setActiveLayerIndex(1);

// Alpha to selection
api.selectLayerAlpha();

// Grow for black border
api.growSelection(black_grow);
api.fillSelection('#000000');

// Duplicate white border background
api.duplicateActiveLayer();
api.setActiveLayerIndex(2);

// Grow for white border
api.growSelection(white_grow);
api.fillSelection('#ffffff');

if (shadow) {
    api.duplicateActiveLayer();
    api.setActiveLayerIndex(3);
    api.fillSelection('#000000');
    api.translateActiveLayer(8, 8);
    api.selectNone();
    api.applyFilter('blur', { type: 'gaussian', sigma: 20 });
    api.setActiveLayerOpacity(70);
}

// Merge everything down starting from top original layer (0)
api.setActiveLayerIndex(0);
api.mergeActiveLayerDown();
api.mergeActiveLayerDown();
if (shadow) {
    api.mergeActiveLayerDown();
}

api.setActiveLayerName("Sticker bordure");
api.selectNone();`;
        }

        const textarea = UI.createNode('textarea', {
            id: 'macro-editor',
            className: 'ui-textarea',
            style: {
                height: '220px',
                fontFamily: 'monospace',
                background: '#1e1e1e',
                color: '#d4d4d4',
                border: '1px solid #3e3e3e',
                whiteSpace: 'pre',
                resize: 'vertical'
            },
            textContent: defaultCode
        }) as HTMLTextAreaElement;

        const recordingStatus = UI.createNode('div', {
            style: { fontSize: '11px', color: '#ff3b30', display: App.state.recording ? 'block' : 'none' }
        }, '● Recording Actions...');

        const btnInsert = UI.createNode('button', {
            className: 'btn',
            on: {
                click: () => {
                    if (App.state.recordedSteps.length === 0) {
                        alert("No recorded actions yet. Try applying filters, duplicating layers, etc.");
                        return;
                    }
                    const recordedCode = "\n// Recorded Actions:\n" + App.state.recordedSteps.join("\n") + "\n";
                    textarea.value += recordedCode;
                }
            }
        }, 'Insert Recorded');

        const btnRun = UI.createNode('button', {
            className: 'btn',
            style: { background: '#0e639c', color: '#fff' },
            on: {
                click: async () => {
                    const code = textarea.value;
                    App.popup!.close();
                    App.actions.saveState();
                    
                    const wasRecording = App.state.recording;
                    App.state.recording = false; // Pause recording temporarily during script execution to prevent duplicates
                    
                    try {
                        const fn = new Function("api", "App", "Filters", `
                            return (async () => {
                                ${code}
                            })();
                        `);
                        await fn(ScriptAPI, App, Filters);
                        App.render();
                        App.ui.refreshLayers();
                    } catch (e: any) {
                        alert("Macro Execution Error: " + e.message);
                    } finally {
                        App.state.recording = wasRecording; // Restore previous state safely
                    }
                }
            }
        }, 'Run Macro');

        const btnCancel = UI.createNode('button', {
            className: 'btn cancel-btn',
            on: { click: () => App.popup!.close() }
        }, 'Close');

        const layout = UI.createNode('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' } },
            UI.createHint('Paste custom sequential scripts or record actions live.'),
            textarea,
            UI.createNode('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                UI.createNode('div', { style: { display: 'flex', gap: '4px' } }, btnInsert),
                recordingStatus
            ),
            UI.createNode('div', { className: 'popup-separator' }),
            UI.createNode('div', { className: 'popup-actions' }, btnCancel, btnRun)
        );

        App.popup!.setHtml('<h3>Macro Script Runner</h3>');
        App.popup!.content.innerHTML = '';
        App.popup!.content.appendChild(layout);
        App.popup!.setWidth('520px', '90vw');
        App.popup!.show();
    }
};
