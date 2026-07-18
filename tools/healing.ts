import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { INPAINT_ALGORITHMS } from '~/filters/gen/inpaint/inpaint';
import { createBrushCanvas, interpolateDabs, drawActiveBrushCircle } from './basics';

App.registerTool({
    id: 'healing',
    icon: '🩹',
    title: 'Healing Brush',
    settings: { mode: 'auto' as 'auto' | 'manual', algorithm: 'patch_match', algoSettings: {} as Record<string, any>, size: 30, hardness: 50, spacing: 10, alignment: 'none', softness: 0 },

    // State
    sourceAnchor: null as { x: number, y: number, layer: Layer } | null,
    offset: null as { dx: number, dy: number } | null,
    distanceAccumulator: 0,

    brushCanvas: null as HTMLCanvasElement | null,
    brushData: null as Uint8ClampedArray | null,
    tempCanvas: null as HTMLCanvasElement | null,

    // Temp mask canvases for auto mode
    autoMaskCanvas: null as HTMLCanvasElement | null,
    autoMaskCtx: null as CanvasRenderingContext2D | null,

    onSelect(panel: HTMLElement) {
        if (Object.keys(this.settings.algoSettings).length === 0) {
            INPAINT_ALGORITHMS.forEach(algo => {
                Object.assign(this.settings.algoSettings, algo.defaultSettings);
            });
        }

        panel.appendChild(UI.createHint('Choose Mode. Auto heals automatically. Alt+Click for Manual.'));

        panel.appendChild(UI.createSliderRow({
            label: 'Brush Size',
            min: 5,
            max: 100,
            value: this.settings.size,
            onInput: (v: string) => this.settings.size = parseInt(v)
        }));

        // Mode Selection
        panel.appendChild(UI.createSelectRow({
            label: 'Mode',
            value: this.settings.mode,
            options: [
                { value: 'auto', text: 'Auto (Content-Aware)' },
                { value: 'manual', text: 'Manual (Source Point)' }
            ],
            onChange: (v: string) => {
                this.settings.mode = v as 'auto' | 'manual';
                App.ui.updateToolSettings();
            }
        }));

        if (this.settings.mode === 'auto') {
            // Algorithm Selection
            panel.appendChild(UI.createSelectRow({
                label: 'Algorithm',
                value: this.settings.algorithm,
                options: INPAINT_ALGORITHMS.map(a => ({ value: a.id, text: a.name })),
                onChange: (v: string) => {
                    this.settings.algorithm = v;
                    updateVisibility();
                }
            }));

            const rows: { el: HTMLElement, algoId: string, condition?: (s: any) => boolean }[] = [];

            INPAINT_ALGORITHMS.forEach(algo => {
                algo.parameters.forEach(param => {
                    let el: HTMLElement;
                    if (param.type === 'slider') {
                        el = UI.createSliderRow({
                            label: param.label, min: param.min!, max: param.max!, step: param.step!, value: this.settings.algoSettings[param.id],
                            onInput: (v: string) => { this.settings.algoSettings[param.id] = parseFloat(v); updateVisibility(); }
                        });
                    } else if (param.type === 'select') {
                        el = UI.createSelectRow({
                            label: param.label, options: param.options!, value: this.settings.algoSettings[param.id],
                            onChange: (v: string) => { this.settings.algoSettings[param.id] = v; updateVisibility(); }
                        });
                    } else if (param.type === 'color') {
                        el = UI.createColorRow({
                            label: param.label, value: this.settings.algoSettings[param.id],
                            onChange: (v: string) => { this.settings.algoSettings[param.id] = v; updateVisibility(); }
                        });
                    }
                    panel.appendChild(el!);
                    rows.push({ el: el!, algoId: algo.id, condition: param.condition });
                });
            });

            const updateVisibility = () => {
                rows.forEach(r => {
                    const isVisible = r.algoId === this.settings.algorithm && (!r.condition || r.condition(this.settings.algoSettings));
                    UI.toggle(r.el, isVisible);
                });
            };
            updateVisibility();

            // Edge Softness
            panel.appendChild(UI.createSliderRow({
                label: 'Edge Softness',
                min: 0,
                max: 50,
                step: 1,
                value: this.settings.softness,
                onInput: (v: string) => this.settings.softness = parseInt(v)
            }));

            // Button to heal active selection if active
            const btnHealSel = UI.createNode('button', {
                className: 'btn',
                style: 'width: 100%; margin: 5px 0; font-weight: bold; background-color: #007acc; color: white;',
                textContent: 'Heal Active Selection',
                on: {
                    click: () => {
                        const l = App.utils.getActive();
                        if (!l) {
                            alert('No active layer.');
                            return;
                        }
                        if (!App.state.selection.active || !App.state.selection.mask) {
                            alert('No active selection to heal. Use the Selection tool first.');
                            return;
                        }
                        this.healMask(l, App.state.selection.mask);
                    }
                }
            });
            panel.appendChild(btnHealSel);
        } else {
            panel.appendChild(UI.createSliderRow({ label: 'Size', min: 5, max: 100, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
            panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
            panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 200, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
            panel.appendChild(UI.createSelectRow({
                label: 'Align',
                value: this.settings.alignment,
                options: [
                    { value: 'aligned', text: 'Aligned' },
                    { value: 'none', text: 'None' }
                ],
                onChange: (v: string) => this.settings.alignment = v
            }));
        }
    },

    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;

        const pos = App.utils.getPos(e);
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        // Handle auto mode drawing
        if (this.settings.mode === 'auto') {
            if (!App.utils.layerIs(l, 'editable')) {
                alert('Layer is not editable.'); 
                return;
            }

            App.state.isDrawing = true;
            App.state.last = { x: lx, y: ly };

            this.autoMaskCanvas = document.createElement('canvas');
            this.autoMaskCanvas.width = l.canvas.width;
            this.autoMaskCanvas.height = l.canvas.height;
            this.autoMaskCtx = this.autoMaskCanvas.getContext('2d')!;

            this.drawAutoMaskDab(lx, ly, lx, ly);
            App.emit('render');
            return;
        }

        // Set Source Anchor
        if (e.altKey) {
            this.sourceAnchor = { x: lx, y: ly, layer: l };
            this.offset = null; 
            App.render();
            return;
        }

        if (!this.sourceAnchor) {
            alert('Alt+Click to set a source point first.');
            return;
        }
        
        if (!App.utils.layerIs(l, 'editable')) {
            alert('Layer is not editable.'); 
            return;
        }

        App.actions.saveState();
        App.state.isDrawing = true;
        
        if (this.settings.alignment === 'none' || !this.offset) {
            this.offset = {
                dx: lx - this.sourceAnchor.x,
                dy: ly - this.sourceAnchor.y
            };
        }

        App.state.last = { x: lx, y: ly };

        // Generate brush mask
        const size = this.settings.size;
        this.brushCanvas = createBrushCanvas(size, this.settings.hardness);

        // Keep local copy of brush pixels for fast boundary checks
        this.brushData = this.brushCanvas.getContext('2d')!.getImageData(0, 0, size, size).data;

        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = size;
        this.tempCanvas.height = size;

        const spacingPx = Math.max(1, this.settings.size * (this.settings.spacing / 100));
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

        if (this.settings.mode === 'auto') {
            this.drawAutoMaskDab(App.state.last.x, App.state.last.y, curr.x, curr.y);
            App.state.last = curr;
            App.emit('render');
            return;
        }

        this.stampDabs(l, App.state.last, curr, false);
        App.state.last = curr;
        App.emit('render');
    },

    onMouseUp() {
        if (App.state.isDrawing) {
            App.state.isDrawing = false;
            
            if (this.settings.mode === 'auto' && this.autoMaskCanvas) {
                const l = App.utils.getActive();
                if (l) {
                    this.healMask(l, this.autoMaskCanvas);
                }
                this.autoMaskCanvas = null;
                this.autoMaskCtx = null;
            } else {
                this.brushCanvas = null;
                this.brushData = null;
                this.tempCanvas = null;
                this.distanceAccumulator = 0;
            }
            App.emit('render');
        }
    },

    drawAutoMaskDab(x1: number, y1: number, x2: number, y2: number) {
        if (!this.autoMaskCtx) return;
        this.autoMaskCtx.save();
        this.autoMaskCtx.lineCap = 'round';
        this.autoMaskCtx.lineJoin = 'round';
        this.autoMaskCtx.strokeStyle = 'rgba(255, 0, 0, 1.0)';
        this.autoMaskCtx.lineWidth = this.settings.size;
        this.autoMaskCtx.beginPath();
        this.autoMaskCtx.moveTo(x1, y1);
        this.autoMaskCtx.lineTo(x2, y2);
        this.autoMaskCtx.stroke();
        this.autoMaskCtx.restore();
    },

    healMask(layer: Layer, maskCanvas: HTMLCanvasElement) {
        App.actions.saveState();
        const algo = INPAINT_ALGORITHMS.find(a => a.id === this.settings.algorithm) || INPAINT_ALGORITHMS[0];
        algo.apply(layer, maskCanvas, this.settings.algoSettings, this.settings.softness);
        App.emit('layer:content');
        App.emit('render');
    },

    stampDabs(layer: Layer, p1: {x: number, y: number}, p2: {x: number, y: number}, isInitial: boolean) {
        const size = this.settings.size;
        const r = size / 2;
        const spacingPx = Math.max(1, size * (this.settings.spacing / 100));
        const tCtx = this.tempCanvas!.getContext('2d', { willReadFrequently: true })!;

        const stampAt = (px: number, py: number) => {
            const sx = px - this.offset!.dx;
            const sy = py - this.offset!.dy;

            tCtx.clearRect(0, 0, size, size);

            const srcPiece = document.createElement('canvas');
            srcPiece.width = size;
            srcPiece.height = size;
            const sCtx = srcPiece.getContext('2d', { willReadFrequently: true })!;
            sCtx.drawImage(this.sourceAnchor!.layer.canvas, Math.round(sx - r), Math.round(sy - r), size, size, 0, 0, size, size);

            const destPiece = document.createElement('canvas');
            destPiece.width = size;
            destPiece.height = size;
            const dCtx = destPiece.getContext('2d', { willReadFrequently: true })!;
            dCtx.drawImage(layer.canvas, Math.round(px - r), Math.round(py - r), size, size, 0, 0, size, size);

            const srcImg = sCtx.getImageData(0, 0, size, size);
            const destImg = dCtx.getImageData(0, 0, size, size);

            const srcData = srcImg.data;
            const destData = destImg.data;

            const area = size * size;
            const diffR = new Float32Array(area);
            const diffG = new Float32Array(area);
            const diffB = new Float32Array(area);
            const diffA = new Float32Array(area);

            // Construct base difference fields (Dest - Src)
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                diffR[i] = destData[idx] - srcData[idx];
                diffG[i] = destData[idx + 1] - srcData[idx + 1];
                diffB[i] = destData[idx + 2] - srcData[idx + 2];
                diffA[i] = destData[idx + 3] - srcData[idx + 3];
            }

            // Gauss-Seidel Successive Over-Relaxation Laplace solver with Dirichlet boundaries
            const iterations = 40;
            const w_sor = 1.42;

            for (let it = 0; it < iterations; it++) {
                for (let y = 1; y < size - 1; y++) {
                    const y_offset = y * size;
                    for (let x = 1; x < size - 1; x++) {
                        const idx = y_offset + x;
                        const mIdx = idx * 4;
                        
                        // Solve only inside the brush boundary mask
                        if (this.brushData![mIdx + 3] > 10) {
                            const up = idx - size;
                            const down = idx + size;
                            const left = idx - 1;
                            const right = idx + 1;

                            const rNew = (diffR[up] + diffR[down] + diffR[left] + diffR[right]) / 4;
                            const gNew = (diffG[up] + diffG[down] + diffG[left] + diffG[right]) / 4;
                            const bNew = (diffB[up] + diffB[down] + diffB[left] + diffB[right]) / 4;
                            const aNew = (diffA[up] + diffA[down] + diffA[left] + diffA[right]) / 4;

                            diffR[idx] += w_sor * (rNew - diffR[idx]);
                            diffG[idx] += w_sor * (gNew - diffG[idx]);
                            diffB[idx] += w_sor * (bNew - diffB[idx]);
                            diffA[idx] += w_sor * (aNew - diffA[idx]);
                        }
                    }
                }
            }

            // Write back healed pixels by adding solved difference map to the source pattern
            for (let i = 0; i < area; i++) {
                const idx = i * 4;
                destData[idx]     = Math.max(0, Math.min(255, diffR[i] + srcData[idx]));
                destData[idx + 1] = Math.max(0, Math.min(255, diffG[i] + srcData[idx + 1]));
                destData[idx + 2] = Math.max(0, Math.min(255, diffB[i] + srcData[idx + 2]));
                destData[idx + 3] = Math.max(0, Math.min(255, diffA[i] + srcData[idx + 3]));
            }
            dCtx.putImageData(destImg, 0, 0);

            // Apply GIMP Dirichlet-Laplace result to tempCanvas masked by brush hardness
            tCtx.drawImage(destPiece, 0, 0);
            tCtx.globalCompositeOperation = 'destination-in';
            tCtx.drawImage(this.brushCanvas!, 0, 0);
            tCtx.globalCompositeOperation = 'source-over';

            layer.ctx.save();
            layer.ctx.globalCompositeOperation = 'source-over';
            layer.ctx.drawImage(this.tempCanvas!, Math.round(px - r), Math.round(py - r));
            layer.ctx.restore();
        };

        if (isInitial) {
            stampAt(p1.x, p1.y);
        } else {
            this.distanceAccumulator = interpolateDabs(p1, p2, this.distanceAccumulator, spacingPx, stampAt);
        }
    },

    drawUI() {
        // Render the auto mask stroke overlay if drawing
        if (this.settings.mode === 'auto' && this.autoMaskCanvas) {
            const ctx = App.els.ctx;
            const l = App.utils.getActive();
            if (l && l.visible) {
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.drawImage(this.autoMaskCanvas, l.x, l.y, l.width, l.height);
                ctx.restore();
            }
        }

        // Render the source anchor if manual mode
        if (this.settings.mode === 'manual' && this.sourceAnchor) {
            const ctx = App.els.ctx;
            const l = this.sourceAnchor.layer;
            if (!l.visible) return;
            
            let lx = this.sourceAnchor.x;
            let ly = this.sourceAnchor.y;
            
            if (this.offset && App.state.isDrawing) {
                lx = App.state.last.x - this.offset.dx;
                ly = App.state.last.y - this.offset.dy;
            }

            const gx = lx * (l.width / l.canvas.width) + l.x;
            const gy = ly * (l.height / l.canvas.height) + l.y;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(gx - 6, gy);
            ctx.lineTo(gx + 6, gy);
            ctx.moveTo(gx, gy - 6);
            ctx.lineTo(gx, gy + 6);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            if (lx === this.sourceAnchor.x && ly === this.sourceAnchor.y) {
                ctx.beginPath();
                ctx.arc(gx, gy, this.settings.size / 2 * (l.width / l.canvas.width), 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.lineDashOffset = 4;
                ctx.stroke();
            }
            
            ctx.restore();
        }

        drawActiveBrushCircle(this.settings.size);
    }
});
