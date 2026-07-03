import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters } from '~/filters';
import { Lib } from '~/libs/index';

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

        this.injectStyles();

        // Constants and Workspace parameters
        const PREVIEW_SIZE = 512;
        let activeTool: 'pen' | 'erase' | 'auto' | 'grid' = 'pen';
        let brushSize = 1;
        let spectrumGain = 1.0;
        let colormapType = 'grayscale';
        let windowType = 'none';
        let livePreview = true;

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
        const mask = new Uint8Array(PREVIEW_SIZE * PREVIEW_SIZE);
        let historyStack: Uint8Array[] = [new Uint8Array(mask)];
        let historyIndex = 0;

        // Fast preview downsampled spatial data structures
        const previewSrcCanvas = document.createElement('canvas');
        previewSrcCanvas.width = PREVIEW_SIZE;
        previewSrcCanvas.height = PREVIEW_SIZE;
        const previewSrcCtx = previewSrcCanvas.getContext('2d')!;
        previewSrcCtx.drawImage(layer.canvas, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
        const previewSrcImgData = previewSrcCtx.getImageData(0, 0, PREVIEW_SIZE, PREVIEW_SIZE).data;

        const previewDenoisedData = new Uint8ClampedArray(PREVIEW_SIZE * PREVIEW_SIZE * 4);

        // Precompute grayscale preview representation for spectrum viewer
        const grayData = new Float32Array(PREVIEW_SIZE * PREVIEW_SIZE);
        for (let i = 0; i < PREVIEW_SIZE * PREVIEW_SIZE; i++) {
            const idx = i * 4;
            const r = previewSrcImgData[idx];
            const g = previewSrcImgData[idx + 1];
            const b = previewSrcImgData[idx + 2];
            grayData[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
        }

        // Initialize full-screen workspace layout
        const ws = new App.FullScreenWorkspace({
            title: 'Periodic Noise FFT Workspace',
            onApply: () => {
                const statusEl = ws.overlay.querySelector('#pn-status')!;
                statusEl.textContent = 'Applying to Full-Size Image...';

                setTimeout(() => {
                    const fullImgData = layer.ctx.getImageData(0, 0, fullW, fullH);
                    const data = fullImgData.data;

                    // Apply notch mask to color channels independently (without windowing)
                    for (let ch = 0; ch < 3; ch++) {
                        const channelData = new Float32Array(fullW * fullH);
                        for (let i = 0; i < fullW * fullH; i++) {
                            channelData[i] = data[i * 4 + ch];
                        }

                        const real2D: Float32Array[] = [];
                        for (let y = 0; y < fullH; y++) {
                            real2D.push(channelData.subarray(y * fullW, (y + 1) * fullW));
                        }

                        const fftRes = Lib.fft.fft2d(real2D);
                        const shifted = Lib.fft.shift(fftRes);

                        // Nullify periodic noise peaks using scaled coordinates
                        for (let y = 0; y < fullH; y++) {
                            const rowRe = shifted.re[y];
                            const rowIm = shifted.im[y];

                            const fy = (y - fullH / 2) / fullH;
                            const py = Math.round(fy * PREVIEW_SIZE + PREVIEW_SIZE / 2);

                            if (py >= 0 && py < PREVIEW_SIZE) {
                                const maskRowOffset = py * PREVIEW_SIZE;
                                for (let x = 0; x < fullW; x++) {
                                    const fx = (x - fullW / 2) / fullW;
                                    const px = Math.round(fx * PREVIEW_SIZE + PREVIEW_SIZE / 2);

                                    if (px >= 0 && px < PREVIEW_SIZE) {
                                        if (mask[maskRowOffset + px] === 1) {
                                            rowRe[x] = 0;
                                            rowIm[x] = 0;
                                        }
                                    }
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

                    App.actions.saveState();
                    layer.ctx.putImageData(fullImgData, 0, 0);
                    App.emit('layer:content');
                    ws.close(true);
                }, 40);
            },
            onCancel: () => {
                window.removeEventListener('mouseup', onMouseUpGlobal);
                ws.close(false);
            }
        });

        // Split visual pane: Left spectrum domain / Right spatial domain
        const panelsContainer = UI.createNode('div', { className: 'pn-panels-container' },
            UI.createNode('div', { className: 'pn-panel' },
                UI.createNode('div', { className: 'pn-panel-header' },
                    UI.createNode('span', {}, 'Shifted Log-Fourier Spectrum'),
                    UI.createNode('span', { id: 'pn-coords-status' }, 'Grayscale Map')
                ),
                UI.createNode('div', { className: 'pn-canvas-wrapper', id: 'pn-left-wrapper' },
                    UI.createNode('canvas', { id: 'pn-fft-canvas', className: 'pn-canvas' })
                )
            ),
            UI.createNode('div', { className: 'pn-panel' },
                UI.createNode('div', { className: 'pn-panel-header' },
                    UI.createNode('span', {}, 'Denoised Reconstruction'),
                    UI.createNode('span', { id: 'pn-status' }, 'Ready')
                ),
                UI.createNode('div', { className: 'pn-canvas-wrapper' },
                    UI.createNode('canvas', { id: 'pn-result-canvas', className: 'pn-canvas' })
                )
            )
        );
        ws.content.appendChild(panelsContainer);

        const canvas = ws.content.querySelector('#pn-fft-canvas') as HTMLCanvasElement;
        const resCanvas = ws.content.querySelector('#pn-result-canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d')!;
        const resCtx = resCanvas.getContext('2d')!;

        canvas.width = PREVIEW_SIZE;
        canvas.height = PREVIEW_SIZE;
        resCanvas.width = PREVIEW_SIZE;
        resCanvas.height = PREVIEW_SIZE;

        // Spectral backbuffer
        const fftBackbuffer = document.createElement('canvas');
        fftBackbuffer.width = PREVIEW_SIZE;
        fftBackbuffer.height = PREVIEW_SIZE;

        let logMag: Float32Array[] = [];

        // --- Spectral Processing Methods ---

        const computeFourierSpectrum = () => {
            const { winX, winY } = getWindow2D(PREVIEW_SIZE, PREVIEW_SIZE, windowType);
            const windowedGray = new Float32Array(PREVIEW_SIZE * PREVIEW_SIZE);

            for (let y = 0; y < PREVIEW_SIZE; y++) {
                const wy = winY[y];
                const row = y * PREVIEW_SIZE;
                for (let x = 0; x < PREVIEW_SIZE; x++) {
                    windowedGray[row + x] = grayData[row + x] * wy * winX[x];
                }
            }

            const input2D: Float32Array[] = [];
            for (let y = 0; y < PREVIEW_SIZE; y++) {
                input2D.push(windowedGray.subarray(y * PREVIEW_SIZE, (y + 1) * PREVIEW_SIZE));
            }

            const fftRes = Lib.fft.fft2d(input2D);
            const shifted = Lib.fft.shift(fftRes);
            logMag = Lib.fft.logMagnitude(shifted);

            renderFourierBackbuffer();
        };

        const renderFourierBackbuffer = () => {
            const bbCtx = fftBackbuffer.getContext('2d')!;
            const imgData = bbCtx.createImageData(PREVIEW_SIZE, PREVIEW_SIZE);
            const data = imgData.data;

            let maxVal = 0;
            let minVal = Infinity;
            for (let y = 0; y < PREVIEW_SIZE; y++) {
                for (let x = 0; x < PREVIEW_SIZE; x++) {
                    const val = logMag[y][x];
                    if (val > maxVal) maxVal = val;
                    if (val < minVal) minVal = val;
                }
            }

            const scale = (1.0 / (maxVal - minVal || 1)) * spectrumGain;

            for (let y = 0; y < PREVIEW_SIZE; y++) {
                const row = y * PREVIEW_SIZE;
                for (let x = 0; x < PREVIEW_SIZE; x++) {
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
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.translate(panX, panY);
            ctx.scale(zoom, zoom);
            ctx.drawImage(fftBackbuffer, 0, 0);

            // Proposed preview markers for automated tools rendered as thin solid blue outlines
            if (activeTool === 'auto' || activeTool === 'grid') {
                ctx.strokeStyle = '#00a6ff';
                ctx.lineWidth = 1.0 / zoom;
                ctx.setLineDash([]);

                if (activeTool === 'auto') {
                    const proposed = getProposedAutoSpikes();
                    proposed.forEach(p => {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, brushSize, 0, 2 * Math.PI);
                        ctx.stroke();
                        // Symmetric peak counterpart
                        const symX = (PREVIEW_SIZE - p.x) % PREVIEW_SIZE;
                        const symY = (PREVIEW_SIZE - p.y) % PREVIEW_SIZE;
                        ctx.beginPath();
                        ctx.arc(symX, symY, brushSize, 0, 2 * Math.PI);
                        ctx.stroke();
                    });
                } else if (activeTool === 'grid') {
                    const proposed = getProposedGrid();
                    proposed.forEach(p => {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, brushSize, 0, 2 * Math.PI);
                        ctx.stroke();
                    });
                }
            }

            ctx.restore();

            // Render interactive circular brush outline
            if (hoverX !== null && hoverY !== null) {
                ctx.save();
                ctx.strokeStyle = (activeTool === 'erase') ? '#007acc' : '#ff3333';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.arc(hoverX, hoverY, brushSize * zoom, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.restore();
            }
        };

        const drawCircleInMask = (cx: number, cy: number, r: number, val: number) => {
            const rSq = r * r;
            const size = PREVIEW_SIZE;
            const centerOfFFT = size / 2;

            for (let dy = -r; dy <= r; dy++) {
                const y = cy + dy;
                if (y < 0 || y >= size) continue;
                const rowOffset = y * size;

                for (let dx = -r; dx <= r; dx++) {
                    const x = cx + dx;
                    if (x < 0 || x >= size) continue;

                    if (dx * dx + dy * dy <= rSq) {
                        // Protect DC component (fundamental average luminance)
                        const distToCenter = Math.sqrt((x - centerOfFFT) ** 2 + (y - centerOfFFT) ** 2);
                        if (distToCenter < 5) continue;

                        mask[rowOffset + x] = val;

                        // Maintain conjugate symmetry
                        const symX = (size - x) % size;
                        const symY = (size - y) % size;
                        const symDist = Math.sqrt((symX - centerOfFFT) ** 2 + (symY - centerOfFFT) ** 2);
                        if (symDist >= 5) {
                            mask[symY * size + symX] = val;
                        }
                    }
                }
            }
        };

        const solvePreview = () => {
            const statusEl = ws.overlay.querySelector('#pn-status')!;
            statusEl.textContent = 'Calculating IFFT...';

            setTimeout(() => {
                // Image processing bypassed window calculations
                for (let ch = 0; ch < 3; ch++) {
                    const channelData = new Float32Array(PREVIEW_SIZE * PREVIEW_SIZE);
                    for (let i = 0; i < PREVIEW_SIZE * PREVIEW_SIZE; i++) {
                        channelData[i] = previewSrcImgData[i * 4 + ch];
                    }

                    const real2D: Float32Array[] = [];
                    for (let y = 0; y < PREVIEW_SIZE; y++) {
                        real2D.push(channelData.subarray(y * PREVIEW_SIZE, (y + 1) * PREVIEW_SIZE));
                    }

                    const fftRes = Lib.fft.fft2d(real2D);
                    const shifted = Lib.fft.shift(fftRes);

                    // Apply notch mask logic
                    for (let y = 0; y < PREVIEW_SIZE; y++) {
                        const rowRe = shifted.re[y];
                        const rowIm = shifted.im[y];
                        const maskRow = y * PREVIEW_SIZE;
                        for (let x = 0; x < PREVIEW_SIZE; x++) {
                            if (mask[maskRow + x] === 1) {
                                rowRe[x] = 0;
                                rowIm[x] = 0;
                            }
                        }
                    }

                    const unshifted = Lib.fft.unshift(shifted);
                    const ifftRes = Lib.fft.ifft2d(unshifted.re, unshifted.im);

                    // Reconstruct denoised spatial data directly without windows
                    for (let y = 0; y < PREVIEW_SIZE; y++) {
                        const row = y * PREVIEW_SIZE;
                        const rowRe = ifftRes.re[y];
                        for (let x = 0; x < PREVIEW_SIZE; x++) {
                            previewDenoisedData[(row + x) * 4 + ch] = Math.max(0, Math.min(255, rowRe[x]));
                        }
                    }
                }

                for (let i = 0; i < PREVIEW_SIZE * PREVIEW_SIZE; i++) {
                    previewDenoisedData[i * 4 + 3] = 255;
                }

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = PREVIEW_SIZE;
                tempCanvas.height = PREVIEW_SIZE;
                tempCanvas.getContext('2d')!.putImageData(new ImageData(previewDenoisedData, PREVIEW_SIZE, PREVIEW_SIZE), 0, 0);

                resCtx.clearRect(0, 0, resCanvas.width, resCanvas.height);
                resCtx.drawImage(tempCanvas, 0, 0, resCanvas.width, resCanvas.height);
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
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) solvePreview();
                updateHistoryButtons();
            }
        };

        const redo = () => {
            if (historyIndex < historyStack.length - 1) {
                historyIndex++;
                mask.set(historyStack[historyIndex]);
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) solvePreview();
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
            const candidates: Array<{ x: number; y: number; val: number; salience: number }> = [];
            const cx = PREVIEW_SIZE / 2;
            const cy = PREVIEW_SIZE / 2;
            const safetyRadius = minDCDistance;

            // Find local maxima first
            for (let y = 1; y < PREVIEW_SIZE - 1; y++) {
                const rowOffset = y * PREVIEW_SIZE;
                for (let x = 1; x < PREVIEW_SIZE - 1; x++) {
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
                            if (ny < 0 || ny >= PREVIEW_SIZE) continue;
                            for (let dx2 = -windowSize; dx2 <= windowSize; dx2++) {
                                const nx = x + dx2;
                                if (nx < 0 || nx >= PREVIEW_SIZE) continue;
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
                return filtered.slice(0, maxSpikes);
            }
            return [];
        };

        const getProposedGrid = (): Array<{ x: number; y: number }> => {
            const list: Array<{ x: number; y: number }> = [];
            const cx = PREVIEW_SIZE / 2;
            const cy = PREVIEW_SIZE / 2;

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
            const maxI = Math.ceil(PREVIEW_SIZE / (gridX || 1)) + 5;
            const maxJ = Math.ceil(PREVIEW_SIZE / (gridY || 1)) + 5;

            const limitI = Math.min(150, maxI);
            const limitJ = Math.min(150, maxJ);

            for (let j = -limitJ; j <= limitJ; j++) {
                for (let i = -limitI; i <= limitI; i++) {
                    if (i === 0 && j === 0) continue; // Skip DC component

                    const x = Math.round(cx + i * ux + j * vx);
                    const y = Math.round(cy + i * uy + j * vy);

                    if (x >= 0 && x < PREVIEW_SIZE && y >= 0 && y < PREVIEW_SIZE) {
                        list.push({ x, y });
                    }
                }
            }
            return list;
        };

        const commitAutoSpikes = () => {
            const proposed = getProposedAutoSpikes();
            if (proposed.length === 0) return;
            proposed.forEach(cand => {
                drawCircleInMask(cand.x, cand.y, brushSize, 1);
            });
            pushHistoryState();
            renderFourierBackbuffer();
            drawFourier();
            if (livePreview) solvePreview();
        };

        const commitHarmonicGrid = () => {
            const proposed = getProposedGrid();
            if (proposed.length === 0) return;
            proposed.forEach(p => {
                drawCircleInMask(p.x, p.y, brushSize, 1);
            });
            pushHistoryState();
            renderFourierBackbuffer();
            drawFourier();
            if (livePreview) solvePreview();
        };

        // --- Mouse and Interaction Bindings ---

        const getUntransformedCoords = (clientX: number, clientY: number) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = clientX - rect.left;
            const mouseY = clientY - rect.top;
            return {
                x: Math.round((mouseX - panX) / zoom),
                y: Math.round((mouseY - panY) / zoom)
            };
        };

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = 1.15;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const fftX = (mouseX - panX) / zoom;
            const fftY = (mouseY - panY) / zoom;

            if (e.deltaY < 0) {
                zoom = Math.min(25.0, zoom * zoomFactor);
            } else {
                zoom = Math.max(0.4, zoom / zoomFactor);
            }

            panX = mouseX - fftX * zoom;
            panY = mouseY - fftY * zoom;

            drawFourier();
        });

        canvas.onmousedown = (e) => {
            e.preventDefault();
            if (e.button === 1) {
                // Middle click for panning
                isPanning = true;
                startX = e.clientX - panX;
                startY = e.clientY - panY;
            } else {
                isDrawing = true;
                const coords = getUntransformedCoords(e.clientX, e.clientY);
                // Right click functions as an instant eraser regardless of current tool selection
                const val = (e.button === 2 || activeTool === 'erase') ? 0 : 1;
                drawCircleInMask(coords.x, coords.y, brushSize, val);
                renderFourierBackbuffer();
                if (livePreview) solvePreview();
                drawFourier();
            }
        };

        canvas.onmousemove = (e) => {
            const rect = canvas.getBoundingClientRect();
            hoverX = e.clientX - rect.left;
            hoverY = e.clientY - rect.top;

            const coords = getUntransformedCoords(e.clientX, e.clientY);
            const statusCoordsEl = ws.overlay.querySelector('#pn-coords-status')!;
            statusCoordsEl.textContent = `Freq Domain: [X: ${coords.x}, Y: ${coords.y}] | Zoom: ${Math.round(zoom * 100)}%`;

            if (isDrawing) {
                const val = ((e.buttons & 2) === 2 || activeTool === 'erase') ? 0 : 1;
                drawCircleInMask(coords.x, coords.y, brushSize, val);
                renderFourierBackbuffer();
                if (livePreview) solvePreview();
            } else if (isPanning) {
                panX = e.clientX - startX;
                panY = e.clientY - startY;
            }
            drawFourier();
        };

        canvas.onmouseleave = () => {
            hoverX = null;
            hoverY = null;
            drawFourier();
        };

        const onMouseUpGlobal = () => {
            if (isDrawing || isPanning) {
                if (isDrawing) {
                    pushHistoryState();
                }
                isDrawing = false;
                isPanning = false;
                if (livePreview) solvePreview();
                drawFourier();
            }
        };
        window.addEventListener('mouseup', onMouseUpGlobal);

        canvas.oncontextmenu = (e) => e.preventDefault();

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
            onInput: (v) => { minDCDistance = parseInt(v); drawFourier(); }
        }));
        autoPanel.appendChild(UI.createSliderRow({
            label: 'Peak Cutoff %', min: 20, max: 95, step: 1, value: spikeThreshold,
            onInput: (v) => { spikeThreshold = parseInt(v); drawFourier(); }
        }));
        autoPanel.appendChild(UI.createSliderRow({
            label: 'Max Spikes', min: 2, max: 40, step: 1, value: maxSpikes,
            onInput: (v) => { maxSpikes = parseInt(v); drawFourier(); }
        }));
        autoPanel.appendChild(UI.createButton({
            label: 'Commit Proposed Peaks', className: 'btn', style: 'width:100%; margin-top:5px;',
            onClick: () => commitAutoSpikes()
        }));
        ws.sidebar.appendChild(autoPanel);

        // Harmonic Grid Parameters Panel
        gridPanel.appendChild(UI.createSliderRow({
            label: 'Grid Spacing X', min: 4, max: 512, step: 1, value: gridX,
            onInput: (v) => { gridX = parseInt(v); drawFourier(); }
        }));
        gridPanel.appendChild(UI.createSliderRow({
            label: 'Grid Spacing Y', min: 4, max: 512, step: 1, value: gridY,
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
            label: 'Clear All Notches', className: 'btn cancel-btn btn-danger',
            onClick: () => {
                mask.fill(0);
                pushHistoryState();
                renderFourierBackbuffer();
                drawFourier();
                if (livePreview) solvePreview();
            }
        });

        ws.sidebar.appendChild(UI.createNode('div', { style: 'display:grid; grid-template-columns:1fr 1fr; gap:10px;' }, undoBtn, redoBtn));
        ws.sidebar.appendChild(clearBtn);

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'FFT Viewport Controls'));

        const zoomInBtn = UI.createButton({ label: 'Zoom +', className: 'btn', onClick: () => { zoom = Math.min(25, zoom * 1.25); drawFourier(); } });
        const zoomOutBtn = UI.createButton({ label: 'Zoom -', className: 'btn', onClick: () => { zoom = Math.max(0.4, zoom / 1.25); drawFourier(); } });
        const resetZoomBtn = UI.createButton({ label: 'Reset Zoom', className: 'btn cancel-btn', onClick: () => { zoom = 1.0; panX = 0; panY = 0; drawFourier(); } });

        ws.sidebar.appendChild(UI.createNode('div', { style: 'display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px;' }, zoomInBtn, zoomOutBtn, resetZoomBtn));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Spectrum Gain', min: 0.1, max: 5.0, step: 0.1, value: spectrumGain,
            onInput: (v) => { spectrumGain = parseFloat(v); renderFourierBackbuffer(); drawFourier(); }
        }));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Colormap',
            options: [
                { value: 'grayscale', text: 'Grayscale Map' },
                { value: 'hot', text: 'Thermal (Hot)' }
            ],
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

        const forceSolveBtn = UI.createButton({
            label: 'Force Preview Refresh', className: 'btn',
            style: 'width:100%; padding:10px; font-weight:bold;',
            onClick: () => solvePreview()
        });
        ws.sidebar.appendChild(forceSolveBtn);

        // Bootstrap visual computation and open workspace
        computeFourierSpectrum();
        renderFourierBackbuffer();
        solvePreview();
        updateHistoryButtons();
        ws.show();
    },

    injectStyles() {
        if (document.getElementById('pn-workspace-style')) return;
        const style = document.createElement('style');
        style.id = 'pn-workspace-style';
        style.textContent = `
            .pn-panels-container { display: flex; width: 100%; height: 100%; gap: 15px; padding: 15px; box-sizing: border-box; background: #141414; }
            .pn-panel { flex: 1; display: flex; flex-direction: column; background: #1e1e1e; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
            .pn-panel-header { display: flex; justify-content: space-between; align-items: center; background: #252526; padding: 8px 12px; border-bottom: 1px solid #333; font-weight: bold; font-size: 11px; color: #aaa; text-transform: uppercase; }
            .pn-canvas-wrapper { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 10px; background-image: linear-gradient(45deg, #181818 25%, transparent 25%), linear-gradient(-45deg, #181818 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181818 75%), linear-gradient(-45deg, transparent 75%, #181818 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px; position: relative; }
            .pn-canvas { box-shadow: 0 4px 12px rgba(0,0,0,0.5); object-fit: contain; image-rendering: pixelated; background: transparent; cursor: crosshair; max-width: 100%; max-height: 100%; }
            .pn-tool-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
            .pn-tool-btn { background-color: #121212; border: 1px solid #333; color: #ccc; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; font-weight: bold; }
            .pn-tool-btn:hover { background-color: #2a2a2a; border-color: #007acc; }
            .pn-tool-btn.active { border-color: #007acc; background-color: rgba(0, 122, 204, 0.15); color: #fff; }
        `;
        document.head.appendChild(style);
    }
};

if (typeof window !== 'undefined') {
    (window as any).PeriodicNoiseWorkspace = PeriodicNoiseWorkspace;
}

Filters.register('periodic-noise', {
    name: 'Periodic Noise Remover',
    mode: 'pixel',
    menu: {
        path: 'Filter/Denoise',
        label: 'Periodic Noise Filter...',
        order: 6
    },
    apply(l: Layer) {
        PeriodicNoiseWorkspace.open();
    }
});