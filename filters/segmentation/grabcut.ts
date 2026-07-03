import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters } from '~/filters';

// --- Neural Network (MLP) for feature modeling ---
class MiniMLP {
    inputDim: number;
    hiddenDim: number;
    W1: Float32Array;
    b1: Float32Array;
    W2: Float32Array;
    b2: number;

    constructor(inputDim: number, hiddenDim = 12) {
        this.inputDim = inputDim;
        this.hiddenDim = hiddenDim;
        
        // Xavier/He weight initialization
        const scale1 = Math.sqrt(2.0 / inputDim);
        this.W1 = new Float32Array(inputDim * hiddenDim);
        for (let i = 0; i < this.W1.length; i++) {
            this.W1[i] = (Math.random() - 0.5) * 2 * scale1;
        }
        this.b1 = new Float32Array(hiddenDim);
        
        const scale2 = Math.sqrt(2.0 / hiddenDim);
        this.W2 = new Float32Array(hiddenDim);
        for (let i = 0; i < this.W2.length; i++) {
            this.W2[i] = (Math.random() - 0.5) * 2 * scale2;
        }
        this.b2 = 0;
    }

    relu(x: number): number {
        return Math.max(0, x);
    }

    sigmoid(x: number): number {
        return 1.0 / (1.0 + Math.exp(-Math.max(-50, Math.min(50, x))));
    }

    forward(x: Float32Array) {
        const z1 = new Float32Array(this.hiddenDim);
        const a1 = new Float32Array(this.hiddenDim);
        for (let h = 0; h < this.hiddenDim; h++) {
            let sum = this.b1[h];
            for (let i = 0; i < this.inputDim; i++) {
                sum += x[i] * this.W1[h * this.inputDim + i];
            }
            z1[h] = sum;
            a1[h] = this.relu(sum);
        }
        
        let z2 = this.b2;
        for (let h = 0; h < this.hiddenDim; h++) {
            z2 += a1[h] * this.W2[h];
        }
        return { a1, z1, a2: this.sigmoid(z2) };
    }

    evaluate(X: Float32Array[], y: number[]) {
        const N = X.length;
        let lossSum = 0;
        let correctCount = 0;
        const eps = 1e-15;
        for (let i = 0; i < N; i++) {
            const pred = this.forward(X[i]).a2;
            const clampedPred = Math.max(eps, Math.min(1 - eps, pred));
            lossSum += -(y[i] * Math.log(clampedPred) + (1 - y[i]) * Math.log(1 - clampedPred));
            if ((pred >= 0.5 ? 1 : 0) === y[i]) {
                correctCount++;
            }
        }
        return { loss: lossSum / N, accuracy: correctCount / N };
    }

