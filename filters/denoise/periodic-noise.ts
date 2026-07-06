import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters, FilterContext } from '~/filters';
import { Lib } from '~/libs/index';
import { PaletteName } from '~/libs/plot';

// 2D Window generator to minimize spectral leakage for visualization
const getWindow2D = (w: number, h: number, type: string) => {
    const winX = new Float32Array(w);
    const winY = new Float32Array(h);
    winX.fill(1.0);
    winY.fill(1.0);
    if (type === 'none') return { winX, winY };

    const gen1D = (arr: Float32Array, size: number) => {
        const M = size > 1 ? size - 1 : 1;
        if (type === 'hann') {
            for (let i = 0; i < size; i++) {
                arr[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / M));
            }
        } else if (type === 'hamming') {
            for (let i = 0; i < size; i++) {
                arr[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / M);
            }
        } else if (type === 'blackman') {
            for (let i = 0; i < size; i++) {
                arr[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / M) + 0.08 * Math.cos(4 * Math.PI * i / M);
            }
        }
    };
    gen1D(winX, w);
    gen1D(winY, h);
    return { winX, winY };
};

export const PeriodicNoiseWorkspace = {
    open() {
        const layer = App.utils.getActive();
        if (!layer) return alert('No active layer selected.');
        if (!App.utils.layerIs(layer, 'editable')) {
            return alert('Layer is not editable. Rasterize it first.');
        }

        const fullW = layer.canvas.width;
        const fullH = layer.canvas.height;

        // Workspace parameters
        let activeTool: 'pen' | 'erase' | 'auto' | 'grid' = 'pen';
        let brushSize = 1;
        let spectrumGain = 1.0;
        let colormapType: PaletteName = 'grayscale';
        let windowType = 'none';
        let livePreview = true;
        let isResultActual = false;
        let hasDrawnSinceMouseDown = false;
        let cachedProposedSpikes: Array<{ x: number; y: number; val: number }> | null = null;

        const invalidateSpikesCache = () => {
            cachedProposedSpikes = null;
        };

        // Auto Detection & Harmonic Grid parameters
        let spikeThreshold = 70;
        let maxSpikes = 12;
        let minDCDistance = 4;
        let gridX = 32;
        let gridY = 32;
        let gridAngle = 0;

        // FFT zoom/pan state
        let zoom = 1.0;
        let panX = 0;
        let panY = 0;
        let isPanning = false;
        let isDrawing = false;
        let startX = 0;
        let startY = 0;

        // Hover coordinates for drawing brush outline
        let hoverX: number | null = null;
        let hoverY: number | null = null;

        // Notch filter masks and edit history
        const mask = new Uint8Array(fullW * fullH);
        let historyStack: Uint8Array[] = [new Uint8Array(mask)];
        let historyIndex = 0;

        // Full resolution image spatial representation structures
        const fullImgData = layer.ctx.getImageData(0, 0, fullW, fullH);
        const srcData = fullImgData.data;

        const previewDenoisedData = new Uint8ClampedArray(fullW * fullH * 4);

        // Precompute grayscale preview representation for spectrum viewer
        const grayData = new Float32Array(fullW * fullH);
        for (let i = 0; i < fullW * fullH; i++) {
            const idx = i * 4;
            const r = srcData[idx];
            const g = srcData[idx + 1];
            const b = srcData[idx + 2];
            grayData[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
        }

        // Initialize full-screen workspace layout
        const ws = new App.FullScreenWorkspace({
            title: 'Periodic Noise FFT Workspace',
            onApply: () => {
                leftViewport.destroy();
                rightViewport.destroy();

                const finalImgData = layer.ctx.getImageData(0, 0, fullW, fullH);
                const data = finalImgData.data;

                if (isResultActual) {
                    for (let i = 0; i < fullW * fullH * 4; i++) {
                        data[i] = previewDenoisedData[i];
                    }
                } else {
                    // Apply notch mask to color channels independently (without windowing)
                    for (let ch = 0; ch < 3; ch++) {
                        const channelData = new Float32Array(fullW * fullH);
                        for (let i = 0; i < fullW * fullH; i++) {
                            channelData[i] = srcData[i * 4 + ch];
                        }

                        const real2D: Float32Array[] = [];
                        for (let y = 0; y < fullH; y++) {
                            real2D.push(channelData.subarray(y * fullW, (y + 1) * fullW));
                        }

                        const fftRes = Lib.fft.fft2d(real2D);
                        const shifted = Lib.fft.shift(fftRes);

                        // Nullify periodic noise peaks using exact coordinates
                        for (let y = 0; y < fullH; y++) {
                            const rowRe = shifted.re[y];
                            const rowIm = shifted.im[y];
                            const maskRowOffset = y * fullW;
                            for (let x = 0; x < fullW; x++) {
                                if (mask[maskRowOffset + x] === 1) {
                                    rowRe[x] = 0;
                                    rowIm[x] = 0;
                                }
                            }
                        }

                        const unshifted = Lib.fft.unshift(shifted);
                        const ifftRes = Lib.fft.ifft2d(unshifted.re, unshifted.im);

                        // Write back directly to channel
                        for (let y = 0; y < fullH; y++) {
                            const rowOffset = y * fullW;
                            const row = ifftRes.re[y];
                            for (let x = 0; x < fullW; x++) {
                                let val = row[x];
                                data[rowOffset * 4 + x * 4 + ch] = val < 0 ? 0 : (val > 255 ? 255 : val);
                            }
                        }
                    }
                    for (let i = 0; i < fullW * fullH; i++) {
                        data[i * 4 + 3] = srcData[i * 4 + 3];
                    }
                }

                App.actions.saveState();
                layer.ctx.putImageData(finalImgData, 0, 0);
                App.emit('layer:content');
            },
            onCancel: () => {
                leftViewport.destroy();
                rightViewport.destroy();
            }
        });

        // Split visual pane: Left spectrum domain / Right spatial domain (decoupled movement)
        const leftPanel = ws.createPanel({ title: 'Shifted Log-Fourier Spectrum', status: 'Computing...' });
        const rightPanel = ws.createPanel({ title: 'Denoised Reconstruction', status: 'Computing...' });

        const canvas = leftPanel.canvas;
        const resCanvas = rightPanel.canvas;
        const statusCoordsEl = leftPanel.statusEl;
        const statusEl = rightPanel.statusEl;

        canvas.width = fullW;
        canvas.height = fullH;
        resCanvas.width = fullW;
        resCanvas.height = fullH;

        const leftViewport = new App.InteractiveViewport(canvas);
        const rightViewport = new App.InteractiveViewport(resCanvas);

        let smoothZoom = true;
        leftViewport.setSmoothing(false);
        rightViewport.setSmoothing(smoothZoom);

        leftViewport.onDraw = () => {
            drawFourier();
        };

        rightViewport.onDraw = () => {
            drawResult();
        };

        // Spectral backbuffer
        const fftBackbuffer = document.createElement('canvas');
        fftBackbuffer.width = fullW;
        fftBackbuffer.height = fullH;

        const denoisedBackbuffer = document.createElement('canvas');
        denoisedBackbuffer.width = fullW;
        denoisedBackbuffer.height = fullH;

        let logMag: Float32Array[] = [];

        // --- Spectral Processing Methods ---

        const computeFourierSpectrum = () => {
            invalidateSpikesCache();
            const { winX, winY } = getWindow2D(fullW, fullH, windowType);
            const windowedGray = new Float32Array(fullW * fullH);

            for (let y = 0; y < fullH; y++) {
                const wy = winY[y];
                const row = y * fullW;
                for (let x = 0; x < fullW; x++) {
                    windowedGray[row + x] = grayData[row + x] * wy * winX[x];
                }
            }

            const input2D: Float32Array[] = [];
            for (let y = 0; y < fullH; y++) {
                input2D.push(windowedGray.subarray(y * fullW, (y + 1) * fullW));
            }

            const fftRes = Lib.fft.fft2d(input2D);
            const shifted = Lib.fft.shift(fftRes);
            logMag = Lib.fft.logMagnitude(shifted);

            renderFourierBackbuffer();
        };

        const renderFourierBackbuffer = () => {
            const bbCtx = fftBackbuffer.getContext('2d')!;
            const imgData = bbCtx.createImageData(fullW, fullH);
            const data = imgData.data;

            let maxVal = 0;
            let minVal = Infinity;
            for (let y = 0; y < fullH; y++) {
                for (let x = 0; x < fullW; x++) {
                    const val = logMag[y][x];
                    if (val > maxVal) maxVal = val;
                    if (val < minVal) minVal = val;
                }
            }

            const scale = (1.0 / (maxVal - minVal || 1)) * spectrumGain;

            for (let y = 0; y < fullH; y++) {
                const row = y * fullW;
                for (let x = 0; x < fullW; x++) {
                    const idx = (row + x) * 4;

                    // Black out zeroed values
                    if (mask[row + x] === 1) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 255;
                    } else {
                        const norm = Math.max(0, Math.min(1, (logMag[y][x] - minVal) * scale));
                        const rgb = Lib.plot.getColor(norm, colormapType);
                        data[idx] = rgb[0];
                        data[idx + 1] = rgb[1];
                        data[idx + 2] = rgb[2];
                        data[idx + 3] = 255;
                    }
                }
            }
            bbCtx.putImageData(imgData, 0, 0);
        };

        const drawFourier = () => {
            const ctx = leftViewport.ctx;
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(fftBackbuffer, 0, 0);
            ctx.restore();
            leftViewport.drawOverlay();
        };

        leftViewport.onDrawOverlay = (ctx) => {
            if (activeTool === 'auto' || activeTool === 'grid') {
                ctx.strokeStyle = '#00a6ff';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([]);

                const r = leftViewport.canvasLengthToOverlay(brushSize - 0.5);

                if (activeTool === 'auto') {
                    const proposed = getProposedAutoSpikes();
                    proposed.forEach(p => {
                        const pt = leftViewport.canvasToOverlay(p.x, p.y);
                        ctx.beginPath();
                        ctx.arc(pt.x, pt.y, r, 0, 2 * Math.PI);
                        ctx.stroke();
                        // Symmetric peak counterpart
                        const symX = (fullW - p.x) % fullW;
                        const symY = (fullH - p.y) % fullH;
                        const symPt = leftViewport.canvasToOverlay(symX, symY);
                        ctx.beginPath();
                        ctx.arc(symPt.x, symPt.y, r, 0, 2 * Math.PI);
                        ctx.stroke();
                    });
                } else if (activeTool === 'grid') {
                    const proposed = getProposedGrid();
                    proposed.forEach(p => {
                        const pt = leftViewport.canvasToOverlay(p.x, p.y);
                        ctx.beginPath();
                        ctx.arc(pt.x, pt.y, r, 0, 2 * Math.PI);
                        ctx.stroke();
                    });
                }
            }

            // Render interactive circular brush outline
            if (hoverX !== null && hoverY !== null) {
                ctx.save();
                ctx.strokeStyle = (activeTool === 'erase') ? '#007acc' : '#ff3333';
                ctx.lineWidth = 1.5;
                const pt = leftViewport.canvasToOverlay(hoverX, hoverY);
                const r = leftViewport.canvasLengthToOverlay(brushSize - 0.5);
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, r, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.restore();
            }
        };

        const drawResult = () => {
            const ctx = rightViewport.ctx;
            ctx.save();
            ctx.clearRect(0, 0, resCanvas.width, resCanvas.height);
            rightViewport.applyTransform();
            ctx.drawImage(denoisedBackbuffer, 0, 0);
            ctx.restore();
        };

        const drawCircleInMask = (cx: number, cy: number, r: number, val: number) => {
            const rSq = (r - 1) * (r - 1);
            const centerX = Math.floor(fullW / 2);
            const centerY = Math.floor(fullH / 2);

            for (let dy = -(r - 1); dy <= r - 1; dy++) {
                const y = cy + dy;
                if (y < 0 || y >= fullH) continue;
                const rowOffset = y * fullW;

                for (let dx = -(r - 1); dx <= r - 1; dx++) {
                    const x = cx + dx;
                    if (x < 0 || x >= fullW) continue;

                    if (dx * dx + dy * dy <= rSq) {
                        // Protect DC component (fundamental average luminance)
                        const distToCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
                        if (distToCenter < 5) continue;

                        if (mask[rowOffset + x] !== val) {
                            mask[rowOffset + x] = val;
                            hasDrawnSinceMouseDown = true;
                            invalidateSpikesCache();
                        }

                        // Maintain conjugate symmetry
                        const symX = (fullW - x) % fullW;
                        const symY = (fullH - y) % fullH;
                        const symDist = Math.sqrt((symX - centerX) ** 2 + (symY - centerY) ** 2);
                        if (symDist >= 5) {
                            if (mask[symY * fullW + symX] !== val) {
                                mask[symY * fullW + symX] = val;
                                hasDrawnSinceMouseDown = true;
                                invalidateSpikesCache();
                            }
                        }
                    }
                }
            }
        };

        const solvePreview = () => {
            statusEl.textContent = 'Calculating IFFT...';

            setTimeout(() => {
                // Image processing bypassed window calculations
                for (let ch = 0; ch < 3; ch++) {
                    const channelData = new Float32Array(fullW * fullH);
                    for (let i = 0; i < fullW * fullH; i++) {
                        channelData[i] = srcData[i * 4 + ch];
                    }

                    const real2D: Float32Array[] = [];
                    for (let y = 0; y < fullH; y++) {
                        real2D.push(channelData.subarray(y * fullW, (y + 1) * fullW));
                    }

                    const fftRes = Lib.fft.fft2d(real2D);
                    const shifted = Lib.fft.shift(fftRes);

                    // Apply notch mask logic
                    for (let y = 0; y < fullH; y++) {
                        const rowRe = shifted.re[y];
                        const rowIm = shifted.im[y];
                        const maskRow = y * fullW;
                        for (let x = 0; x < fullW; x++) {
                            if (mask[maskRow + x] === 1) {
                                rowRe[x] = 0;
                                rowIm[x] = 0;
                            }
                        }
                    }

                    const unshifted = Lib.fft.unshift(shifted);
                    const ifftRes = Lib.fft.ifft2d(unshifted.re, unshifted.im);

                    // Reconstruct denoised spatial data directly without windows
                    for (let y = 0; y < fullH; y++) {
                        const row = y * fullW;
                        const rowRe = ifftRes.re[y];
                        for (let x = 0; x < fullW; x++) {
                            previewDenoisedData[(row + x) * 4 + ch] = Math.max(0, Math.min(255, rowRe[x]));
                        }
                    }
                }

                for (let i = 0; i < fullW * fullH; i++) {
                    previewDenoisedData[i * 4 + 3] = srcData[i * 4 + 3];
                }

                denoisedBackbuffer.getContext('2d')!.putImageData(new ImageData(previewDenoisedData, fullW, fullH), 0, 0);

                drawResult();
                isResultActual = true;
                statusEl.textContent = 'Preview Updated';
            }, 30);
        };

        // --- History Manager ---

        const pushHistoryState = () => {
            if (historyIndex < historyStack.length - 1) {
                historyStack = historyStack.slice(0, historyIndex + 1);
            }
            if (historyStack.length >= 50) {
                historyStack.shift();
            }
            historyStack.push(new Uint8Array(mask));
            historyIndex = historyStack.length - 1;
            updateHistoryButtons();
        };

        const undo = () => {
            if (historyIndex > 0) {
                historyIndex--;
                mask.set(historyStack[historyIndex]);
                invalidateSpikesCache();
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) {
                    solvePreview();
                } else {
                    isResultActual = false;
                    statusEl.textContent = 'Preview out of date';
                }
                updateHistoryButtons();
            }
        };

        const redo = () => {
            if (historyIndex < historyStack.length - 1) {
                historyIndex++;
                mask.set(historyStack[historyIndex]);
                invalidateSpikesCache();
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) {
                    solvePreview();
                } else {
                    isResultActual = false;
                    statusEl.textContent = 'Preview out of date';
                }
                updateHistoryButtons();
            }
        };

        const updateHistoryButtons = () => {
            const undoBtn = ws.sidebar.querySelector('#pn-btn-undo') as HTMLButtonElement;
            const redoBtn = ws.sidebar.querySelector('#pn-btn-redo') as HTMLButtonElement;
            if (undoBtn) undoBtn.disabled = historyIndex === 0;
            if (redoBtn) redoBtn.disabled = historyIndex === historyStack.length - 1;
        };

        // --- Spike and Grid Proposing Functions ---

        const getProposedAutoSpikes = (): Array<{ x: number; y: number; val: number }> => {
            if (cachedProposedSpikes) return cachedProposedSpikes;

            const candidates: Array<{ x: number; y: number; val: number; salience: number }> = [];
            const cx = Math.floor(fullW / 2);
            const cy = Math.floor(fullH / 2);
            const safetyRadius = minDCDistance;

            // Find local maxima first
            for (let y = 1; y < fullH - 1; y++) {
                const rowOffset = y * fullW;
                for (let x = 1; x < fullW - 1; x++) {
                    const dx = x - cx;
                    const dy = y - cy;
                    if (dx * dx + dy * dy < safetyRadius * safetyRadius) continue;

                    // Skip frequencies that are already covered by the active notch mask
                    if (mask[rowOffset + x] === 1) continue;

                    const val = logMag[y][x];
                    // Check if it's a local 8-neighbor maximum
                    if (val > logMag[y - 1][x - 1] && val > logMag[y - 1][x] && val > logMag[y - 1][x + 1] &&
                        val > logMag[y][x - 1] && val > logMag[y][x + 1] &&
                        val > logMag[y + 1][x - 1] && val > logMag[y + 1][x] && val > logMag[y + 1][x + 1]) {
                        
                        // Compute local mean in a 15x15 window, excluding a 3x3 guard band
                        let sum = 0;
                        let count = 0;
                        const windowSize = 7; // radius of 7 -> 15x15 window
                        for (let dy2 = -windowSize; dy2 <= windowSize; dy2++) {
                            const ny = y + dy2;
                            if (ny < 0 || ny >= fullH) continue;
                            for (let dx2 = -windowSize; dx2 <= windowSize; dx2++) {
                                const nx = x + dx2;
                                if (nx < 0 || nx >= fullW) continue;
                                // Guard band check: skip 3x3 around center
                                if (Math.abs(dx2) <= 1 && Math.abs(dy2) <= 1) continue;
                                
                                sum += logMag[ny][nx];
                                count++;
                            }
                        }
                        
                        const localMean = count > 0 ? (sum / count) : val;
                        // Salience in log-space is the peak's height above the local background
                        const salience = val - localMean;
                        
                        // Only consider positive salience (peaks higher than background)
                        if (salience > 0.1) {
                            candidates.push({ x, y, val, salience });
                        }
                    }
                }
            }

            // Sort candidates by local salience instead of absolute magnitude
            candidates.sort((a, b) => b.salience - a.salience);

            if (candidates.length > 0) {
                const maxSalience = candidates[0].salience;
                const cutoff = maxSalience * (spikeThreshold / 100);
                const filtered = candidates.filter(c => c.salience >= cutoff);
                cachedProposedSpikes = filtered.slice(0, maxSpikes);
            } else {
                cachedProposedSpikes = [];
            }
            return cachedProposedSpikes;
        };

        const getProposedGrid = (): Array<{ x: number; y: number }> => {
            const list: Array<{ x: number; y: number }> = [];
            const cx = Math.floor(fullW / 2);
            const cy = Math.floor(fullH / 2);

            if (gridX <= 1 && gridY <= 1) return [];

            const rad = (gridAngle * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            // Rotate the basis vectors for the grid relative to DC
            const ux = gridX * cos;
            const uy = gridX * sin;
            const vx = -gridY * sin;
            const vy = gridY * cos;

            // Estimate limits for indices to cover the canvas safely
            const maxI = Math.ceil(fullW / (gridX || 1)) + 5;
            const maxJ = Math.ceil(fullH / (gridY || 1)) + 5;

            const limitI = Math.min(150, maxI);
            const limitJ = Math.min(150, maxJ);

            for (let j = -limitJ; j <= limitJ; j++) {
                for (let i = -limitI; i <= limitI; i++) {
                    if (i === 0 && j === 0) continue; // Skip DC component

                    const x = Math.round(cx + i * ux + j * vx);
                    const y = Math.round(cy + i * uy + j * vy);

                    if (x >= 0 && x < fullW && y >= 0 && y < fullH) {
                        list.push({ x, y });
                    }
                }
            }
            return list;
        };

        const commitAutoSpikes = () => {
            const proposed = getProposedAutoSpikes();
            if (proposed.length === 0) return;
            hasDrawnSinceMouseDown = false;
            proposed.forEach(cand => {
                drawCircleInMask(cand.x, cand.y, brushSize, 1);
            });
            if (hasDrawnSinceMouseDown) {
                pushHistoryState();
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) {
                    solvePreview();
                } else {
                    isResultActual = false;
                    statusEl.textContent = 'Preview out of date';
                }
            }
            hasDrawnSinceMouseDown = false;
        };

        const commitHarmonicGrid = () => {
            const proposed = getProposedGrid();
            if (proposed.length === 0) return;
            hasDrawnSinceMouseDown = false;
            proposed.forEach(p => {
                drawCircleInMask(p.x, p.y, brushSize, 1);
            });
            if (hasDrawnSinceMouseDown) {
                pushHistoryState();
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) {
                    solvePreview();
                } else {
                    isResultActual = false;
                    statusEl.textContent = 'Preview out of date';
                }
            }
            hasDrawnSinceMouseDown = false;
        };

        // --- Viewport Interactive Handlers ---

        leftViewport.onMouseDown = (e) => {
            hasDrawnSinceMouseDown = false;
            const val = (e.isRightClick || activeTool === 'erase') ? 0 : 1;
            drawCircleInMask(e.x, e.y, brushSize, val);
            if (hasDrawnSinceMouseDown) {
                renderFourierBackbuffer();
                isResultActual = false;
                statusEl.textContent = 'Preview out of date';
            }
            drawFourier();
        };

        leftViewport.onMouseMove = (e) => {
            const val = (e.isRightClick || activeTool === 'erase') ? 0 : 1;
            const oldDrawn = hasDrawnSinceMouseDown;
            hasDrawnSinceMouseDown = false;
            drawCircleInMask(e.x, e.y, brushSize, val);
            if (hasDrawnSinceMouseDown) {
                renderFourierBackbuffer();
                isResultActual = false;
                statusEl.textContent = 'Preview out of date';
            }
            if (oldDrawn || hasDrawnSinceMouseDown) {
                hasDrawnSinceMouseDown = true;
            }
        };

        leftViewport.onMouseUp = () => {
            if (hasDrawnSinceMouseDown) {
                pushHistoryState();
                if (livePreview) {
                    solvePreview();
                } else {
                    isResultActual = false;
                    statusEl.textContent = 'Preview out of date';
                }
                hasDrawnSinceMouseDown = false;
            }
            drawFourier();
        };

        leftViewport.onHover = (x, y, clientX, clientY) => {
            if (x !== null && y !== null) {
                hoverX = x;
                hoverY = y;
                statusCoordsEl.textContent = `Freq Domain: [X: ${x}, Y: ${y}] | Zoom: ${Math.round(leftViewport.zoom * 100)}%`;
            } else {
                hoverX = null;
                hoverY = null;
            }
            drawFourier();
        };

        leftViewport.onMouseLeave = () => {
            hoverX = null;
            hoverY = null;
            drawFourier();
        };

        // --- Construct Workspace Controls (Sidebar) ---

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Active Tool Selection'));

        // Dynamic parameters containers
        const autoPanel = UI.createNode('div', { style: 'display: none;' });
        const gridPanel = UI.createNode('div', { style: 'display: none;' });

        const updateActiveToolUI = (tool: 'pen' | 'erase' | 'auto' | 'grid') => {
            activeTool = tool;
            UI.toggle(autoPanel, tool === 'auto', 'block');
            UI.toggle(gridPanel, tool === 'grid', 'block');
            drawFourier();
        };

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Tool Mode',
            options: [
                { value: 'pen', text: 'Notch Brush' },
                { value: 'erase', text: 'Eraser Brush' },
                { value: 'auto', text: 'Auto-Detect Peaks' },
                { value: 'grid', text: 'Harmonic Grid' }
            ],
            value: activeTool,
            onChange: (v) => updateActiveToolUI(v as any)
        }));

        // Brush Radius is universally applicable to all tools
        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Brush Radius', min: 1, max: 40, value: brushSize, step: 1,
            onInput: (v) => { brushSize = parseInt(v); drawFourier(); }
        }));

        // Auto Detect Parameters Panel
        autoPanel.appendChild(UI.createSliderRow({
            label: 'Min DC Distance', min: 2, max: 100, step: 1, value: minDCDistance,
            onInput: (v) => { minDCDistance = parseInt(v); invalidateSpikesCache(); drawFourier(); }
        }));
        autoPanel.appendChild(UI.createSliderRow({
            label: 'Peak Cutoff %', min: 20, max: 95, step: 1, value: spikeThreshold,
            onInput: (v) => { spikeThreshold = parseInt(v); invalidateSpikesCache(); drawFourier(); }
        }));
        autoPanel.appendChild(UI.createSliderRow({
            label: 'Max Spikes', min: 2, max: 40, step: 1, value: maxSpikes,
            onInput: (v) => { maxSpikes = parseInt(v); invalidateSpikesCache(); drawFourier(); }
        }));
        autoPanel.appendChild(UI.createButton({
            label: 'Commit Proposed Peaks', className: 'btn', style: 'width:100%; margin-top:5px;',
            onClick: () => commitAutoSpikes()
        }));
        ws.sidebar.appendChild(autoPanel);

        // Harmonic Grid Parameters Panel
        const maxGridSpacing = Math.max(512, Math.max(fullW, fullH));
        gridPanel.appendChild(UI.createSliderRow({
            label: 'Grid Spacing X', min: 4, max: maxGridSpacing, step: 1, value: gridX,
            onInput: (v) => { gridX = parseInt(v); drawFourier(); }
        }));
        gridPanel.appendChild(UI.createSliderRow({
            label: 'Grid Spacing Y', min: 4, max: maxGridSpacing, step: 1, value: gridY,
            onInput: (v) => { gridY = parseInt(v); drawFourier(); }
        }));
        gridPanel.appendChild(UI.createSliderRow({
            label: 'Grid Angle', min: -180, max: 180, step: 1, value: gridAngle,
            onInput: (v) => { gridAngle = parseInt(v); drawFourier(); }
        }));
        gridPanel.appendChild(UI.createButton({
            label: 'Commit Grid Pattern', className: 'btn', style: 'width:100%; margin-top:5px;',
            onClick: () => commitHarmonicGrid()
        }));
        ws.sidebar.appendChild(gridPanel);

        // Standard Workspace Actions Panel
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Actions & History'));

        const undoBtn = UI.createButton({
            label: 'Undo Edit', id: 'pn-btn-undo', className: 'btn cancel-btn',
            onClick: () => undo()
        });
        const redoBtn = UI.createButton({
            label: 'Redo Edit', id: 'pn-btn-redo', className: 'btn cancel-btn',
            onClick: () => redo()
        });
        const clearBtn = UI.createButton({
            label: 'Clear All Notches', className: 'btn btn-danger',
            onClick: () => {
                mask.fill(0);
                pushHistoryState();
                invalidateSpikesCache();
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) {
                    solvePreview();
                } else {
                    isResultActual = false;
                    statusEl.textContent = 'Preview out of date';
                }
            }
        });

        ws.sidebar.appendChild(UI.createNode('div', { style: 'display:grid; grid-template-columns:1fr 1fr; gap:10px;' }, undoBtn, redoBtn));
        ws.sidebar.appendChild(clearBtn);

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'FFT Viewport Controls'));

        const zoomInBtn = UI.createButton({ label: 'Zoom +', className: 'btn', onClick: () => { leftViewport.zoom = Math.min(25, leftViewport.zoom * 1.25); leftViewport.onDraw!(); } });
        const zoomOutBtn = UI.createButton({ label: 'Zoom -', className: 'btn', onClick: () => { leftViewport.zoom = Math.max(0.2, leftViewport.zoom / 1.25); leftViewport.onDraw!(); } });
        const resetZoomBtn = UI.createButton({ label: 'Reset Zoom', className: 'btn cancel-btn', onClick: () => { leftViewport.reset(); } });

        ws.sidebar.appendChild(UI.createNode('div', { style: 'display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px;' }, zoomInBtn, zoomOutBtn, resetZoomBtn));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Spectrum Gain', min: 0.1, max: 5.0, step: 0.1, value: spectrumGain,
            onInput: (v) => { spectrumGain = parseFloat(v); renderFourierBackbuffer(); drawFourier(); }
        }));

        ws.sidebar.appendChild(UI.createPaletteSelectRow({
            label: 'Colormap',
            value: colormapType,
            onChange: (v) => { colormapType = v; renderFourierBackbuffer(); drawFourier(); }
        }));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Visualization Window',
            options: [
                { value: 'hamming', text: 'Hamming' },
                { value: 'hann', text: 'Hann (Hanning)' },
                { value: 'blackman', text: 'Blackman' },
                { value: 'none', text: 'None (Rectangular)' }
            ],
            value: windowType,
            onChange: (v) => { windowType = v; computeFourierSpectrum(); drawFourier(); }
        }));

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title', style: 'margin-top:10px;' }, 'Preview Config'));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Real-time Live Preview', value: livePreview,
            onChange: (v) => {
                livePreview = v;
                if (livePreview) solvePreview();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Smooth zoom', value: smoothZoom,
            onChange: (v) => {
                smoothZoom = v;
                rightViewport.setSmoothing(smoothZoom);
            }
        }));

        const forceSolveBtn = UI.createButton({
            label: 'Force Preview Refresh', className: 'btn',
            style: 'width:100%; padding:10px; font-weight:bold;',
            onClick: () => solvePreview()
        });
        ws.sidebar.appendChild(forceSolveBtn);

        // Bootstrap visual computation and open workspace
        ws.show();

        setTimeout(() => {
            computeFourierSpectrum();
            solvePreview();
            updateHistoryButtons();
            statusCoordsEl.textContent = 'Grayscale Map';
        }, 50);
    }
};

if (typeof window !== 'undefined') {
    (window as any).PeriodicNoiseWorkspace = PeriodicNoiseWorkspace;
}

Filters.register('periodic-noise', {
    name: 'Periodic Noise Remover',
    mode: 'unified',
    menu: {
        path: 'Filter/Denoise',
        label: 'Periodic Noise Filter...',
        order: 6
    },
    apply(ctx: FilterContext) {
        const l = ctx.layer;
        PeriodicNoiseWorkspace.open();
    }
});
