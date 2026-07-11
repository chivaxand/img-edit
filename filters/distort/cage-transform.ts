import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { App } from '~/app';

interface Point {
    x: number;
    y: number;
}

interface PrecalcCoords {
    phi: Float64Array;
    psi: Float64Array;
    isInside: boolean;
}

Filters.register('distort-cage-transform', {
    name: 'Cage Transform (GC)',
    mode: 'unified',
    menu: {
        path: 'Filter/Distort',
        label: 'Cage Transform...',
        order: 7
    },

    apply(context: FilterContext) {
        const layer = context.layer;
        const fullW = layer.canvas.width;
        const fullH = layer.canvas.height;

        const origCanvas = document.createElement('canvas');
        origCanvas.width = fullW;
        origCanvas.height = fullH;
        origCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);

        // --- State Variables ---
        let mode: 'edit' | 'deform' = 'edit';
        let gridSize = 30;
        let showMesh = false;
        let showCage = true;
        let cutOutMode = false;

        let originalCage: Point[] = [];
        let transfCage: Point[] = [];
        let originalEdgeLengths: number[] = [];

        let vRest: Array<{ id: number; x: number; y: number }> = [];
        let vDeformed: Array<{ id: number; x: number; y: number }> = [];
        let triangles: Array<[number, number, number]> = [];
        let gridCoords: PrecalcCoords[] = [];

        let maskedOrigCanvas: HTMLCanvasElement | null = null;
        let maskedSrc8: Uint8ClampedArray | null = null;

        // Interaction state
        let hoveredNodeIdx: number | null = null;
        let hoveredEdgeIdx: number | null = null;
        let hoveredEdgeProj: Point | null = null;
        let draggingNodeIdx: number | null = null;

        // Interactive states for pipeline dual-rendering
        let interpolationMode: 'lanczos' | 'bicubic' | 'bilinear' | 'pixelated' = 'bicubic';
        let isAdjustingSlider = false;

        // Initialize cage slightly outside the canvas bounds
        const pad = Math.max(30, Math.min(fullW, fullH) * 0.1);
        originalCage = [
            { x: -pad, y: -pad },
            { x: -pad, y: fullH + pad },
            { x: fullW + pad, y: fullH + pad },
            { x: fullW + pad, y: -pad }
        ];
        transfCage = JSON.parse(JSON.stringify(originalCage));

        const onMouseMove = (e: MouseEvent) => {
            if (draggingNodeIdx !== null) {
                const { x, y } = getUnclampedViewportCoords(e);
                if (mode === 'edit') {
                    originalCage[draggingNodeIdx].x = x;
                    originalCage[draggingNodeIdx].y = y;
                    transfCage[draggingNodeIdx].x = x;
                    transfCage[draggingNodeIdx].y = y;
                } else {
                    transfCage[draggingNodeIdx].x = x;
                    transfCage[draggingNodeIdx].y = y;
                    updateDeformation();
                }
                render();
            }
        };

        const onMouseUp = () => {
            if (draggingNodeIdx !== null) {
                draggingNodeIdx = null;
                canvas.style.cursor = 'grab';
                render();
            }
        };

        // --- Workspace Setup ---
        const ws = new App.FullScreenWorkspace({
            title: 'Cage Transform',
            onApply: () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                viewport.destroy();
                App.actions.saveState();
                const finalCtx = layer.ctx;
                finalCtx.clearRect(0, 0, fullW, fullH);
                finalCtx.drawImage(backbuffer, 0, 0);
                App.emit('layer:content');
            },
            onCancel: () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                viewport.destroy();
            }
        });

        const mainPanel = ws.createPanel({ title: 'Cage Editor', status: '📐 Click edges to add points. Right-click points to remove.' });
        const canvas = mainPanel.canvas;
        canvas.width = fullW;
        canvas.height = fullH;

        const viewport = new App.InteractiveViewport(canvas);
        viewport.setSmoothing(true);

        const backbuffer = document.createElement('canvas');
        backbuffer.width = fullW;
        backbuffer.height = fullH;
        const bbCtx = backbuffer.getContext('2d')!;
        bbCtx.drawImage(origCanvas, 0, 0);

        // --- Math Helpers ---

        const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;

        const getSignedArea = (cage: Point[]) => {
            let area = 0;
            for (let i = 0; i < cage.length; i++) {
                const p1 = cage[i];
                const p2 = cage[(i + 1) % cage.length];
                area += p1.x * p2.y - p2.x * p1.y;
            }
            return area * 0.5;
        };

        const adjustIfOnBoundary = (pt: Point, cage: Point[], isCW: boolean): Point => {
            const salt = 1e-3;
            const p = { x: pt.x, y: pt.y };
            for (let i = 0; i < cage.length; i++) {
                const v1 = cage[i];
                const v2 = cage[(i + 1) % cage.length];
                const dx = v2.x - v1.x;
                const dy = v2.y - v1.y;
                const l2 = dx * dx + dy * dy;
                if (l2 === 0) continue;
                let t = ((p.x - v1.x) * dx + (p.y - v1.y) * dy) / l2;
                t = Math.max(0, Math.min(1, t));
                const projX = v1.x + t * dx;
                const projY = v1.y + t * dy;
                const dist = Math.hypot(p.x - projX, p.y - projY);
                if (dist < 1e-2) {
                    let nx = isCW ? -dy : dy;
                    let ny = isCW ? dx : -dx;
                    const nLen = Math.hypot(nx, ny) || 1e-8;
                    p.x += (nx / nLen) * salt;
                    p.y += (ny / nLen) * salt;
                }
            }
            return p;
        };

        const isPointInPolygon = (p: Point, polygon: Point[]): boolean => {
            let inside = false;
            const n = polygon.length;
            let p1 = polygon[0];
            for (let i = 0; i <= n; i++) {
                const p2 = polygon[i % n];
                if (p.y > Math.min(p1.y, p2.y)) {
                    if (p.y <= Math.max(p1.y, p2.y)) {
                        if (p.x <= Math.max(p1.x, p2.x)) {
                            if (p1.y !== p2.y) {
                                const xints = (p.y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y) + p1.x;
                                if (p1.x === p2.x || p.x <= xints) {
                                    inside = !inside;
                                }
                            }
                        }
                    }
                }
                p1 = p2;
            }
            return inside;
        };

        const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
            const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
            if (l2 === 0) return { dist: Math.hypot(px - x1, py - y1), proj: { x: x1, y: y1 } };
            let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = x1 + t * (x2 - x1);
            const projY = y1 + t * (y2 - y1);
            return { dist: Math.hypot(px - projX, py - projY), proj: { x: projX, y: projY } };
        };

        // --- Software Interpolar/Alpha Samplers ---

        const srcCtx = origCanvas.getContext('2d')!;
        const srcData = srcCtx.getImageData(0, 0, fullW, fullH);
        const src8 = srcData.data;
        let activeSrc8 = src8;

        const getPixelVal = (sx: number, sy: number, c: number) => {
            let x = Math.floor(sx);
            let y = Math.floor(sy);
            if (x < 0) x = 0; else if (x >= fullW) x = fullW - 1;
            if (y < 0) y = 0; else if (y >= fullH) y = fullH - 1;
            return activeSrc8[(y * fullW + x) * 4 + c];
        };

        const sampleBilinear = (u: number, v: number, c: number) => {
            const x0 = Math.floor(u);
            const y0 = Math.floor(v);
            const x1 = Math.min(fullW - 1, x0 + 1);
            const y1 = Math.min(fullH - 1, y0 + 1);
            const dx = u - x0;
            const dy = v - y0;

            const top = getPixelVal(x0, y0, c) * (1 - dx) + getPixelVal(x1, y0, c) * dx;
            const bot = getPixelVal(x0, y1, c) * (1 - dx) + getPixelVal(x1, y1, c) * dx;
            return top * (1 - dy) + bot * dy;
        };

        const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
            return 0.5 * ((2 * p1) + (-p0 + p2) * t + 
                (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + 
                (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        };

        const sampleBicubic = (u: number, v: number, c: number) => {
            const x0 = Math.floor(u);
            const y0 = Math.floor(v);
            const dx = u - x0;
            const dy = v - y0;

            const row = (offsetY: number) => {
                return cubic(
                    getPixelVal(x0 - 1, y0 + offsetY, c),
                    getPixelVal(x0,     y0 + offsetY, c),
                    getPixelVal(x0 + 1, y0 + offsetY, c),
                    getPixelVal(x0 + 2, y0 + offsetY, c),
                    dx
                );
            };

            const val = cubic(row(-1), row(0), row(1), row(2), dy);
            return Math.max(0, Math.min(255, val));
        };

        const l_sinc = (x: number) => {
            if (x === 0) return 1;
            const px = Math.PI * x;
            return Math.sin(px) / px;
        };

        const l_weight = (x: number) => {
            if (x < 0) x = -x;
            if (x >= 3) return 0;
            return l_sinc(x) * l_sinc(x / 3);
        };

        const sampleLanczos3 = (u: number, v: number, c: number) => {
            const x0 = Math.floor(u);
            const y0 = Math.floor(v);
            let sum = 0, weightSum = 0;

            for (let j = -2; j <= 3; j++) {
                const sy = y0 + j;
                const wy = l_weight(v - sy);
                if (wy === 0) continue;

                for (let i = -2; i <= 3; i++) {
                    const sx = x0 + i;
                    const wx = l_weight(u - sx);
                    const w = wx * wy;
                    if (w === 0) continue;

                    sum += getPixelVal(sx, sy, c) * w;
                    weightSum += w;
                }
            }

            if (weightSum === 0) return getPixelVal(x0, y0, c);
            const val = sum / weightSum;
            return Math.max(0, Math.min(255, val));
        };

        // --- Grid Generation ---

        const buildGrid = () => {
            const cols = gridSize;
            const rows = Math.max(4, Math.round(gridSize * (fullH / fullW)));
            
            vRest = [];
            triangles = [];

            for (let c = 0; c <= cols; c++) {
                for (let r = 0; r <= rows; r++) {
                    vRest.push({
                        id: vRest.length,
                        x: (c / cols) * fullW,
                        y: (r / rows) * fullH
                    });
                }
            }

            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    const v00 = c * (rows + 1) + r;
                    const v01 = c * (rows + 1) + (r + 1);
                    const v10 = (c + 1) * (rows + 1) + r;
                    const v11 = (c + 1) * (rows + 1) + (r + 1);

                    triangles.push([v00, v10, v01]);
                    triangles.push([v10, v11, v01]);
                }
            }
            vDeformed = JSON.parse(JSON.stringify(vRest));
        };

        const generateMaskedSource = () => {
            maskedOrigCanvas = document.createElement('canvas');
            maskedOrigCanvas.width = fullW;
            maskedOrigCanvas.height = fullH;
            const mCtx = maskedOrigCanvas.getContext('2d')!;
            mCtx.drawImage(origCanvas, 0, 0);

            mCtx.globalCompositeOperation = 'destination-in';
            mCtx.beginPath();
            for (let i = 0; i < originalCage.length; i++) {
                if (i === 0) mCtx.moveTo(originalCage[i].x, originalCage[i].y);
                else mCtx.lineTo(originalCage[i].x, originalCage[i].y);
            }
            mCtx.closePath();
            mCtx.fill();

            maskedSrc8 = mCtx.getImageData(0, 0, fullW, fullH).data;
        };

        // --- Green Coordinates Math ---

        const precalculateGrid = () => {
            const N = originalCage.length;
            const isCW = getSignedArea(originalCage) > 0;

            originalEdgeLengths = [];
            for (let i = 0; i < N; i++) {
                const v1 = originalCage[i];
                const v2 = originalCage[(i + 1) % N];
                originalEdgeLengths.push(Math.hypot(v2.x - v1.x, v2.y - v1.y));
            }

            gridCoords = [];
            for (let i = 0; i < vRest.length; i++) {
                const pt = vRest[i];
                const isInside = isPointInPolygon(pt, originalCage);

                const phi = new Float64Array(N);
                const psi = new Float64Array(N);

                if (isInside) {
                    const adjusted = adjustIfOnBoundary(pt, originalCage, isCW);
                    const px = adjusted.x; 
                    const py = adjusted.y;

                    for (let j = 0; j < N; j++) {
                        const v1 = originalCage[j];
                        const v2 = originalCage[(j + 1) % N];
                        
                        const ax = v2.x - v1.x;
                        const ay = v2.y - v1.y;
                        const bx = v1.x - px;
                        const by = v1.y - py;
                        
                        const aLen = Math.hypot(ax, ay);
                        if (aLen === 0) continue;

                        let nx = isCW ? -ay : ay;
                        let ny = isCW ? ax : -ax;
                        const nLen = Math.hypot(nx, ny) || 1e-8;
                        nx /= nLen; ny /= nLen;

                        const Q = ax * ax + ay * ay;
                        const S = bx * bx + by * by;
                        const R = 2 * (ax * bx + ay * by);
                        const BA = bx * (aLen * nx) + by * (aLen * ny);
                        
                        const srtArg = 4 * S * Q - R * R;
                        const SRT = Math.sqrt(Math.max(0, srtArg));

                        if (SRT < 1e-6) continue;

                        const L0 = Math.log(S);
                        const L1 = Math.log(Math.max(1e-8, S + Q + R));
                        const A0 = Math.atan2(R, SRT) / SRT;
                        const A1 = Math.atan2((2 * Q + R), SRT) / SRT;
                        
                        const A10 = A1 - A0;
                        const L10 = L1 - L0;
                        
                        const edge_psi = (aLen / (4 * Math.PI)) * ((4 * S - (R * R) / Q) * A10 + (R / (2 * Q)) * L10 + L1 - 2);
                        const phi2 = -(BA / (2 * Math.PI)) * (L10 / (2 * Q) - A10 * (R / Q));
                        const phi1 = (BA / (2 * Math.PI)) * (L10 / (2 * Q) - A10 * (2 + R / Q));
                        
                        if (!isNaN(edge_psi)) psi[j] = edge_psi;
                        if (!isNaN(phi1)) phi[j] += phi1;
                        if (!isNaN(phi2)) phi[(j + 1) % N] += phi2;
                    }
                }
                gridCoords.push({ phi, psi, isInside });
            }
        };

        const updateDeformation = () => {
            if (mode === 'edit') return;
            const N = transfCage.length;
            const isCW = getSignedArea(transfCage) > 0;

            const transfNormals: Point[] = [];
            for (let i = 0; i < N; i++) {
                const v1 = transfCage[i];
                const v2 = transfCage[(i + 1) % N];
                
                let ax = v2.x - v1.x;
                let ay = v2.y - v1.y;
                let nx = isCW ? -ay : ay;
                let ny = isCW ? ax : -ax;
                const nLen = Math.hypot(nx, ny) || 1e-8;
                nx /= nLen; ny /= nLen;

                const transfEdgeLength = Math.hypot(ax, ay);
                const scaleCoeff = originalEdgeLengths[i] === 0 ? 1 : (transfEdgeLength / originalEdgeLengths[i]);
                
                transfNormals.push({
                    x: nx * scaleCoeff,
                    y: ny * scaleCoeff
                });
            }

            const insideIndices: number[] = [];
            const outsideIndices: number[] = [];

            for (let i = 0; i < vRest.length; i++) {
                if (gridCoords[i].isInside) {
                    insideIndices.push(i);
                } else {
                    outsideIndices.push(i);
                }
            }

            // PASS 1: Apply Green Coordinates to points INSIDE the cage
            for (const i of insideIndices) {
                const { phi, psi } = gridCoords[i];
                let rx = 0, ry = 0;
                for (let j = 0; j < N; j++) {
                    rx += phi[j] * transfCage[j].x + psi[j] * transfNormals[j].x;
                    ry += phi[j] * transfCage[j].y + psi[j] * transfNormals[j].y;
                }
                vDeformed[i].x = rx;
                vDeformed[i].y = ry;
            }

            // PASS 2: Extrapolate points OUTSIDE the cage
            for (const i of outsideIndices) {
                let nearestIdx = -1;
                let minDistSq = Infinity;
                const outPt = vRest[i];
                
                for (const innIdx of insideIndices) {
                    const dx = outPt.x - vRest[innIdx].x;
                    const dy = outPt.y - vRest[innIdx].y;
                    const dSq = dx * dx + dy * dy;
                    if (dSq < minDistSq) {
                        minDistSq = dSq;
                        nearestIdx = innIdx;
                    }
                }

                if (nearestIdx !== -1) {
                    const dx = vDeformed[nearestIdx].x - vRest[nearestIdx].x;
                    const dy = vDeformed[nearestIdx].y - vRest[nearestIdx].y;
                    vDeformed[i].x = outPt.x + dx;
                    vDeformed[i].y = outPt.y + dy;
                } else {
                    vDeformed[i].x = outPt.x;
                    vDeformed[i].y = outPt.y;
                }
            }
        };

        const drawTriangleSoftware = (
            dstData: Uint8ClampedArray,
            p0: Point, p1: Point, p2: Point,
            q0: Point, q1: Point, q2: Point,
            sampler: (u: number, v: number, c: number) => number
        ) => {
            const minX = Math.max(0, Math.floor(Math.min(q0.x, q1.x, q2.x)));
            const maxX = Math.min(fullW - 1, Math.ceil(Math.max(q0.x, q1.x, q2.x)));
            const minY = Math.max(0, Math.floor(Math.min(q0.y, q1.y, q2.y)));
            const maxY = Math.min(fullH - 1, Math.ceil(Math.max(q0.y, q1.y, q2.y)));

            const denom = (q1.y - q2.y) * (q0.x - q2.x) + (q2.x - q1.x) * (q0.y - q2.y);
            if (Math.abs(denom) < 1e-6) return;

            const invDenom = 1.0 / denom;

            for (let y = minY; y <= maxY; y++) {
                const rowOffset = y * fullW;
                for (let x = minX; x <= maxX; x++) {
                    const w0 = ((q1.y - q2.y) * (x - q2.x) + (q2.x - q1.x) * (y - q2.y)) * invDenom;
                    const w1 = ((q2.y - q0.y) * (x - q2.x) + (q0.x - q2.x) * (y - q2.y)) * invDenom;
                    const w2 = 1.0 - w0 - w1;

                    const eps = -1e-4;
                    if (w0 >= eps && w1 >= eps && w2 >= eps) {
                        const u = w0 * p0.x + w1 * p1.x + w2 * p2.x;
                        const v = w0 * p0.y + w1 * p1.y + w2 * p2.y;

                        const idx = (rowOffset + x) * 4;
                        dstData[idx]     = sampler(u, v, 0);
                        dstData[idx + 1] = sampler(u, v, 1);
                        dstData[idx + 2] = sampler(u, v, 2);
                        dstData[idx + 3] = sampler(u, v, 3);
                    }
                }
            }
        };

        const drawTriangleHardware = (
            bCtx: CanvasRenderingContext2D,
            img: HTMLCanvasElement,
            p0: Point, p1: Point, p2: Point,
            q0: Point, q1: Point, q2: Point
        ) => {
            bCtx.save();
            bCtx.setTransform(1, 0, 0, 1, 0, 0);

            const cx = (q0.x + q1.x + q2.x) / 3;
            const cy = (q0.y + q1.y + q2.y) / 3;
            // Anti-aliasing seam bleed patch
            const expandX = (x: number) => x + (x - cx > 0 ? 0.45 : -0.45);
            const expandY = (y: number) => y + (y - cy > 0 ? 0.45 : -0.45);

            bCtx.beginPath();
            bCtx.moveTo(expandX(q0.x), expandY(q0.y));
            bCtx.lineTo(expandX(q1.x), expandY(q1.y));
            bCtx.lineTo(expandX(q2.x), expandY(q2.y));
            bCtx.closePath();
            bCtx.clip();

            const dX1 = q1.x - q0.x, dY1 = q1.y - q0.y;
            const dX2 = q2.x - q0.x, dY2 = q2.y - q0.y;
            const dU1 = p1.x - p0.x, dV1 = p1.y - p0.y;
            const dU2 = p2.x - p0.x, dV2 = p2.y - p0.y;

            const det = dU1 * dV2 - dU2 * dV1;
            if (Math.abs(det) > 1e-6) {
                const id = 1.0 / det;
                const a = id * (dV2 * dX1 - dV1 * dX2);
                const b = id * (dV2 * dY1 - dV1 * dY2);
                const c = id * (dU1 * dX2 - dU2 * dX1);
                const d = id * (dU1 * dY2 - dU2 * dY1);
                const e = q0.x - a * p0.x - c * p0.y;
                const f = q0.y - b * p0.x - d * p0.y;

                bCtx.setTransform(a, b, c, d, e, f);
                bCtx.drawImage(img, 0, 0);
            }
            bCtx.restore();
        };

        const render = () => {
            if (mode === 'deform') {
                const useFastDrag = draggingNodeIdx !== null || isAdjustingSlider;
                activeSrc8 = (cutOutMode && maskedSrc8) ? maskedSrc8 : src8;

                bbCtx.clearRect(0, 0, fullW, fullH);

                if (cutOutMode) {
                    bbCtx.globalCompositeOperation = 'source-over';
                    bbCtx.drawImage(origCanvas, 0, 0);

                    bbCtx.globalCompositeOperation = 'destination-out';
                    bbCtx.beginPath();
                    for (let i = 0; i < originalCage.length; i++) {
                        const p = originalCage[i];
                        if (i === 0) bbCtx.moveTo(p.x, p.y);
                        else bbCtx.lineTo(p.x, p.y);
                    }
                    bbCtx.closePath();
                    bbCtx.fill();
                    bbCtx.globalCompositeOperation = 'source-over';
                }

                let renderTriangles = triangles;
                if (cutOutMode) {
                    renderTriangles = triangles.filter(([i0, i1, i2]) => 
                        gridCoords[i0] && gridCoords[i1] && gridCoords[i2] &&
                        (gridCoords[i0].isInside || gridCoords[i1].isInside || gridCoords[i2].isInside)
                    );
                }

                if (useFastDrag) {
                    bbCtx.imageSmoothingEnabled = true;
                    bbCtx.imageSmoothingQuality = 'low';

                    for (const [i0, i1, i2] of renderTriangles) {
                        drawTriangleHardware(bbCtx, cutOutMode && maskedOrigCanvas ? maskedOrigCanvas : origCanvas, vRest[i0], vRest[i1], vRest[i2], vDeformed[i0], vDeformed[i1], vDeformed[i2]);
                    }
                } else {
                    const deformLayer = document.createElement('canvas');
                    deformLayer.width = fullW;
                    deformLayer.height = fullH;
                    const deformCtx = deformLayer.getContext('2d')!;
                    const dstImageData = deformCtx.createImageData(fullW, fullH);
                    const dst8 = dstImageData.data;

                    let sampler: (u: number, v: number, c: number) => number;
                    if (interpolationMode === 'pixelated') {
                        sampler = (u, v, c) => getPixelVal(Math.round(u), Math.round(v), c);
                    } else if (interpolationMode === 'bilinear') {
                        sampler = sampleBilinear;
                    } else if (interpolationMode === 'lanczos') {
                        sampler = sampleLanczos3;
                    } else {
                        sampler = sampleBicubic;
                    }

                    for (const [i0, i1, i2] of renderTriangles) {
                        drawTriangleSoftware(dst8, vRest[i0], vRest[i1], vRest[i2], vDeformed[i0], vDeformed[i1], vDeformed[i2], sampler);
                    }
                    deformCtx.putImageData(dstImageData, 0, 0);
                    
                    bbCtx.globalCompositeOperation = 'source-over';
                    bbCtx.drawImage(deformLayer, 0, 0);
                }
            } else {
                bbCtx.globalCompositeOperation = 'source-over';
                bbCtx.clearRect(0, 0, fullW, fullH);
                bbCtx.drawImage(origCanvas, 0, 0);
            }
            viewport.onDraw!();
            viewport.drawOverlay();
        };

        // --- Custom Interaction Management (bypasses clamping limitation) ---

        const getUnclampedViewportCoords = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) / viewport.zoom,
                y: (e.clientY - rect.top) / viewport.zoom
            };
        };

        const updateHoverState = (cx: number, cy: number) => {
            const cage = mode === 'edit' ? originalCage : transfCage;
            hoveredNodeIdx = null;
            hoveredEdgeIdx = null;
            hoveredEdgeProj = null;

            const hitTolerance = 15 / viewport.zoom;

            // Priority 1: Check nodes
            for (let i = 0; i < cage.length; i++) {
                if (Math.hypot(cx - cage[i].x, cy - cage[i].y) < hitTolerance) {
                    hoveredNodeIdx = i;
                    canvas.style.cursor = 'grab';
                    return;
                }
            }

            // Priority 2: Check edges
            if (mode === 'edit') {
                let minDist = hitTolerance;
                for (let i = 0; i < cage.length; i++) {
                    const p1 = cage[i];
                    const p2 = cage[(i + 1) % cage.length];
                    const { dist, proj } = distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y);
                    if (dist < minDist) {
                        minDist = dist;
                        hoveredEdgeIdx = i;
                        hoveredEdgeProj = proj;
                    }
                }
                if (hoveredEdgeIdx !== null) {
                    canvas.style.cursor = 'copy';
                    return;
                }
            }
            canvas.style.cursor = 'default';
        };

        // Attach globally to the wrapper to track out-of-bounds clicks perfectly
        ws.content.addEventListener('contextmenu', e => e.preventDefault());

        ws.content.addEventListener('mousedown', (e) => {
            // Ignore middle clicks (used for panning)
            if (e.button === 1 || e.button === 4) return;
            
            const { x, y } = getUnclampedViewportCoords(e);
            const isRightClick = e.button === 2;

            if (isRightClick && mode === 'edit' && hoveredNodeIdx !== null) {
                if (originalCage.length > 3) {
                    originalCage.splice(hoveredNodeIdx, 1);
                    transfCage.splice(hoveredNodeIdx, 1);
                    hoveredNodeIdx = null;
                    render();
                }
                return;
            }

            if (hoveredNodeIdx !== null) {
                draggingNodeIdx = hoveredNodeIdx;
                canvas.style.cursor = 'grabbing';
            } else if (mode === 'edit' && hoveredEdgeProj !== null && hoveredEdgeIdx !== null) {
                originalCage.splice(hoveredEdgeIdx + 1, 0, { x: hoveredEdgeProj.x, y: hoveredEdgeProj.y });
                transfCage.splice(hoveredEdgeIdx + 1, 0, { x: hoveredEdgeProj.x, y: hoveredEdgeProj.y });
                draggingNodeIdx = hoveredEdgeIdx + 1;
                canvas.style.cursor = 'grabbing';
                render();
            }
        });

        window.addEventListener('mousemove', onMouseMove);

        // Only hover state when moving over the canvas bounding area
        ws.content.addEventListener('mousemove', (e) => {
            if (draggingNodeIdx === null) {
                const { x, y } = getUnclampedViewportCoords(e);
                updateHoverState(x, y);
                viewport.drawOverlay();
            }
        });

        window.addEventListener('mouseup', onMouseUp);


        // --- Viewport Callbacks ---
        viewport.onDraw = () => {
            viewport.ctx.clearRect(0, 0, canvas.width, canvas.height);
            viewport.ctx.drawImage(backbuffer, 0, 0);
        };

        viewport.onDrawOverlay = (oCtx: CanvasRenderingContext2D) => {
            if (showMesh && mode === 'deform') {
                oCtx.strokeStyle = 'rgba(0, 230, 120, 0.25)';
                oCtx.lineWidth = 1;
                oCtx.beginPath();
                const drawnEdges = new Set<string>();
                for (const [i0, i1, i2] of triangles) {
                    const edges = [[i0, i1], [i1, i2], [i2, i0]];
                    for (const [a, b] of edges) {
                        const edgeKey = Math.min(a, b) + '-' + Math.max(a, b);
                        if (!drawnEdges.has(edgeKey)) {
                            drawnEdges.add(edgeKey);
                            const pA = viewport.canvasToOverlay(vDeformed[a].x, vDeformed[a].y);
                            const pB = viewport.canvasToOverlay(vDeformed[b].x, vDeformed[b].y);
                            oCtx.moveTo(pA.x, pA.y);
                            oCtx.lineTo(pB.x, pB.y);
                        }
                    }
                }
                oCtx.stroke();
            }

            if (showCage) {
                const cage = mode === 'edit' ? originalCage : transfCage;
                const orig = originalCage;
                
                if (mode === 'deform') {
                    oCtx.beginPath();
                    for (let i = 0; i < orig.length; i++) {
                        const p = viewport.canvasToOverlay(orig[i].x, orig[i].y);
                        if (i === 0) oCtx.moveTo(p.x, p.y);
                        else oCtx.lineTo(p.x, p.y);
                    }
                    oCtx.closePath();
                    oCtx.strokeStyle = 'rgba(0, 122, 204, 0.4)';
                    oCtx.lineWidth = 1;
                    oCtx.setLineDash([4, 4]);
                    oCtx.stroke();
                    oCtx.setLineDash([]);
                }

                oCtx.beginPath();
                for (let i = 0; i < cage.length; i++) {
                    const p = viewport.canvasToOverlay(cage[i].x, cage[i].y);
                    if (i === 0) oCtx.moveTo(p.x, p.y);
                    else oCtx.lineTo(p.x, p.y);
                }
                oCtx.closePath();
                oCtx.strokeStyle = mode === 'edit' ? '#007acc' : '#ff3366';
                oCtx.lineWidth = 2;
                oCtx.stroke();

                for (let i = 0; i < cage.length; i++) {
                    const p = viewport.canvasToOverlay(cage[i].x, cage[i].y);
                    const isHovered = i === hoveredNodeIdx;
                    
                    oCtx.beginPath();
                    oCtx.arc(p.x, p.y, isHovered ? 8 : 6, 0, 2 * Math.PI);
                    oCtx.fillStyle = '#fff';
                    oCtx.strokeStyle = mode === 'edit' ? '#007acc' : '#ff3366';
                    oCtx.lineWidth = 2;
                    oCtx.fill();
                    oCtx.stroke();
                }

                if (mode === 'edit' && hoveredEdgeProj && hoveredNodeIdx === null) {
                    const p = viewport.canvasToOverlay(hoveredEdgeProj.x, hoveredEdgeProj.y);
                    oCtx.beginPath();
                    oCtx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
                    oCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    oCtx.strokeStyle = '#007acc';
                    oCtx.lineWidth = 2;
                    oCtx.setLineDash([2, 2]);
                    oCtx.fill();
                    oCtx.stroke();
                    oCtx.setLineDash([]);
                }
            }
        };

        // --- Sidebar UI ---

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Interaction Mode'));

        const setMode = (newMode: 'edit' | 'deform') => {
            if (mode === newMode) return;
            mode = newMode;
            
            if (mode === 'deform') {
                mainPanel.statusEl.textContent = '🖐 Drag nodes to deform the image using Green Coordinates.';
                generateMaskedSource();
                buildGrid();
                precalculateGrid();
                updateDeformation();
            } else {
                mainPanel.statusEl.textContent = '📐 Click edges to add points. Right-click points to remove.';
                transfCage = JSON.parse(JSON.stringify(originalCage));
            }
            render();
        };

        ws.sidebar.appendChild(UI.createRadioGroup({
            label: null,
            options: [
                { value: 'edit', text: 'Edit Cage' },
                { value: 'deform', text: 'Deform Image' }
            ],
            value: mode,
            onChange: (v) => setMode(v as any)
        }));
        
        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Cut Out Mode',
            value: cutOutMode,
            onChange: (v) => { 
                cutOutMode = v; 
                render(); 
            }
        }));

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Display Settings'));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Mesh Density', min: 10, max: 100, step: 1, value: gridSize,
            onInput: (v) => {
                gridSize = parseInt(v);
                isAdjustingSlider = true;
                if (mode === 'deform') {
                    buildGrid();
                    precalculateGrid();
                    updateDeformation();
                    render();
                }
            },
            onChange: (v) => {
                gridSize = parseInt(v);
                isAdjustingSlider = false;
                if (mode === 'deform') {
                    buildGrid();
                    precalculateGrid();
                    updateDeformation();
                    render();
                }
            }
        }));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Quality Level',
            options: [
                { value: 'lanczos', text: 'Lanczos-3' },
                { value: 'bicubic', text: 'Bicubic' },
                { value: 'bilinear', text: 'Bilinear' },
                { value: 'pixelated', text: 'Nearest Neighbor' }
            ],
            value: interpolationMode,
            onChange: (v) => {
                interpolationMode = v as any;
                render();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Show Cage Constraints',
            value: showCage,
            onChange: (v) => { showCage = v; viewport.drawOverlay(); }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Show Interpolation Mesh',
            value: showMesh,
            onChange: (v) => { showMesh = v; viewport.drawOverlay(); }
        }));

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Actions'));

        ws.sidebar.appendChild(UI.createButton({
            label: 'Reset Deformation',
            className: 'btn cancel-btn',
            style: 'width: 100%; margin-bottom: 8px;',
            onClick: () => {
                transfCage = JSON.parse(JSON.stringify(originalCage));
                if (mode === 'deform') updateDeformation();
                render();
            }
        }));

        ws.sidebar.appendChild(UI.createHint('<b>Green Coordinates</b> perfectly preserve local conformal mapping. In Edit mode, add boundary points by clicking lines, drag them to stretch, and right-click to remove.'));

        ws.show();

        setTimeout(() => {
            render();
            viewport.reset();
        }, 60);
    }
});
