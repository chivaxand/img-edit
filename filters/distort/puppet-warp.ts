import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { App } from '~/app';

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
        let selectedPinId: string | null = null; // Currently editing single pin
        let activeTool: 'drag' | 'add' | 'remove' = 'add';
        let mode: 'rigid' | 'similarity' | 'affine' = 'rigid';
        let alpha = 1.0;
        let gridSize = 25;
        let showMesh = true;
        let showHeatmap = false;
        let showPins = true;
        let interpolationMode: 'lanczos' | 'high' | 'low' | 'pixelated' = 'lanczos';

        let isDraggingPin = false;
        let isAdjustingSlider = false; // Flag to lock fast renderer on input and run slow resampler on release
        let hasDragged = false;
        let activeDragPinId: string | null = null;
        const dragStartPositions: Record<string, { x: number; y: number }> = {};
        let dragStartMouseX = 0;
        let dragStartMouseY = 0;

        // Local history manager (50-steps local undo/redo stack)
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
                saveLocalState();
                recalculateAndRender();
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

        // Triangular grid structures
        let vRest: Array<Array<{ x: number; y: number }>> = [];
        let vDeformed: Array<Array<{ x: number; y: number }>> = [];
        let cols = 0;
        let rows = 0;

        const srcCtx = origCanvas.getContext('2d')!;
        const srcData = srcCtx.getImageData(0, 0, fullW, fullH);
        const src8 = srcData.data;

        const getPixelVal = (sx: number, sy: number, c: number) => {
            let x = Math.floor(sx);
            let y = Math.floor(sy);
            if (x < 0) x = 0; else if (x >= fullW) x = fullW - 1;
            if (y < 0) y = 0; else if (y >= fullH) y = fullH - 1;
            return src8[(y * fullW + x) * 4 + c];
        };

        // --- Custom High Quality Software Resampler Kernels ---

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

        const buildRestGrid = () => {
            cols = gridSize;
            rows = Math.max(4, Math.round(gridSize * (fullH / fullW)));
            vRest = [];
            for (let c = 0; c <= cols; c++) {
                vRest[c] = [];
                const tx = c / cols;
                const x = tx * fullW;
                for (let r = 0; r <= rows; r++) {
                    const ty = r / rows;
                    const y = ty * fullH;
                    vRest[c][r] = { x, y };
                }
            }
        };

        // barycentric coordinates helper to evaluate which source triangle contains coordinate 
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

            const eps = -1e-3; // slight overlap epsilon to prevent boundary leaks
            if (w0 >= eps && w1 >= eps && w2 >= eps) {
                const u = w0 * p0.x + w1 * p1.x + w2 * p2.x;
                const v = w0 * p0.y + w1 * p1.y + w2 * p2.y;
                return { x: u, y: v };
            }
            return null;
        };

        // maps a visual clicked point back into the pristine source context
        const getOriginalCoords = (clickX: number, clickY: number) => {
            if (pins.length === 0 || vDeformed.length === 0) {
                return { x: clickX, y: clickY };
            }

            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    // Triangle 1
                    const p0_1 = vRest[c][r];
                    const p1_1 = vRest[c + 1][r];
                    const p2_1 = vRest[c][r + 1];

                    const q0_1 = vDeformed[c][r];
                    const q1_1 = vDeformed[c + 1][r];
                    const q2_1 = vDeformed[c][r + 1];

                    let mapped = checkTriangleBarycentric(clickX, clickY, q0_1, q1_1, q2_1, p0_1, p1_1, p2_1);
                    if (mapped) return mapped;

                    // Triangle 2
                    const p0_2 = vRest[c + 1][r];
                    const p1_2 = vRest[c + 1][r + 1];
                    const p2_2 = vRest[c][r + 1];

                    const q0_2 = vDeformed[c + 1][r];
                    const q1_2 = vDeformed[c + 1][r + 1];
                    const q2_2 = vDeformed[c][r + 1];

                    mapped = checkTriangleBarycentric(clickX, clickY, q0_2, q1_2, q2_2, p0_2, p1_2, p2_2);
                    if (mapped) return mapped;
                }
            }
            return { x: clickX, y: clickY };
        };

        const recalculateAndRender = () => {
            vDeformed = [];
            for (let c = 0; c <= cols; c++) {
                vDeformed[c] = [];
                for (let r = 0; r <= rows; r++) {
                    const pt = vRest[c][r];
                    // 1. Solve the base automatic deformation (MLS formulation)
                    const baseDef = solveMLS(pt.x, pt.y, pins, mode, alpha);

                    // 2. Blend the manual twist rotations and local expansions around the control pins smoothly
                    if (pins.length === 0) {
                        vDeformed[c][r] = baseDef;
                        continue;
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
                            weights[i] = 1e12; // massive pull directly on point
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

                        // Calculate relative displacement from the auto-solved coordinate frame
                        const dx = baseDef.x - pin.targetX;
                        const dy = baseDef.y - pin.targetY;

                        // Apply the manual twist angle
                        const rad = (pin.rotation * Math.PI) / 180;
                        const cosR = Math.cos(rad);
                        const sinR = Math.sin(rad);

                        // Rotate & local expansion scaling offsets
                        const rotatedX = (dx * cosR - dy * sinR) * pin.scale;
                        const rotatedY = (dx * sinR + dy * cosR) * pin.scale;

                        finalX += normW * (pin.targetX + rotatedX);
                        finalY += normW * (pin.targetY + rotatedY);
                    }

                    vDeformed[c][r] = { x: finalX, y: finalY };
                }
            }

            // Realtime dragging or sliding renders fast via GPU. Pause/Release fires slow high-quality filters.
            const useFastDrag = isDraggingPin || isAdjustingSlider;

            if (useFastDrag) {
                bbCtx.clearRect(0, 0, fullW, fullH);
                bbCtx.imageSmoothingEnabled = true;
                bbCtx.imageSmoothingQuality = 'low';

                if (pins.length === 0) {
                    bbCtx.drawImage(origCanvas, 0, 0);
                } else {
                    for (let c = 0; c < cols; c++) {
                        for (let r = 0; r < rows; r++) {
                            const p00 = vRest[c][r];
                            const p10 = vRest[c + 1][r];
                            const p11 = vRest[c + 1][r + 1];
                            const p01 = vRest[c][r + 1];

                            const q00 = vDeformed[c][r];
                            const q10 = vDeformed[c + 1][r];
                            const q11 = vDeformed[c + 1][r + 1];
                            const q01 = vDeformed[c][r + 1];

                            drawTriangleHardware(bbCtx, origCanvas, p00, p10, p01, q00, q10, q01);
                            drawTriangleHardware(bbCtx, origCanvas, p10, p11, p01, q10, q11, q01);
                        }
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
                        sampler = (u, v, c) => getPixelVal(Math.round(u), Math.round(v), c);
                    } else if (interpolationMode === 'low') {
                        sampler = sampleBilinear;
                    } else if (interpolationMode === 'lanczos') {
                        sampler = sampleLanczos3;
                    } else {
                        sampler = sampleBicubic;
                    }

                    for (let c = 0; c < cols; c++) {
                        for (let r = 0; r < rows; r++) {
                            const p00 = vRest[c][r];
                            const p10 = vRest[c + 1][r];
                            const p11 = vRest[c + 1][r + 1];
                            const p01 = vRest[c][r + 1];

                            const q00 = vDeformed[c][r];
                            const q10 = vDeformed[c + 1][r];
                            const q11 = vDeformed[c + 1][r + 1];
                            const q01 = vDeformed[c][r + 1];

                            drawTriangleSoftware(dst8, p00, p10, p01, q00, q10, q01, sampler);
                            drawTriangleSoftware(dst8, p10, p11, p01, q10, q11, q01, sampler);
                        }
                    }
                    bbCtx.putImageData(dstImageData, 0, 0);
                }
            }

            viewport.onDraw!();
            viewport.drawOverlay();
        };

        // Moving Least Squares Closed-Form Solver
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

        // Custom High-Quality Scanline Rasterizer
        const drawTriangleSoftware = (
            dstData: Uint8ClampedArray,
            p0: { x: number; y: number },
            p1: { x: number; y: number },
            p2: { x: number; y: number },
            q0: { x: number; y: number },
            q1: { x: number; y: number },
            q2: { x: number; y: number },
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

                    const eps = -1e-4; // Tiny overlap prevent edge line cracks
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

        // Triangle clipper & hardware texture mapper (Fast preview renderer)
        const drawTriangleHardware = (
            bCtx: CanvasRenderingContext2D,
            img: HTMLCanvasElement,
            p0: { x: number; y: number },
            p1: { x: number; y: number },
            p2: { x: number; y: number },
            q0: { x: number; y: number },
            q1: { x: number; y: number },
            q2: { x: number; y: number }
        ) => {
            bCtx.save();

            const cx = (q0.x + q1.x + q2.x) / 3;
            const cy = (q0.y + q1.y + q2.y) / 3;
            const expandX = (x: number) => x + (x - cx === 0 ? 0 : (x - cx > 0 ? 0.35 : -0.35));
            const expandY = (y: number) => y + (y - cy === 0 ? 0 : (y - cy > 0 ? 0.35 : -0.35));

            bCtx.beginPath();
            bCtx.moveTo(expandX(q0.x), expandY(q0.y));
            bCtx.lineTo(expandX(q1.x), expandY(q1.y));
            bCtx.lineTo(expandX(q2.x), expandY(q2.y));
            bCtx.closePath();
            bCtx.clip();

            const x0 = q0.x, y0 = q0.y;
            const x1 = q1.x, y1 = q1.y;
            const x2 = q2.x, y2 = q2.y;

            const u0 = p0.x, v0 = p0.y;
            const u1 = p1.x, v1 = p1.y;
            const u2 = p2.x, v2 = p2.y;

            const dX1 = x1 - x0, dY1 = y1 - y0;
            const dX2 = x2 - x0, dY2 = y2 - y0;
            const dU1 = u1 - u0, dV1 = v1 - v0;
            const dU2 = u2 - u0, dV2 = v2 - v0;

            const det = dU1 * dV2 - dU2 * dV1;
            if (Math.abs(det) > 1e-6) {
                const id = 1.0 / det;
                const a = id * (dV2 * dX1 - dV1 * dX2);
                const b = id * (dV2 * dY1 - dV1 * dY2);
                const c = id * (dU1 * dX2 - dU2 * dX1);
                const d = id * (dU1 * dY2 - dU2 * dY1);
                const e = x0 - a * u0 - c * v0;
                const f = y0 - b * u0 - d * v0;

                bCtx.transform(a, b, c, d, e, f);
                bCtx.drawImage(img, 0, 0);
            }

            bCtx.restore();
        };

        // Renders visual heatmap representation inside overlays
        const drawTriangleHeatmap = (
            ctx: CanvasRenderingContext2D,
            c0: number, r0: number,
            c1: number, r1: number,
            c2: number, r2: number
        ) => {
            const p0 = vRest[c0][r0];
            const p1 = vRest[c1][r1];
            const p2 = vRest[c2][r2];

            const q0 = vDeformed[c0][r0];
            const q1 = vDeformed[c1][r1];
            const q2 = vDeformed[c2][r2];

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
            const factor = Math.min(1.0, stress / 0.4); // maximum redness at 40% elongation

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
            // Remove previous borders to prevent duplicates
            pins = pins.filter(p => !p.id.startsWith('border_'));

            const numPointsX = 6;
            const numPointsY = Math.max(4, Math.round(numPointsX * (fullH / fullW)));
            const borderPins: WarpPin[] = [];

            // top & bottom caps
            for (let i = 0; i < numPointsX; i++) {
                const tx = i / (numPointsX - 1);
                const x = tx * fullW;
                
                borderPins.push({
                    id: 'border_t_' + i,
                    x: x, y: 0,
                    targetX: x, targetY: 0,
                    stiffness: 1.0,
                    rotation: 0,
                    scale: 1.0
                });
                borderPins.push({
                    id: 'border_b_' + i,
                    x: x, y: fullH,
                    targetX: x, targetY: fullH,
                    stiffness: 1.0,
                    rotation: 0,
                    scale: 1.0
                });
            }

            // left & right margins (excluding corners)
            for (let i = 1; i < numPointsY - 1; i++) {
                const ty = i / (numPointsY - 1);
                const y = ty * fullH;

                borderPins.push({
                    id: 'border_l_' + i,
                    x: 0, y: y,
                    targetX: 0, targetY: y,
                    stiffness: 1.0,
                    rotation: 0,
                    scale: 1.0
                });
                borderPins.push({
                    id: 'border_r_' + i,
                    x: fullW, y: y,
                    targetX: fullW, targetY: y,
                    stiffness: 1.0,
                    rotation: 0,
                    scale: 1.0
                });
            }

            pins = [...pins, ...borderPins];
            saveLocalState();
            recalculateAndRender();
        };

        viewport.onDraw = () => {
            viewport.ctx.clearRect(0, 0, canvas.width, canvas.height);
            viewport.ctx.drawImage(backbuffer, 0, 0);
        };

        viewport.onDrawOverlay = (oCtx: CanvasRenderingContext2D) => {
            // Draw visual stress heatmap
            if (showHeatmap && pins.length > 0 && vDeformed.length > 0) {
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        drawTriangleHeatmap(oCtx, c, r, c + 1, r, c, r + 1);
                        drawTriangleHeatmap(oCtx, c + 1, r, c + 1, r + 1, c, r + 1);
                    }
                }
            }

            // Draw Wireframe overlay
            if (showMesh && pins.length > 0 && vDeformed.length > 0) {
                oCtx.strokeStyle = 'rgba(0, 230, 120, 0.35)';
                oCtx.lineWidth = 1;

                for (let c = 0; c <= cols; c++) {
                    for (let r = 0; r <= rows; r++) {
                        const pCurr = vDeformed[c][r];
                        const sCurr = viewport.canvasToOverlay(pCurr.x, pCurr.y);

                        if (c < cols) {
                            const pRight = vDeformed[c + 1][r];
                            const sRight = viewport.canvasToOverlay(pRight.x, pRight.y);
                            oCtx.beginPath();
                            oCtx.moveTo(sCurr.x, sCurr.y);
                            oCtx.lineTo(sRight.x, sRight.y);
                            oCtx.stroke();
                        }

                        if (r < rows) {
                            const pDown = vDeformed[c][r + 1];
                            const sDown = viewport.canvasToOverlay(pDown.x, pDown.y);
                            oCtx.beginPath();
                            oCtx.moveTo(sCurr.x, sCurr.y);
                            oCtx.lineTo(sDown.x, sDown.y);
                            oCtx.stroke();
                        }
                    }
                }
            }

            // Draw visual pins
            if (showPins) {
                pins.forEach(pin => {
                    const sPos = viewport.canvasToOverlay(pin.targetX, pin.targetY);
                    const isSelected = selectedPinIds.has(pin.id);

                    // Draw stiffness influence visual field
                    const circleRadius = viewport.canvasLengthToOverlay(pin.stiffness * 25);
                    oCtx.beginPath();
                    oCtx.arc(sPos.x, sPos.y, circleRadius, 0, 2 * Math.PI);
                    oCtx.strokeStyle = isSelected ? 'rgba(255, 170, 0, 0.22)' : 'rgba(0, 122, 204, 0.15)';
                    oCtx.lineWidth = 1;
                    oCtx.setLineDash([4, 4]);
                    oCtx.stroke();
                    oCtx.setLineDash([]);

                    oCtx.beginPath();
                    oCtx.arc(sPos.x, sPos.y, 8, 0, 2 * Math.PI);
                    oCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                    oCtx.strokeStyle = isSelected ? '#ffaa00' : '#222';
                    oCtx.lineWidth = isSelected ? 2 : 1.5;
                    oCtx.fill();
                    oCtx.stroke();

                    oCtx.beginPath();
                    oCtx.arc(sPos.x, sPos.y, 4, 0, 2 * Math.PI);
                    oCtx.fillStyle = isSelected ? '#ff3366' : '#007acc';
                    oCtx.fill();
                });
            }
        };

        viewport.onMouseDown = (ev) => {
            const clickX = ev.x;
            const clickY = ev.y;

            let clickedPin = null;
            let minDist = 16;

            for (let i = 0; i < pins.length; i++) {
                const p = pins[i];
                const d = Math.hypot(clickX - p.targetX, clickY - p.targetY);
                if (d < minDist) {
                    minDist = d;
                    clickedPin = p;
                }
            }

            // Right Click deletion
            if (ev.isRightClick || ev.button === 2) {
                if (clickedPin) {
                    pins = pins.filter(p => p.id !== clickedPin.id);
                    selectedPinIds.delete(clickedPin.id);
                    if (selectedPinId === clickedPin.id) {
                        selectedPinId = null;
                    }
                    saveLocalState();
                    recalculateAndRender();
                }
                return;
            }

            if (clickedPin) {
                if (activeTool === 'remove') {
                    pins = pins.filter(p => p.id !== clickedPin.id);
                    selectedPinIds.delete(clickedPin.id);
                    selectedPinId = null;
                    saveLocalState();
                    recalculateAndRender();
                } else {
                    // Multi-select handling with Shift
                    const isShift = ev.originalEvent && 'shiftKey' in ev.originalEvent && (ev.originalEvent as any).shiftKey;
                    if (isShift) {
                        if (selectedPinIds.has(clickedPin.id)) {
                            selectedPinIds.delete(clickedPin.id);
                        } else {
                            selectedPinIds.add(clickedPin.id);
                            selectedPinId = clickedPin.id; // Edit properties of most recently added pin
                        }
                    } else {
                        if (!selectedPinIds.has(clickedPin.id)) {
                            selectedPinIds.clear();
                            selectedPinIds.add(clickedPin.id);
                        }
                        selectedPinId = clickedPin.id;
                    }

                    // Store starting anchor translations for relative multi-drags
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
                    // Extract exact original rest coordinates based on current active warp layout
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

                    activeDragPinId = newPin.id;
                    isDraggingPin = true;
                    hasDragged = false;
                    saveLocalState();
                    recalculateAndRender();
                } else {
                    const isShift = ev.originalEvent && 'shiftKey' in ev.originalEvent && (ev.originalEvent as any).shiftKey;
                    if (!isShift) {
                        selectedPinIds.clear();
                        selectedPinId = null;
                    }
                    viewport.drawOverlay();
                }
            }
            updateSidebarFields();
        };

        viewport.onMouseMove = (ev) => {
            if (isDraggingPin && activeDragPinId) {
                const dx = ev.x - dragStartMouseX;
                const dy = ev.y - dragStartMouseY;

                selectedPinIds.forEach(id => {
                    const pin = pins.find(p => p.id === id);
                    const startPos = dragStartPositions[id];
                    if (pin && startPos) {
                        pin.targetX = Math.max(0, Math.min(fullW, startPos.x + dx));
                        pin.targetY = Math.max(0, Math.min(fullH, startPos.y + dy));
                    }
                });

                hasDragged = true;
                recalculateAndRender();
            }
        };

        viewport.onMouseUp = () => {
            if (isDraggingPin) {
                isDraggingPin = false;
                activeDragPinId = null;
                if (hasDragged) {
                    saveLocalState();
                }
                recalculateAndRender();
            }
        };

        // Sidebar layout building
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Puppet Warp Tools'));

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

        // Contextual Per-Pin Stiffness, Rotation, and Local Expand Parameters
        const stiffnessSection = UI.createNode('div', { style: 'display: none;' });
        stiffnessSection.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Selected Pin Properties'));

        // 1. Influence (Stiffness) Slider
        const stiffnessRow = UI.createSliderRow({
            label: 'Pin Influence', min: 0.2, max: 10.0, step: 0.1, value: 1.0,
            onInput: (v) => {
                if (selectedPinId) {
                    const pin = pins.find(p => p.id === selectedPinId);
                    if (pin) {
                        pin.stiffness = parseFloat(v);
                        isAdjustingSlider = true; // Use fast GPU preview during adjusting
                        recalculateAndRender();
                    }
                }
            },
            onChange: () => {
                isAdjustingSlider = false; // Trigger high quality pass on release
                saveLocalState();
                recalculateAndRender();
            }
        });
        const stiffnessInput = stiffnessRow.querySelector('input[type="range"]') as HTMLInputElement;
        stiffnessSection.appendChild(stiffnessRow);

        // 2. Twist Angle Slider
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

        // 3. Expansion Scale Slider
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

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Deformation Model'));

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

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Rigid Weights'));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Stiffness (α)', min: 0.5, max: 3.0, step: 0.1, value: alpha,
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
            label: 'Grid Density', min: 10, max: 50, step: 1, value: gridSize,
            onInput: (v) => {
                gridSize = parseInt(v);
                buildRestGrid();
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

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Undo / Redo History'));

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

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Actions'));

        ws.sidebar.appendChild(UI.createButton({
            label: 'Freeze Borders',
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

        // Bootstrap visual canvases and reveal workspace
        buildRestGrid();
        saveLocalState(); // Initial undo anchor point
        ws.show();

        setTimeout(() => {
            recalculateAndRender();
            viewport.reset();
        }, 60);
    }
});
