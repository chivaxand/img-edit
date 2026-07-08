import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

App.registerTool({
    id: 'smudge',
    icon: '🧽',
    title: 'Smudge Tool (S)',
    settings: { size: 30, hardness: 50, rate: 50, flow: 0, spacing: 5, noErasing: true },
    
    // Offscreen buffers
    brushData: null as Uint8ClampedArray | null,
    accumCanvas: null as HTMLCanvasElement | null,
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

        const imgData = new ImageData(size, size);
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
        this.brushData = imgData.data;

        // Prepare Accumulator Canvas
        this.accumCanvas = document.createElement('canvas');
        this.accumCanvas.width = size;
        this.accumCanvas.height = size;
        const accumCtx = this.accumCanvas.getContext('2d')!;

        const clx = Math.max(0, Math.min(l.canvas.width - 1, Math.round(lx)));
        const cly = Math.max(0, Math.min(l.canvas.height - 1, Math.round(ly)));
        const centerPixel = l.ctx.getImageData(clx, cly, 1, 1).data;

        const sx = Math.round(lx - r);
        const sy = Math.round(ly - r);
        
        const accumImg = l.ctx.getImageData(sx, sy, size, size);
        const accumData = accumImg.data;
        const lw = l.canvas.width;
        const lh = l.canvas.height;
        
        for (let y = 0; y < size; y++) {
            const ly = sy + y;
            for (let x = 0; x < size; x++) {
                const lx = sx + x;
                if (lx < 0 || lx >= lw || ly < 0 || ly >= lh) {
                    const idx = (y * size + x) * 4;
                    accumData[idx] = centerPixel[0];
                    accumData[idx + 1] = centerPixel[1];
                    accumData[idx + 2] = centerPixel[2];
                    accumData[idx + 3] = centerPixel[3];
                }
            }
        }
        accumCtx.putImageData(accumImg, 0, 0);

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
            this.brushData = null;
            this.accumCanvas = null;
            this.distanceAccumulator = 0;
        }
    },

    stampDabs(layer: Layer, p1: {x: number, y: number}, p2: {x: number, y: number}, isInitial: boolean) {
        const size = this.settings.size;
        const r = size / 2;
        const spacingPx = Math.max(1, size * (this.settings.spacing / 100));
        
        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === layer.id;
        let selCtx: CanvasRenderingContext2D | null = null;
        if (hasSel) {
            selCtx = sel.mask!.getContext('2d')!;
        }
        
        const accumCtx = this.accumCanvas!.getContext('2d')!;
        const accumImg = accumCtx.getImageData(0, 0, size, size);
        const accumData = accumImg.data;
        
        const rate = this.settings.rate / 100;
        const flow = this.settings.flow / 100;
        const noErasing = this.settings.noErasing;
        
        const fgColor = App.state.fg;
        const fgRgb = App.utils.hexToRgb(fgColor) || { r: 0, g: 0, b: 0 };
        
        const stampAt = (px: number, py: number) => {
            const sx = Math.round(px - r);
            const sy = Math.round(py - r);
            
            const currentImg = layer.ctx.getImageData(sx, sy, size, size);
            const currentData = currentImg.data;
            
            let selData: Uint8ClampedArray | null = null;
            if (selCtx) {
                selData = selCtx.getImageData(sx, sy, size, size).data;
            }
            
            const clx = Math.max(0, Math.min(layer.canvas.width - 1, Math.round(px)));
            const cly = Math.max(0, Math.min(layer.canvas.height - 1, Math.round(py)));
            const edgePixel = layer.ctx.getImageData(clx, cly, 1, 1).data;
            
            const lw = layer.canvas.width;
            const lh = layer.canvas.height;
            
            for (let y = 0; y < size; y++) {
                const ly = sy + y;
                for (let x = 0; x < size; x++) {
                    const lx = sx + x;
                    if (lx < 0 || lx >= lw || ly < 0 || ly >= lh) {
                        const idx = (y * size + x) * 4;
                        currentData[idx] = edgePixel[0];
                        currentData[idx + 1] = edgePixel[1];
                        currentData[idx + 2] = edgePixel[2];
                        currentData[idx + 3] = edgePixel[3];
                    }
                }
            }
            
            for (let i = 0; i < size * size * 4; i += 4) {
                const r_acc = accumData[i];
                const g_acc = accumData[i+1];
                const b_acc = accumData[i+2];
                const a_acc = accumData[i+3];
                
                const r_I = currentData[i];
                const g_I = currentData[i+1];
                const b_I = currentData[i+2];
                const a_I = currentData[i+3];
                
                const a_acc_f = a_acc / 255;
                const a_I_f = a_I / 255;
                
                const w_acc = rate * a_acc_f;
                const w_I = (1 - rate) * a_I_f;
                const w_total = w_acc + w_I;
                
                let next_r = r_acc;
                let next_g = g_acc;
                let next_b = b_acc;
                
                if (w_total > 0.001) {
                    next_r = Math.max(0, Math.min(255, (w_acc * r_acc + w_I * r_I) / w_total));
                    next_g = Math.max(0, Math.min(255, (w_acc * g_acc + w_I * g_I) / w_total));
                    next_b = Math.max(0, Math.min(255, (w_acc * b_acc + w_I * b_I) / w_total));
                }
                
                let next_a_f = rate * a_acc_f + (1 - rate) * a_I_f;
                if (noErasing) {
                    // Prevent canvas transparency from decreasing if the user set noErasing
                    next_a_f = Math.max(a_I_f, next_a_f);
                }
                
                let paint_r = next_r;
                let paint_g = next_g;
                let paint_b = next_b;
                let paint_a_f = next_a_f;
                
                if (flow > 0) {
                    const w_next = (1 - flow) * next_a_f;
                    const w_fg = flow;
                    const w_paint = w_next + w_fg;
                    
                    if (w_paint > 0.001) {
                        paint_r = Math.max(0, Math.min(255, (w_next * next_r + w_fg * fgRgb.r) / w_paint));
                        paint_g = Math.max(0, Math.min(255, (w_next * next_g + w_fg * fgRgb.g) / w_paint));
                        paint_b = Math.max(0, Math.min(255, (w_next * next_b + w_fg * fgRgb.b) / w_paint));
                    }
                    paint_a_f = next_a_f * (1 - flow) + flow;
                }
                
                // Save updated state back into the Accumulator
                accumData[i]   = Math.round(paint_r);
                accumData[i+1] = Math.round(paint_g);
                accumData[i+2] = Math.round(paint_b);
                accumData[i+3] = Math.round(paint_a_f * 255);
                
                // Blend with original canvas using Brush and Selection masks via premultiplied alpha
                let mask_f = this.brushData![i + 3] / 255;
                if (selData) {
                    mask_f *= (selData[i + 3] / 255);
                }
                
                if (mask_f > 0) {
                    const pre_r = paint_r * paint_a_f * mask_f + r_I * a_I_f * (1 - mask_f);
                    const pre_g = paint_g * paint_a_f * mask_f + g_I * a_I_f * (1 - mask_f);
                    const pre_b = paint_b * paint_a_f * mask_f + b_I * a_I_f * (1 - mask_f);
                    const final_a_f = paint_a_f * mask_f + a_I_f * (1 - mask_f);
                    
                    let final_r = 0, final_g = 0, final_b = 0;
                    if (final_a_f > 0.001) {
                        final_r = pre_r / final_a_f;
                        final_g = pre_g / final_a_f;
                        final_b = pre_b / final_a_f;
                    }
                    
                    currentData[i]   = Math.round(final_r);
                    currentData[i+1] = Math.round(final_g);
                    currentData[i+2] = Math.round(final_b);
                    currentData[i+3] = Math.round(final_a_f * 255);
                }
            }
            
            accumCtx.putImageData(accumImg, 0, 0);
            layer.ctx.putImageData(currentImg, sx, sy);
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
    }
});
