import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

App.registerTool({
    id: 'healing',
    icon: '🩹',
    title: 'Healing Brush',
    settings: { mode: 'auto' as 'auto' | 'manual', size: 30, hardness: 50, spacing: 10, alignment: 'none' },

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
        panel.appendChild(UI.createHint('Choose Mode. Auto heals automatically. Alt+Click for Manual.'));

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

            panel.appendChild(UI.createSliderRow({
                label: 'Brush Size',
                min: 5,
                max: 100,
                value: this.settings.size,
                onInput: (v: string) => this.settings.size = parseInt(v)
            }));
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

        // Keep local copy of brush pixels for fast boundary checks
        this.brushData = bCtx.getImageData(0, 0, size, size).data;

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

        const width = layer.canvas.width;
        const height = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, width, height);
        const pixels = imgData.data;

        // Keep a copy of raw pixels for reference and boundary condition computations
        const pixelsOriginal = new Uint8ClampedArray(pixels);

        const mCtx = maskCanvas.getContext('2d')!;
        const mImgData = mCtx.getImageData(0, 0, width, height);
        const mPixels = mImgData.data;

        let minX = width, maxX = 0, minY = height, maxY = 0;
        let hasMask = false;
        const mask = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {
            const yOffset = y * width;
            for (let x = 0; x < width; x++) {
                const idx = yOffset + x;
                if (mPixels[idx * 4 + 3] > 10) {
                    mask[idx] = 1;
                    hasMask = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!hasMask) return;

        // Context padding extension
        const padding = 10;
        minX = Math.max(0, minX - padding);
        maxX = Math.min(width - 1, maxX + padding);
        minY = Math.max(0, minY - padding);
        maxY = Math.min(height - 1, maxY + padding);

        // BFS traversal for concentric onion peel scheduling
        const depth = new Int32Array(width * height).fill(-1);
        const queue: number[] = [];

        for (let y = minY; y <= maxY; y++) {
            const yOffset = y * width;
            for (let x = minX; x <= maxX; x++) {
                const idx = yOffset + x;
                if (mask[idx] === 1) {
                    let isBoundary = false;
                    if (x > 0 && mask[idx - 1] === 0) isBoundary = true;
                    else if (x < width - 1 && mask[idx + 1] === 0) isBoundary = true;
                    else if (y > 0 && mask[idx - width] === 0) isBoundary = true;
                    else if (y < height - 1 && mask[idx + width] === 0) isBoundary = true;

                    if (isBoundary) {
                        depth[idx] = 1;
                        queue.push(idx);
                    }
                }
            }
        }

        let head = 0;
        while (head < queue.length) {
            const curr = queue[head++];
            const cx = curr % width;
            const cy = Math.floor(curr / width);
            const currDepth = depth[curr];

            const neighbors = [curr - 1, curr + 1, curr - width, curr + width];
            for (let i = 0; i < neighbors.length; i++) {
                const nIdx = neighbors[i];
                if (nIdx >= 0 && nIdx < width * height) {
                    const nx = nIdx % width;
                    const ny = Math.floor(nIdx / width);
                    if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
                        if (mask[nIdx] === 1 && depth[nIdx] === -1) {
                            depth[nIdx] = currDepth + 1;
                            queue.push(nIdx);
                        }
                    }
                }
            }
        }

        const targetPixels: number[] = [];
        for (let y = minY; y <= maxY; y++) {
            const yOffset = y * width;
            for (let x = minX; x <= maxX; x++) {
                const idx = yOffset + x;
                if (mask[idx] === 1 && depth[idx] !== -1) {
                    targetPixels.push(idx);
                }
            }
        }

        targetPixels.sort((a, b) => depth[a] - depth[b]);

        const offsetsX = new Int16Array(width * height);
        const offsetsY = new Int16Array(width * height);
        const filled = new Uint8Array(width * height);

        const patchRadius = 3; 
        const searchRadius = 40;

        const evaluateOffset = (x: number, y: number, dx: number, dy: number): number => {
            let ssd = 0;
            let weightSum = 0;

            for (let py = -patchRadius; py <= patchRadius; py++) {
                const ty = y + py;
                const sy = y + dy + py;
                if (ty < 0 || ty >= height || sy < 0 || sy >= height) continue;

                const tyOffset = ty * width;
                const syOffset = sy * width;

                for (let px = -patchRadius; px <= patchRadius; px++) {
                    const tx = x + px;
                    const sx = x + dx + px;
                    if (tx < 0 || tx >= width || sx < 0 || sx >= width) continue;

                    const tIdx = tyOffset + tx;
                    if (mask[tIdx] === 0 || filled[tIdx] === 1) {
                        const sIdx = syOffset + sx;
                        const tIdx4 = tIdx * 4;
                        const sIdx4 = sIdx * 4;

                        const dr = pixels[tIdx4] - pixels[sIdx4];
                        const dg = pixels[tIdx4 + 1] - pixels[sIdx4 + 1];
                        const db = pixels[tIdx4 + 2] - pixels[sIdx4 + 2];
                        const da = pixels[tIdx4 + 3] - pixels[sIdx4 + 3];

                        const distSq = px * px + py * py;
                        const weight = 1 / (1 + distSq);

                        ssd += (dr * dr + dg * dg + db * db + da * da) * weight;
                        weightSum += weight;
                    }
                }
            }

            return weightSum > 0 ? ssd / weightSum : Infinity;
        };

        const checked = new Set<number>();

        for (let i = 0; i < targetPixels.length; i++) {
            const idx = targetPixels[i];
            const x = idx % width;
            const y = Math.floor(idx / width);

            let bestDx = 0;
            let bestDy = 0;
            let minScore = Infinity;

            checked.clear();

            const addCandidate = (dx: number, dy: number) => {
                const sx = x + dx;
                const sy = y + dy;
                if (sx < 0 || sx >= width || sy < 0 || sy >= height) return;
                if (mask[sy * width + sx] === 1) return;

                const key = (dx + 1000) * 2000 + (dy + 1000);
                if (checked.has(key)) return;
                checked.add(key);

                const score = evaluateOffset(x, y, dx, dy);
                if (score < minScore) {
                    minScore = score;
                    bestDx = dx;
                    bestDy = dy;
                }
            };

            // Neighbor propagation candidates
            const spatialNeighbors = [
                { nx: x - 1, ny: y },
                { nx: x + 1, ny: y },
                { nx: x, ny: y - 1 },
                { nx: x, ny: y + 1 }
            ];

            for (let j = 0; j < spatialNeighbors.length; j++) {
                const sn = spatialNeighbors[j];
                if (sn.nx >= 0 && sn.nx < width && sn.ny >= 0 && sn.ny < height) {
                    const nIdx = sn.ny * width + sn.nx;
                    if (mask[nIdx] === 0 || filled[nIdx] === 1) {
                        addCandidate(offsetsX[nIdx], offsetsY[nIdx]);
                    }
                }
            }

            // Fallback offset to nearest boundary context
            if (minScore === Infinity) {
                for (let r = 1; r <= searchRadius; r += 2) {
                    let found = false;
                    for (let dy = -r; dy <= r; dy += r) {
                        for (let dx = -r; dx <= r; dx += r) {
                            const sx = x + dx;
                            const sy = y + dy;
                            if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                                if (mask[sy * width + sx] === 0) {
                                    addCandidate(dx, dy);
                                    found = true;
                                }
                            }
                        }
                    }
                    if (found) break;
                }
            }

            // Multiscale localized random offset candidate search
            let currSearchRadius = searchRadius;
            while (currSearchRadius >= 1) {
                for (let step = 0; step < 4; step++) {
                    const rdx = bestDx + Math.round((Math.random() - 0.5) * 2 * currSearchRadius);
                    const rdy = bestDy + Math.round((Math.random() - 0.5) * 2 * currSearchRadius);
                    addCandidate(rdx, rdy);
                }
                currSearchRadius = Math.floor(currSearchRadius / 2);
            }

            // Safe fallback offset generator
            if (minScore === Infinity) {
                let found = false;
                for (let ty = 0; ty < height; ty++) {
                    for (let tx = 0; tx < width; tx++) {
                        if (mask[ty * width + tx] === 0) {
                            bestDx = tx - x;
                            bestDy = ty - y;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }

            offsetsX[idx] = bestDx;
            offsetsY[idx] = bestDy;

            const sourceIdx = (y + bestDy) * width + (x + bestDx);
            const tIdx4 = idx * 4;
            const sIdx4 = sourceIdx * 4;

            pixels[tIdx4] = pixels[sIdx4];
            pixels[tIdx4 + 1] = pixels[sIdx4 + 1];
            pixels[tIdx4 + 2] = pixels[sIdx4 + 2];
            pixels[tIdx4 + 3] = pixels[sIdx4 + 3];

            filled[idx] = 1;
        }

        ctx.putImageData(imgData, 0, 0);

        // Poisson Blend Difference Solver
        const gsIterations = 20;
        const w_sor = 1.4;
        const diff = new Float32Array(width * height * 4);

        for (let i = 0; i < targetPixels.length; i++) {
            const idx = targetPixels[i];
            const x = idx % width;
            const y = Math.floor(idx / width);
            const dx = offsetsX[idx];
            const dy = offsetsY[idx];

            const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
            for (let j = 0; j < neighbors.length; j++) {
                const nIdx = neighbors[j];
                if (nIdx >= 0 && nIdx < width * height && mask[nIdx] === 0) {
                    const nx = nIdx % width;
                    const ny = Math.floor(nIdx / width);
                    const sx = nx + dx;
                    const sy = ny + dy;
                    if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                        const sIdx = sy * width + sx;
                        for (let c = 0; c < 4; c++) {
                            diff[nIdx * 4 + c] = pixelsOriginal[nIdx * 4 + c] - pixelsOriginal[sIdx * 4 + c];
                        }
                    }
                }
            }
        }

        for (let it = 0; it < gsIterations; it++) {
            for (let i = 0; i < targetPixels.length; i++) {
                const idx = targetPixels[i];
                const x = idx % width;
                const y = Math.floor(idx / width);
                if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) continue;

                const up = idx - width;
                const down = idx + width;
                const left = idx - 1;
                const right = idx + 1;

                for (let c = 0; c < 4; c++) {
                    const cIdx = idx * 4 + c;
                    const average = (diff[up * 4 + c] + diff[down * 4 + c] + diff[left * 4 + c] + diff[right * 4 + c]) / 4;
                    diff[cIdx] += w_sor * (average - diff[cIdx]);
                }
            }
        }

        for (let i = 0; i < targetPixels.length; i++) {
            const idx = targetPixels[i];
            for (let c = 0; c < 4; c++) {
                const cIdx = idx * 4 + c;
                pixels[cIdx] = Math.max(0, Math.min(255, pixels[cIdx] + diff[cIdx]));
            }
        }

        ctx.putImageData(imgData, 0, 0);
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
    }
});