    train(X: Float32Array[], y: number[], lr = 0.01, epochs = 100, batchSize = 32) {
        const N = X.length;
        const beta1 = 0.9;
        const beta2 = 0.999;
        const eps = 1e-8;
        const gW1 = new Float32Array(this.W1.length);
        const gb1 = new Float32Array(this.b1.length);
        const gW2 = new Float32Array(this.W2.length);
        let gb2 = 0;
        
        // AdaBelief moments
        const mW1 = new Float32Array(this.W1.length);
        const sW1 = new Float32Array(this.W1.length);
        const mb1 = new Float32Array(this.b1.length);
        const sb1 = new Float32Array(this.b1.length);
        
        const mW2 = new Float32Array(this.W2.length);
        const sW2 = new Float32Array(this.W2.length);
        
        let mb2 = 0;
        let sb2 = 0;
        let t = 0;

        const indices = new Int32Array(N);
        for (let i = 0; i < N; i++) indices[i] = i;

        // Log initial loss and accuracy
        const initEval = this.evaluate(X, y);
        console.log(`Epoch 0: Loss = ${initEval.loss.toFixed(4)}, Accuracy = ${(initEval.accuracy * 100).toFixed(2)}%`);

        for (let epoch = 0; epoch < epochs; epoch++) {
            // Fisher-Yates shuffle
            for (let i = N - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const temp = indices[i];
                indices[i] = indices[j];
                indices[j] = temp;
            }

            // Mini-batch updates
            for (let start = 0; start < N; start += batchSize) {
                const end = Math.min(start + batchSize, N);
                const currentBatchSize = end - start;
                gW1.fill(0);
                gb1.fill(0);
                gW2.fill(0);
                gb2 = 0;

                for (let b = start; b < end; b++) {
                    const idx = indices[b];
                    const xi = X[idx];
                    const yi = y[idx];
                    const { a1, z1, a2 } = this.forward(xi);
                    const diff = a2 - yi;
                    const dz2 = diff;
                    gb2 += dz2;
                    for (let h = 0; h < this.hiddenDim; h++) {
                        gW2[h] += dz2 * a1[h];
                    }
                    
                    for (let h = 0; h < this.hiddenDim; h++) {
                        const dz1 = (z1[h] > 0 ? 1 : 0) * (dz2 * this.W2[h]);
                        gb1[h] += dz1;
                        for (let j = 0; j < this.inputDim; j++) {
                            gW1[h * this.inputDim + j] += dz1 * xi[j];
                        }
                    }
                }

                t++;
                const correction1 = 1 - Math.pow(beta1, t);
                const correction2 = 1 - Math.pow(beta2, t);

                // Update b2 (AdaBelief step)
                const g_b2 = gb2 / currentBatchSize;
                mb2 = beta1 * mb2 + (1 - beta1) * g_b2;
                const diff_b2 = g_b2 - mb2;
                sb2 = beta2 * sb2 + (1 - beta2) * (diff_b2 * diff_b2) + eps;
                const mb2Hat = mb2 / correction1;
                const sb2Hat = sb2 / correction2;
                this.b2 -= lr * mb2Hat / (Math.sqrt(sb2Hat) + eps);

                // Update W2 (AdaBelief step)
                for (let h = 0; h < this.hiddenDim; h++) {
                    const g_W2 = gW2[h] / currentBatchSize;
                    mW2[h] = beta1 * mW2[h] + (1 - beta1) * g_W2;
                    const diff_W2 = g_W2 - mW2[h];
                    sW2[h] = beta2 * sW2[h] + (1 - beta2) * (diff_W2 * diff_W2) + eps;
                    const mW2Hat = mW2[h] / correction1;
                    const sW2Hat = sW2[h] / correction2;
                    this.W2[h] -= lr * mW2Hat / (Math.sqrt(sW2Hat) + eps);
                }

                // Update b1 (AdaBelief step)
                for (let h = 0; h < this.hiddenDim; h++) {
                    const g_b1 = gb1[h] / currentBatchSize;
                    mb1[h] = beta1 * mb1[h] + (1 - beta1) * g_b1;
                    const diff_b1 = g_b1 - mb1[h];
                    sb1[h] = beta2 * sb1[h] + (1 - beta2) * (diff_b1 * diff_b1) + eps;
                    const mb1Hat = mb1[h] / correction1;
                    const sb1Hat = sb1[h] / correction2;
                    this.b1[h] -= lr * mb1Hat / (Math.sqrt(sb1Hat) + eps);
                }

                // Update W1 (AdaBelief step)
                for (let idx = 0; idx < this.W1.length; idx++) {
                    const g_W1 = gW1[idx] / currentBatchSize;
                    mW1[idx] = beta1 * mW1[idx] + (1 - beta1) * g_W1;
                    const diff_W1 = g_W1 - mW1[idx];
                    sW1[idx] = beta2 * sW1[idx] + (1 - beta2) * (diff_W1 * diff_W1) + eps;
                    const mW1Hat = mW1[idx] / correction1;
                    const sW1Hat = sW1[idx] / correction2;
                    this.W1[idx] -= lr * mW1Hat / (Math.sqrt(sW1Hat) + eps);
                }
            }

            // Log progress
            const epochNum = epoch + 1;
            if (epochNum % 10 === 0 || epochNum === epochs) {
                const evalRes = this.evaluate(X, y);
                console.log(`Epoch ${epochNum}: Loss = ${evalRes.loss.toFixed(4)}, Accuracy = ${(evalRes.accuracy * 100).toFixed(2)}%`);
            }
        }
    }
}

// --- Dinic's Algorithm for Min-Cut / Max-Flow ---
interface DinicEdge {
    to: number;
    cap: number;
    flow: number;
    rev: DinicEdge | null;
}

class Dinic {
    numNodes: number;
    adj: DinicEdge[][];
    level: Int32Array;
    ptr: Int32Array;

    constructor(numNodes: number) {
        this.numNodes = numNodes;
        this.adj = Array.from({ length: numNodes }, () => []);
        this.level = new Int32Array(numNodes);
        this.ptr = new Int32Array(numNodes);
    }

    addEdge(u: number, v: number, cap: number) {
        const a: DinicEdge = { to: v, cap: cap, flow: 0, rev: null };
        const b: DinicEdge = { to: u, cap: 0, flow: 0, rev: null };
        a.rev = b;
        b.rev = a;
        this.adj[u].push(a);
        this.adj[v].push(b);
    }

    addUndirectedEdge(u: number, v: number, cap: number) {
        const a: DinicEdge = { to: v, cap: cap, flow: 0, rev: null };
        const b: DinicEdge = { to: u, cap: cap, flow: 0, rev: null };
        a.rev = b;
        b.rev = a;
        this.adj[u].push(a);
        this.adj[v].push(b);
    }

