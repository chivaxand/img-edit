import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { createBrushCanvas, interpolateDabs, drawActiveBrushCircle } from './tools';

export const SmudgeTool = {
    id: 'smudge' as const,
    icon: '🧽',
    title: 'Smudge Tool (S)',
    sortOrder: 150,
    settings: { 
        size: 30, 
        hardness: 50, 
        rate: 50, 
        colorRate: 0, 
        smudgeRadius: 10, 
        spacing: 5, 
        smearAlpha: true,
        mode: 'smearing'
    },
    requiresEditableLayer: true,
    
    // Offscreen buffers
    brushData: null as Uint8ClampedArray | null,
    accumCanvas: null as HTMLCanvasElement | null,
    distanceAccumulator: 0,
    activeColor: { r: 0, g: 0, b: 0, a: 1.0 },
    
    drawUI() {
        drawActiveBrushCircle(this.settings.size);
    },

    onSelect(panel: HTMLElement) {
        const radiusRow = UI.createSliderRow({ 
            label: 'Smudge Radius',  min: 1,  max: 100, 
            value: this.settings.smudgeRadius, 
            onInput: (v: string) => this.settings.smudgeRadius = parseInt(v) 
        });
        const updateRadiusVisibility = (mode: string) => {
            UI.toggle(radiusRow, mode === 'dulling');
        };

        panel.appendChild(UI.createSelectRow({
            label: 'Mode',
            options: [
                { value: 'smearing', text: 'Smearing Mode' },
                { value: 'dulling', text: 'Dulling Mode' }
            ],
            value: this.settings.mode,
            onChange: (v: string) => {
                this.settings.mode = v as 'smearing' | 'dulling';
                updateRadiusVisibility(v);
            }
        }));

        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 200, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Smudge Rate', min: 0, max: 100, value: this.settings.rate, onInput: (v: string) => this.settings.rate = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Color Rate', min: 0, max: 100, value: this.settings.colorRate, onInput: (v: string) => this.settings.colorRate = parseInt(v) }));
        panel.appendChild(radiusRow);
        updateRadiusVisibility(this.settings.mode);

        panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 100, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
        panel.appendChild(UI.createCheckbox({
            label: 'Smear Alpha (Transparency)',
            value: this.settings.smearAlpha,
            onChange: (v: boolean) => this.settings.smearAlpha = v
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

        const brushCanvas = createBrushCanvas(size, this.settings.hardness);
        this.brushData = brushCanvas.getContext('2d')!.getImageData(0, 0, size, size).data;

        // Prepare Accumulator Canvas
        this.accumCanvas = document.createElement('canvas');
        this.accumCanvas.width = size;
        this.accumCanvas.height = size;
        const accumCtx = this.accumCanvas.getContext('2d')!;

        const clx = Math.max(0, Math.min(l.canvas.width - 1, Math.round(lx)));
        const cly = Math.max(0, Math.min(l.canvas.height - 1, Math.round(ly)));
        const centerPixel = l.ctx.getImageData(clx, cly, 1, 1).data;

        this.activeColor = {
            r: centerPixel[0],
            g: centerPixel[1],
            b: centerPixel[2],
            a: centerPixel[3] / 255
        };

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
        
        const rate = this.settings.rate / 100;
        const colorRate = this.settings.colorRate / 100;
        const smearAlpha = this.settings.smearAlpha;
        
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

            let accumImg: ImageData | null = null;
            let accumData: Uint8ClampedArray | null = null;

            if (this.settings.mode === 'smearing') {
                const img = accumCtx.getImageData(0, 0, size, size);
                accumImg = img;
                accumData = img.data;
            }

            let activeColorLocal = { ...this.activeColor };

            if (this.settings.mode === 'dulling') {
                const sampled = sampleCanvasColor(
                    layer.ctx,
                    px, py,
                    this.settings.smudgeRadius,
                    this.brushData,
                    size,
                    this.activeColor
                );

                const a_canvas = sampled.a / 255;
                const r_canvas = sampled.r;
                const g_canvas = sampled.g;
                const b_canvas = sampled.b;

                const a_brush = this.activeColor.a;
                const r_brush = this.activeColor.r;
                const g_brush = this.activeColor.g;
                const b_brush = this.activeColor.b;

                const w_brush = rate * a_brush;
                const w_canvas = (1 - rate) * a_canvas;
                const w_total = w_brush + w_canvas;

                let next_r = r_brush;
                let next_g = g_brush;
                let next_b = b_brush;

                if (w_total > 0.001) {
                    next_r = (w_brush * r_brush + w_canvas * r_canvas) / w_total;
                    next_g = (w_brush * g_brush + w_canvas * g_canvas) / w_total;
                    next_b = (w_brush * b_brush + w_canvas * b_canvas) / w_total;
                }

                let next_a = rate * a_brush + (1 - rate) * a_canvas;
                if (!smearAlpha) {
                    next_a = Math.max(a_brush, a_canvas);
                }

                if (colorRate > 0) {
                    const w_next = (1 - colorRate) * next_a;
                    const w_fg = colorRate;
                    const w_paint = w_next + w_fg;

                    if (w_paint > 0.001) {
                        next_r = (w_next * next_r + w_fg * fgRgb.r) / w_paint;
                        next_g = (w_next * next_g + w_fg * fgRgb.g) / w_paint;
                        next_b = (w_next * next_b + w_fg * fgRgb.b) / w_paint;
                    }
                    next_a = next_a * (1 - colorRate) + colorRate;
                }

                activeColorLocal.r = next_r;
                activeColorLocal.g = next_g;
                activeColorLocal.b = next_b;
                activeColorLocal.a = next_a;

                this.activeColor = { ...activeColorLocal };
            } else {
                for (let i = 0; i < size * size * 4; i += 4) {
                    const r_canvas = currentData[i];
                    const g_canvas = currentData[i+1];
                    const b_canvas = currentData[i+2];
                    const a_canvas = currentData[i+3] / 255;

                    const r_acc = accumData![i];
                    const g_acc = accumData![i+1];
                    const b_acc = accumData![i+2];
                    const a_acc = accumData![i+3] / 255;

                    const w_acc = rate * a_acc;
                    const w_canvas = (1 - rate) * a_canvas;
                    const w_total = w_acc + w_canvas;

                    let next_r = r_acc;
                    let next_g = g_acc;
                    let next_b = b_acc;

                    if (w_total > 0.001) {
                        next_r = (w_acc * r_acc + w_canvas * r_canvas) / w_total;
                        next_g = (w_acc * g_acc + w_canvas * g_canvas) / w_total;
                        next_b = (w_acc * b_acc + w_canvas * b_canvas) / w_total;
                    }

                    let next_a = rate * a_acc + (1 - rate) * a_canvas;
                    if (!smearAlpha) {
                        next_a = Math.max(a_acc, a_canvas);
                    }

                    if (colorRate > 0) {
                        const w_next = (1 - colorRate) * next_a;
                        const w_fg = colorRate;
                        const w_paint = w_next + w_fg;

                        if (w_paint > 0.001) {
                            next_r = (w_next * next_r + w_fg * fgRgb.r) / w_paint;
                            next_g = (w_next * next_g + w_fg * fgRgb.g) / w_paint;
                            next_b = (w_next * next_b + w_fg * fgRgb.b) / w_paint;
                        }
                        next_a = next_a * (1 - colorRate) + colorRate;
                    }

                    accumData![i]   = Math.round(Math.max(0, Math.min(255, next_r)));
                    accumData![i+1] = Math.round(Math.max(0, Math.min(255, next_g)));
                    accumData![i+2] = Math.round(Math.max(0, Math.min(255, next_b)));
                    accumData![i+3] = Math.round(Math.max(0, Math.min(255, next_a * 255)));
                }
                accumCtx.putImageData(accumImg!, 0, 0);
            }
            
            for (let i = 0; i < size * size * 4; i += 4) {
                let mask_f = this.brushData![i + 3] / 255;
                if (selData) {
                    mask_f *= (selData[i + 3] / 255);
                }
                
                if (mask_f > 0) {
                    const r_canvas = currentData[i];
                    const g_canvas = currentData[i+1];
                    const b_canvas = currentData[i+2];
                    const a_canvas = currentData[i+3] / 255;

                    let paint_r = 0, paint_g = 0, paint_b = 0, paint_a = 0;

                    if (this.settings.mode === 'dulling') {
                        paint_r = activeColorLocal.r;
                        paint_g = activeColorLocal.g;
                        paint_b = activeColorLocal.b;
                        paint_a = activeColorLocal.a;
                    } else {
                        paint_r = accumData![i];
                        paint_g = accumData![i+1];
                        paint_b = accumData![i+2];
                        paint_a = accumData![i+3] / 255;
                    }

                    const pre_r = paint_r * paint_a * mask_f + r_canvas * a_canvas * (1 - mask_f);
                    const pre_g = paint_g * paint_a * mask_f + g_canvas * a_canvas * (1 - mask_f);
                    const pre_b = paint_b * paint_a * mask_f + b_canvas * a_canvas * (1 - mask_f);
                    
                    const final_a = paint_a * mask_f + a_canvas * (1 - mask_f);
                    
                    let final_r = r_canvas;
                    let g_final = g_canvas;
                    let b_final = b_canvas;
                    
                    if (final_a > 0.001) {
                        final_r = pre_r / final_a;
                        g_final = pre_g / final_a;
                        b_final = pre_b / final_a;
                    }
                    
                    currentData[i]   = Math.round(Math.max(0, Math.min(255, final_r)));
                    currentData[i+1] = Math.round(Math.max(0, Math.min(255, g_final)));
                    currentData[i+2] = Math.round(Math.max(0, Math.min(255, b_final)));
                    currentData[i+3] = Math.round(Math.max(0, Math.min(255, final_a * 255)));
                }
            }
            
            layer.ctx.putImageData(currentImg, sx, sy);
        };

        if (isInitial) {
            stampAt(p1.x, p1.y);
        } else {
            this.distanceAccumulator = interpolateDabs(p1, p2, this.distanceAccumulator, spacingPx, stampAt);
        }
    }
};

