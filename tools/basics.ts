import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

// Move Tool
App.registerTool({
    id: 'move',
    icon: '✥',
    title: 'Move',
    onSelect: (panel: HTMLElement) => {
        panel.appendChild(UI.createHint('Click and drag to move layer.'));
    },
    onMouseDown: (e: MouseEvent) => {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        App.actions.saveState();
        App.state.isDrawing = true;
        const pos = App.utils.getPos(e);
        App.state.dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
    },
    onMouseMove: (e: MouseEvent) => {
        if (!App.state.isDrawing) return;
        const l = App.utils.getActive();
        if (!l) return;
        const pos = App.utils.getPos(e);
        l.x = Math.round(pos.x - App.state.dragOffset.x); 
        l.y = Math.round(pos.y - App.state.dragOffset.y);
        App.emit('layer:props');
    },
    onMouseUp: () => { App.state.isDrawing = false; }
});

// Pen & Eraser Tools
['pen', 'eraser'].forEach(type => {
    App.registerTool({
        id: type,
        icon: type === 'pen' ? '✎' : '⌫',
        title: type === 'pen' ? 'Pen' : 'Eraser',
        settings: { size: type === 'eraser' ? 30 : 5, hardness: 100, alpha: 1.0 },
        
        brushCanvas: null as HTMLCanvasElement | null,
        distanceAccumulator: 0,
        
        onSelect(panel: HTMLElement) {
            panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 100, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
            panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
            panel.appendChild(UI.createSliderRow({ label: 'Alpha', min: 1, max: 100, value: Math.round(this.settings.alpha * 100), onInput: (v: string) => this.settings.alpha = parseInt(v) / 100 }));
        },
        onMouseDown(e: MouseEvent) {
            const l = App.utils.getActive();
            if (!l || !l.visible) return;
            if (!App.utils.layerIs(l, 'editable')) { 
                alert('Layer is not editable (rasterize first).'); 
                return; 
            }
            
            App.actions.saveState();
            App.state.isDrawing = true;
            const pos = App.utils.getPos(e);
            
            const lx = App.utils.toLocal(l, pos.x, 'x');
            const ly = App.utils.toLocal(l, pos.y, 'y');
            
            // Store last position
            App.state.last = { x: lx, y: ly };

            // Prepare scratch canvas if selection is active
            const sel = App.state.selection;
            if (sel.active && sel.mask && sel.layerId === l.id) {
                App.state.scratch = document.createElement('canvas');
                App.state.scratch.width = l.canvas.width;
                App.state.scratch.height = l.canvas.height;
            } else {
                App.state.scratch = null;
            }

            // Generate brush tip canvas
            const size = this.settings.size;
            const color = type === 'eraser' ? '#000000' : App.state.fg;
            
            this.brushCanvas = document.createElement('canvas');
            this.brushCanvas.width = size;
            this.brushCanvas.height = size;
            const bCtx = this.brushCanvas.getContext('2d')!;
            const imgData = bCtx.createImageData(size, size);
            const data = imgData.data;
            const rgb = App.utils.hexToRgb(color) || { r: 0, g: 0, b: 0 };
            const r = size / 2;
            const hLimit = this.settings.hardness / 100;
            
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const dx = (x + 0.5) - r;
                    const dy = (y + 0.5) - r;
                    const dist = Math.hypot(dx, dy);
                    let normDist = dist / r;
                    
                    let alpha = 0;
                    if (this.settings.hardness === 100) {
                        alpha = normDist <= 1.0 ? 1.0 : 0.0;
                    } else {
                        if (normDist <= hLimit) {
                            alpha = 1.0;
                        } else if (normDist > 1.0) {
                            alpha = 0.0;
                        } else {
                            alpha = 1.0 - (normDist - hLimit) / (1.0 - hLimit);
                        }
                    }
                    
                    const idx = (y * size + x) * 4;
                    data[idx] = rgb.r;
                    data[idx + 1] = rgb.g;
                    data[idx + 2] = rgb.b;
                    data[idx + 3] = Math.round(alpha * 255);
                }
            }
            bCtx.putImageData(imgData, 0, 0);

            // Draw initial dab and reset spacing accumulator
            const spacingPx = 1;
            this.distanceAccumulator = spacingPx;
            this.stampDabs(l, App.state.last, App.state.last, true, type);
            App.emit('render');
        },
        onMouseMove(e: MouseEvent) {
            if (!App.state.isDrawing) return;
            const l = App.utils.getActive();
            if (!l) return;
            const pos = App.utils.getPos(e);
            const curr = {
                x: App.utils.toLocal(l, pos.x, 'x'),
                y: App.utils.toLocal(l, pos.y, 'y')
            };

            this.stampDabs(l, App.state.last, curr, false, type);
            
            App.state.last = curr;
            App.emit('render');
        },
        onMouseUp() { 
            App.state.isDrawing = false; 
            App.state.scratch = null;
            this.brushCanvas = null;
            this.distanceAccumulator = 0;
        },
        stampDabs(layer: Layer, p1: {x: number, y: number}, p2: {x: number, y: number}, isInitial: boolean, toolType: string) {
            const size = this.settings.size;
            const r = size / 2;
            const spacingPx = 1;
            
            const sel = App.state.selection;
            const hasSel = sel.active && sel.mask && sel.layerId === layer.id;
            let targetCtx = layer.ctx;
            
            if (hasSel && App.state.scratch) {
                targetCtx = App.state.scratch.getContext('2d')!;
                targetCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            }
            
            const stampAt = (px: number, py: number) => {
                targetCtx.save();
                if (hasSel && App.state.scratch) {
                    targetCtx.globalCompositeOperation = 'source-over';
                    targetCtx.globalAlpha = 1.0;
                } else {
                    targetCtx.globalCompositeOperation = toolType === 'eraser' ? 'destination-out' : 'source-over';
                    targetCtx.globalAlpha = this.settings.alpha;
                }
                if (this.brushCanvas) {
                    targetCtx.drawImage(this.brushCanvas, Math.round(px - r), Math.round(py - r));
                }
                targetCtx.restore();
            };

            if (isInitial) {
                stampAt(p1.x, p1.y);
            } else {
                const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (dist > 0) {
                    const dx = (p2.x - p1.x) / dist;
                    const dy = (p2.y - p1.y) / dist;
                    
                    let d = this.distanceAccumulator;
                    while (d <= dist) {
                        stampAt(p1.x + dx * d, p1.y + dy * d);
                        d += spacingPx;
                    }
                    this.distanceAccumulator = d - dist;
                }
            }
            
            if (hasSel && App.state.scratch) {
                targetCtx.globalCompositeOperation = 'destination-in';
                targetCtx.drawImage(sel.mask!, 0, 0);
                
                layer.ctx.save();
                layer.ctx.globalAlpha = this.settings.alpha;
                layer.ctx.globalCompositeOperation = toolType === 'eraser' ? 'destination-out' : 'source-over';
                layer.ctx.drawImage(App.state.scratch, 0, 0);
                layer.ctx.restore();
            }
        }
    });
});

// Zoom Tool
App.registerTool({
    id: 'zoom',
    icon: '🔍',
    title: 'Zoom',
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
});