    bfs(s: number, t: number): boolean {
        this.level.fill(-1);
        this.level[s] = 0;
        const queue: number[] = [s];
        let head = 0;
        while (head < queue.length) {
            const u = queue[head++];
            for (let i = 0; i < this.adj[u].length; i++) {
                const edge = this.adj[u][i];
                if (edge.cap - edge.flow > 0 && this.level[edge.to] === -1) {
                    this.level[edge.to] = this.level[u] + 1;
                    queue.push(edge.to);
                }
            }
        }
        return this.level[t] !== -1;
    }

    dfs(u: number, t: number, flow: number): number {
        if (u === t || flow === 0) return flow;
        let pushedTotal = 0;
        for (; this.ptr[u] < this.adj[u].length; this.ptr[u]++) {
            const edge = this.adj[u][this.ptr[u]];
            if (this.level[edge.to] === this.level[u] + 1 && edge.cap - edge.flow > 0) {
                const pushed = this.dfs(edge.to, t, Math.min(flow - pushedTotal, edge.cap - edge.flow));
                if (pushed > 0) {
                    edge.flow += pushed;
                    edge.rev!.flow -= pushed;
                    pushedTotal += pushed;
                    if (pushedTotal === flow) {
                        return pushedTotal;
                    }
                }
            }
        }
        return pushedTotal;
    }

    maxFlow(s: number, t: number): number {
        if (s === t) return 0;
        let flow = 0;
        while (this.bfs(s, t)) {
            this.ptr.fill(0);
            while (true) {
                const pushed = this.dfs(s, t, Infinity);
                if (pushed === 0) break;
                flow += pushed;
            }
        }
        return flow;
    }

    getReachable(s: number): Uint8Array {
        const visited = new Uint8Array(this.numNodes);
        visited[s] = 1;
        const queue: number[] = [s];
        let head = 0;
        while (head < queue.length) {
            const u = queue[head++];
            for (let i = 0; i < this.adj[u].length; i++) {
                const edge = this.adj[u][i];
                if (edge.cap - edge.flow > 0 && !visited[edge.to]) {
                    visited[edge.to] = 1;
                    queue.push(edge.to);
                }
            }
        }
        return visited;
    }
}

// --- Guided Filter for High-Resolution Upscaling ---
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

