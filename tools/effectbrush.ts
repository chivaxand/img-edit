import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { BaseBrushTool, createBrushCanvas } from './tools';

// Effect Brush (Universal Filter Brush)
export class EffectBrushToolClass extends BaseBrushTool {
    id = 'effectbrush' as const;
    icon = '💧';
    title = 'Effect Brush (Universal Filters)';
    sortOrder = 140;
    settings = { mode: 'blur', size: 30, strength: 20, hardness: 50, spacing: 10 };
    protected accumulateWithinStroke = true;

    protected activeLayerCanvas: HTMLCanvasElement | null = null;

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSelectRow({
            label: 'Mode',
            value: this.settings.mode,
            options: [
                { value: 'blur', text: 'Blur' },
                { value: 'sharpen', text: 'Sharpen' },
                { value: 'invert', text: 'Invert' },
                { value: 'grayscale', text: 'Grayscale' },
                { value: 'sepia', text: 'Sepia' },
                { value: 'emboss', text: 'Emboss' },
                { value: 'threshold', text: 'Threshold' }
            ],
            onChange: (v: string) => {
                this.settings.mode = v;
                App.ui.updateToolSettings();
            }
        }));

        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 5, max: 150, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Strength', min: 1, max: 100, value: this.settings.strength, onInput: (v: string) => this.settings.strength = parseInt(v) }));
    }

    protected onStrokeStart(layer: Layer) {
        this.brushCanvas = createBrushCanvas(this.settings.size, this.settings.hardness);
        
        // Take a snapshot of current layer state for progressive non-destructive reading
        this.activeLayerCanvas = document.createElement('canvas');
        this.activeLayerCanvas.width = layer.canvas.width;
        this.activeLayerCanvas.height = layer.canvas.height;
        this.activeLayerCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    }

    protected onStrokeEnd() {
        this.activeLayerCanvas = null;
    }

    protected paintDab(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number, size: number) {
        if (!this.activeLayerCanvas) return;
        const sourceImg = this.activeLayerCanvas;

        const srcPiece = document.createElement('canvas');
        srcPiece.width = size;
        srcPiece.height = size;
        const sCtx = srcPiece.getContext('2d', { willReadFrequently: true })!;
        sCtx.drawImage(sourceImg, Math.round(sx), Math.round(sy), size, size, 0, 0, size, size);

        const destPiece = document.createElement('canvas');
        destPiece.width = size;
        destPiece.height = size;
        const dCtx = destPiece.getContext('2d', { willReadFrequently: true })!;

        const str = this.settings.strength / 100;
        const area = size * size;

        // Separable 1D Gaussian blur function
        const gaussianBlurLocal = (inputData: Uint8ClampedArray, blurRadius: number) => {
            const tempR = new Float32Array(area);
            const tempG = new Float32Array(area);
            const tempB = new Float32Array(area);
            const tempA = new Float32Array(area);

            const outR = new Float32Array(area);
            const outG = new Float32Array(area);
            const outB = new Float32Array(area);
            const outA = new Float32Array(area);

            const radVal = Math.max(1, Math.round(blurRadius));
            const sigma = radVal / 2;
            const kernelSize = radVal * 2 + 1;
            const weights = new Float32Array(kernelSize);
            let sum = 0;
            for (let i = 0; i < kernelSize; i++) {
                const xDiff = i - radVal;
                const w = Math.exp(-(xDiff * xDiff) / (2 * sigma * sigma));
                weights[i] = w;
                sum += w;
            }
            for (let i = 0; i < kernelSize; i++) weights[i] /= sum;

            // Horizontal pass
            for (let yCoord = 0; yCoord < size; yCoord++) {
                const yOff = yCoord * size;
                for (let xCoord = 0; xCoord < size; xCoord++) {
                    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
                    for (let k = 0; k < kernelSize; k++) {
                        const kx = Math.max(0, Math.min(size - 1, xCoord + k - radVal));
                        const sIdx = (yOff + kx) * 4;
                        const w = weights[k];
                        rSum += inputData[sIdx] * w;
                        gSum += inputData[sIdx + 1] * w;
                        bSum += inputData[sIdx + 2] * w;
                        aSum += inputData[sIdx + 3] * w;
                    }
                    const idx = yOff + xCoord;
                    tempR[idx] = rSum;
                    tempG[idx] = gSum;
                    tempB[idx] = bSum;
                    tempA[idx] = aSum;
                }
            }

            // Vertical pass
            for (let yCoord = 0; yCoord < size; yCoord++) {
                for (let xCoord = 0; xCoord < size; xCoord++) {
                    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
                    for (let k = 0; k < kernelSize; k++) {
                        const ky = Math.max(0, Math.min(size - 1, yCoord + k - radVal));
                        const idx = ky * size + xCoord;
                        const w = weights[k];
                        rSum += tempR[idx] * w;
                        gSum += tempG[idx] * w;
                        bSum += tempB[idx] * w;
                        aSum += tempA[idx] * w;
                    }
                    const idx = yCoord * size + xCoord;
                    outR[idx] = rSum;
                    outG[idx] = gSum;
                    outB[idx] = bSum;
                    outA[idx] = aSum;
                }
            }

            return { r: outR, g: outG, b: outB, a: outA };
        };

        const convolve3x3Local = (inputData: Uint8ClampedArray, kernel: number[], divisor: number, offset: number) => {
            const out = new Uint8ClampedArray(area * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    let rSum = 0, gSum = 0, bSum = 0;
                    for (let ky = 0; ky < 3; ky++) {
                        const py = Math.max(0, Math.min(size - 1, y + ky - 1));
                        const yOff = py * size;
                        for (let kx = 0; kx < 3; kx++) {
                            const px = Math.max(0, Math.min(size - 1, x + kx - 1));
                            const sIdx = (yOff + px) * 4;
                            const weight = kernel[ky * 3 + kx];
                            rSum += inputData[sIdx] * weight;
                            gSum += inputData[sIdx + 1] * weight;
                            bSum += inputData[sIdx + 2] * weight;
                        }
                    }
                    const idx = (y * size + x) * 4;
                    out[idx]     = Math.max(0, Math.min(255, rSum / divisor + offset));
                    out[idx + 1] = Math.max(0, Math.min(255, gSum / divisor + offset));
                    out[idx + 2] = Math.max(0, Math.min(255, bSum / divisor + offset));
                    out[idx + 3] = inputData[idx + 3];
                }
            }
            return out;
        };

        const srcData = sCtx.getImageData(0, 0, size, size).data;
        const destImg = dCtx.createImageData(size, size);
        const destPixels = destImg.data;

        if (this.settings.mode === 'blur') {
            const blurred = gaussianBlurLocal(srcData, size * 0.15);
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                destPixels[idx]     = blurred.r[i];
                destPixels[idx + 1] = blurred.g[i];
                destPixels[idx + 2] = blurred.b[i];
                destPixels[idx + 3] = blurred.a[i];
            }
            dCtx.putImageData(destImg, 0, 0);
        } else if (this.settings.mode === 'sharpen') {
            const blurred = gaussianBlurLocal(srcData, 2.5);
            const amount = str * 2.5;
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                destPixels[idx]     = Math.max(0, Math.min(255, srcData[idx]     + amount * (srcData[idx]     - blurred.r[i])));
                destPixels[idx + 1] = Math.max(0, Math.min(255, srcData[idx + 1] + amount * (srcData[idx + 1] - blurred.g[i])));
                destPixels[idx + 2] = Math.max(0, Math.min(255, srcData[idx + 2] + amount * (srcData[idx + 2] - blurred.b[i])));
                destPixels[idx + 3] = Math.max(0, Math.min(255, srcData[idx + 3] + amount * (srcData[idx + 3] - blurred.a[i])));
            }
            dCtx.putImageData(destImg, 0, 0);
        } else if (this.settings.mode === 'invert') {
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                destPixels[idx]     = 255 - srcData[idx];
                destPixels[idx + 1] = 255 - srcData[idx + 1];
                destPixels[idx + 2] = 255 - srcData[idx + 2];
                destPixels[idx + 3] = srcData[idx + 3];
            }
            dCtx.putImageData(destImg, 0, 0);
        } else if (this.settings.mode === 'grayscale') {
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                const gray = 0.299 * srcData[idx] + 0.587 * srcData[idx + 1] + 0.114 * srcData[idx + 2];
                destPixels[idx]     = gray;
                destPixels[idx + 1] = gray;
                destPixels[idx + 2] = gray;
                destPixels[idx + 3] = srcData[idx + 3];
            }
            dCtx.putImageData(destImg, 0, 0);
        } else if (this.settings.mode === 'sepia') {
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                const r = srcData[idx], g = srcData[idx + 1], b = srcData[idx + 2];
                destPixels[idx]     = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
                destPixels[idx + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
                destPixels[idx + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
                destPixels[idx + 3] = srcData[idx + 3];
            }
            dCtx.putImageData(destImg, 0, 0);
        } else if (this.settings.mode === 'emboss') {
            const kernel = [-2, -1, 0, -1, 1, 1, 0, 1, 2];
            const result = convolve3x3Local(srcData, kernel, 1, 128);
            destPixels.set(result);
            dCtx.putImageData(destImg, 0, 0);
        } else if (this.settings.mode === 'threshold') {
            const thresholdVal = 128;
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                const v = (srcData[idx] + srcData[idx + 1] + srcData[idx + 2]) / 3;
                const outV = v >= thresholdVal ? 255 : 0;
                destPixels[idx]     = outV;
                destPixels[idx + 1] = outV;
                destPixels[idx + 2] = outV;
                destPixels[idx + 3] = srcData[idx + 3];
            }
            dCtx.putImageData(destImg, 0, 0);
        }

        const maskPiece = document.createElement('canvas');
        maskPiece.width = size;
        maskPiece.height = size;
        const mCtx = maskPiece.getContext('2d')!;
        mCtx.drawImage(destPiece, 0, 0);
        mCtx.globalCompositeOperation = 'destination-in';
        mCtx.drawImage(this.brushCanvas!, 0, 0);

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = str;
        ctx.drawImage(maskPiece, Math.round(sx), Math.round(sy));
        ctx.restore();
    }
}

