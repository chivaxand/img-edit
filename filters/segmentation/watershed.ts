import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters } from '~/filters';

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

// --- Guided Filter for High-Quality Edge Softening ---
function boxFilter(data: Float32Array, width: number, height: number, r: number): Float32Array {
    const dest = new Float32Array(data.length);
    const scale = 1 / ((2 * r + 1) * (2 * r + 1));
    const temp = new Float32Array(data.length);
    
    // Horizontal pass
    for (let y = 0; y < height; y++) {
        let sum = 0;
        const offset = y * width;
        for (let x = -r; x <= r; x++) {
            const px = Math.min(width - 1, Math.max(0, x));
            sum += data[offset + px];
        }
        temp[offset] = sum;
        for (let x = 1; x < width; x++) {
            const nextX = Math.min(width - 1, x + r);
            const prevX = Math.max(0, x - r - 1);
            sum += data[offset + nextX] - data[offset + prevX];
            temp[offset + x] = sum;
        }
    }
    
    // Vertical pass
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) {
            const py = Math.min(height - 1, Math.max(0, y));
            sum += temp[py * width + x];
        }
        dest[x] = sum * scale;
        for (let y = 1; y < height; y++) {
            const nextY = Math.min(height - 1, y + r);
            const prevY = Math.max(0, y - r - 1);
            sum += temp[nextY * width + x] - temp[prevY * width + x];
            dest[y * width + x] = sum * scale;
        }
    }
    return dest;
}

