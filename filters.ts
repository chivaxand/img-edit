import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Menu } from '~/menu';

export interface FilterParam {
    id: string;
    label: string;
    type: string;
    min: number;
    max: number;
    val: number;
}

export interface FilterDef {
    name: string;
    mode: 'css' | 'pixel';
    filter?: (values: any) => string;
    params?: FilterParam[];
    process?: (data: Uint8ClampedArray, w: number, h: number, values: any) => void;
    apply?: (layer: Layer, values: any) => void;
    renderUI?: (root: HTMLElement, layer: Layer, hooks: any) => void;
    dialogOptions?: { width?: string; maxWidth?: string };
    menu?: { path: string; label?: string; order?: number };
    [key: string]: any;
}

export const Filters = {
    registry: {} as Record<string, FilterDef>,

    register(id: string, def: FilterDef) {
        this.registry[id] = def;
        if (def.menu) {
            Menu.registerDynamicItem(def.menu.path, {
                label: def.menu.label || def.name,
                action: () => Filters.run(id)
            }, def.menu.order);
        }
    },

    run(id: string) {
        const def = this.registry[id];
        if (!def) return console.error(`Filter ${id} not found`);
        
        const l = App.utils.getActive();
        if(!l || !App.utils.layerIs(l, 'filterable')) { alert('This layer type cannot be filtered. Rasterize it first.'); return; }

        if(!def.params && !def.renderUI) {
            App.actions.saveState();
            this.applyEffect(l, def, {});
            return;
        }
        this.showDialog(def, l);
    },

    applyEffect(l: Layer, def: FilterDef, values: any, record = true) {
        if (def.apply) {
            def.apply(l, values);
        } else if (def.mode === 'css') {
            const tmp = document.createElement('canvas');
            tmp.width = l.canvas.width; tmp.height = l.canvas.height;
            tmp.getContext('2d')!.drawImage(l.canvas, 0, 0);
            const filtered = document.createElement('canvas');
            filtered.width = l.width; filtered.height = l.height;
            const fCtx = filtered.getContext('2d')!;
            fCtx.filter = def.filter!(values);
            fCtx.drawImage(tmp, 0, 0);
            fCtx.filter = 'none';
            this.processPixels(l, (data: Uint8ClampedArray, w: number, h: number) => {
                const fData = fCtx.getImageData(0,0,w,h).data;
                for(let i=0; i<data.length; i++) data[i] = fData[i];
            });
        } 
        else if (def.mode === 'pixel' && def.process) {
            this.processPixels(l, (data: Uint8ClampedArray, w: number, h: number) => def.process!(data, w, h, values));
        }

        if (record) {
            // Filter out transient or non-serializable parameters before recording
            const cleanValues: Record<string, any> = {};
            for (const key in values) {
                if (key.startsWith('orig') || values[key] instanceof HTMLCanvasElement || values[key] instanceof HTMLElement) {
                    continue;
                }
                cleanValues[key] = values[key];
            }
            const filterId = Object.keys(this.registry).find(key => this.registry[key] === def) || 'unknown';
            App.recordAction(`api.applyFilter('${filterId}', ${JSON.stringify(cleanValues)});`);
        }

        App.render();
        App.ui.refreshLayers();
    },

    processPixels(layer: Layer, fn: Function) {
        const w = layer.canvas.width, h = layer.canvas.height;
        const imgData = layer.ctx.getImageData(0, 0, w, h);
        
        // Prepare Mask
        let maskData: Uint8ClampedArray | null = null;
        if (App.state.selection.active && App.state.selection.mask && App.state.selection.layerId === layer.id) {
            maskData = App.state.selection.ctx!.getImageData(0, 0, w, h).data;
        }

        if (maskData) {
            const orig = new Uint8ClampedArray(imgData.data);
            // Apply filter
            fn(imgData.data, w, h);
            // Blend based on mask
            for (let i = 0; i < imgData.data.length; i += 4) {
                // Alpha from mask (0-255). 0 = Not Selected (Keep Orig), 255 = Selected (Use Filtered)
                const alpha = maskData[i+3] / 255; 
                if (alpha < 1) {
                    const inv = 1 - alpha;
                    imgData.data[i]   = imgData.data[i] * alpha   + orig[i] * inv;
                    imgData.data[i+1] = imgData.data[i+1] * alpha + orig[i+1] * inv;
                    imgData.data[i+2] = imgData.data[i+2] * alpha + orig[i+2] * inv;
                    imgData.data[i+3] = imgData.data[i+3] * alpha + orig[i+3] * inv;
                }
            }
        } else {
            fn(imgData.data, w, h);
        }
        
        layer.ctx.putImageData(imgData, 0, 0);
    },

    showDialog(def: FilterDef, layer: Layer) {
        // Deep copy canvas and state properties to restore on preview/cancel
        const origCanvas = document.createElement('canvas');
        origCanvas.width = layer.canvas.width;
        origCanvas.height = layer.canvas.height;
        origCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);
        const cache = {
            canvas: origCanvas,
            width: layer.width,
            height: layer.height,
            x: layer.x,
            y: layer.y,
            canvasW: App.state.width,
            canvasH: App.state.height
        };

        const p = App.popup!;
        p.setHtml(`
            <h2>${def.name}</h2>
            <div id="filter-ui-root"></div>
            <div class="popup-actions" style="justify-content:space-between; align-items:center;">
                <label style="display:flex; align-items:center; cursor:pointer; color:inherit; font-size:13px; margin:0; user-select:none;">
                    <input type="checkbox" id="chk-preview" checked style="width:auto; margin:0 5px 0 0;"> Preview
                </label>
                <div>
                    <button class="cancel-btn" id="btn-cancel">Cancel</button>
                    <button id="btn-ok">Apply</button>
                </div>
            </div>
        `);

        if (def.dialogOptions) {
            p.setWidth(def.dialogOptions.width, def.dialogOptions.maxWidth);
        }

        const root = p.getById('filter-ui-root')!;
        const chkPreview = p.getById('chk-preview') as HTMLInputElement;
        let currentValues: Record<string, any> = {};
        let isPreview = true;

        const restore = () => {
            const nc = document.createElement('canvas');
            nc.width = cache.canvas.width;
            nc.height = cache.canvas.height;
            nc.getContext('2d')!.drawImage(cache.canvas, 0, 0);
            layer.canvas = nc;
            layer.ctx = nc.getContext('2d')!;
            layer.width = cache.width;
            layer.height = cache.height;
            layer.x = cache.x;
            layer.y = cache.y;
            
            // Restore main canvas size to prevent cascading scaling errors on preview
            App.actions.resizeCanvas(cache.canvasW, cache.canvasH);
        };

        const hooks = {
            preview: (vals: any) => {
                currentValues = vals;
                // Restore original state before reapplying preview
                restore();
                
                if (isPreview) {
                    this.applyEffect(layer, def, vals, false);
                } else {
                    App.render();
                    App.ui.refreshLayers();
                }
            },
            commit: (vals: any) => {
                restore();
                App.actions.saveState();
                this.applyEffect(layer, def, vals, true);
                p.close();
            }
        };
        
        chkPreview.onchange = (e: Event) => {
            isPreview = (e.target as HTMLInputElement).checked;
            hooks.preview(currentValues);
        };

        if (def.renderUI) {
            setTimeout(() => { def.renderUI!(root, layer, hooks); }, 1);
        } else if (def.params) {
            def.params.forEach(param => {
                currentValues[param.id] = param.val;
                if (param.type === 'range') {
                    root.appendChild(UI.createSliderRow({
                        label: param.label,
                        min: param.min,
                        max: param.max,
                        value: param.val,
                        onInput: (v: any) => {
                            currentValues[param.id] = v;
                            hooks.preview(currentValues);
                        }
                    }));
                }
            });
            hooks.preview(currentValues);
        }

        p.onClick('btn-ok', () => hooks.commit(currentValues));
        p.onClick('btn-cancel', () => {
            restore();
            App.render();
            App.ui.refreshLayers();
            p.close();
        });
        p.show();
    }
};