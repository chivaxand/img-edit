import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters, FilterContext } from '~/filters';
import { Lib } from '~/libs/index';

// Binary Heap Priority Queue for Meyer's Flooding algorithm
class PriorityQueue {
    private heap: Array<{ idx: number; val: number }> = [];

    push(idx: number, val: number) {
        this.heap.push({ idx, val });
        this.up(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const top = this.heap[0];
        const bottom = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this.down(0);
        }
        return top;
    }

    private up(i: number) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.heap[p].val <= this.heap[i].val) break;
            const tmp = this.heap[p];
            this.heap[p] = this.heap[i];
            this.heap[i] = tmp;
            i = p;
        }
    }

    private down(i: number) {
        const len = this.heap.length;
        while ((i << 1) + 1 < len) {
            const left = (i << 1) + 1;
            const right = left + 1;
            let best = i;
            if (this.heap[left].val < this.heap[best].val) best = left;
            if (right < len && this.heap[right].val < this.heap[best].val) best = right;
            if (best === i) break;
            const tmp = this.heap[i];
            this.heap[i] = this.heap[best];
            this.heap[best] = tmp;
            i = best;
        }
    }

    size() {
        return this.heap.length;
    }
}

// Connected Component Labeling BFS to auto-detect and merge stroke segments
const runCCA = (maskData: Uint8ClampedArray, w: number, h: number) => {
    const visited = new Uint8Array(w * h);
    const labels = new Int32Array(w * h);
    let currentComponentId = 0;

    for (let y = 0; y < h; y++) {
        const yOffset = y * w;
        for (let x = 0; x < w; x++) {
            const u = yOffset + x;
            const idx = u * 4;

            if (maskData[idx] > 10 && maskData[idx + 3] > 50 && visited[u] === 0) {
                currentComponentId++;
                const queue: number[] = [u];
                visited[u] = 1;
                let head = 0;

                while (head < queue.length) {
                    const curr = queue[head++];
                    labels[curr] = currentComponentId;

                    const cx = curr % w;
                    const cy = Math.floor(curr / w);

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = cx + dx;
                            const ny = cy + dy;
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                const nu = ny * w + nx;
                                const nIdx = nu * 4;
                                if (maskData[nIdx] > 10 && maskData[nIdx + 3] > 50 && visited[nu] === 0) {
                                    visited[nu] = 1;
                                    queue.push(nu);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return { labels, count: currentComponentId };
};

// Interactive Watershed Segmentation Filter Controller
export const WatershedFilter = {
    open() {
        const layer = App.utils.getActive();
        if (!layer) return alert('No active layer selected.');
        if (!App.utils.layerIs(layer, 'editable')) {
            alert('Layer is not editable. Rasterize it first.');
            return;
        }

        const fullW = layer.canvas.width;
        const fullH = layer.canvas.height;

        this.injectStyles();

        // Workspace States
        let seeds = [
            { id: 1, name: 'Background (Seed 1)', color: '#2196f3' }
        ];
        let brushType: 'obj' | 'bg' | 'erase' = 'obj';
        let currentStrokeBrush: 'obj' | 'bg' | 'erase' | null = null;
        let brushSize = 5;
        let solverMaxDim = 500;
        let edgeSoftness = 3;
        let borderThickness = 1;
        let borderColor = '#ff0000';
        let showBorder = false;
        let removeBackground = true;
        let realtimeUpdate = true;
        let viewMode: 'cutout' | 'classes' | 'mean' = 'cutout';

        let isDrawing = false;
        const history: Array<{ labelData: ImageData; visData: ImageData }> = [];

        let cutoutImageData: ImageData | null = null;
        let classesImageData: ImageData | null = null;
        let meanImageData: ImageData | null = null;
        let fullLabelsCache: Int32Array | null = null;

        // Initialize Workspace layout
        const ws = new App.FullScreenWorkspace({
            title: 'Watershed Segmentation',
            onApply: () => {
                leftViewport.destroy();
                rightViewport.destroy();
                App.actions.saveState();
                solveFullResolution();
                let activeData = cutoutImageData;
                if (viewMode === 'classes') activeData = classesImageData;
                else if (viewMode === 'mean') activeData = meanImageData;

                if (activeData) {
                    layer.ctx.clearRect(0, 0, fullW, fullH);
                    layer.ctx.putImageData(activeData, 0, 0);
                    App.emit('layer:content');
                }
            },
            onCancel: () => {
                leftViewport.destroy();
                rightViewport.destroy();
            }
        });

        // Split view container using dynamic panel layout
        const leftPanel = ws.createPanel({ title: 'Source & Painted Seeds' });
        const rightPanel = ws.createPanel({ title: 'Flooded Segment Result', status: 'Ready' });

        const srcCanvas = leftPanel.canvas;
        const resCanvas = rightPanel.canvas;
        const statusEl = rightPanel.statusEl;

        srcCanvas.width = fullW;
        srcCanvas.height = fullH;
        resCanvas.width = fullW;
        resCanvas.height = fullH;

        const leftViewport = new App.InteractiveViewport(srcCanvas);
        const rightViewport = new App.InteractiveViewport(resCanvas);

        leftViewport.onDraw = () => {
            rightViewport.zoom = leftViewport.zoom;
            rightViewport.panX = leftViewport.panX;
            rightViewport.panY = leftViewport.panY;
            renderSource();
            drawActiveResult();
        };

        rightViewport.onDraw = () => {
            leftViewport.zoom = rightViewport.zoom;
            leftViewport.panX = rightViewport.panX;
            leftViewport.panY = rightViewport.panY;
            renderSource();
            drawActiveResult();
        };

        // Setup internal label state and display stroke canvases
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = fullW;
        maskCanvas.height = fullH;
        const maskCtx = maskCanvas.getContext('2d')!;

        const visibleMaskCanvas = document.createElement('canvas');
        visibleMaskCanvas.width = fullW;
        visibleMaskCanvas.height = fullH;
        const visibleMaskCtx = visibleMaskCanvas.getContext('2d')!;

        const renderSource = () => {
            const ctx = leftViewport.ctx;
            ctx.save();
            ctx.clearRect(0, 0, fullW, fullH);
            leftViewport.applyTransform();
            ctx.drawImage(layer.canvas, 0, 0);
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.drawImage(visibleMaskCanvas, 0, 0);
            ctx.restore();
            ctx.restore();
        };

        const drawActiveResult = () => {
            let activeData = cutoutImageData;
            if (viewMode === 'classes') activeData = classesImageData;
            else if (viewMode === 'mean') activeData = meanImageData;

            const ctx = rightViewport.ctx;
            ctx.save();
            ctx.clearRect(0, 0, fullW, fullH);
            rightViewport.applyTransform();
            if (activeData) {
                const tempC = document.createElement('canvas');
                tempC.width = fullW;
                tempC.height = fullH;
                tempC.getContext('2d')!.putImageData(activeData, 0, 0);
                ctx.drawImage(tempC, 0, 0);
            }
            ctx.restore();
        };

        // Sidebar Painting tool buttons
        ws.sidebar.appendChild(UI.createSubheading('Drawing Tools'));

        const objBtn = UI.createNode('button', { className: 'fs-tool-btn obj-tool active' },
            UI.createNode('span', { style: 'display:inline-block; width:10px; height:10px; background-color:#e91e63; border-radius:50%' }),
            'Object'
        ) as HTMLButtonElement;

        const bgBtn = UI.createNode('button', { className: 'fs-tool-btn bg-tool' },
            UI.createNode('span', { style: 'display:inline-block; width:10px; height:10px; background-color:#2196f3; border-radius:50%' }),
            'Background'
        ) as HTMLButtonElement;

        const eraseBtn = UI.createNode('button', { className: 'fs-tool-btn erase-tool' },
            UI.createNode('span', { style: 'display:inline-block; width:10px; height:10px; background-color:#fff; border: 1px solid #666; border-radius:50%' }),
            'Erase'
        ) as HTMLButtonElement;

        const updateToolButtons = () => {
            objBtn.classList.toggle('active', brushType === 'obj');
            bgBtn.classList.toggle('active', brushType === 'bg');
            eraseBtn.classList.toggle('active', brushType === 'erase');
        };

        objBtn.onclick = () => { brushType = 'obj'; updateToolButtons(); };
        bgBtn.onclick = () => { brushType = 'bg'; updateToolButtons(); };
        eraseBtn.onclick = () => { brushType = 'erase'; updateToolButtons(); };

        const toolGroup = UI.createNode('div', { className: 'fs-tool-group tri' }, objBtn, bgBtn, eraseBtn);
        ws.sidebar.appendChild(toolGroup);

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Brush Size', min: 2, max: 60, value: brushSize,
            onInput: (v) => { brushSize = parseInt(v); }
        }));

        const undoBtn = UI.createButton({
            label: 'Undo Stroke',
            className: 'btn cancel-btn',
            onClick: () => undo()
        });
        const clearBtn = UI.createButton({
            label: 'Clear All',
            className: 'btn cancel-btn',
            onClick: () => clearStrokes()
        });

        const btnRow = UI.createNode('div', { style: 'display:flex; gap:10px;' }, undoBtn, clearBtn);
        ws.sidebar.appendChild(btnRow);

        // Dynamic Seeds visualizer container
        ws.sidebar.appendChild(UI.createSubheading('Detected Segment Seeds'));

        const seedsContainer = UI.createNode('div', { className: 'ws-seeds-container' });
        ws.sidebar.appendChild(seedsContainer);

        const renderSeedsList = () => {
            seedsContainer.innerHTML = '';
            seeds.forEach(seed => {
                const row = UI.createNode('div', { className: 'ws-seed-row' },
                    UI.createNode('div', { className: 'ws-seed-color', style: { backgroundColor: seed.color } }),
                    UI.createNode('span', { className: 'ws-seed-info' }, seed.name)
                );
                seedsContainer.appendChild(row);
            });
        };

        ws.sidebar.appendChild(UI.createSubheading('Viewport Controls'));
        const zoomInBtn = UI.createButton({ label: 'Zoom +', className: 'btn', onClick: () => { leftViewport.zoom = Math.min(25, leftViewport.zoom * 1.25); leftViewport.onDraw!(); } });
        const zoomOutBtn = UI.createButton({ label: 'Zoom -', className: 'btn', onClick: () => { leftViewport.zoom = Math.max(0.2, leftViewport.zoom / 1.25); leftViewport.onDraw!(); } });
        const resetZoomBtn = UI.createButton({ label: 'Reset Zoom', className: 'btn cancel-btn', onClick: () => { leftViewport.reset(); } });
        ws.sidebar.appendChild(UI.createNode('div', { style: 'display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px;' }, zoomInBtn, zoomOutBtn, resetZoomBtn));

        ws.sidebar.appendChild(UI.createSubheading('Visual Settings'));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Result Type',
            options: [
                { value: 'cutout', text: 'Transparent Cutout' },
                { value: 'classes', text: 'Unique Seed Colors' },
                { value: 'mean', text: 'Mean Segment Color' }
            ],
            value: viewMode,
            onChange: (v) => {
                viewMode = v as 'cutout' | 'classes' | 'mean';
                drawActiveResult();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Edge Softness', min: 0, max: 15, step: 1, value: edgeSoftness,
            onInput: (v) => {
                edgeSoftness = parseInt(v);
                if (fullLabelsCache) renderResult(fullLabelsCache);
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Cutout Background',
            value: removeBackground,
            onChange: (v) => {
                removeBackground = v;
                if (fullLabelsCache) renderResult(fullLabelsCache);
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Show Boundaries',
            value: showBorder,
            onChange: (v) => {
                showBorder = v;
                if (fullLabelsCache) renderResult(fullLabelsCache);
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Border Size', min: 0, max: 5, step: 1, value: borderThickness,
            onInput: (v) => {
                borderThickness = parseInt(v);
                if (fullLabelsCache) renderResult(fullLabelsCache);
            }
        }));

        ws.sidebar.appendChild(UI.createColorRow({
            label: 'Border Color',
            value: borderColor,
            onChange: (v) => {
                borderColor = v;
                if (fullLabelsCache) renderResult(fullLabelsCache);
            }
        }));

        ws.sidebar.appendChild(UI.createSubheading('Solver Options'));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Preview Size', min: 200, max: 1000, step: 25, value: solverMaxDim,
            onInput: (v) => {
                solverMaxDim = parseInt(v);
                if (realtimeUpdate) solve();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Solve in Real-time',
            value: realtimeUpdate,
            onChange: (v) => {
                realtimeUpdate = v;
            }
        }));

        const solveBtn = UI.createButton({
            label: 'Flood Watershed',
            className: 'btn',
            style: 'width:100%; margin-top:10px; padding: 10px;',
            onClick: () => solve()
        });
        ws.sidebar.appendChild(solveBtn);

        // --- Stroke Execution and Interaction Logic ---
        const executeStroke = (coords: { x: number, y: number }, activeBrush: 'obj' | 'bg' | 'erase') => {
            maskCtx.lineWidth = brushSize;
            maskCtx.lineCap = 'round';
            maskCtx.lineJoin = 'round';

            visibleMaskCtx.lineWidth = brushSize;
            visibleMaskCtx.lineCap = 'round';
            visibleMaskCtx.lineJoin = 'round';

            if (activeBrush === 'erase') {
                maskCtx.globalCompositeOperation = 'destination-out';
                visibleMaskCtx.globalCompositeOperation = 'destination-out';
                
                maskCtx.lineTo(coords.x, coords.y);
                maskCtx.stroke();
                maskCtx.beginPath();
                maskCtx.moveTo(coords.x, coords.y);

                visibleMaskCtx.lineTo(coords.x, coords.y);
                visibleMaskCtx.stroke();
                visibleMaskCtx.beginPath();
                visibleMaskCtx.moveTo(coords.x, coords.y);

                maskCtx.globalCompositeOperation = 'source-over';
                visibleMaskCtx.globalCompositeOperation = 'source-over';
            } else {
                const isBg = activeBrush === 'bg';
                maskCtx.strokeStyle = isBg ? 'rgba(1, 0, 0, 1)' : 'rgba(255, 0, 0, 1)';
                maskCtx.lineTo(coords.x, coords.y);
                maskCtx.stroke();
                maskCtx.beginPath();
                maskCtx.moveTo(coords.x, coords.y);

                visibleMaskCtx.strokeStyle = isBg ? '#2196f3' : '#e91e63';
                visibleMaskCtx.lineTo(coords.x, coords.y);
                visibleMaskCtx.stroke();
                visibleMaskCtx.beginPath();
                visibleMaskCtx.moveTo(coords.x, coords.y);
            }
            renderSource();
        };

        leftViewport.onMouseDown = (e) => {
            saveHistoryState();
            currentStrokeBrush = e.isRightClick ? 'bg' : brushType;
            
            maskCtx.beginPath();
            maskCtx.moveTo(e.x, e.y);
            visibleMaskCtx.beginPath();
            visibleMaskCtx.moveTo(e.x, e.y);

            executeStroke({ x: e.x, y: e.y }, currentStrokeBrush);
        };

        leftViewport.onMouseMove = (e) => {
            if (!currentStrokeBrush) return;
            executeStroke({ x: e.x, y: e.y }, currentStrokeBrush);
        };

        leftViewport.onMouseUp = () => {
            currentStrokeBrush = null;
            maskCtx.beginPath();
            visibleMaskCtx.beginPath();
            if (realtimeUpdate) solve();
        };

        const saveHistoryState = () => {
            const labelData = maskCtx.getImageData(0, 0, fullW, fullH);
            const visData = visibleMaskCtx.getImageData(0, 0, fullW, fullH);
            history.push({ labelData, visData });
            if (history.length > 20) history.shift();
        };

        const undo = () => {
            if (history.length === 0) return;
            const state = history.pop()!;
            maskCtx.putImageData(state.labelData, 0, 0);
            visibleMaskCtx.putImageData(state.visData, 0, 0);
            renderSource();
            if (realtimeUpdate) solve();
        };

        const clearStrokes = () => {
            saveHistoryState();
            maskCtx.clearRect(0, 0, fullW, fullH);
            visibleMaskCtx.clearRect(0, 0, fullW, fullH);
            renderSource();
            cutoutImageData = null;
            classesImageData = null;
            meanImageData = null;
            fullLabelsCache = null;
            seeds = [{ id: 1, name: 'Background (Seed 1)', color: '#2196f3' }];
            renderSeedsList();
            drawActiveResult();
        };

        const getStableColor = (index: number) => {
            const palette = [
                '#4caf50', '#ff9800', '#e91e63', '#9c27b0', '#673ab7',
                '#3f51b5', '#ffeb3b', '#009688', '#ff5722', '#795548',
                '#1abc9c', '#2ecc71', '#3498db', '#f1c40f', '#e74c3c',
                '#d35400', '#8e44ad', '#2c3e50', '#16a085', '#27ae60',
                '#2980b9', '#f39c12', '#c0392b', '#7f8c8d', '#bdc3c7'
            ];
            return palette[(index - 1) % palette.length];
        };

        const hexToRgb = (hex: string) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return { r, g, b };
        };

        // Calculate Sobel gradient magnitude using CIELAB color space for improved edge detection
        const getGradientMap = (imgData: Uint8ClampedArray, w: number, h: number) => {
            const grad = new Float32Array(w * h);
            const labData = Lib.image.convertRgbToLab(imgData, w, h);

            for (let y = 1; y < h - 1; y++) {
                const yOffset = y * w;
                const prevYOffset = (y - 1) * w;
                const nextYOffset = (y + 1) * w;
                
                for (let x = 1; x < w - 1; x++) {
                    const u = yOffset + x;

                    let gx_sum_sq = 0;
                    let gy_sum_sq = 0;

                    for (let c = 0; c < 3; c++) {
                        const tl = labData[(prevYOffset + x - 1) * 3 + c];
                        const tc = labData[(prevYOffset + x) * 3 + c];
                        const tr = labData[(prevYOffset + x + 1) * 3 + c];
                        
                        const cl = labData[(yOffset + x - 1) * 3 + c];
                        const cr = labData[(yOffset + x + 1) * 3 + c];
                        
                        const bl = labData[(nextYOffset + x - 1) * 3 + c];
                        const bc = labData[(nextYOffset + x) * 3 + c];
                        const br = labData[(nextYOffset + x + 1) * 3 + c];

                        const gx = -tl + tr - 2 * cl + 2 * cr - bl + br;
                        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

                        gx_sum_sq += gx * gx;
                        gy_sum_sq += gy * gy;
                    }

                    grad[u] = Math.sqrt(gx_sum_sq + gy_sum_sq);
                }
            }
            return grad;
        };

        // Priority Queue flooding algorithm
        const runWatershed = (grad: Float32Array, initialLabels: Int32Array, w: number, h: number) => {
            const labels = new Int32Array(initialLabels);
            const pq = new PriorityQueue();
            const inQueue = new Uint8Array(w * h);

            for (let y = 0; y < h; y++) {
                const yOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const u = yOffset + x;
                    if (labels[u] > 0) {
                        const neighbors = [
                            { nx: x + 1, ny: y }, { nx: x - 1, ny: y },
                            { nx: x, ny: y + 1 }, { nx: x, ny: y - 1 }
                        ];
                        for (const { nx, ny } of neighbors) {
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                const nu = ny * w + nx;
                                if (labels[nu] === 0 && inQueue[nu] === 0) {
                                    pq.push(nu, grad[nu]);
                                    inQueue[nu] = 1;
                                }
                            }
                        }
                    }
                }
            }

            while (pq.size() > 0) {
                const popped = pq.pop()!;
                const u = popped.idx;
                const x = u % w;
                const y = Math.floor(u / w);

                if (labels[u] > 0) continue;

                const neighbors = [
                    { nx: x + 1, ny: y }, { nx: x - 1, ny: y },
                    { nx: x, ny: y + 1 }, { nx: x, ny: y - 1 }
                ];

                let assignedLabel = 0;
                let minGrad = Infinity;

                for (const { nx, ny } of neighbors) {
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nu = ny * w + nx;
                        if (labels[nu] > 0) {
                            if (grad[nu] < minGrad) {
                                minGrad = grad[nu];
                                assignedLabel = labels[nu];
                            }
                        }
                    }
                }

                if (assignedLabel > 0) {
                    labels[u] = assignedLabel;
                    for (const { nx, ny } of neighbors) {
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            const nu = ny * w + nx;
                            if (labels[nu] === 0 && inQueue[nu] === 0) {
                                pq.push(nu, grad[nu]);
                                inQueue[nu] = 1;
                            }
                        }
                    }
                }
            }
            return labels;
        };

        const isBorder = (x: number, y: number, thickness: number, labels: Int32Array, w: number, h: number) => {
            const centerLabel = labels[y * w + x];
            for (let dy = -thickness; dy <= thickness; dy++) {
                for (let dx = -thickness; dx <= thickness; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        if (labels[ny * w + nx] !== centerLabel) {
                            return true;
                        }
                    }
                }
            }
            return false;
        };

        const cleanCanvas = document.createElement('canvas');
        cleanCanvas.width = fullW;
        cleanCanvas.height = fullH;
        const cleanCtx = cleanCanvas.getContext('2d')!;
        cleanCtx.drawImage(layer.canvas, 0, 0);
        const fullImgData = cleanCtx.getImageData(0, 0, fullW, fullH).data;

        // Calculate segment averages of colors
        const calcMeanColors = (labels: Int32Array) => {
            const sumsR: Record<number, number> = {};
            const sumsG: Record<number, number> = {};
            const sumsB: Record<number, number> = {};
            const counts: Record<number, number> = {};

            for (let i = 0; i < labels.length; i++) {
                const label = labels[i];
                if (label > 0) {
                    const idx = i * 4;
                    sumsR[label] = (sumsR[label] || 0) + fullImgData[idx];
                    sumsG[label] = (sumsG[label] || 0) + fullImgData[idx + 1];
                    sumsB[label] = (sumsB[label] || 0) + fullImgData[idx + 2];
                    counts[label] = (counts[label] || 0) + 1;
                }
            }

            const means: Record<number, { r: number; g: number; b: number }> = {};
            Object.keys(counts).forEach(lblStr => {
                const lbl = parseInt(lblStr);
                const cnt = counts[lbl];
                means[lbl] = {
                    r: Math.round(sumsR[lbl] / cnt),
                    g: Math.round(sumsG[lbl] / cnt),
                    b: Math.round(sumsB[lbl] / cnt)
                };
            });
            return means;
        };

        // Render result views using segment classification maps
        const renderResult = (fullLabels: Int32Array) => {
            const cutoutData = rightViewport.ctx.createImageData(fullW, fullH);
            const classesData = rightViewport.ctx.createImageData(fullW, fullH);
            const meanData = rightViewport.ctx.createImageData(fullW, fullH);

            const seedRgbMap: Record<number, { r: number; g: number; b: number }> = {};
            seeds.forEach(seed => {
                seedRgbMap[seed.id] = hexToRgb(seed.color);
            });

            const meanColors = calcMeanColors(fullLabels);
            const borderRgb = hexToRgb(borderColor);
            const drawBorder = showBorder && borderThickness > 0;

            // --- GUIDED FILTER EDGE SOFTENING ---
            let softAlpha: Float32Array | null = null;
            if (edgeSoftness > 0 && removeBackground) {
                const grayGuidance = new Float32Array(fullW * fullH);
                const binaryMask = new Float32Array(fullW * fullH);
                
                for (let i = 0; i < fullW * fullH; i++) {
                    const idx = i * 4;
                    // Luminance scale 0.0 - 1.0
                    grayGuidance[i] = 0.299 * (fullImgData[idx] / 255) + 0.587 * (fullImgData[idx+1] / 255) + 0.114 * (fullImgData[idx+2] / 255);
                    // 1.0 for Objects, 0.0 for Background
                    binaryMask[i] = fullLabels[i] > 1 ? 1.0 : 0.0;
                }
                
                // Soften mask using source image boundaries as guidance
                softAlpha = Lib.image.guidedFilterGrayscale(grayGuidance, binaryMask, fullW, fullH, edgeSoftness, 1e-3);
            }

            for (let y = 0; y < fullH; y++) {
                const yOffset = y * fullW;
                for (let x = 0; x < fullW; x++) {
                    const u = yOffset + x;
                    const idx = u * 4;
                    const label = fullLabels[u];

                    let cutoutR = fullImgData[idx], cutoutG = fullImgData[idx + 1], cutoutB = fullImgData[idx + 2], cutoutA = 255;
                    let classR = 0, classG = 0, classB = 0, classA = 255;
                    let meanR = 0, meanG = 0, meanB = 0, meanA = 255;

                    if (label > 0) {
                        if (removeBackground && label === 1) {
                            cutoutA = 0; classA = 0; meanA = 0;
                        }

                        const seedColor = seedRgbMap[label] || { r: 128, g: 128, b: 128 };
                        classR = seedColor.r; classG = seedColor.g; classB = seedColor.b;

                        const mColor = meanColors[label] || { r: 128, g: 128, b: 128 };
                        meanR = mColor.r; meanG = mColor.g; meanB = mColor.b;
                    } else {
                        cutoutA = 0; classA = 0; meanA = 0;
                    }

                    // Apply anti-aliased edge softness if generated
                    if (softAlpha && removeBackground) {
                        const smoothA = Math.max(0, Math.min(255, Math.round(softAlpha[u] * 255)));
                        cutoutA = smoothA;
                        classA = smoothA;
                        meanA = smoothA;
                    }

                    if (drawBorder && isBorder(x, y, borderThickness, fullLabels, fullW, fullH)) {
                        cutoutR = borderRgb.r; cutoutG = borderRgb.g; cutoutB = borderRgb.b; cutoutA = 255;
                        classR = borderRgb.r; classG = borderRgb.g; classB = borderRgb.b; classA = 255;
                        meanR = borderRgb.r; meanG = borderRgb.g; meanB = borderRgb.b; meanA = 255;
                    }

                    cutoutData.data[idx] = cutoutR; cutoutData.data[idx + 1] = cutoutG; cutoutData.data[idx + 2] = cutoutB; cutoutData.data[idx + 3] = cutoutA;
                    classesData.data[idx] = classR; classesData.data[idx + 1] = classG; classesData.data[idx + 2] = classB; classesData.data[idx + 3] = classA;
                    meanData.data[idx] = meanR; meanData.data[idx + 1] = meanG; meanData.data[idx + 2] = meanB; meanData.data[idx + 3] = meanA;
                }
            }

            cutoutImageData = cutoutData;
            classesImageData = classesData;
            meanImageData = meanData;

            drawActiveResult();
        };

        // Real-time solver optimized with nearest-neighbor upscaling
        const solve = () => {
            statusEl.textContent = 'Flooding...';

            let lowW = fullW;
            let lowH = fullH;
            if (fullW > solverMaxDim || fullH > solverMaxDim) {
                const scale = Math.min(solverMaxDim / fullW, solverMaxDim / fullH);
                lowW = Math.round(fullW * scale);
                lowH = Math.round(fullH * scale);
            }

            const lowResCanvas = document.createElement('canvas');
            lowResCanvas.width = lowW;
            lowResCanvas.height = lowH;
            const lowResCtx = lowResCanvas.getContext('2d')!;
            lowResCtx.drawImage(layer.canvas, 0, 0, lowW, lowH);
            const lowImgData = lowResCtx.getImageData(0, 0, lowW, lowH).data;

            const lowMaskCanvas = document.createElement('canvas');
            lowMaskCanvas.width = lowW;
            lowMaskCanvas.height = lowH;
            const lowMaskCtx = lowMaskCanvas.getContext('2d')!;
            lowMaskCtx.drawImage(maskCanvas, 0, 0, lowW, lowH);
            const lowMaskData = lowMaskCtx.getImageData(0, 0, lowW, lowH).data;

            const ccaResult = runCCA(lowMaskData, lowW, lowH);

            const initialLabels = new Int32Array(lowW * lowH);
            let seedsFound = 0;
            for (let i = 0; i < lowW * lowH; i++) {
                const idx = i * 4;
                const r = lowMaskData[idx];
                const a = lowMaskData[idx + 3];
                if (a > 50) {
                    if (r === 1) {
                        initialLabels[i] = 1;
                        seedsFound++;
                    } else if (r > 10) {
                        initialLabels[i] = ccaResult.labels[i] + 1;
                        seedsFound++;
                    }
                }
            }

            const newSeeds = [
                { id: 1, name: 'Background (Seed 1)', color: '#2196f3' }
            ];
            for (let i = 1; i <= ccaResult.count; i++) {
                newSeeds.push({
                    id: i + 1,
                    name: `Object ${i} (Seed ${i + 1})`,
                    color: getStableColor(i)
                });
            }
            seeds = newSeeds;
            renderSeedsList();

            if (seedsFound === 0) {
                statusEl.textContent = 'Paint Seeds';
                return;
            }

            const grad = getGradientMap(lowImgData, lowW, lowH);
            const lowLabels = runWatershed(grad, initialLabels, lowW, lowH);

            const fullLabels = new Int32Array(fullW * fullH);
            for (let y = 0; y < fullH; y++) {
                const lowY = Math.min(lowH - 1, Math.floor((y / fullH) * lowH));
                const yOffset = y * fullW;
                const lowYOffset = lowY * lowW;
                for (let x = 0; x < fullW; x++) {
                    const lowX = Math.min(lowW - 1, Math.floor((x / fullW) * lowW));
                    fullLabels[yOffset + x] = lowLabels[lowYOffset + lowX];
                }
            }

            fullLabelsCache = fullLabels;
            renderResult(fullLabels);
            statusEl.textContent = 'Previewing';
        };

        const solveFullResolution = () => {
            const fullMaskData = maskCtx.getImageData(0, 0, fullW, fullH).data;
            const ccaResult = runCCA(fullMaskData, fullW, fullH);

            const fullInitialLabels = new Int32Array(fullW * fullH);
            for (let i = 0; i < fullW * fullH; i++) {
                const idx = i * 4;
                const r = fullMaskData[idx];
                const a = fullMaskData[idx + 3];
                if (a > 50) {
                    if (r === 1) {
                        fullInitialLabels[i] = 1;
                    } else if (r > 10) {
                        fullInitialLabels[i] = ccaResult.labels[i] + 1;
                    }
                }
            }

            const fullGrad = getGradientMap(fullImgData, fullW, fullH);
            const fullLabels = runWatershed(fullGrad, fullInitialLabels, fullW, fullH);

            renderResult(fullLabels);
        };

        renderSource();
        renderSeedsList();
        ws.show();
    },

    injectStyles() {
        if (document.getElementById('watershed-filter-style')) return;
        const style = document.createElement('style');
        style.id = 'watershed-filter-style';
        style.textContent = `
            .ws-seeds-container { display: flex; flex-direction: column; gap: 8px; min-height: 100px; max-height: 130px; overflow-y: auto; padding: 6px; border: 1px solid #2d2d2d; border-radius: 4px; background: #121212; flex-shrink: 0; }
            .ws-seed-row { display: flex; align-items: center; padding: 8px 10px; background: #1e1e1e; border: 1px solid #333; border-radius: 6px; transition: all 0.2s ease; }
            .ws-seed-color { width: 12px; height: 12px; border-radius: 50%; margin-right: 10px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2); }
            .ws-seed-info { flex-grow: 1; font-weight: bold; font-size: 12px; color: #ccc; }
            .fs-tool-btn.obj-tool.active { border-color: #e91e63; background-color: rgba(233, 30, 99, 0.15); }
            .fs-tool-btn.bg-tool.active { border-color: #2196f3; background-color: rgba(33, 150, 243, 0.15); }
            .fs-tool-btn.erase-tool.active { border-color: #9e9e9e; background-color: rgba(158, 158, 158, 0.15); }
        `;
        document.head.appendChild(style);
    }
};

if (typeof window !== 'undefined') {
    (window as any).WatershedFilter = WatershedFilter;
}

Filters.register('watershed', {
    name: 'Watershed Segmentation',
    mode: 'unified',
    menu: {
        path: 'Filter/Segmentation',
        label: 'Watershed...',
        order: 2
    },
    apply(ctx: FilterContext) {
        const l = ctx.layer;
        WatershedFilter.open();
    }
});