function guidedFilterGrayscale(I: Float32Array, p: Float32Array, width: number, height: number, r: number, eps: number): Float32Array {
    const meanI = boxFilter(I, width, height, r);
    const meanP = boxFilter(p, width, height, r);
    
    const Ip = new Float32Array(I.length);
    const II = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) {
        Ip[i] = I[i] * p[i];
        II[i] = I[i] * I[i];
    }
    
    const meanIp = boxFilter(Ip, width, height, r);
    const meanII = boxFilter(II, width, height, r);
    
    const covIp = new Float32Array(I.length);
    const varI = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) {
        covIp[i] = meanIp[i] - meanI[i] * meanP[i];
        varI[i] = meanII[i] - meanI[i] * meanI[i];
    }
    
    const a = new Float32Array(I.length);
    const b = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) {
        a[i] = covIp[i] / (varI[i] + eps);
        b[i] = meanP[i] - a[i] * meanI[i];
    }
    
    const meanA = boxFilter(a, width, height, r);
    const meanB = boxFilter(b, width, height, r);
    
    const q = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) {
        q[i] = meanA[i] * I[i] + meanB[i];
    }
    return q;
}

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
            }
        });

        // Split view container for source and segment displays
        const panelsContainer = UI.createNode('div', { className: 'ws-panels-container' },
            UI.createNode('div', { className: 'ws-panel' },
                UI.createNode('div', { className: 'ws-panel-header' },
                    UI.createNode('span', {}, 'Source & Painted Seeds'),
                    UI.createNode('span', {}, `${fullW} x ${fullH}`)
                ),
                UI.createNode('div', { className: 'ws-canvas-wrapper' },
                    UI.createNode('canvas', { id: 'ws-source-canvas', className: 'ws-canvas' })
                )
            ),
            UI.createNode('div', { className: 'ws-panel' },
                UI.createNode('div', { className: 'ws-panel-header' },
                    UI.createNode('span', {}, 'Flooded Segment Result'),
                    UI.createNode('span', { id: 'ws-status' }, 'Ready')
                ),
                UI.createNode('div', { className: 'ws-canvas-wrapper' },
                    UI.createNode('canvas', { id: 'ws-result-canvas', className: 'ws-canvas' })
                )
            )
        );
        ws.content.appendChild(panelsContainer);

        const srcCanvas = ws.content.querySelector('#ws-source-canvas') as HTMLCanvasElement;
        const resCanvas = ws.content.querySelector('#ws-result-canvas') as HTMLCanvasElement;
        const srcCtx = srcCanvas.getContext('2d')!;
        const resCtx = resCanvas.getContext('2d')!;

        srcCanvas.width = fullW;
        srcCanvas.height = fullH;
        resCanvas.width = fullW;
        resCanvas.height = fullH;

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
            srcCtx.clearRect(0, 0, fullW, fullH);
            srcCtx.drawImage(layer.canvas, 0, 0);
            srcCtx.save();
            srcCtx.globalAlpha = 0.55;
            srcCtx.drawImage(visibleMaskCanvas, 0, 0);
            srcCtx.restore();
        };

        const drawActiveResult = () => {
            let activeData = cutoutImageData;
            if (viewMode === 'classes') activeData = classesImageData;
            else if (viewMode === 'mean') activeData = meanImageData;

            resCtx.clearRect(0, 0, fullW, fullH);
            if (activeData) {
                resCtx.putImageData(activeData, 0, 0);
            }
        };

        // Sidebar Painting tool buttons
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Drawing Tools'));

        const objBtn = UI.createNode('button', { className: 'ws-tool-btn obj-tool active' },
            UI.createNode('span', { style: 'display:inline-block; width:10px; height:10px; background-color:#e91e63; border-radius:50%' }),
            'Object'
        ) as HTMLButtonElement;

        const bgBtn = UI.createNode('button', { className: 'ws-tool-btn bg-tool' },
            UI.createNode('span', { style: 'display:inline-block; width:10px; height:10px; background-color:#2196f3; border-radius:50%' }),
            'Background'
        ) as HTMLButtonElement;

        const eraseBtn = UI.createNode('button', { className: 'ws-tool-btn erase-tool' },
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

        const toolGroup = UI.createNode('div', { className: 'ws-tool-group' }, objBtn, bgBtn, eraseBtn);
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

        const btnRow = UI.createNode('div', { style: 'display:flex; gap:10px; margin-bottom:15px;' }, undoBtn, clearBtn);
        ws.sidebar.appendChild(btnRow);

        // Dynamic Seeds visualizer container
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Detected Segment Seeds'));

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

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title', style: 'margin-top:15px;' }, 'Visual Settings'));

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

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title', style: 'margin-top:15px;' }, 'Solver Options'));

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

        // Map mouse click coordinates to local space
        const getCoords = (e: MouseEvent | Touch, cvs: HTMLCanvasElement) => {
            const rect = cvs.getBoundingClientRect();
            const scaleX = cvs.width / rect.width;
            const scaleY = cvs.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

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

        srcCanvas.onmousedown = (e) => {
            e.preventDefault();
            saveHistoryState();
            isDrawing = true;
            
            // Lock the brush type based on the initial click state
            currentStrokeBrush = (e.buttons === 2) ? 'bg' : brushType;
            
            const coords = getCoords(e, srcCanvas);
            maskCtx.beginPath();
            maskCtx.moveTo(coords.x, coords.y);
            visibleMaskCtx.beginPath();
            visibleMaskCtx.moveTo(coords.x, coords.y);

            executeStroke(coords, currentStrokeBrush);
        };

        srcCanvas.onmousemove = (e) => {
            if (!isDrawing || !currentStrokeBrush) return;
            const coords = getCoords(e, srcCanvas);
            executeStroke(coords, currentStrokeBrush);
        };

        window.addEventListener('mouseup', () => {
            if (isDrawing) {
                isDrawing = false;
                currentStrokeBrush = null; // Release brush lock
                maskCtx.beginPath();
                visibleMaskCtx.beginPath();
                if (realtimeUpdate) solve();
            }
        });

        srcCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            saveHistoryState();
            isDrawing = true;
            currentStrokeBrush = brushType; // Lock brush for touch
            if (e.touches && e.touches.length > 0) {
                const coords = getCoords(e.touches[0], srcCanvas);
                maskCtx.beginPath();
                maskCtx.moveTo(coords.x, coords.y);
                visibleMaskCtx.beginPath();
                visibleMaskCtx.moveTo(coords.x, coords.y);
                executeStroke(coords, currentStrokeBrush);
            }
        }, { passive: false });

        srcCanvas.addEventListener('touchmove', (e) => {
            if (!isDrawing || !currentStrokeBrush) return;
            e.preventDefault();
            if (e.touches && e.touches.length > 0) {
                const coords = getCoords(e.touches[0], srcCanvas);
                executeStroke(coords, currentStrokeBrush);
            }
        }, { passive: false });

        srcCanvas.addEventListener('touchend', () => {
            if (isDrawing) {
                isDrawing = false;
                currentStrokeBrush = null;
                maskCtx.beginPath();
                visibleMaskCtx.beginPath();
                if (realtimeUpdate) solve();
            }
        });

        // Prevent right-click browser menu
        srcCanvas.oncontextmenu = (e) => e.preventDefault();

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
            const labData = convertRgbToLab(imgData, w, h);

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
            const cutoutData = resCtx.createImageData(fullW, fullH);
            const classesData = resCtx.createImageData(fullW, fullH);
            const meanData = resCtx.createImageData(fullW, fullH);

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
                softAlpha = guidedFilterGrayscale(grayGuidance, binaryMask, fullW, fullH, edgeSoftness, 1e-3);
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
            const statusEl = ws.overlay.querySelector('#ws-status')!;
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
            .ws-panels-container { display: flex; width: 100%; height: 100%; gap: 15px; padding: 15px; box-sizing: border-box; background: #141414; }
            .ws-panel { flex: 1; display: flex; flex-direction: column; background: #1e1e1e; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
            .ws-panel-header { display: flex; justify-content: space-between; align-items: center; background: #252526; padding: 8px 12px; border-bottom: 1px solid #333; font-weight: bold; font-size: 11px; color: #aaa; text-transform: uppercase; }
            .ws-canvas-wrapper { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 10px; background-image: linear-gradient(45deg, #181818 25%, transparent 25%), linear-gradient(-45deg, #181818 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181818 75%), linear-gradient(-45deg, transparent 75%, #181818 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px; }
            .ws-canvas { max-width: 100%; max-height: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.5); object-fit: contain; image-rendering: pixelated; background: transparent; cursor: crosshair; }
            .ws-seeds-container { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; min-height: 120px; max-height: 220px; overflow-y: auto; padding: 6px; border: 1px solid #2d2d2d; border-radius: 4px; background: #121212; flex-shrink: 0; }
            .ws-seed-row { display: flex; align-items: center; padding: 8px 10px; background: #1e1e1e; border: 1px solid #333; border-radius: 6px; transition: all 0.2s ease; }
            .ws-seed-color { width: 12px; height: 12px; border-radius: 50%; margin-right: 10px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2); }
            .ws-seed-info { flex-grow: 1; font-weight: bold; font-size: 12px; color: #ccc; }
            .ws-tool-group { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px; }
            .ws-tool-btn { background-color: #121212; border: 1px solid #333; color: #ccc; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; font-weight: bold; }
            .ws-tool-btn:hover { background-color: #2a2a2a; border-color: #007acc; }
            .ws-tool-btn.active { border-color: #007acc; background-color: rgba(0, 122, 204, 0.15); color: #fff; }
            .ws-tool-btn.obj-tool.active { border-color: #e91e63; background-color: rgba(233, 30, 99, 0.15); }
            .ws-tool-btn.bg-tool.active { border-color: #2196f3; background-color: rgba(33, 150, 243, 0.15); }
            .ws-tool-btn.erase-tool.active { border-color: #9e9e9e; background-color: rgba(158, 158, 158, 0.15); }
        `;
        document.head.appendChild(style);
    }
};

if (typeof window !== 'undefined') {
    (window as any).WatershedFilter = WatershedFilter;
}

// Standard sRGB-to-CIELAB conversion
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
    let r_n = r / 255, g_n = g / 255, b_n = b / 255;
    r_n = r_n > 0.04045 ? Math.pow((r_n + 0.055) / 1.055, 2.4) : r_n / 12.92;
    g_n = g_n > 0.04045 ? Math.pow((g_n + 0.055) / 1.055, 2.4) : g_n / 12.92;
    b_n = b_n > 0.04045 ? Math.pow((b_n + 0.055) / 1.055, 2.4) : b_n / 12.92;
    const x = r_n * 0.4124564 + g_n * 0.3575761 + b_n * 0.1804375;
    const y = r_n * 0.2126729 + g_n * 0.7151522 + b_n * 0.0721750;
    const z = r_n * 0.0193339 + g_n * 0.1191920 + b_n * 0.9503041;
    const xr = x / 0.95047, yr = y / 1.00000, zr = z / 1.08883;
    const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
    const fx = f(xr), fy = f(yr), fz = f(zr);
    const L = fy > 0.008856 ? 116 * fy - 16 : 903.3 * yr;
    const a = 500 * (fx - fy);
    const b_val = 200 * (fy - fz);
    return [L, a, b_val];
}

function convertRgbToLab(data: Uint8ClampedArray, w: number, h: number): Float32Array {
    const size = w * h;
    const lab = new Float32Array(size * 3);
    for (let i = 0; i < size; i++) {
        const idx = i * 4;
        const [L, a, b] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
        lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
    }
    return lab;
}

Filters.register('watershed', {
    name: 'Watershed Segmentation',
    mode: 'pixel',
    menu: {
        path: 'Filter/Segmentation',
        label: 'Watershed...',
        order: 2
    },
    apply(l: Layer) {
        WatershedFilter.open();
    }
});