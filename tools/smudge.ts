import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

App.registerTool({
    id: 'smudge',
    icon: '🧽',
    title: 'Smudge Tool (S)',
    settings: { size: 30, hardness: 50, rate: 50, flow: 0, spacing: 10, noErasing: true },
    
    // Offscreen buffers
    brushCanvas: null as HTMLCanvasElement | null,
    accumCanvas: null as HTMLCanvasElement | null,
    tempCanvas: null as HTMLCanvasElement | null,
    distanceAccumulator: 0,
    
    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 200, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Rate', min: 0, max: 100, value: this.settings.rate, onInput: (v: string) => this.settings.rate = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Flow', min: 0, max: 100, value: this.settings.flow, onInput: (v: string) => this.settings.flow = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 100, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
        panel.appendChild(UI.createCheckbox({
            label: 'No Erasing Effect',
            value: this.settings.noErasing,
            onChange: (v: boolean) => this.settings.noErasing = v
        }));
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
        
        App.state.last = { x: lx, y: ly };

        // Prepare selection scratch canvas
        const sel = App.state.selection;
        if (sel.active && sel.mask && sel.layerId === l.id) {
            App.state.scratch = document.createElement('canvas');
            App.state.scratch.width = l.canvas.width;
            App.state.scratch.height = l.canvas.height;
        } else {
            App.state.scratch = null;
        }

        const size = this.settings.size;
        const r = size / 2;

        // Generate brush tip mask canvas
        this.brushCanvas = document.createElement('canvas');
        this.brushCanvas.width = size;
        this.brushCanvas.height = size;
        const bCtx = this.brushCanvas.getContext('2d')!;
        const imgData = bCtx.createImageData(size, size);
        const data = imgData.data;
        const hLimit = this.settings.hardness / 100;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = (x + 0.5) - r;
                const dy = (y + 0.5) - r;
                const dist = Math.hypot(dx, dy);
                const normDist = dist / r;
                
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
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = Math.round(alpha * 255);
            }
        }
        bCtx.putImageData(imgData, 0, 0);

        // Prepare Accumulator Canvas
        this.accumCanvas = document.createElement('canvas');
        this.accumCanvas.width = size;
        this.accumCanvas.height = size;
        const accumCtx = this.accumCanvas.getContext('2d')!;

        // Fill accumulator with center pixel to handle boundary clamp
        const clx = Math.max(0, Math.min(l.canvas.width - 1, Math.round(lx)));
        const cly = Math.max(0, Math.min(l.canvas.height - 1, Math.round(ly)));
        const centerPixel = l.ctx.getImageData(clx, cly, 1, 1).data;
        accumCtx.fillStyle = `rgba(${centerPixel[0]}, ${centerPixel[1]}, ${centerPixel[2]}, ${centerPixel[3] / 255})`;
        accumCtx.fillRect(0, 0, size, size);

        // Draw initial under-brush region
        const sx = Math.round(lx - r);
        const sy = Math.round(ly - r);
        accumCtx.drawImage(l.canvas, sx, sy, size, size, 0, 0, size, size);

        // Prepare temp canvas for calculations
        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = size;
        this.tempCanvas.height = size;

        const spacingPx = Math.max(1, size * (this.settings.spacing / 100));
        this.distanceAccumulator = spacingPx;

        this.stampDabs(l, App.state.last, App.state.last, true);
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

        this.stampDabs(l, App.state.last, curr, false);
        
        App.state.last = curr;
        App.emit('render');
    },
    
    onMouseUp() {
        if (App.state.isDrawing) {
            App.state.isDrawing = false;
            App.state.scratch = null;
            this.brushCanvas = null;
            this.accumCanvas = null;
            this.tempCanvas = null;
            this.distanceAccumulator = 0;
        }
    },

    stampDabs(layer: Layer, p1: {x: number, y: number}, p2: {x: number, y: number}, isInitial: boolean) {
        const size = this.settings.size;
        const r = size / 2;
        const spacingPx = Math.max(1, size * (this.settings.spacing / 100));
        
        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === layer.id;
        let targetCtx = layer.ctx;
        
        if (hasSel && App.state.scratch) {
            targetCtx = App.state.scratch.getContext('2d')!;
            targetCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        }
        
        const accumCtx = this.accumCanvas!.getContext('2d')!;
        const accumImg = accumCtx.getImageData(0, 0, size, size);
        const accumData = accumImg.data;
        
        const tCtx = this.tempCanvas!.getContext('2d')!;
        
        const rate = this.settings.rate / 100;
        const flow = this.settings.flow / 100;
        const noErasing = this.settings.noErasing;
        
        const fgColor = App.state.fg;
        const fgRgb = App.utils.hexToRgb(fgColor) || { r: 0, g: 0, b: 0 };
        
        const stampAt = (px: number, py: number) => {
            const sx = Math.round(px - r);
            const sy = Math.round(py - r);
            
            tCtx.clearRect(0, 0, size, size);
            
            // Prefill with clamped edge color to avoid dark artifacts
            const clx = Math.max(0, Math.min(layer.canvas.width - 1, Math.round(px)));
            const cly = Math.max(0, Math.min(layer.canvas.height - 1, Math.round(py)));
            const edgePixel = layer.ctx.getImageData(clx, cly, 1, 1).data;
            tCtx.fillStyle = `rgba(${edgePixel[0]}, ${edgePixel[1]}, ${edgePixel[2]}, ${edgePixel[3] / 255})`;
            tCtx.fillRect(0, 0, size, size);
            
            tCtx.drawImage(layer.canvas, sx, sy, size, size, 0, 0, size, size);
            
            const currentImg = tCtx.getImageData(0, 0, size, size);
            const currentData = currentImg.data;
            
            // Core GIMP smudge & color mixing loops
            for (let i = 0; i < size * size * 4; i += 4) {
                const r_acc = accumData[i];
                const g_acc = accumData[i+1];
                const b_acc = accumData[i+2];
                const a_acc = accumData[i+3];
                
                const r_I = currentData[i];
                const g_I = currentData[i+1];
                const b_I = currentData[i+2];
                const a_I = currentData[i+3];
                
                let next_r = rate * r_acc + (1 - rate) * r_I;
                let next_g = rate * g_acc + (1 - rate) * g_I;
                let next_b = rate * b_acc + (1 - rate) * b_I;
                let next_a = rate * a_acc + (1 - rate) * a_I;
                
                if (noErasing) {
                    next_a = Math.max(a_acc, next_a);
                }
                
                // Save updated state back into the Accumulator
                accumData[i]   = Math.round(next_r);
                accumData[i+1] = Math.round(next_g);
                accumData[i+2] = Math.round(next_b);
                accumData[i+3] = Math.round(next_a);
                
                // Composite with Paint Flow
                let paint_r = next_r;
                let paint_g = next_g;
                let paint_b = next_b;
                let paint_a = next_a;
                
                if (flow > 0) {
                    paint_r = (1 - flow) * next_r + flow * fgRgb.r;
                    paint_g = (1 - flow) * next_g + flow * fgRgb.g;
                    paint_b = (1 - flow) * next_b + flow * fgRgb.b;
                    paint_a = (1 - flow) * next_a + flow * 255;
                }
                
                currentData[i]   = Math.round(paint_r);
                currentData[i+1] = Math.round(paint_g);
                currentData[i+2] = Math.round(paint_b);
                currentData[i+3] = Math.round(paint_a);
            }
            
            accumCtx.putImageData(accumImg, 0, 0);
            tCtx.putImageData(currentImg, 0, 0);
            
            // Mask paint region using brush hardness map
            tCtx.save();
            tCtx.globalCompositeOperation = 'destination-in';
            tCtx.drawImage(this.brushCanvas!, 0, 0);
            tCtx.restore();
            
            // Draw result onto canvas
            targetCtx.drawImage(this.tempCanvas!, Math.round(px - r), Math.round(py - r));
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
            layer.ctx.globalCompositeOperation = 'source-over';
            layer.ctx.drawImage(App.state.scratch, 0, 0);
            layer.ctx.restore();
        }
    }
});