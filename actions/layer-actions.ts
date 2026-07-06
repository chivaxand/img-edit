import { App, AppActions } from '~/app';
import { Layers, Layer } from '~/layers';

export const layersActions: Pick<AppActions,
    'createLayer' | 'addEmptyLayer' | 'addLayer' | 'addTextLayer' |
    'updateLayer' | 'rasterizeLayer' | 'deleteLayer' | 'setActiveLayer' |
    'toggleVis' | 'setLayerProp' | 'transformLayer' | 'centerActiveLayer' |
    'handleFiles' | 'mergeAll' | 'duplicateLayer' | 'moveLayer' | 'mergeLayerDown'
> = {
    createLayer(name: string, img?: HTMLImageElement | HTMLCanvasElement, type = 'raster') {
        return Layers.create(type, { name, img, width: App.state.width, height: App.state.height });
    },

    addEmptyLayer() { 
        App.actions.addLayer(App.actions.createLayer(`Layer ${App.state.layers.length+1}`)!); 
        App.recordAction("api.addEmptyLayer();");
    },

    addLayer(l: Layer) { 
        App.actions.saveState(); 
        App.state.layers.unshift(l); 
        App.actions.setActiveLayer(l.id); 
    },

    addTextLayer(x: number, y: number, options: any = {}) {
        const l = Layers.create('text', {
            text: options.text || 'Text', 
            font: options.font || 'Arial',
            fontSize: options.fontSize || 24, 
            color: App.state.fg, 
            x, y
        });
        if(l) {
            App.actions.addLayer(l);
            App.actions.setTool('move');
        }
    },

    updateLayer(l: Layer, props: any) {
        const def = Layers.get(l.type);
        if(def && def.update) {
            def.update(l, props);
            App.emit('layer:content');
        }
    },

    rasterizeLayer(id: number) {
        const l = App.state.layers.find(x=>x.id===id);
        if(!l || l.type !== 'text') return;
        App.actions.saveState();
        const newL = Layers.create('raster', { name:l.name, img:l.canvas })!;
        Object.assign(newL, { x:l.x, y:l.y, opacity:l.opacity, blend:l.blend, visible:l.visible, id:l.id });
        const idx = App.state.layers.indexOf(l);
        App.state.layers[idx] = newL;
        App.actions.setActiveLayer(newL.id);
    },

    deleteLayer() {
        if(App.state.layers.length<=1) return;
        App.actions.saveState();
        App.state.layers = App.state.layers.filter(l => l.id !== App.state.activeLayerId);
        App.actions.setActiveLayer(App.state.layers[0].id);
        App.recordAction("api.deleteActiveLayer();");
    },

    setActiveLayer(id: number) { 
        const currentTool = App.getTool();
        if (currentTool && currentTool.finishOnLayerSwitch && App.state.activeLayerId !== id) {
            App.actions.setTool('move');
        }
        App.state.activeLayerId = id; 
        const index = App.state.layers.findIndex(x => x.id === id);
        if (index >= 0) {
            App.recordAction(`api.setActiveLayerIndex(${index});`);
        }
        App.emit('layers:structure'); 
    },

    toggleVis(id: number) { 
        const l = App.state.layers.find(x=>x.id===id); 
        if(l) { 
            l.visible = !l.visible; 
            App.emit('layers:structure');
        } 
    },

    setLayerProp(k: string, v: any) { 
        const l = App.utils.getActive(); 
        if(l) { 
            l[k]=v; 
            App.emit('layer:props'); 
        } 
    },

    transformLayer(k: string, v: string) { 
        const l = App.utils.getActive(); 
        if(l) { 
            l[k]=parseFloat(v)||0; 
            App.emit('layer:props'); 
        } 
    },

    centerActiveLayer() {
        const l = App.utils.getActive();
        if (!l) return;
        App.actions.saveState();
        l.x = Math.round((App.state.width - l.width) / 2);
        l.y = Math.round((App.state.height - l.height) / 2);
        App.emit('layer:props');
        App.render();
    },

    handleFiles(files: FileList) {
        Array.from(files).forEach(f => {
            if(!f.type.startsWith('image/')) return;
            const r = new FileReader();
            r.onload = (e: ProgressEvent<FileReader>) => {
                const img = new Image();
                img.onload = () => {
                    if(App.state.layers.length===1 && App.utils.isEmpty(App.state.layers[0].canvas)) {
                        App.actions.resizeCanvas(img.width, img.height);
                        App.state.layers = [];
                    }
                    App.actions.addLayer(App.actions.createLayer(f.name, img)!);
                    App.actions.setTool('move');
                };
                img.src = e.target!.result as string;
            };
            r.readAsDataURL(f);
        });
    },

    mergeAll() {
        App.actions.saveState();
        const c = document.createElement('canvas');
        c.width = App.state.width; c.height = App.state.height;
        const ctx = c.getContext('2d')!;
        for (let i = App.state.layers.length - 1; i >= 0; i--) {
            const l = App.state.layers[i];
            if (!l.visible) continue;
            ctx.save();
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = l.blend as GlobalCompositeOperation;
            ctx.drawImage(l.canvas, l.x, l.y, l.width, l.height);
            ctx.restore();
        }
        const newLayer = App.actions.createLayer('Merged', c);
        if (newLayer) {
            App.state.layers = [newLayer];
            App.actions.setActiveLayer(newLayer.id);
            App.recordAction("api.mergeAllLayers();");
        }
    },

    duplicateLayer() {
        const l = App.utils.getActive();
        if (!l) return;
        App.actions.saveState();

        // Deep copy canvas
        const nc = document.createElement('canvas');
        nc.width = l.canvas.width; nc.height = l.canvas.height;
        nc.getContext('2d')!.drawImage(l.canvas, 0, 0);

        // Create object copy
        const newL = { 
            ...l, 
            id: Date.now() + Math.random(), 
            name: l.name + ' copy', 
            canvas: nc, 
            ctx: nc.getContext('2d')! 
        } as Layer;

        // Placing above current layer
        const idx = App.state.layers.indexOf(l);
        App.state.layers.splice(idx, 0, newL);
        
        App.actions.setActiveLayer(newL.id);
        App.recordAction("api.duplicateActiveLayer();");
    },

    moveLayer(dir: number) {
        // dir: -1 (Up/Top), 1 (Down/Bottom)
        const l = App.utils.getActive();
        if (!l) return;
        
        const i = App.state.layers.indexOf(l);
        const ni = i + dir;

        if (ni < 0 || ni >= App.state.layers.length) return;

        App.actions.saveState();

        // Swap
        [App.state.layers[i], App.state.layers[ni]] = [App.state.layers[ni], App.state.layers[i]];
        
        App.recordAction(`api.moveActiveLayer(${dir});`);
        App.emit('layers:structure');
    },

    mergeLayerDown() {
        const l = App.utils.getActive();
        if (!l) return;
        const idx = App.state.layers.indexOf(l);
        if (idx < 0 || idx >= App.state.layers.length - 1) return;

        App.actions.saveState();

        const bottomLayer = App.state.layers[idx + 1];
        const temp = document.createElement('canvas');
        temp.width = bottomLayer.canvas.width; 
        temp.height = bottomLayer.canvas.height;
        const tempCtx = temp.getContext('2d')!;
        tempCtx.drawImage(bottomLayer.canvas, 0, 0);
        tempCtx.save();
        tempCtx.globalAlpha = l.opacity;
        tempCtx.globalCompositeOperation = l.blend as GlobalCompositeOperation;
        tempCtx.drawImage(l.canvas, l.x - bottomLayer.x, l.y - bottomLayer.y, l.width, l.height);
        tempCtx.restore();
        bottomLayer.ctx.clearRect(0, 0, bottomLayer.width, bottomLayer.height);
        bottomLayer.ctx.drawImage(temp, 0, 0);

        App.state.layers.splice(idx, 1);
        App.actions.setActiveLayer(bottomLayer.id);
        App.recordAction("api.mergeActiveLayerDown();");
        App.emit('layers:structure');
    },
};