// --- GrabCut Interactive Filter Controller ---
export const GrabCutFilter = {
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
        let brushType: 'fg' | 'bg' = 'fg';
        let currentStrokeBrush: 'fg' | 'bg' | null = null;
        let brushSize = 15;
        let solverMaxDim = 200;
        let epochsCount = 50;
        let lambda = 10;
        let gamma = 30;
        let edgeSoftness = 4;
        let maskThreshold = 0.5;
        let realtimeUpdate = true;
        let viewMode: 'cutout' | 'mlp' | 'lowres' = 'cutout';

        let isDrawing = false;
        let history: ImageData[] = [];

        let cutoutImageData: ImageData | null = null;
        let mlpImageData: ImageData | null = null;
        let lowresImageData: ImageData | null = null;

        // Initialize Workspace layout
        const ws = new App.FullScreenWorkspace({
            title: 'Hybrid GrabCut Segmentation',
            onApply: () => {
                if (cutoutImageData) {
                    App.actions.saveState();
                    layer.ctx.clearRect(0, 0, fullW, fullH);
                    layer.ctx.putImageData(cutoutImageData, 0, 0);
                    App.emit('layer:content');
                }
            }
        });

        // 1. Build Side Panels inside content area
        const panelsContainer = UI.createNode('div', { className: 'gc-panels-container' },
            UI.createNode('div', { className: 'gc-panel' },
                UI.createNode('div', { className: 'gc-panel-header' },
                    UI.createNode('span', {}, 'Source Image & User Strokes'),
                    UI.createNode('span', {}, `${fullW} x ${fullH}`)
                ),
                UI.createNode('div', { className: 'gc-canvas-wrapper' },
                    UI.createNode('canvas', { id: 'gc-source-canvas', className: 'gc-canvas' })
                )
            ),
            UI.createNode('div', { className: 'gc-panel' },
                UI.createNode('div', { className: 'gc-panel-header' },
                    UI.createNode('span', {}, 'Interactive Segment Result'),
                    UI.createNode('span', { id: 'gc-status' }, 'Ready')
                ),
                UI.createNode('div', { className: 'gc-canvas-wrapper' },
                    UI.createNode('canvas', { id: 'gc-result-canvas', className: 'gc-canvas' })
                )
            )
        );
        ws.content.appendChild(panelsContainer);

        const srcCanvas = ws.content.querySelector('#gc-source-canvas') as HTMLCanvasElement;
        const resCanvas = ws.content.querySelector('#gc-result-canvas') as HTMLCanvasElement;
        const srcCtx = srcCanvas.getContext('2d')!;
        const resCtx = resCanvas.getContext('2d')!;

        srcCanvas.width = fullW;
        srcCanvas.height = fullH;
        resCanvas.width = fullW;
        resCanvas.height = fullH;

        // Prepare Offscreen Drawing Canvas
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = fullW;
        maskCanvas.height = fullH;
        const maskCtx = maskCanvas.getContext('2d')!;

        const renderSource = () => {
            srcCtx.clearRect(0, 0, fullW, fullH);
            srcCtx.drawImage(layer.canvas, 0, 0);
            srcCtx.save();
            srcCtx.globalAlpha = 0.5;
            srcCtx.drawImage(maskCanvas, 0, 0);
            srcCtx.restore();
        };

        const renderResult = () => {
            let activeData = cutoutImageData;
            if (viewMode === 'mlp') activeData = mlpImageData;
            else if (viewMode === 'lowres') activeData = lowresImageData;

            resCtx.clearRect(0, 0, fullW, fullH);
            if (activeData) {
                resCtx.putImageData(activeData, 0, 0);
            }
        };

        // 2. Build Sidebar Controls
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Drawing Tools'));

        const fgBtn = UI.createNode('button', { className: 'gc-tool-btn fg-tool active' },
            UI.createNode('span', { style: 'display:inline-block; width:10px; height:10px; background-color:#4caf50; border-radius:50%' }),
            'Foreground'
        ) as HTMLButtonElement;

        const bgBtn = UI.createNode('button', { className: 'gc-tool-btn bg-tool' },
            UI.createNode('span', { style: 'display:inline-block; width:10px; height:10px; background-color:#2196f3; border-radius:50%' }),
            'Background'
        ) as HTMLButtonElement;

        fgBtn.onclick = () => {
            brushType = 'fg';
            fgBtn.classList.add('active');
            bgBtn.classList.remove('active');
        };
        bgBtn.onclick = () => {
            brushType = 'bg';
            bgBtn.classList.add('active');
            fgBtn.classList.remove('active');
        };

        const toolGroup = UI.createNode('div', { className: 'gc-tool-group' }, fgBtn, bgBtn);
        ws.sidebar.appendChild(toolGroup);

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Brush Size', min: 2, max: 60, value: brushSize,
            onInput: (v) => {
                brushSize = parseInt(v);
            }
        }));

        const undoBtn = UI.createButton({
            label: 'Undo Stroke',
            className: 'btn cancel-btn',
            onClick: () => undo()
        });
        const clearBtn = UI.createButton({
            label: 'Clear Strokes',
            className: 'btn cancel-btn',
            onClick: () => clearStrokes()
        });

        const btnRow = UI.createNode('div', { style: 'display:flex; gap:10px;' }, undoBtn, clearBtn);
        ws.sidebar.appendChild(btnRow);

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title', style: 'margin-top:15px;' }, 'Solver Settings'));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'View Mode',
            options: [
                { value: 'cutout', text: 'Transparent Cutout' },
                { value: 'mlp', text: 'MLP Probability Map' },
                { value: 'lowres', text: 'Raw Binary Mask' }
            ],
            value: viewMode,
            onChange: (v) => {
                viewMode = v as 'cutout' | 'mlp' | 'lowres';
                renderResult();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Max Dim', min: 100, max: 500, step: 25, value: solverMaxDim,
            onInput: (v) => {
                solverMaxDim = parseInt(v);
                if (realtimeUpdate) solve();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Epochs', min: 10, max: 200, value: epochsCount,
            onInput: (v) => {
                epochsCount = parseInt(v);
                if (realtimeUpdate) solve();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'λ (Unary)', min: 1, max: 50, value: lambda,
            onInput: (v) => {
                lambda = parseInt(v);
                if (realtimeUpdate) solve();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'γ (Boundary)', min: 1, max: 100, value: gamma,
            onInput: (v) => {
                gamma = parseInt(v);
                if (realtimeUpdate) solve();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Edge Softness', min: 0, max: 15, value: edgeSoftness,
            onInput: (v) => {
                edgeSoftness = parseInt(v);
                if (realtimeUpdate) solve();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Threshold', min: 0.1, max: 0.9, step: 0.05, value: maskThreshold,
            onInput: (v) => {
                maskThreshold = parseFloat(v);
                if (realtimeUpdate) solve();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Live Update (Real-time)',
            value: realtimeUpdate,
            onChange: (v) => {
                realtimeUpdate = v;
            }
        }));

        const solveBtn = UI.createButton({
            label: 'Solve Segment',
            className: 'btn',
            style: 'width:100%; margin-top:10px; padding: 10px;',
            onClick: () => solve()
        });
        ws.sidebar.appendChild(solveBtn);

        // --- Interaction Logic ---
        const getCoords = (e: MouseEvent | Touch, cvs: HTMLCanvasElement) => {
            const rect = cvs.getBoundingClientRect();
            const scaleX = cvs.width / rect.width;
            const scaleY = cvs.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

        const executeStroke = (coords: { x: number, y: number }, activeBrush: 'fg' | 'bg') => {
            maskCtx.strokeStyle = activeBrush === 'fg' ? '#4caf50' : '#2196f3';
            maskCtx.lineWidth = brushSize;
            maskCtx.lineCap = 'round';
            maskCtx.lineJoin = 'round';
            maskCtx.lineTo(coords.x, coords.y);
            maskCtx.stroke();
            maskCtx.beginPath();
            maskCtx.moveTo(coords.x, coords.y);
            renderSource();
        };

        srcCanvas.onmousedown = (e) => {
            e.preventDefault();
            saveHistoryState();
            isDrawing = true;
            currentStrokeBrush = (e.buttons === 2) ? 'bg' : brushType;
            
            const coords = getCoords(e, srcCanvas);
            maskCtx.beginPath();
            maskCtx.moveTo(coords.x, coords.y);
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

        srcCanvas.addEventListener('touchend', (e) => {
            if (isDrawing) {
                isDrawing = false;
                currentStrokeBrush = null; // Release brush lock
                maskCtx.beginPath();
                if (realtimeUpdate) solve();
            }
        });

        // Prevent right-click browser menu
        srcCanvas.oncontextmenu = (e) => e.preventDefault();

        // --- History / Drawing helpers ---
        const saveHistoryState = () => {
            const data = maskCtx.getImageData(0, 0, fullW, fullH);
            history.push(data);
            if (history.length > 20) history.shift();
        };

        const undo = () => {
            if (history.length === 0) return;
            const state = history.pop()!;
            maskCtx.putImageData(state, 0, 0);
            renderSource();
            if (realtimeUpdate) solve();
        };

        const clearStrokes = () => {
            saveHistoryState();
            maskCtx.clearRect(0, 0, fullW, fullH);
            renderSource();
            cutoutImageData = null;
            mlpImageData = null;
            lowresImageData = null;
            renderResult();
        };

        // --- Core Solver Mechanics ---
        const solve = () => {
            const statusEl = ws.overlay.querySelector('#gc-status')!;
            statusEl.textContent = 'Solving...';

            let lowW = fullW;
            let lowH = fullH;
            if (fullW > solverMaxDim || fullH > solverMaxDim) {
                const scale = Math.min(solverMaxDim / fullW, solverMaxDim / fullH);
                lowW = Math.round(fullW * scale);
                lowH = Math.round(fullH * scale);
            }

            // Downsample active layer clean pixels
            const lowResCanvas = document.createElement('canvas');
            lowResCanvas.width = lowW;
            lowResCanvas.height = lowH;
            const lowResCtx = lowResCanvas.getContext('2d')!;
            lowResCtx.drawImage(layer.canvas, 0, 0, lowW, lowH);
            const lowImgData = lowResCtx.getImageData(0, 0, lowW, lowH).data;

            // Convert to CIELAB for perceptually uniform feature mapping and edge detection
            const labData = convertRgbToLab(lowImgData, lowW, lowH);

            // Downsample stroke mask pixels
            const lowMaskCanvas = document.createElement('canvas');
            lowMaskCanvas.width = lowW;
            lowMaskCanvas.height = lowH;
            const lowMaskCtx = lowMaskCanvas.getContext('2d')!;
            lowMaskCtx.imageSmoothingEnabled = false;
            lowMaskCtx.drawImage(maskCanvas, 0, 0, lowW, lowH);
            const lowMaskData = lowMaskCtx.getImageData(0, 0, lowW, lowH).data;

            const patches: Float32Array[] = [];
            const labels = new Uint8Array(lowW * lowH);
            const X_train: Float32Array[] = [];
            const y_train: number[] = [];

            // Extract features from LAB space. Normalized for MLP [0..1]
            const getPatch = (lab: Float32Array, w: number, h: number, x: number, y: number) => {
                const pad = 1;
                const patch = new Float32Array(27);
                let idx = 0;
                for (let dy = -pad; dy <= pad; dy++) {
                    for (let dx = -pad; dx <= pad; dx++) {
                        const px = Math.max(0, Math.min(w - 1, x + dx));
                        const py = Math.max(0, Math.min(h - 1, y + dy));
                        const offset = (py * w + px) * 3;
                        patch[idx++] = lab[offset] / 100.0;             // L component
                        patch[idx++] = (lab[offset + 1] + 128.0) / 255.0; // a component
                        patch[idx++] = (lab[offset + 2] + 128.0) / 255.0; // b component
                    }
                }
                return patch;
            };

            for (let y = 0; y < lowH; y++) {
                for (let x = 0; x < lowW; x++) {
                    const u = y * lowW + x;
                    const patch = getPatch(labData, lowW, lowH, x, y);
                    patches.push(patch);

                    const maskIdx = u * 4;
                    const r = lowMaskData[maskIdx];
                    const g = lowMaskData[maskIdx + 1];
                    const b = lowMaskData[maskIdx + 2];
                    const a = lowMaskData[maskIdx + 3];

                    if (a > 50) {
                        if (g > r && g > b) {
                            labels[u] = 1;
                            X_train.push(patch);
                            y_train.push(1);
                        } else if (b > r && b > g) {
                            labels[u] = 2;
                            X_train.push(patch);
                            y_train.push(0);
                        }
                    }
                }
            }

            // Ensure we have both Foreground and Background stroke labels
            if (X_train.length === 0 || y_train.filter(v => v === 1).length === 0 || y_train.filter(v => v === 0).length === 0) {
                statusEl.textContent = 'Draw both FG & BG';
                return;
            }

            // Dataset balancing
            const fg_samples: Float32Array[] = [];
            const bg_samples: Float32Array[] = [];
            for (let i = 0; i < X_train.length; i++) {
                if (y_train[i] === 1) fg_samples.push(X_train[i]);
                else bg_samples.push(X_train[i]);
            }

            const balanced_X: Float32Array[] = [];
            const balanced_y: number[] = [];
            const max_len = Math.max(fg_samples.length, bg_samples.length);
            for (let i = 0; i < max_len; i++) {
                balanced_X.push(fg_samples[i % fg_samples.length]);
                balanced_y.push(1);
                balanced_X.push(bg_samples[i % bg_samples.length]);
                balanced_y.push(0);
            }

            // Train Feature MLP
            const epochs = epochsCount;
            const mlp = new MiniMLP(12, 24);
            mlp.train(balanced_X, balanced_y, 0.03, epochs, 32);

            const p_fg = new Float32Array(lowW * lowH);
            for (let i = 0; i < p_fg.length; i++) {
                p_fg[i] = mlp.forward(patches[i]).a2;
            }

            const lam = lambda;
            const gam = gamma;
            const solver = new Dinic(lowW * lowH + 2);
            const S = lowW * lowH;
            const T = S + 1;

            // Compute Boundary Contrast Edge Beta Parameter (Using LAB Delta-E squared)
            let totalDiff = 0;
            let count = 0;
            for (let y = 0; y < lowH; y++) {
                for (let x = 0; x < lowW; x++) {
                    const u = y * lowW + x;
                    const idx1 = u * 3;
                    const L1 = labData[idx1], a1 = labData[idx1+1], b1 = labData[idx1+2];
                    
                    if (x + 1 < lowW) {
                        const idx2 = (y * lowW + (x + 1)) * 3;
                        const L2 = labData[idx2], a2 = labData[idx2+1], b2 = labData[idx2+2];
                        totalDiff += (L1 - L2)**2 + (a1 - a2)**2 + (b1 - b2)**2;
                        count++;
                    }
                    if (y + 1 < lowH) {
                        const idx2 = ((y + 1) * lowW + x) * 3;
                        const L2 = labData[idx2], a2 = labData[idx2+1], b2 = labData[idx2+2];
                        totalDiff += (L1 - L2)**2 + (a1 - a2)**2 + (b1 - b2)**2;
                        count++;
                    }
                }
            }
            const sigmaSq = totalDiff / (count || 1);
            const beta = sigmaSq > 1e-6 ? 1.0 / (2.0 * sigmaSq) : 1.0;

            // Precompute boundary contrast weights
            const leftW = new Float64Array(lowW * lowH);
            const upleftW = new Float64Array(lowW * lowH);
            const upW = new Float64Array(lowW * lowH);
            const uprightW = new Float64Array(lowW * lowH);

            const gammaDivSqrt2 = gam / Math.sqrt(2.0);

            for (let y = 0; y < lowH; y++) {
                for (let x = 0; x < lowW; x++) {
                    const u = y * lowW + x;
                    const idx1 = u * 3;
                    const L1 = labData[idx1], a1 = labData[idx1+1], b1 = labData[idx1+2];

                    if (x > 0) {
                        const idx2 = (y * lowW + (x - 1)) * 3;
                        const L2 = labData[idx2], a2 = labData[idx2+1], b2 = labData[idx2+2];
                        const diff = (L1 - L2)**2 + (a1 - a2)**2 + (b1 - b2)**2;
                        leftW[u] = gam * Math.exp(-beta * diff);
                    } else {
                        leftW[u] = 0;
                    }

                    if (x > 0 && y > 0) {
                        const idx2 = ((y - 1) * lowW + (x - 1)) * 3;
                        const L2 = labData[idx2], a2 = labData[idx2+1], b2 = labData[idx2+2];
                        const diff = (L1 - L2)**2 + (a1 - a2)**2 + (b1 - b2)**2;
                        upleftW[u] = gammaDivSqrt2 * Math.exp(-beta * diff);
                    } else {
                        upleftW[u] = 0;
                    }

                    if (y > 0) {
                        const idx2 = ((y - 1) * lowW + x) * 3;
                        const L2 = labData[idx2], a2 = labData[idx2+1], b2 = labData[idx2+2];
                        const diff = (L1 - L2)**2 + (a1 - a2)**2 + (b1 - b2)**2;
                        upW[u] = gam * Math.exp(-beta * diff);
                    } else {
                        upW[u] = 0;
                    }

                    if (x < lowW - 1 && y > 0) {
                        const idx2 = ((y - 1) * lowW + (x + 1)) * 3;
                        const L2 = labData[idx2], a2 = labData[idx2+1], b2 = labData[idx2+2];
                        const diff = (L1 - L2)**2 + (a1 - a2)**2 + (b1 - b2)**2;
                        uprightW[u] = gammaDivSqrt2 * Math.exp(-beta * diff);
                    } else {
                        uprightW[u] = 0;
                    }
                }
            }

            // Construct Dinic Graph with classic Unary (T) and Boundary (N) weights
            for (let y = 0; y < lowH; y++) {
                for (let x = 0; x < lowW; x++) {
                    const u = y * lowW + x;
                    
                    let fromSource = lam * p_fg[u];
                    let toSink = lam * (1.0 - p_fg[u]);
                    
                    if (labels[u] === 1) {
                        fromSource = lam * 1000;
                        toSink = 0;
                    } else if (labels[u] === 2) {
                        fromSource = 0;
                        toSink = lam * 1000;
                    }
                    
                    solver.addEdge(S, u, fromSource);
                    solver.addEdge(u, T, toSink);

                    // Set symmetric undirected neighbor edges
                    if (x > 0) {
                        solver.addUndirectedEdge(u, u - 1, leftW[u]);
                    }
                    if (x > 0 && y > 0) {
                        solver.addUndirectedEdge(u, u - lowW - 1, upleftW[u]);
                    }
                    if (y > 0) {
                        solver.addUndirectedEdge(u, u - lowW, upW[u]);
                    }
                    if (x < lowW - 1 && y > 0) {
                        solver.addUndirectedEdge(u, u - lowW + 1, uprightW[u]);
                    }
                }
            }

            solver.maxFlow(S, T);
            const reachable = solver.getReachable(S);

            const lowResMask = new Float32Array(lowW * lowH);
            for (let i = 0; i < lowResMask.length; i++) {
                lowResMask[i] = reachable[i] ? 1.0 : 0.0;
            }

            // High-res pixel upscaling with Guidance Filtering
            const cleanCanvas = document.createElement('canvas');
            cleanCanvas.width = fullW;
            cleanCanvas.height = fullH;
            const cleanCtx = cleanCanvas.getContext('2d')!;
            cleanCtx.drawImage(layer.canvas, 0, 0);
            const fullImgData = cleanCtx.getImageData(0, 0, fullW, fullH).data;

            const grayGuidance = new Float32Array(fullW * fullH);
            const upscaledMask = new Float32Array(fullW * fullH);

            for (let y = 0; y < fullH; y++) {
                const lowY = Math.min(lowH - 1, Math.floor((y / fullH) * lowH));
                for (let x = 0; x < fullW; x++) {
                    const i = y * fullW + x;
                    const lowX = Math.min(lowW - 1, Math.floor((x / fullW) * lowW));
                    
                    const r = fullImgData[i * 4] / 255;
                    const g = fullImgData[i * 4 + 1] / 255;
                    const b = fullImgData[i * 4 + 2] / 255;
                    grayGuidance[i] = 0.299 * r + 0.587 * g + 0.114 * b;
                    
                    upscaledMask[i] = lowResMask[lowY * lowW + lowX];
                }
            }

            let finalBinaryMask: Uint8Array;
            if (edgeSoftness > 0) {
                const filtered = guidedFilterGrayscale(grayGuidance, upscaledMask, fullW, fullH, edgeSoftness, 1e-3);
                finalBinaryMask = new Uint8Array(fullW * fullH);
                for (let i = 0; i < filtered.length; i++) {
                    finalBinaryMask[i] = filtered[i] >= maskThreshold ? 1 : 0;
                }
            } else {
                finalBinaryMask = new Uint8Array(fullW * fullH);
                for (let i = 0; i < upscaledMask.length; i++) {
                    finalBinaryMask[i] = upscaledMask[i] >= maskThreshold ? 1 : 0;
                }
            }

            cutoutImageData = resCtx.createImageData(fullW, fullH);
            mlpImageData = resCtx.createImageData(fullW, fullH);
            lowresImageData = resCtx.createImageData(fullW, fullH);

            // 1. Build MLP Probability Map
            for (let y = 0; y < fullH; y++) {
                const lowY = Math.min(lowH - 1, Math.floor((y / fullH) * lowH));
                for (let x = 0; x < fullW; x++) {
                    const i = y * fullW + x;
                    const lowX = Math.min(lowW - 1, Math.floor((x / fullW) * lowW));
                    const p = p_fg[lowY * lowW + lowX];
                    const idx = i * 4;
                    const val = Math.round(p * 255);
                    mlpImageData.data[idx] = val;
                    mlpImageData.data[idx+1] = val;
                    mlpImageData.data[idx+2] = val;
                    mlpImageData.data[idx+3] = 255;
                }
            }

            // 2. Build Lowres Binary Mask
            for (let i = 0; i < upscaledMask.length; i++) {
                const idx = i * 4;
                const val = upscaledMask[i] >= 0.5 ? 255 : 0;
                lowresImageData.data[idx] = val;
                lowresImageData.data[idx+1] = val;
                lowresImageData.data[idx+2] = val;
                lowresImageData.data[idx+3] = 255;
            }

            // 3. Build Transparent Cutout
            for (let i = 0; i < finalBinaryMask.length; i++) {
                const idx = i * 4;
                if (finalBinaryMask[i] === 1) {
                    cutoutImageData.data[idx] = fullImgData[idx];
                    cutoutImageData.data[idx+1] = fullImgData[idx+1];
                    cutoutImageData.data[idx+2] = fullImgData[idx+2];
                    cutoutImageData.data[idx+3] = 255;
                } else {
                    cutoutImageData.data[idx+3] = 0;
                }
            }

            renderResult();
            statusEl.textContent = 'Optimized';
        };

        // Render Initial Frame
        renderSource();
        renderResult();
        ws.show();
    },

    injectStyles() {
        if (document.getElementById('grabcut-filter-style')) return;
        const style = document.createElement('style');
        style.id = 'grabcut-filter-style';
        style.textContent = `
            .gc-panels-container { display: flex; width: 100%; height: 100%; gap: 15px; padding: 15px; box-sizing: border-box; background: #141414; }
            .gc-panel { flex: 1; display: flex; flex-direction: column; background: #1e1e1e; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
            .gc-panel-header { display: flex; justify-content: space-between; align-items: center; background: #252526; padding: 8px 12px; border-bottom: 1px solid #333; font-weight: bold; font-size: 11px; color: #aaa; text-transform: uppercase; }
            .gc-canvas-wrapper { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 10px; background-image: linear-gradient(45deg, #181818 25%, transparent 25%), linear-gradient(-45deg, #181818 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181818 75%), linear-gradient(-45deg, transparent 75%, #181818 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px; }
            .gc-canvas { max-width: 100%; max-height: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.5); object-fit: contain; image-rendering: pixelated; background: transparent; cursor: crosshair; }
            .gc-tool-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
            .gc-tool-btn { background-color: #121212; border: 1px solid #333; color: #ccc; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; font-weight: bold; }
            .gc-tool-btn:hover { background-color: #2a2a2a; border-color: #007acc; }
            .gc-tool-btn.active { border-color: #007acc; background-color: rgba(0, 122, 204, 0.15); color: #fff; }
            .gc-tool-btn.fg-tool.active { border-color: #4caf50; background-color: rgba(76, 175, 80, 0.15); }
            .gc-tool-btn.bg-tool.active { border-color: #2196f3; background-color: rgba(33, 150, 243, 0.15); }
        `;
        document.head.appendChild(style);
    }
};

if (typeof window !== 'undefined') {
    (window as any).GrabCutFilter = GrabCutFilter;
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

Filters.register('grabcut', {
    name: 'Hybrid GrabCut',
    mode: 'pixel',
    menu: {
        path: 'Filter/Segmentation',
        label: 'Hybrid GrabCut...',
        order: 1
    },
    apply(l: Layer) {
        GrabCutFilter.open();
    }
});