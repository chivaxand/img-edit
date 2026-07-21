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

export interface FilterContext {
    layer: Layer;
    values: any;
    selection: {
        active: boolean;
        mask: HTMLCanvasElement | null;
        ctx: CanvasRenderingContext2D | null;
    };
    layers: Layer[];
    width: number;
    height: number;
    createLayer: (name: string, img?: HTMLImageElement | HTMLCanvasElement, type?: string) => Layer | null;
    addLayer: (l: Layer) => void;
    processPixels: (fn: (data: Uint8ClampedArray, w: number, h: number) => void) => void;
}

export interface FilterDef {
    name: string;
    mode: 'css' | 'pixel' | 'unified';
    filter?: (values: any) => string;
    params?: FilterParam[];
    process?: (data: Uint8ClampedArray, w: number, h: number, values: any) => void;
    apply?: (context: FilterContext) => void;
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
            App.actions.saveState(def.name);
            this.applyEffect(l, def, {});
            return;
        }
        this.showDialog(def, l);
    },

    applyEffect(l: Layer, def: FilterDef, values: any, record = true) {
        const startTime = performance.now();
        let targetLayer = l;
        const hasNewLayer = values && values._newLayer;
        
        if (hasNewLayer) {
            const nc = document.createElement('canvas');
            nc.width = l.canvas.width;
            nc.height = l.canvas.height;
            nc.getContext('2d')!.drawImage(l.canvas, 0, 0);

            const newL = { ...l, id: Date.now() + Math.random(), name: `${l.name} (${def.name})`, canvas: nc, ctx: nc.getContext('2d')! } as Layer;

            // Ensure selection moves with the new layer
            if (App.state.selection.layerId === l.id) {
                App.state.selection.layerId = newL.id;
            }

            // Insert above original layer
            const idx = App.state.layers.indexOf(l);
            if (idx >= 0) {
                App.state.layers.splice(idx, 0, newL);
            } else {
                App.state.layers.unshift(newL);
            }

            App.actions.setActiveLayer(newL.id);
            targetLayer = newL;
        }

        const context: FilterContext = {
            layer: targetLayer,
            values: values,
            selection: {
                active: App.state.selection.active,
                mask: App.state.selection.mask,
                ctx: App.state.selection.ctx
            },
            layers: App.state.layers,
            width: App.state.width,
            height: App.state.height,
            createLayer: (name, img, type) => App.actions.createLayer(name, img, type),
            addLayer: (layer) => App.actions.addLayer(layer),
            processPixels: (fn) => this.processPixels(targetLayer, fn)
        };

        if (def.apply) {
            if (def.mode === 'unified') {
                def.apply(context);
            } else {
                // Backward compatibility for old (layer, values) signatures
                (def.apply as any)(targetLayer, values);
            }
        } else if (def.mode === 'css') {
            const tmp = document.createElement('canvas');
            tmp.width = targetLayer.canvas.width; tmp.height = targetLayer.canvas.height;
            tmp.getContext('2d')!.drawImage(targetLayer.canvas, 0, 0);
            const filtered = document.createElement('canvas');
            filtered.width = targetLayer.width; filtered.height = targetLayer.height;
            const fCtx = filtered.getContext('2d')!;
            fCtx.filter = def.filter!(values);
            fCtx.drawImage(tmp, 0, 0);
            fCtx.filter = 'none';
            this.processPixels(targetLayer, (data: Uint8ClampedArray, w: number, h: number) => {
                const fData = fCtx.getImageData(0,0,w,h).data;
                for(let i=0; i<data.length; i++) data[i] = fData[i];
            });
        } 
        else if (def.mode === 'pixel' && def.process) {
            this.processPixels(targetLayer, (data: Uint8ClampedArray, w: number, h: number) => def.process!(data, w, h, values));
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

        const duration = performance.now() - startTime;
        if (duration > 200) {
            console.log(`Filter ${def.name} took ${(duration).toFixed(1)} ms`);
        }
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
        
        // Clear overlay on close
        const originalClose = p.close.bind(p);
        p.close = () => {
            App.state.customOverlay = null;
            p.close = originalClose;
            originalClose();
            App.render();
        };

        p.setHtml(`
            <h2>${def.name}</h2>
            <div id="filter-ui-root"></div>
            <div class="popup-actions" style="justify-content:space-between; align-items:center;">
                <div style="display:flex; gap:15px; align-items:center;">
                    <label class="ui-checkbox-label" style="font-size:13px; margin:0;">
                        <input type="checkbox" id="chk-preview" class="ui-checkbox" checked> Preview
                    </label>
                    <label class="ui-checkbox-label" style="font-size:13px; margin:0;">
                        <input type="checkbox" id="chk-new-layer" class="ui-checkbox"> New layer
                    </label>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn cancel-btn" id="btn-cancel">Cancel</button>
                    <button class="btn" id="btn-ok">Apply</button>
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
                App.actions.saveState(def.name);

                const chkNewLayer = p.getById('chk-new-layer') as HTMLInputElement;
                if (chkNewLayer && chkNewLayer.checked) {
                    vals = { ...vals, _newLayer: true };
                }
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