// Low-discrepancy Halton sequence generator for high-performance canvas sampling
function halton(index: number, base: number): number {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
        result += f * (i % base);
        i = Math.floor(i / base);
        f = f / base;
    }
    return result;
}

// Samples color under the brush using Krita-like convergence logic
function sampleCanvasColor(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    radius: number,
    brushData: Uint8ClampedArray | null,
    size: number,
    fallbackColor: { r: number, g: number, b: number }
): { r: number, g: number, b: number, a: number } {
    if (radius <= 2) {
        const img = ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1);
        const a = img.data[3];
        if (a > 0) {
            return { r: img.data[0], g: img.data[1], b: img.data[2], a };
        }
        return { r: fallbackColor.r, g: fallbackColor.g, b: fallbackColor.b, a: 0 };
    }

    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const rx = Math.round(cx - radius);
    const ry = Math.round(cy - radius);
    const rw = Math.round(radius * 2);
    const rh = Math.round(radius * 2);

    const sx = Math.max(0, Math.min(width - rw, rx));
    const sy = Math.max(0, Math.min(height - rh, ry));
    if (rw <= 0 || rh <= 0) {
        return { r: fallbackColor.r, g: fallbackColor.g, b: fallbackColor.b, a: 0 };
    }

    const imgData = ctx.getImageData(sx, sy, rw, rh);
    const data = imgData.data;

    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    let count = 0;
    let alphaCount = 0;

    const minSamples = Math.min(rw * rh, 64);
    const maxSamples = Math.min(rw * rh, 256);

    let lastR = 0, lastG = 0, lastB = 0, lastA = 0;

    for (let i = 1; i <= maxSamples; i++) {
        const hx = Math.floor(halton(i, 2) * rw);
        const hy = Math.floor(halton(i, 3) * rh);

        const dx = hx - radius;
        const dy = hy - radius;
        if (dx * dx + dy * dy <= radius * radius) {
            const idx = (hy * rw + hx) * 4;
            if (idx >= 0 && idx < data.length) {
                let weight = 1;
                if (brushData && size === rw) {
                    weight = brushData[idx + 3] / 255;
                }
                const pixelAlpha = data[idx + 3] / 255;
                const totalWeight = weight * pixelAlpha;

                sumR += data[idx] * totalWeight;
                sumG += data[idx + 1] * totalWeight;
                sumB += data[idx + 2] * totalWeight;
                sumA += data[idx + 3] * weight;
                count += totalWeight;
                alphaCount += weight;
            }
        }

        // Convergence evaluation check
        if (i >= minSamples && i % 16 === 0 && count > 0) {
            const currR = sumR / count;
            const currG = sumG / count;
            const currB = sumB / count;
            const currA = sumA / alphaCount;

            if (i > minSamples) {
                const diff = Math.abs(currR - lastR) + Math.abs(currG - lastG) + Math.abs(currB - lastB) + Math.abs(currA - lastA);
                if (diff < 2) {
                    break;
                }
            }
            lastR = currR;
            lastG = currG;
            lastB = currB;
            lastA = currA;
        }
    }

    if (count > 0 && alphaCount > 0) {
        return { r: sumR / count, g: sumG / count, b: sumB / count, a: sumA / alphaCount };
    }
    return { r: fallbackColor.r, g: fallbackColor.g, b: fallbackColor.b, a: 0 };
}


declare global {
    interface ToolRegistry {
        smudge: typeof SmudgeTool;
    }
}

App.registerTool(SmudgeTool);