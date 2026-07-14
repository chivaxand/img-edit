import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { App } from '~/app';
import { Lib } from '~/libs/index';

interface WarpPin {
    id: string;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    stiffness: number;
    rotation: number; // in degrees
    scale: number;
}

Filters.register('distort-puppet-warp', {
    name: 'Puppet Warp (MLS)',
    mode: 'unified',
    menu: {
        path: 'Filter/Distort',
        label: 'Puppet Warp...',
        order: 6
    },

    apply(context: FilterContext) {
        const layer = context.layer;
        const fullW = layer.canvas.width;
        const fullH = layer.canvas.height;

        const origCanvas = document.createElement('canvas');
        origCanvas.width = fullW;
        origCanvas.height = fullH;
        origCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);

        // State variables
        let pins: WarpPin[] = [];
        let selectedPinIds = new Set<string>();
        let selectedPinId: string | null = null;
        let hoveredPinId: string | null = null;
        let activeTool: 'drag' | 'add' | 'remove' = 'add';
        let mode: 'rigid' | 'similarity' | 'affine' = 'rigid';
        let alpha = 3.0;
        let gridSize = 40;
        let showMesh = true;
        let showHeatmap = false;
        let showPins = true;
        let interpolationMode: 'lanczos' | 'high' | 'low' | 'pixelated' = 'lanczos';

        let isDraggingPin = false;
        let isAdjustingSlider = false;
        let hasDragged = false;
        let activeDragPinId: string | null = null;
        const dragStartPositions: Record<string, { x: number; y: number }> = {};
        let dragStartMouseX = 0;
        let dragStartMouseY = 0;

        // Local history manager
        const historyStack: string[] = [];
        const redoStack: string[] = [];
        const maxHistory = 50;

        const saveLocalState = () => {
            const serialized = JSON.stringify(pins);
            if (historyStack.length > 0 && historyStack[historyStack.length - 1] === serialized) {
                return;
            }
            if (historyStack.length >= maxHistory) {
                historyStack.shift();
            }
            historyStack.push(serialized);
            redoStack.length = 0;
            updateSidebarFields();
        };

        const undoLocal = () => {
            if (historyStack.length > 1) {
                const current = historyStack.pop()!;
                redoStack.push(current);
                pins = JSON.parse(historyStack[historyStack.length - 1]);
                selectedPinIds.clear();
                selectedPinId = null;
                hoveredPinId = null;
                recalculateAndRender();
                updateSidebarFields();
            }
        };

        const redoLocal = () => {
            if (redoStack.length > 0) {
                const next = redoStack.pop()!;
                historyStack.push(next);
                pins = JSON.parse(next);
                recalculateAndRender();
                updateSidebarFields();
            }
        };

        // Workspace setup
        const ws = new App.FullScreenWorkspace({
            title: 'Puppet Warp (Pin-Based MLS)',
            onApply: () => {
                viewport.destroy();
                document.removeEventListener('keydown', keyHandler);
                App.actions.saveState();
                const finalCtx = layer.ctx;
                finalCtx.clearRect(0, 0, fullW, fullH);
                finalCtx.drawImage(backbuffer, 0, 0);
                App.emit('layer:content');
            },
            onCancel: () => {
                viewport.destroy();
                document.removeEventListener('keydown', keyHandler);
            }
        });

        const mainPanel = ws.createPanel({ title: 'Puppet Warp Editor', status: 'Place pins, configure stiffness, and drag.' });
        const canvas = mainPanel.canvas;
        canvas.width = fullW;
        canvas.height = fullH;

        const viewport = new App.InteractiveViewport(canvas);
        viewport.setSmoothing(true);

        // Rendering backbuffers
        const backbuffer = document.createElement('canvas');
        backbuffer.width = fullW;
        backbuffer.height = fullH;
        const bbCtx = backbuffer.getContext('2d')!;

        // Keyboard shortcuts
        const keyHandler = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPinId !== null) {
                pins = pins.filter(p => !selectedPinIds.has(p.id));
                selectedPinIds.clear();
                selectedPinId = null;
                hoveredPinId = null;
                saveLocalState();
                recalculateAndRender();
                updateCursor(0, 0, false);
                e.preventDefault();
            } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                undoLocal();
                e.preventDefault();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                redoLocal();
                e.preventDefault();
            } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
                redoLocal();
                e.preventDefault();
            }
        };
        document.addEventListener('keydown', keyHandler);

        // Alpha-Contour Triangle mesh structures
        let vRest: Array<{ id: number; x: number; y: number }> = [];
        let vDeformed: Array<{ id: number; x: number; y: number }> = [];
        let triangles: Array<[number, number, number]> = [];

        const srcCtx = origCanvas.getContext('2d')!;
        const srcData = srcCtx.getImageData(0, 0, fullW, fullH);
        const src8 = srcData.data;

        const buildMesh = () => {
            const cols = gridSize;
            const rows = Math.max(4, Math.round(gridSize * (fullH / fullW)));
            const cellW = fullW / cols;
            const cellH = fullH / rows;
            
            const activeCells = Array.from({length: cols}, () => new Array(rows).fill(false));
            
            const checkCellAlpha = (c: number, r: number) => {
                const startX = Math.floor(c * cellW);
                const endX = Math.min(fullW, Math.ceil((c + 1) * cellW));
                const startY = Math.floor(r * cellH);
                const endY = Math.min(fullH, Math.ceil((r + 1) * cellH));
                
                const step = 3;
                for (let y = startY; y < endY; y += step) {
                    for (let x = startX; x < endX; x += step) {
                        const alphaIdx = (y * fullW + x) * 4 + 3;
                        if (src8[alphaIdx] > 5) return true;
                    }
                }
                return false;
            };

            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    activeCells[c][r] = checkCellAlpha(c, r);
                }
            }

            const dilatedCells = Array.from({length: cols}, () => new Array(rows).fill(false));
            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    if (activeCells[c][r]) {
                        for (let dc = -1; dc <= 1; dc++) {
                            for (let dr = -1; dr <= 1; dr++) {
                                const nc = c + dc, nr = r + dr;
                                if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
                                    dilatedCells[nc][nr] = true;
                                }
                            }
                        }
                    }
                }
            }

            vRest = [];
            triangles = [];
            const vertexMap = new Map<string, number>();

            const getVertexId = (c: number, r: number) => {
                const key = `${c},${r}`;
                if (vertexMap.has(key)) return vertexMap.get(key)!;
                const id = vRest.length;
                vRest.push({ id, x: (c / cols) * fullW, y: (r / rows) * fullH });
                vertexMap.set(key, id);
                return id;
            };

            let hasAny = false;
            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    if (dilatedCells[c][r]) {
                        hasAny = true;
                        const v00 = getVertexId(c, r);
                        const v10 = getVertexId(c + 1, r);
                        const v11 = getVertexId(c + 1, r + 1);
                        const v01 = getVertexId(c, r + 1);

                        triangles.push([v00, v10, v01]);
                        triangles.push([v10, v11, v01]);
                    }
                }
            }

            if (!hasAny) {
                 for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        const v00 = getVertexId(c, r);
                        const v10 = getVertexId(c + 1, r);
                        const v11 = getVertexId(c + 1, r + 1);
                        const v01 = getVertexId(c, r + 1);
                        triangles.push([v00, v10, v01]);
                        triangles.push([v10, v11, v01]);
                    }
                 }
            }
        };

        const checkTriangleBarycentric = (
            x: number, y: number,
            q0: { x: number; y: number }, q1: { x: number; y: number }, q2: { x: number; y: number },
            p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }
        ) => {
            const denom = (q1.y - q2.y) * (q0.x - q2.x) + (q2.x - q1.x) * (q0.y - q2.y);
            if (Math.abs(denom) < 1e-6) return null;

            const w0 = ((q1.y - q2.y) * (x - q2.x) + (q2.x - q1.x) * (y - q2.y)) / denom;
            const w1 = ((q2.y - q0.y) * (x - q2.x) + (q0.x - q2.x) * (y - q2.y)) / denom;
            const w2 = 1.0 - w0 - w1;

            const eps = -1e-3;
            if (w0 >= eps && w1 >= eps && w2 >= eps) {
                const u = w0 * p0.x + w1 * p1.x + w2 * p2.x;
                const v = w0 * p0.y + w1 * p1.y + w2 * p2.y;
                return { x: u, y: v };
            }
            return null;
        };

        const getOriginalCoords = (clickX: number, clickY: number) => {
            if (pins.length === 0 || vDeformed.length === 0) {
                return { x: clickX, y: clickY };
            }

            for (const [i0, i1, i2] of triangles) {
                const p0 = vRest[i0], p1 = vRest[i1], p2 = vRest[i2];
                const q0 = vDeformed[i0], q1 = vDeformed[i1], q2 = vDeformed[i2];

                const mapped = checkTriangleBarycentric(clickX, clickY, q0, q1, q2, p0, p1, p2);
                if (mapped) return mapped;
            }
            return { x: clickX, y: clickY };
        };

        const recalculateAndRender = () => {
            vDeformed = vRest.map(pt => {
                const baseDef = solveMLS(pt.x, pt.y, pins, mode, alpha);

                if (pins.length === 0) {
                    return { id: pt.id, x: baseDef.x, y: baseDef.y };
                }

                const weights = new Float64Array(pins.length);
                let sumW = 0;
                const eps = 1e-6;

                for (let i = 0; i < pins.length; i++) {
                    const pin = pins[i];
                    const dx = pin.x - pt.x;
                    const dy = pin.y - pt.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < eps) {
                        weights[i] = 1e12;
                    } else {
                        weights[i] = pin.stiffness / Math.pow(distSq, alpha);
                    }
                    sumW += weights[i];
                }

                let finalX = 0;
                let finalY = 0;

                for (let i = 0; i < pins.length; i++) {
                    const pin = pins[i];
                    const normW = weights[i] / sumW;

                    const dx = baseDef.x - pin.targetX;
                    const dy = baseDef.y - pin.targetY;

                    const rad = (pin.rotation * Math.PI) / 180;
                    const cosR = Math.cos(rad);
                    const sinR = Math.sin(rad);

                    const rotatedX = (dx * cosR - dy * sinR) * pin.scale;
                    const rotatedY = (dx * sinR + dy * cosR) * pin.scale;

                    finalX += normW * (pin.targetX + rotatedX);
                    finalY += normW * (pin.targetY + rotatedY);
                }

                return { id: pt.id, x: finalX, y: finalY };
            });

            const useFastDrag = isDraggingPin || isAdjustingSlider;

            if (useFastDrag) {
                bbCtx.clearRect(0, 0, fullW, fullH);
                bbCtx.imageSmoothingEnabled = true;
                bbCtx.imageSmoothingQuality = 'low';

                if (pins.length === 0) {
                    bbCtx.drawImage(origCanvas, 0, 0);
                } else {
                    for (const [i0, i1, i2] of triangles) {
                        const p0 = vRest[i0], p1 = vRest[i1], p2 = vRest[i2];
                        const q0 = vDeformed[i0], q1 = vDeformed[i1], q2 = vDeformed[i2];
                        Lib.mesh.drawTriangleHardware(bbCtx, origCanvas, p0, p1, p2, q0, q1, q2);
                    }
                }
            } else {
                bbCtx.clearRect(0, 0, fullW, fullH);
                if (pins.length === 0) {
                    bbCtx.drawImage(origCanvas, 0, 0);
                } else {
                    const dstImageData = bbCtx.createImageData(fullW, fullH);
                    const dst8 = dstImageData.data;

                    let sampler: (u: number, v: number, c: number) => number;
                    if (interpolationMode === 'pixelated') {
                        sampler = (u, v, c) => Lib.image.sampleNearest(src8, fullW, fullH, u, v, c);
                    } else if (interpolationMode === 'low') {
                        sampler = (u, v, c) => Lib.image.sampleBilinear(src8, fullW, fullH, u, v, c);
                    } else if (interpolationMode === 'lanczos') {
                        sampler = (u, v, c) => Lib.image.sampleLanczos3(src8, fullW, fullH, u, v, c);
                    } else {
                        sampler = (u, v, c) => Lib.image.sampleBicubic(src8, fullW, fullH, u, v, c);
                    }

                    for (const [i0, i1, i2] of triangles) {
                        const p0 = vRest[i0], p1 = vRest[i1], p2 = vRest[i2];
                        const q0 = vDeformed[i0], q1 = vDeformed[i1], q2 = vDeformed[i2];
                        Lib.mesh.drawTriangleSoftware(dst8, fullW, fullH, p0, p1, p2, q0, q1, q2, sampler);
                    }
                    bbCtx.putImageData(dstImageData, 0, 0);
                }
            }

            viewport.onDraw!();
            viewport.drawOverlay();
        };

        const solveMLS = (v_x: number, v_y: number, pinsArray: WarpPin[], m: typeof mode, aVal: number) => {
            const N = pinsArray.length;
            if (N === 0) return { x: v_x, y: v_y };
            if (N === 1) {
                const dx = pinsArray[0].targetX - pinsArray[0].x;
                const dy = pinsArray[0].targetY - pinsArray[0].y;
                return { x: v_x + dx, y: v_y + dy };
            }

            const w = new Float64Array(N);
            let sumW = 0;
            const eps = 1e-6;

            for (let i = 0; i < N; i++) {
                const pin = pinsArray[i];
                const dx = pin.x - v_x;
                const dy = pin.y - v_y;
                const distSq = dx * dx + dy * dy;
                if (distSq < eps) {
                    return { x: pin.targetX, y: pin.targetY };
                }
                w[i] = 1.0 / Math.pow(distSq, aVal);
                w[i] *= pin.stiffness;
                sumW += w[i];
            }

            let p_star_x = 0;
            let p_star_y = 0;
            let q_star_x = 0;
            let q_star_y = 0;

            for (let i = 0; i < N; i++) {
                p_star_x += w[i] * pinsArray[i].x;
                p_star_y += w[i] * pinsArray[i].y;
                q_star_x += w[i] * pinsArray[i].targetX;
                q_star_y += w[i] * pinsArray[i].targetY;
            }

            p_star_x /= sumW;
            p_star_y /= sumW;
            q_star_x /= sumW;
            q_star_y /= sumW;

            const hat_p_x = new Float64Array(N);
            const hat_p_y = new Float64Array(N);
            const hat_q_x = new Float64Array(N);
            const hat_q_y = new Float64Array(N);

            for (let i = 0; i < N; i++) {
                hat_p_x[i] = pinsArray[i].x - p_star_x;
                hat_p_y[i] = pinsArray[i].y - p_star_y;
                hat_q_x[i] = pinsArray[i].targetX - q_star_x;
                hat_q_y[i] = pinsArray[i].targetY - q_star_y;
            }

            const dv_x = v_x - p_star_x;
            const dv_y = v_y - p_star_y;

            if (m === 'affine') {
                let d00 = 0, d01 = 0, d11 = 0;
                for (let i = 0; i < N; i++) {
                    const wi = w[i];
                    const px = hat_p_x[i];
                    const py = hat_p_y[i];
                    d00 += wi * px * px;
                    d01 += wi * px * py;
                    d11 += wi * py * py;
                }

                const det = d00 * d11 - d01 * d01;
                if (Math.abs(det) < 1e-8) {
                    return { x: v_x - p_star_x + q_star_x, y: v_y - p_star_y + q_star_y };
                }

                const invD00 = d11 / det;
                const invD01 = -d01 / det;
                const invD11 = d00 / det;

                let s00 = 0, s01 = 0, s10 = 0, s11 = 0;
                for (let i = 0; i < N; i++) {
                    const wi = w[i];
                    const px = hat_p_x[i];
                    const py = hat_p_y[i];
                    const qx = hat_q_x[i];
                    const qy = hat_q_y[i];
                    s00 += wi * px * qx;
                    s01 += wi * px * qy;
                    s10 += wi * py * qx;
                    s11 += wi * py * qy;
                }

                const m00 = invD00 * s00 + invD01 * s10;
                const m01 = invD00 * s01 + invD01 * s11;
                const m10 = invD01 * s00 + invD11 * s10;
                const m11 = invD01 * s01 + invD11 * s11;

                const rx = dv_x * m00 + dv_y * m10 + q_star_x;
                const ry = dv_x * m01 + dv_y * m11 + q_star_y;
                return { x: rx, y: ry };
            } else {
                let mu_s = 0;
                for (let i = 0; i < N; i++) {
                    mu_s += w[i] * (hat_p_x[i] * hat_p_x[i] + hat_p_y[i] * hat_p_y[i]);
                }

                if (mu_s < 1e-8) {
                    return { x: v_x - p_star_x + q_star_x, y: v_y - p_star_y + q_star_y };
                }

                let a = 0;
                let b = 0;
                for (let i = 0; i < N; i++) {
                    const wi = w[i];
                    const px = hat_p_x[i];
                    const py = hat_p_y[i];
                    const qx = hat_q_x[i];
                    const qy = hat_q_y[i];
                    a += wi * (px * qx + py * qy);
                    b += wi * (px * qy - py * qx);
                }

                if (m === 'rigid') {
                    const H = Math.sqrt(a * a + b * b);
                    if (H < 1e-8) {
                        return { x: v_x - p_star_x + q_star_x, y: v_y - p_star_y + q_star_y };
                    }
                    const rx = (dv_x * a - dv_y * b) / H + q_star_x;
                    const ry = (dv_x * b + dv_y * a) / H + q_star_y;
                    return { x: rx, y: ry };
                } else {
                    const rx = (dv_x * a - dv_y * b) / mu_s + q_star_x;
                    const ry = (dv_x * b + dv_y * a) / mu_s + q_star_y;
                    return { x: rx, y: ry };
                }
            }
        };

        const drawTriangleHeatmap = (
            ctx: CanvasRenderingContext2D,
            i0: number, i1: number, i2: number
        ) => {
            const p0 = vRest[i0], p1 = vRest[i1], p2 = vRest[i2];
            const q0 = vDeformed[i0], q1 = vDeformed[i1], q2 = vDeformed[i2];

            const L01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            const L12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const L20 = Math.hypot(p0.x - p2.x, p0.y - p2.y);

            const l01 = Math.hypot(q1.x - q0.x, q1.y - q0.y);
            const l12 = Math.hypot(q2.x - q1.x, q2.y - q1.y);
            const l20 = Math.hypot(q0.x - q0.x, q0.y - q2.y);

            const s01 = L01 === 0 ? 0 : Math.abs(l01 / L01 - 1);
            const s12 = L12 === 0 ? 0 : Math.abs(l12 / L12 - 1);
            const s20 = L20 === 0 ? 0 : Math.abs(l20 / L20 - 1);

            const stress = (s01 + s12 + s20) / 3;
            const factor = Math.min(1.0, stress / 0.4);

            const red = Math.round(factor * 255);
            const green = Math.round((1 - factor) * 255);

            const s0 = viewport.canvasToOverlay(q0.x, q0.y);
            const s1 = viewport.canvasToOverlay(q1.x, q1.y);
            const s2 = viewport.canvasToOverlay(q2.x, q2.y);

            ctx.beginPath();
            ctx.moveTo(s0.x, s0.y);
            ctx.lineTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.closePath();
            ctx.fillStyle = `rgba(${red}, ${green}, 40, 0.28)`;
            ctx.strokeStyle = `rgba(${red}, ${green}, 40, 0.12)`;
            ctx.fill();
            ctx.stroke();
        };

        const freezeBorders = () => {
            pins = pins.filter(p => !p.id.startsWith('border_'));

            if (vRest.length === 0 || triangles.length === 0) return;

            // Analyze edge-sharing topology to extract the actual subject boundary
            const edgeCount = new Map<string, number>();
            const registerEdge = (iA: number, iB: number) => {
                const key = Math.min(iA, iB) + '-' + Math.max(iA, iB);
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            };

            for (const [i0, i1, i2] of triangles) {
                registerEdge(i0, i1);
                registerEdge(i1, i2);
                registerEdge(i2, i0);
            }

            const boundaryVertexIds = new Set<number>();
            for (const [key, count] of edgeCount.entries()) {
                if (count === 1) {
                    const [iA, iB] = key.split('-').map(Number);
                    boundaryVertexIds.add(iA);
                    boundaryVertexIds.add(iB);
                }
            }

            const boundaryArray = Array.from(boundaryVertexIds);
            const step = Math.max(1, Math.round(boundaryArray.length / 16));

            const borderPins: WarpPin[] = [];
            for (let i = 0; i < boundaryArray.length; i += step) {
                const vIndex = boundaryArray[i];
                const pt = vRest[vIndex];
                
                borderPins.push({
                    id: 'border_' + vIndex,
                    x: pt.x,
                    y: pt.y,
                    targetX: pt.x,
                    targetY: pt.y,
                    stiffness: 1.0,
                    rotation: 0,
                    scale: 1.0
                });
            }

            pins = [...pins, ...borderPins];
            saveLocalState();
            recalculateAndRender();
        };

        const hitTestPins = (clickX: number, clickY: number): WarpPin | null => {
            const hitRadius = 16;
            let clickedPin = null;
            let minDist = hitRadius;

            for (let i = 0; i < pins.length; i++) {
                const p = pins[i];
                const d = Math.hypot(clickX - p.targetX, clickY - p.targetY);
                if (d < minDist) {
                    minDist = d;
                    clickedPin = p;
                }
            }
            return clickedPin;
        };

        const updateCursor = (clickX: number, clickY: number, isShift: boolean) => {
            if (isDraggingPin) {
                canvas.style.cursor = 'grabbing';
                return;
            }

            const hovered = hitTestPins(clickX, clickY);
            if (hovered) {
                if (activeTool === 'remove') {
                    canvas.style.cursor = 'no-drop';
                } else if (isShift) {
                    canvas.style.cursor = 'crosshair';
                } else {
                    canvas.style.cursor = 'grab';
                }
            } else {
                if (activeTool === 'add') {
                    canvas.style.cursor = 'alias';
                } else if (activeTool === 'drag') {
                    canvas.style.cursor = 'default';
                } else {
                    canvas.style.cursor = 'default';
                }
            }
        };

        viewport.onDraw = () => {
            viewport.ctx.clearRect(0, 0, canvas.width, canvas.height);
            viewport.ctx.drawImage(backbuffer, 0, 0);
        };

        viewport.onDrawOverlay = (oCtx: CanvasRenderingContext2D) => {
            if (showHeatmap && pins.length > 0 && vDeformed.length > 0) {
                for (const [i0, i1, i2] of triangles) {
                    drawTriangleHeatmap(oCtx, i0, i1, i2);
                }
            }

            if (showMesh && pins.length > 0 && vDeformed.length > 0) {
                oCtx.strokeStyle = 'rgba(0, 230, 120, 0.35)';
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

            if (showPins) {
                pins.forEach(pin => {
                    const sPos = viewport.canvasToOverlay(pin.targetX, pin.targetY);
                    const isSelected = selectedPinIds.has(pin.id);
                    const isHovered = pin.id === hoveredPinId;

                    if (isSelected) {
                        const circleRadius = viewport.canvasLengthToOverlay(pin.stiffness * 25);
                        oCtx.beginPath();
                        oCtx.arc(sPos.x, sPos.y, circleRadius, 0, 2 * Math.PI);
                        oCtx.strokeStyle = 'rgba(255, 170, 0, 0.22)';
                        oCtx.lineWidth = 1;
                        oCtx.setLineDash([4, 4]);
                        oCtx.stroke();
                        oCtx.setLineDash([]);
                    }

                    oCtx.beginPath();
                    oCtx.arc(sPos.x, sPos.y, isHovered ? 10 : 8, 0, 2 * Math.PI);
                    oCtx.fillStyle = isHovered ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.85)';
                    oCtx.strokeStyle = isSelected ? '#ffaa00' : '#222';
                    oCtx.lineWidth = isSelected ? 2 : 1.5;
                    oCtx.fill();
                    oCtx.stroke();

                    oCtx.beginPath();
                    oCtx.arc(sPos.x, sPos.y, isHovered ? 5 : 4, 0, 2 * Math.PI);
                    oCtx.fillStyle = isSelected ? '#ff3366' : (isHovered ? '#3399ff' : '#007acc');
                    oCtx.fill();
                });
            }
        };

        viewport.onMouseDown = (ev) => {
            const clickX = ev.x;
            const clickY = ev.y;
            const isShift = ev.originalEvent && 'shiftKey' in ev.originalEvent && (ev.originalEvent as any).shiftKey;

            const clickedPin = hitTestPins(clickX, clickY);

            if (ev.isRightClick || ev.button === 2) {
                if (clickedPin) {
                    pins = pins.filter(p => p.id !== clickedPin.id);
                    selectedPinIds.delete(clickedPin.id);
                    if (selectedPinId === clickedPin.id) {
                        selectedPinId = null;
                    }
                    if (hoveredPinId === clickedPin.id) {
                        hoveredPinId = null;
                    }
                    saveLocalState();
                    recalculateAndRender();
                    updateCursor(clickX, clickY, isShift);
                }
                return;
            }

            if (clickedPin) {
                if (activeTool === 'remove') {
                    pins = pins.filter(p => p.id !== clickedPin.id);
                    selectedPinIds.delete(clickedPin.id);
                    if (selectedPinId === clickedPin.id) {
                        selectedPinId = null;
                    }
                    if (hoveredPinId === clickedPin.id) {
                        hoveredPinId = null;
                    }
                    saveLocalState();
                    recalculateAndRender();
                } else {
                    if (isShift) {
                        if (selectedPinIds.has(clickedPin.id)) {
                            selectedPinIds.delete(clickedPin.id);
                        } else {
                            selectedPinIds.add(clickedPin.id);
                            selectedPinId = clickedPin.id;
                        }
                    } else {
                        if (!selectedPinIds.has(clickedPin.id)) {
                            selectedPinIds.clear();
                            selectedPinIds.add(clickedPin.id);
                        }
                        selectedPinId = clickedPin.id;
                    }

                    pins.forEach(p => {
                        dragStartPositions[p.id] = { x: p.targetX, y: p.targetY };
                    });
                    dragStartMouseX = clickX;
                    dragStartMouseY = clickY;

                    activeDragPinId = clickedPin.id;
                    isDraggingPin = true;
                    hasDragged = false;
                    viewport.drawOverlay();
                }
            } else {
                if (activeTool === 'add') {
                    const originalCoords = getOriginalCoords(clickX, clickY);
                    const newPin: WarpPin = {
                        id: 'pin_' + Math.random().toString(36).substr(2, 9),
                        x: originalCoords.x,
                        y: originalCoords.y,
                        targetX: clickX,
                        targetY: clickY,
                        stiffness: 1.0,
                        rotation: 0,
                        scale: 1.0
                    };
                    pins.push(newPin);

                    selectedPinIds.clear();
                    selectedPinIds.add(newPin.id);
                    selectedPinId = newPin.id;

                    dragStartPositions[newPin.id] = { x: clickX, y: clickY };
                    dragStartMouseX = clickX;
                    dragStartMouseY = clickY;

                    activeDragPinId = newPin.id;
                    isDraggingPin = true;
                    hasDragged = false;
                    saveLocalState();
                    recalculateAndRender();
                } else {
                    if (!isShift) {
                        selectedPinIds.clear();
                        selectedPinId = null;
                    }
                    viewport.drawOverlay();
                }
            }
            updateCursor(clickX, clickY, isShift);
            updateSidebarFields();
        };

        viewport.onMouseMove = (ev) => {
            const clickX = ev.x;
            const clickY = ev.y;
            const isShift = ev.originalEvent && 'shiftKey' in ev.originalEvent && (ev.originalEvent as any).shiftKey;

            if (isDraggingPin && activeDragPinId) {
                const dx = clickX - dragStartMouseX;
                const dy = clickY - dragStartMouseY;

                selectedPinIds.forEach(id => {
                    const pin = pins.find(p => p.id === id);
                    const startPos = dragStartPositions[id];
                    if (pin && startPos) {
                        pin.targetX = startPos.x + dx;
                        pin.targetY = startPos.y + dy;
                    }
                });

                hasDragged = true;
                recalculateAndRender();
            } else {
                const hovered = hitTestPins(clickX, clickY);
                const newHoveredId = hovered ? hovered.id : null;
                if (hoveredPinId !== newHoveredId) {
                    hoveredPinId = newHoveredId;
                    viewport.drawOverlay();
                }
            }

            updateCursor(clickX, clickY, isShift);
        };

        viewport.onMouseUp = (ev) => {
            if (isDraggingPin) {
                isDraggingPin = false;
                activeDragPinId = null;
                if (hasDragged) {
                    saveLocalState();
                }
                recalculateAndRender();
                
                const isShift = ev.originalEvent && 'shiftKey' in ev.originalEvent && (ev.originalEvent as any).shiftKey;
                updateCursor(ev.x, ev.y, isShift);
            }
        };

        ws.sidebar.appendChild(UI.createSubheading('Puppet Warp Tools'));

        ws.sidebar.appendChild(UI.createRadioGroup({
            label: 'Mode',
            options: [
                { value: 'drag', text: '✥ Select & Drag Pin' },
                { value: 'add', text: '📍 Add Joint Pin' },
                { value: 'remove', text: '❌ Remove Joint Pin' }
            ],
            value: activeTool,
            layout: 'column',
            onChange: (v) => {
                activeTool = v as any;
            }
        }));

        const stiffnessSection = UI.createNode('div', { style: 'display: none;' });
        stiffnessSection.appendChild(UI.createSubheading('Selected Pin Properties'));

        const stiffnessRow = UI.createSliderRow({
            label: 'Pin Influence', min: 0.2, max: 10.0, step: 0.1, value: 1.0,
            onInput: (v) => {
                if (selectedPinId) {
                    const pin = pins.find(p => p.id === selectedPinId);
                    if (pin) {
                        pin.stiffness = parseFloat(v);
                        isAdjustingSlider = true;
                        recalculateAndRender();
                    }
                }
            },
            onChange: () => {
                isAdjustingSlider = false;
                saveLocalState();
                recalculateAndRender();
            }
        });
        const stiffnessInput = stiffnessRow.querySelector('input[type="range"]') as HTMLInputElement;
        stiffnessSection.appendChild(stiffnessRow);

        const rotationRow = UI.createSliderRow({
            label: 'Pin Twist', min: -180, max: 180, step: 1, value: 0,
            formatter: (v) => `${v}°`,
            onInput: (v) => {
                if (selectedPinId) {
                    const pin = pins.find(p => p.id === selectedPinId);
                    if (pin) {
                        pin.rotation = parseFloat(v);
                        isAdjustingSlider = true;
                        recalculateAndRender();
                    }
                }
            },
            onChange: () => {
                isAdjustingSlider = false;
                saveLocalState();
                recalculateAndRender();
            }
        });
        const rotationInput = rotationRow.querySelector('input[type="range"]') as HTMLInputElement;
        stiffnessSection.appendChild(rotationRow);

        const scaleRow = UI.createSliderRow({
            label: 'Pin Expand', min: 0.2, max: 3.0, step: 0.05, value: 1.0,
            formatter: (v) => `${Math.round(Number(v) * 100)}%`,
            onInput: (v) => {
                if (selectedPinId) {
                    const pin = pins.find(p => p.id === selectedPinId);
                    if (pin) {
                        pin.scale = parseFloat(v);
                        isAdjustingSlider = true;
                        recalculateAndRender();
                    }
                }
            },
            onChange: () => {
                isAdjustingSlider = false;
                saveLocalState();
                recalculateAndRender();
            }
        });
        const scaleInput = scaleRow.querySelector('input[type="range"]') as HTMLInputElement;
        stiffnessSection.appendChild(scaleRow);

        ws.sidebar.appendChild(stiffnessSection);

        ws.sidebar.appendChild(UI.createSubheading('Deformation Model'));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Algorithm',
            options: [
                { value: 'rigid', text: 'As-Rigid-As-Possible' },
                { value: 'similarity', text: 'Similarity (Scale/Rot)' },
                { value: 'affine', text: 'Affine (Shear)' }
            ],
            value: mode,
            onChange: (v) => {
                mode = v as any;
                saveLocalState();
                recalculateAndRender();
            }
        }));

        ws.sidebar.appendChild(UI.createSubheading('Rigid Weights'));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Stiffness (α)', min: 0.5, max: 5.0, step: 0.1, value: alpha,
            onInput: (v) => {
                alpha = parseFloat(v);
                isAdjustingSlider = true;
                recalculateAndRender();
            },
            onChange: () => {
                isAdjustingSlider = false;
                saveLocalState();
                recalculateAndRender();
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Grid Density', min: 10, max: 100, step: 1, value: gridSize,
            onInput: (v) => {
                gridSize = parseInt(v);
                buildMesh();
                isAdjustingSlider = true;
                recalculateAndRender();
            },
            onChange: () => {
                isAdjustingSlider = false;
                saveLocalState();
                recalculateAndRender();
            }
        }));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Quality Level',
            options: [
                { value: 'lanczos', text: 'Lanczos-3' },
                { value: 'high', text: 'Bicubic' },
                { value: 'low', text: 'Bilinear' },
                { value: 'pixelated', text: 'Nearest Neighbor' }
            ],
            value: interpolationMode,
            onChange: (v) => {
                interpolationMode = v as any;
                recalculateAndRender();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Show Stretch Mesh',
            value: showMesh,
            onChange: (v) => {
                showMesh = v;
                viewport.drawOverlay();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Show Stress Heatmap',
            value: showHeatmap,
            onChange: (v) => {
                showHeatmap = v;
                viewport.drawOverlay();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Show Control Pins',
            value: showPins,
            onChange: (v) => {
                showPins = v;
                viewport.drawOverlay();
            }
        }));

        ws.sidebar.appendChild(UI.createSubheading('Undo / Redo History'));

        const historyRow = UI.createNode('div', { style: 'display: flex; gap: 8px; margin-bottom: 15px;' });
        const undoBtn = UI.createButton({
            label: 'Undo',
            className: 'btn cancel-btn',
            style: 'flex: 1;',
            onClick: () => undoLocal()
        });
        const redoBtn = UI.createButton({
            label: 'Redo',
            className: 'btn cancel-btn',
            style: 'flex: 1;',
            onClick: () => redoLocal()
        });
        historyRow.appendChild(undoBtn);
        historyRow.appendChild(redoBtn);
        ws.sidebar.appendChild(historyRow);

        ws.sidebar.appendChild(UI.createSubheading('Actions'));

        ws.sidebar.appendChild(UI.createButton({
            label: 'Freeze Subject Borders',
            className: 'btn',
            style: 'width: 100%; margin-bottom: 8px; font-weight: bold; background-color: #007acc;',
            onClick: () => {
                freezeBorders();
            }
        }));

        ws.sidebar.appendChild(UI.createButton({
            label: 'Reset All Pins',
            className: 'btn cancel-btn',
            style: 'width: 100%; margin-bottom: 8px;',
            onClick: () => {
                pins.forEach(p => {
                    p.targetX = p.x;
                    p.targetY = p.y;
                    p.rotation = 0;
                    p.scale = 1.0;
                });
                saveLocalState();
                recalculateAndRender();
            }
        }));

        ws.sidebar.appendChild(UI.createButton({
            label: 'Clear All Pins',
            className: 'btn cancel-btn btn-danger',
            style: 'width: 100%;',
            onClick: () => {
                pins = [];
                selectedPinIds.clear();
                selectedPinId = null;
                hoveredPinId = null;
                saveLocalState();
                recalculateAndRender();
            }
        }));

        const updateSidebarFields = () => {
            const pin = pins.find(p => p.id === selectedPinId);
            if (pin && selectedPinIds.has(pin.id)) {
                stiffnessSection.style.display = 'block';
                stiffnessInput.value = pin.stiffness.toFixed(1);
                const dispStiff = stiffnessInput.nextSibling as HTMLElement;
                if (dispStiff) dispStiff.textContent = pin.stiffness.toFixed(1);

                rotationInput.value = pin.rotation.toString();
                const dispRot = rotationInput.nextSibling as HTMLElement;
                if (dispRot) dispRot.textContent = `${pin.rotation}°`;

                scaleInput.value = pin.scale.toString();
                const dispScale = scaleInput.nextSibling as HTMLElement;
                if (dispScale) dispScale.textContent = `${Math.round(pin.scale * 100)}%`;
            } else {
                stiffnessSection.style.display = 'none';
            }
            updateUndoRedoButtons();
        };

        const updateUndoRedoButtons = () => {
            (undoBtn as HTMLButtonElement).disabled = historyStack.length <= 1;
            (redoBtn as HTMLButtonElement).disabled = redoStack.length === 0;
        };

        buildMesh();
        saveLocalState();
        ws.show();

        setTimeout(() => {
            recalculateAndRender();
            viewport.reset();
        }, 60);
    }
});