// Color & Blend Brush Tool
export class ColorBlendBrushToolClass extends BaseBrushTool {
    id = 'colorblendbrush' as const;
    icon = '🎨';
    title = 'Color & Blend Brush';
    sortOrder = 141;
    settings = { mode: 'color', size: 30, strength: 50, hardness: 50, spacing: 10, tolerance: 40 };
    protected accumulateWithinStroke = true;

    protected activeLayerCanvas: HTMLCanvasElement | null = null;

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSelectRow({
            label: 'Mode',
            value: this.settings.mode,
            options: [
                { value: 'color', text: 'Color (HSL)' },
                { value: 'hue', text: 'Hue (HSL)' },
                { value: 'saturation', text: 'Saturation' },
                { value: 'luminosity', text: 'Luminosity' },
                { value: 'dodge', text: 'Dodge (Lighten)' },
                { value: 'burn', text: 'Burn (Darken)' },
                { value: 'color-erase', text: 'Color Erase' }
            ],
            onChange: (v: string) => {
                this.settings.mode = v;
                App.ui.updateToolSettings();
            }
        }));

        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 5, max: 150, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Strength', min: 1, max: 100, value: this.settings.strength, onInput: (v: string) => this.settings.strength = parseInt(v) }));

        if (this.settings.mode === 'color-erase') {
            panel.appendChild(UI.createSliderRow({ label: 'Tolerance', min: 1, max: 255, value: this.settings.tolerance, onInput: (v: string) => this.settings.tolerance = parseInt(v) }));
        }
    }

    protected onStrokeStart(layer: Layer) {
        this.brushCanvas = createBrushCanvas(this.settings.size, this.settings.hardness);
        
        // Snap active canvas region
        this.activeLayerCanvas = document.createElement('canvas');
        this.activeLayerCanvas.width = layer.canvas.width;
        this.activeLayerCanvas.height = layer.canvas.height;
        this.activeLayerCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    }

    protected onStrokeEnd() {
        this.activeLayerCanvas = null;
    }

    protected paintDab(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number, size: number) {
        if (!this.activeLayerCanvas) return;
        const sourceImg = this.activeLayerCanvas;

        const srcPiece = document.createElement('canvas');
        srcPiece.width = size;
        srcPiece.height = size;
        const sCtx = srcPiece.getContext('2d', { willReadFrequently: true })!;
        sCtx.drawImage(sourceImg, Math.round(sx), Math.round(sy), size, size, 0, 0, size, size);

        const destPiece = document.createElement('canvas');
        destPiece.width = size;
        destPiece.height = size;
        const dCtx = destPiece.getContext('2d', { willReadFrequently: true })!;

        const srcData = sCtx.getImageData(0, 0, size, size).data;
        const destImg = dCtx.createImageData(size, size);
        const destPixels = destImg.data;
        const area = size * size;
        const str = this.settings.strength / 100;

        const fgColor = App.utils.hexToRgb(App.state.fg) || { r: 255, g: 0, b: 0 };
        const fgHsl = rgbToHsl(fgColor.r, fgColor.g, fgColor.b);

        for (let i = 0; i < area; i++) {
            const idx = i * 4;
            const r = srcData[idx], g = srcData[idx + 1], b = srcData[idx + 2], a = srcData[idx + 3];

            if (a === 0 && this.settings.mode !== 'color-erase') {
                destPixels[idx] = r;
                destPixels[idx + 1] = g;
                destPixels[idx + 2] = b;
                destPixels[idx + 3] = a;
                continue;
            }

            const hsl = rgbToHsl(r, g, b);

            if (this.settings.mode === 'color') {
                const rgb = hslToRgb(fgHsl.h, fgHsl.s, hsl.l);
                destPixels[idx]     = rgb.r;
                destPixels[idx + 1] = rgb.g;
                destPixels[idx + 2] = rgb.b;
                destPixels[idx + 3] = a;
            } else if (this.settings.mode === 'hue') {
                const rgb = hslToRgb(fgHsl.h, hsl.s, hsl.l);
                destPixels[idx]     = rgb.r;
                destPixels[idx + 1] = rgb.g;
                destPixels[idx + 2] = rgb.b;
                destPixels[idx + 3] = a;
            } else if (this.settings.mode === 'saturation') {
                const rgb = hslToRgb(hsl.h, fgHsl.s, hsl.l);
                destPixels[idx]     = rgb.r;
                destPixels[idx + 1] = rgb.g;
                destPixels[idx + 2] = rgb.b;
                destPixels[idx + 3] = a;
            } else if (this.settings.mode === 'luminosity') {
                const rgb = hslToRgb(hsl.h, hsl.s, fgHsl.l);
                destPixels[idx]     = rgb.r;
                destPixels[idx + 1] = rgb.g;
                destPixels[idx + 2] = rgb.b;
                destPixels[idx + 3] = a;
            } else if (this.settings.mode === 'dodge') {
                const rgb = hslToRgb(hsl.h, hsl.s, Math.min(1, hsl.l + 0.15 * str));
                destPixels[idx]     = rgb.r;
                destPixels[idx + 1] = rgb.g;
                destPixels[idx + 2] = rgb.b;
                destPixels[idx + 3] = a;
            } else if (this.settings.mode === 'burn') {
                const rgb = hslToRgb(hsl.h, hsl.s, Math.max(0, hsl.l - 0.15 * str));
                destPixels[idx]     = rgb.r;
                destPixels[idx + 1] = rgb.g;
                destPixels[idx + 2] = rgb.b;
                destPixels[idx + 3] = a;
            } else if (this.settings.mode === 'color-erase') {
                const tolerance = this.settings.tolerance;
                const dist = Math.sqrt(
                    (r - fgColor.r) ** 2 +
                    (g - fgColor.g) ** 2 +
                    (b - fgColor.b) ** 2
                );
                if (dist < tolerance) {
                    destPixels[idx]     = 0;
                    destPixels[idx + 1] = 0;
                    destPixels[idx + 2] = 0;
                    destPixels[idx + 3] = Math.round(255 * (1.0 - dist / tolerance));
                } else {
                    destPixels[idx]     = 0;
                    destPixels[idx + 1] = 0;
                    destPixels[idx + 2] = 0;
                    destPixels[idx + 3] = 0;
                }
            }
        }

        dCtx.putImageData(destImg, 0, 0);

        const maskPiece = document.createElement('canvas');
        maskPiece.width = size;
        maskPiece.height = size;
        const mCtx = maskPiece.getContext('2d')!;
        mCtx.drawImage(destPiece, 0, 0);
        mCtx.globalCompositeOperation = 'destination-in';
        mCtx.drawImage(this.brushCanvas!, 0, 0);

        const isErase = this.settings.mode === 'color-erase';

        ctx.save();
        ctx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
        ctx.globalAlpha = this.settings.mode === 'dodge' || this.settings.mode === 'burn' ? 1.0 : str;
        ctx.drawImage(maskPiece, Math.round(sx), Math.round(sy));
        ctx.restore();
    }
}

// Universal math helpers for HSL conversion
function rgbToHsl(r: number, g: number, b: number) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export const EffectBrushTool = new EffectBrushToolClass();
export const ColorBlendBrushTool = new ColorBlendBrushToolClass();

declare global {
    interface ToolRegistry {
        effectbrush: typeof EffectBrushTool;
        colorblendbrush: typeof ColorBlendBrushTool;
    }
}

App.registerTool(EffectBrushTool);
App.registerTool(ColorBlendBrushTool);
