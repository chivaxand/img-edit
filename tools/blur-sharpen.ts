import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

App.registerTool({
    id: 'effectbrush',
    icon: '💧',
    title: 'Effect Brush (Blur/Sharpen)',
    settings: { mode: 'blur', size: 30, strength: 50, hardness: 50 },

    brushCanvas: null as HTMLCanvasElement | null,
    brushData: null as Uint8ClampedArray | null,
    distanceAccumulator: 0,

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSelectRow({
            label: 'Mode',
            value: this.settings.mode,
            options: [
                { value: 'blur', text: 'Blur' },
                { value: 'sharpen', text: 'Sharpen' }
            ],
            onChange: (v: string) => {
                this.settings.mode = v;
                App.ui.updateToolSettings();
            }
        }));

        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 5, max: 150, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Strength', min: 1, max: 100, value: this.settings.strength, onInput: (v: string) => this.settings.strength = parseInt(v) }));
    },

    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        if (!App.utils.layerIs(l, 'editable')) { 
            alert('Layer is not editable.'); 
            return; 
        }

        App.actions.saveState();
        App.state.isDrawing = true;

        const pos = App.utils.getPos(e);
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        App.state.last = { x: lx, y: ly };

        const size = this.settings.size;
        this.brushCanvas = document.createElement('canvas');
        this.brushCanvas.width = size;
        this.brushCanvas.height = size;
        const bCtx = this.brushCanvas.getContext('2d')!;
        const r = size / 2;
        const grad = bCtx.createRadialGradient(r, r, 0, r, r, r);
        const stop0 = Math.max(0, Math.min(1, this.settings.hardness / 100));
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        if (stop0 < 1 && stop0 > 0) grad.addColorStop(stop0, 'rgba(0,0,0,1)');
        if (stop0 < 1) grad.addColorStop(1, 'rgba(0,0,0,0)');
        bCtx.fillStyle = grad;
        bCtx.beginPath();
        bCtx.arc(r, r, r, 0, Math.PI * 2);
        bCtx.fill();

        this.brushData = bCtx.getImageData(0, 0, size, size).data;

        const sel = App.state.selection;
        if (sel.active && sel.mask && sel.layerId === l.id) {
            App.state.scratch = document.createElement('canvas');
            App.state.scratch.width = l.canvas.width;
            App.state.scratch.height = l.canvas.height;
        } else {
            App.state.scratch = null;
        }

        const spacingPx = Math.max(1, size * 0.1);
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
            this.brushData = null;
            this.distanceAccumulator = 0;
        }
    },

    stampDabs(layer: Layer, p1: {x: number, y: number}, p2: {x: number, y: number}, isInitial: boolean) {
        const size = this.settings.size;
        const r = size / 2;
        const spacingPx = Math.max(1, size * 0.1);
        
        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === layer.id;
        let targetCtx = layer.ctx;

        if (hasSel && App.state.scratch) {
            targetCtx = App.state.scratch.getContext('2d')!;
            targetCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        }

        const stampAt = (px: number, py: number) => {
            const sx = Math.round(px - r);
            const sy = Math.round(py - r);

            const srcPiece = document.createElement('canvas');
            srcPiece.width = size;
            srcPiece.height = size;
            const sCtx = srcPiece.getContext('2d', { willReadFrequently: true })!;
            sCtx.drawImage(layer.canvas, sx, sy, size, size, 0, 0, size, size);

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
                for (let yCoord = 0; yOff = yCoord * size, yCoord < size; yCoord++) {
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

            var yOff: number;

            if (this.settings.mode === 'blur') {
                const srcData = sCtx.getImageData(0, 0, size, size).data;
                const blurred = gaussianBlurLocal(srcData, size * 0.15);
                const destImg = dCtx.createImageData(size, size);
                const destPixels = destImg.data;
                for (let i = 0; i < area; i++) {
                    const idx = i * 4;
                    destPixels[idx]     = blurred.r[i];
                    destPixels[idx + 1] = blurred.g[i];
                    destPixels[idx + 2] = blurred.b[i];
                    destPixels[idx + 3] = blurred.a[i];
                }
                dCtx.putImageData(destImg, 0, 0);
            } 
            else if (this.settings.mode === 'sharpen') {
                const srcData = sCtx.getImageData(0, 0, size, size).data;
                const blurred = gaussianBlurLocal(srcData, 2.5);
                const destImg = dCtx.createImageData(size, size);
                const destPixels = destImg.data;
                const amount = str * 2.5;
                for (let i = 0; i < area; i++) {
                    const idx = i * 4;
                    destPixels[idx]     = Math.max(0, Math.min(255, srcData[idx]     + amount * (srcData[idx]     - blurred.r[i])));
                    destPixels[idx + 1] = Math.max(0, Math.min(255, srcData[idx + 1] + amount * (srcData[idx + 1] - blurred.g[i])));
                    destPixels[idx + 2] = Math.max(0, Math.min(255, srcData[idx + 2] + amount * (srcData[idx + 2] - blurred.b[i])));
                    destPixels[idx + 3] = Math.max(0, Math.min(255, srcData[idx + 3] + amount * (srcData[idx + 3] - blurred.a[i])));
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

            targetCtx.save();
            targetCtx.globalAlpha = str;
            targetCtx.drawImage(maskPiece, sx, sy);
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

            layer.ctx.globalCompositeOperation = 'source-over';
            layer.ctx.drawImage(App.state.scratch, 0, 0);
        }
    }
});