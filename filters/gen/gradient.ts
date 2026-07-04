import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters } from '~/filters';

interface GradientStop {
    id: string;
    t: number;      // 0.0 to 1.0
    color: [number, number, number]; // [r, g, b]
    opacity: number; // 0.0 to 1.0
}

export const GradientGeneratorWorkspace = {
    open() {
        const layer = App.utils.getActive();
        if (!layer) return alert('No active layer selected.');
        if (!App.utils.layerIs(layer, 'editable')) {
            return alert('Layer is not editable. Rasterize it first.');
        }

        const fullW = layer.canvas.width;
        const fullH = layer.canvas.height;

        this.injectStyles();

        // Workspace State
        let stops: GradientStop[] = [
            { id: 'stop_start', t: 0.0, color: [0, 0, 0], opacity: 1.0 },
            { id: 'stop_end', t: 1.0, color: [255, 255, 255], opacity: 1.0 }
        ];
        let selectedStopId = 'stop_start';

        let previewPattern: 'linear' | 'wave' | 'radial' | 'concentric' = 'linear';
        let exportFormat: 'json' | 'css' | 'svg' = 'json';
        let exportHex = true;
        
        let sampleAlgo: 'dp' | 'equidistant' = 'dp';
        let sampleStopsCount = 10;

        // Sampling Line Endpoint State (Canvas coordinates)
        let lineStart = { x: Math.round(fullW * 0.15), y: Math.round(fullH * 0.5) };
        let lineEnd = { x: Math.round(fullW * 0.85), y: Math.round(fullH * 0.5) };
        let activeDragEndpoint: 'start' | 'end' | 'new' | null = null;

        // UI references for interactive updates
        let selectedColorInput: HTMLInputElement;
        let selectedOpacityInput: HTMLInputElement;
        let selectedPositionInput: HTMLInputElement;
        let deleteStopBtn: HTMLButtonElement;
        let exportTextarea: HTMLTextAreaElement;

        // Extract active layer's image pixel data for sampling
        const fullImgData = layer.ctx.getImageData(0, 0, fullW, fullH);
        const srcData = fullImgData.data;

        // Initialize full-screen workspace layout
        const ws = new App.FullScreenWorkspace({
            title: 'Interactive Gradient Generator',
            onApply: () => {
                leftViewport.destroy();
                rightViewport.destroy();

                const finalImgData = layer.ctx.getImageData(0, 0, fullW, fullH);
                const data = finalImgData.data;

                // Render the selected preview pattern to the active layer
                for (let y = 0; y < fullH; y++) {
                    for (let x = 0; x < fullW; x++) {
                        let t = 0;
                        if (previewPattern === 'linear') {
                            t = x / (fullW - 1 || 1);
                        } else if (previewPattern === 'wave') {
                            const nx = (x / (fullW || 1)) * 4 * Math.PI;
                            const ny = (y / (fullH || 1)) * 4 * Math.PI;
                            t = (Math.sin(nx) * Math.cos(ny) + 1) / 2;
                        } else if (previewPattern === 'radial') {
                            const cx = fullW / 2;
                            const cy = fullH / 2;
                            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                            const maxDist = Math.sqrt(cx ** 2 + cy ** 2) || 1;
                            t = 1 - dist / maxDist;
                        } else if (previewPattern === 'concentric') {
                            const cx = fullW / 2;
                            const cy = fullH / 2;
                            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                            t = (Math.sin(dist / 20) + 1) / 2;
                        }

                        const [r, g, b, a] = getGradientColor(t);
                        const idx = (y * fullW + x) * 4;

                        data[idx] = r;
                        data[idx + 1] = g;
                        data[idx + 2] = b;
                        data[idx + 3] = Math.round(a * 255);
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

        const leftPanel = ws.createPanel({ title: 'Gradient Preview Pattern', status: 'Generating...' });
        const rightPanel = ws.createPanel({ title: 'Image Sampling & Profile Source', status: 'Drag line caps' });

        const leftCanvas = leftPanel.canvas;
        const rightCanvas = rightPanel.canvas;
        const leftStatusEl = leftPanel.statusEl;
        const rightStatusEl = rightPanel.statusEl;

        leftCanvas.width = fullW;
        leftCanvas.height = fullH;
        rightCanvas.width = fullW;
        rightCanvas.height = fullH;

        const leftViewport = new App.InteractiveViewport(leftCanvas);
        const rightViewport = new App.InteractiveViewport(rightCanvas);

        leftViewport.setSmoothing(true);
        rightViewport.setSmoothing(true);

        // Backbuffers
        const patternBackbuffer = document.createElement('canvas');
        patternBackbuffer.width = fullW;
        patternBackbuffer.height = fullH;

        const imageBackbuffer = document.createElement('canvas');
        imageBackbuffer.width = fullW;
        imageBackbuffer.height = fullH;
        imageBackbuffer.getContext('2d')!.putImageData(fullImgData, 0, 0);

        // --- Core Color Interpolation ---
        const getGradientColor = (t: number): [number, number, number, number] => {
            t = Math.max(0, Math.min(1, t));
            const sortedStops = [...stops].sort((a, b) => a.t - b.t);

            if (sortedStops.length === 0) return [0, 0, 0, 1];
            if (t <= sortedStops[0].t) {
                const first = sortedStops[0];
                return [first.color[0], first.color[1], first.color[2], first.opacity];
            }
            if (t >= sortedStops[sortedStops.length - 1].t) {
                const last = sortedStops[sortedStops.length - 1];
                return [last.color[0], last.color[1], last.color[2], last.opacity];
            }

            for (let i = 1; i < sortedStops.length; i++) {
                if (t <= sortedStops[i].t) {
                    const stop1 = sortedStops[i - 1];
                    const stop2 = sortedStops[i];
                    const dist = stop2.t - stop1.t;
                    const factor = dist === 0 ? 0 : (t - stop1.t) / dist;

                    const r = Math.round(stop1.color[0] * (1 - factor) + stop2.color[0] * factor);
                    const g = Math.round(stop1.color[1] * (1 - factor) + stop2.color[1] * factor);
                    const b = Math.round(stop1.color[2] * (1 - factor) + stop2.color[2] * factor);
                    const a = stop1.opacity * (1 - factor) + stop2.opacity * factor;
                    return [r, g, b, a];
                }
            }

            const last = sortedStops[sortedStops.length - 1];
            return [last.color[0], last.color[1], last.color[2], last.opacity];
        };

        const formatColor = (r: number, g: number, b: number, a: number, useHex: boolean) => {
            if (useHex) {
                const rHex = ("0" + r.toString(16)).slice(-2);
                const gHex = ("0" + g.toString(16)).slice(-2);
                const bHex = ("0" + b.toString(16)).slice(-2);
                const aHex = ("0" + Math.round(a * 255).toString(16)).slice(-2);
                return `#${rHex}${gHex}${bHex}${aHex}`;
            } else {
                return `rgba(${r}, ${g}, ${b}, ${parseFloat(a.toFixed(3))})`;
            }
        };

        const parseColorToRGBA = (str: string): [number, number, number, number] | null => {
            str = str.trim().toLowerCase();
            if (str.startsWith('#')) {
                const hex = str.substring(1);
                if (hex.length === 3) {
                    const r = parseInt(hex[0] + hex[0], 16);
                    const g = parseInt(hex[1] + hex[1], 16);
                    const b = parseInt(hex[2] + hex[2], 16);
                    return [r, g, b, 1.0];
                }
                if (hex.length === 4) {
                    const r = parseInt(hex[0] + hex[0], 16);
                    const g = parseInt(hex[1] + hex[1], 16);
                    const b = parseInt(hex[2] + hex[2], 16);
                    const a = parseInt(hex[3] + hex[3], 16) / 255;
                    return [r, g, b, Math.round(a * 1000) / 1000];
                }
                if (hex.length === 6) {
                    const r = parseInt(hex.substring(0, 2), 16);
                    const g = parseInt(hex.substring(2, 4), 16);
                    const b = parseInt(hex.substring(4, 6), 16);
                    return [r, g, b, 1.0];
                }
                if (hex.length === 8) {
                    const r = parseInt(hex.substring(0, 2), 16);
                    const g = parseInt(hex.substring(2, 4), 16);
                    const b = parseInt(hex.substring(4, 6), 16);
                    const a = parseInt(hex.substring(6, 8), 16) / 255;
                    return [r, g, b, Math.round(a * 1000) / 1000];
                }
                return null;
            }

            const rgbaMatch = str.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
            if (rgbaMatch) {
                const r = parseInt(rgbaMatch[1], 10);
                const g = parseInt(rgbaMatch[2], 10);
                const b = parseInt(rgbaMatch[3], 10);
                const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1.0;
                return [r, g, b, a];
            }

            const names: Record<string, [number, number, number]> = {
                black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0],
                lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
                cyan: [0, 255, 255], magenta: [255, 0, 255], silver: [192, 192, 192],
                gray: [128, 128, 128], maroon: [128, 0, 0], olive: [128, 128, 0],
                green: [0, 128, 0], purple: [128, 0, 128], teal: [0, 128, 128], navy: [0, 0, 128]
            };
            if (names[str]) {
                return [names[str][0], names[str][1], names[str][2], 1.0];
            }
            return null;
        };

        const parseCSSGradient = (css: string): GradientStop[] | null => {
            let content = css.trim();
            const match = content.match(/linear-gradient\s*\((.*)\)/i);
            if (match) {
                content = match[1];
            }
            const parts: string[] = [];
            let current = '';
            let depth = 0;
            for (let i = 0; i < content.length; i++) {
                const char = content[i];
                if (char === '(') depth++;
                else if (char === ')') depth--;
                if (char === ',' && depth === 0) {
                    parts.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current.trim()) {
                parts.push(current.trim());
            }
            const stopParts = parts.filter(p => {
                const lower = p.toLowerCase();
                return !(lower.includes('deg') || lower.startsWith('to '));
            });
            if (stopParts.length < 2) return null;

            const parsedStops: GradientStop[] = [];
            for (let i = 0; i < stopParts.length; i++) {
                const part = stopParts[i];
                const percentMatch = part.match(/([\d.]+)\s*%/);
                let t = i / (stopParts.length - 1);
                if (percentMatch) {
                    t = parseFloat(percentMatch[1]) / 100;
                }
                const colorPart = part.replace(/[\d.]+\s*%/, '').trim();
                const rgba = parseColorToRGBA(colorPart);
                if (!rgba) return null;
                parsedStops.push({
                    id: 'stop_' + Math.random().toString(36).substr(2, 9),
                    t: Math.round(t * 1000) / 1000,
                    color: [rgba[0], rgba[1], rgba[2]],
                    opacity: rgba[3]
                });
            }
            return parsedStops;
        };

        const parseJSONGradient = (jsonStr: string): GradientStop[] | null => {
            try {
                const obj = JSON.parse(jsonStr);
                if (!Array.isArray(obj)) return null;
                if (obj.length < 2) return null;
                const parsedStops: GradientStop[] = [];
                for (let i = 0; i < obj.length; i++) {
                    const item = obj[i];
                    let t = parseFloat(item.t !== undefined ? item.t : (item.position !== undefined ? item.position : (item.offset !== undefined ? item.offset : i / (obj.length - 1))));
                    if (isNaN(t)) t = i / (obj.length - 1);
                    t = Math.max(0, Math.min(1, t));
                    let r = 0, g = 0, b = 0, a = 1.0;
                    if (typeof item.color === 'string') {
                        const rgba = parseColorToRGBA(item.color);
                        if (!rgba) return null;
                        [r, g, b, a] = rgba;
                    } else if (Array.isArray(item.color)) {
                        r = parseInt(item.color[0], 10) || 0;
                        g = parseInt(item.color[1], 10) || 0;
                        b = parseInt(item.color[2], 10) || 0;
                        if (item.color[3] !== undefined) {
                            a = parseFloat(item.color[3]);
                        } else if (item.opacity !== undefined) {
                            a = parseFloat(item.opacity);
                        }
                    } else {
                        return null;
                    }
                    parsedStops.push({
                        id: 'stop_' + Math.random().toString(36).substr(2, 9),
                        t: Math.round(t * 1000) / 1000,
                        color: [r, g, b],
                        opacity: a
                    });
                }
                return parsedStops;
            } catch (e) {
                return null;
            }
        };

        const parseSVGGradient = (svgStr: string): GradientStop[] | null => {
            try {
                const stopRegex = /<stop\s+([^>]+)\s*\/?>/gi;
                const parsedStops: GradientStop[] = [];
                let match;
                while ((match = stopRegex.exec(svgStr)) !== null) {
                    const attrsStr = match[1];
                    const offsetMatch = attrsStr.match(/offset="([^"]+)"/i);
                    const colorMatch = attrsStr.match(/stop-color="([^"]+)"/i);
                    const opacityMatch = attrsStr.match(/stop-opacity="([^"]+)"/i);
                    if (!colorMatch) continue;
                    let t = 0;
                    if (offsetMatch) {
                        const offVal = offsetMatch[1];
                        if (offVal.endsWith('%')) {
                            t = parseFloat(offVal) / 100;
                        } else {
                            t = parseFloat(offVal);
                        }
                    }
                    const rgba = parseColorToRGBA(colorMatch[1]);
                    if (!rgba) continue;
                    let a = opacityMatch ? parseFloat(opacityMatch[1]) : 1.0;
                    if (isNaN(a)) a = 1.0;
                    parsedStops.push({
                        id: 'stop_' + Math.random().toString(36).substr(2, 9),
                        t: Math.round(t * 1000) / 1000,
                        color: [rgba[0], rgba[1], rgba[2]],
                        opacity: a
                    });
                }
                if (parsedStops.length >= 2) {
                    return parsedStops;
                }
            } catch (e) {}
            return null;
        };

        const loadGradientFromText = (text: string) => {
            let loadedStops: GradientStop[] | null = null;
            const trimmed = text.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                loadedStops = parseJSONGradient(trimmed);
            } else if (trimmed.includes('<linearGradient') || trimmed.includes('<stop')) {
                loadedStops = parseSVGGradient(trimmed);
            } else {
                loadedStops = parseCSSGradient(trimmed);
            }
            if (loadedStops && loadedStops.length >= 2) {
                loadedStops.sort((a, b) => a.t - b.t);
                stops = loadedStops;
                selectedStopId = stops[0].id;
                renderStopMarkers();
                renderGradientBar();
                renderPreviewPattern();
                drawChannelsPlot();
                updateStopUIFields();
                updateExportText();
            }
        };

        // --- Viewport Render Handlers ---
        leftViewport.onDraw = () => {
            const ctx = leftViewport.ctx;
            ctx.save();
            ctx.clearRect(0, 0, leftCanvas.width, leftCanvas.height);
            leftViewport.applyTransform();
            ctx.drawImage(patternBackbuffer, 0, 0);
            ctx.restore();
        };

        rightViewport.onDraw = () => {
            const ctx = rightViewport.ctx;
            ctx.save();
            ctx.clearRect(0, 0, rightCanvas.width, rightCanvas.height);
            rightViewport.applyTransform();
            ctx.drawImage(imageBackbuffer, 0, 0);
            ctx.restore();
        };

        // Sampling Line Drawing Overlay
        rightViewport.onDrawOverlay = (ctx) => {
            ctx.save();
            
            const pStart = rightViewport.canvasToOverlay(lineStart.x, lineStart.y);
            const pEnd = rightViewport.canvasToOverlay(lineEnd.x, lineEnd.y);

            // Draw line connecting the endpoints
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 4;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.beginPath();
            ctx.moveTo(pStart.x, pStart.y);
            ctx.lineTo(pEnd.x, pEnd.y);
            ctx.stroke();

            ctx.strokeStyle = '#007acc';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(pStart.x, pStart.y);
            ctx.lineTo(pEnd.x, pEnd.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw handles at endpoints
            const r = 8;
            ctx.fillStyle = '#007acc';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.shadowBlur = 0;

            // Start handle
            ctx.beginPath();
            ctx.arc(pStart.x, pStart.y, r, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            // End handle
            ctx.beginPath();
            ctx.arc(pEnd.x, pEnd.y, r, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        };

        // --- Visual Rendering Processes ---
        const renderPreviewPattern = () => {
            leftStatusEl.textContent = 'Rendering preview...';
            const ctx = patternBackbuffer.getContext('2d')!;
            const imgData = ctx.createImageData(fullW, fullH);
            const data = imgData.data;

            for (let y = 0; y < fullH; y++) {
                for (let x = 0; x < fullW; x++) {
                    let t = 0;
                    if (previewPattern === 'linear') {
                        t = x / (fullW - 1 || 1);
                    } else if (previewPattern === 'wave') {
                        const nx = (x / (fullW || 1)) * 4 * Math.PI;
                        const ny = (y / (fullH || 1)) * 4 * Math.PI;
                        t = (Math.sin(nx) * Math.cos(ny) + 1) / 2;
                    } else if (previewPattern === 'radial') {
                        const cx = fullW / 2;
                        const cy = fullH / 2;
                        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                        const maxDist = Math.sqrt(cx ** 2 + cy ** 2) || 1;
                        t = 1 - dist / maxDist;
                    } else if (previewPattern === 'concentric') {
                        const cx = fullW / 2;
                        const cy = fullH / 2;
                        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                        t = (Math.sin(dist / 20) + 1) / 2;
                    }

                    const [r, g, b, a] = getGradientColor(t);
                    const idx = (y * fullW + x) * 4;

                    const isChecker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
                    const bgVal = isChecker ? 28 : 20;

                    data[idx] = Math.round(r * a + bgVal * (1 - a));
                    data[idx + 1] = Math.round(g * a + bgVal * (1 - a));
                    data[idx + 2] = Math.round(b * a + bgVal * (1 - a));
                    data[idx + 3] = 255;
                }
            }

            ctx.putImageData(imgData, 0, 0);
            leftViewport.onDraw!();
            leftStatusEl.textContent = `Pattern: ${previewPattern.toUpperCase()}`;
        };

        // --- Build Interactive Gradient Bar (Inserted directly in leftPanel) ---
        const gradientEditorDiv = UI.createNode('div', {
            className: 'gradient-editor-bar-wrapper'
        });

        const gradientBarCanvas = UI.createNode('canvas', {
            className: 'gradient-bar-display-canvas',
            width: 500,
            height: 30
        }) as HTMLCanvasElement;

        const gradientBarContainer = UI.createNode('div', {
            className: 'gradient-bar-container'
        }, gradientBarCanvas);

        const stopsTrack = UI.createNode('div', {
            className: 'gradient-stops-track'
        });

        gradientEditorDiv.appendChild(gradientBarContainer);
        gradientEditorDiv.appendChild(stopsTrack);

        // Insert at the top of Left Panel, right below header
        leftPanel.panel.insertBefore(gradientEditorDiv, leftPanel.panel.children[1]);

        // --- Append Channels Plot Canvas below viewport in Left Panel ---
        const channelsPlotContainer = UI.createNode('div', {
            className: 'gradient-channels-plot-wrapper',
            style: 'height: 85px; border-top: 1px solid #2d2d2d; background: #121212; padding: 4px; box-sizing: border-box;'
        });

        const channelsCanvas = UI.createNode('canvas', {
            className: 'gradient-channels-canvas',
            width: 500,
            height: 80,
            style: 'width: 100%; height: 100%; display: block;'
        }) as HTMLCanvasElement;

        channelsPlotContainer.appendChild(channelsCanvas);
        leftPanel.panel.appendChild(channelsPlotContainer);

        const drawChannelsPlot = () => {
            const ctx = channelsCanvas.getContext('2d')!;
            const w = channelsCanvas.width;
            const h = channelsCanvas.height;
            ctx.clearRect(0, 0, w, h);

            // Grid background guides
            ctx.strokeStyle = '#222222';
            ctx.lineWidth = 1;
            for (let i = 1; i < 4; i++) {
                const y = (h / 4) * i;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }

            const channelColors = ['#ff4d4d', '#2ecc71', '#3498db', '#f1c40f'];
            ctx.lineWidth = 1.8;

            for (let ch = 0; ch < 4; ch++) {
                ctx.strokeStyle = channelColors[ch];
                ctx.beginPath();
                for (let x = 0; x < w; x++) {
                    const t = x / (w - 1 || 1);
                    const rgba = getGradientColor(t);
                    const sampleVal = ch === 3 ? rgba[3] * 255 : rgba[ch];
                    const y = h - (sampleVal / 255) * h;

                    if (x === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
            }
        };

        const renderGradientBar = () => {
            const ctx = gradientBarCanvas.getContext('2d')!;
            ctx.clearRect(0, 0, gradientBarCanvas.width, gradientBarCanvas.height);

            const grad = ctx.createLinearGradient(0, 0, gradientBarCanvas.width, 0);
            const sortedStops = [...stops].sort((a, b) => a.t - b.t);
            sortedStops.forEach(stop => {
                grad.addColorStop(stop.t, `rgba(${stop.color[0]}, ${stop.color[1]}, ${stop.color[2]}, ${stop.opacity})`);
            });

            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, gradientBarCanvas.width, gradientBarCanvas.height);
        };

        const renderStopMarkers = () => {
            stopsTrack.innerHTML = '';

            stops.forEach(stop => {
                const marker = UI.createNode('div', {
                    className: 'gradient-stop-marker' + (stop.id === selectedStopId ? ' selected' : ''),
                    style: `left: ${stop.t * 100}%; background: rgb(${stop.color.join(',')}); opacity: ${stop.opacity};`,
                    dataset: { id: stop.id }
                });

                // Marker click/drag interactions
                marker.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    selectedStopId = stop.id;
                    const markerElements = stopsTrack.querySelectorAll('.gradient-stop-marker');
                    markerElements.forEach(m => {
                        const htmlM = m as HTMLElement;
                        if (htmlM.dataset.id === selectedStopId) {
                            htmlM.classList.add('selected');
                        } else {
                            htmlM.classList.remove('selected');
                        }
                    });
                    updateStopUIFields();

                    const startX = e.clientX;
                    const startT = stop.t;
                    const trackRect = stopsTrack.getBoundingClientRect();

                    const onMouseMove = (moveEvent: MouseEvent) => {
                        const dx = moveEvent.clientX - startX;
                        const dt = dx / (trackRect.width || 1);
                        let newT = Math.max(0.0, Math.min(1.0, startT + dt));
                        stop.t = Math.round(newT * 1000) / 1000;

                        // Sort continuously during dragging to keep interpolation correct
                        stops.sort((a, b) => a.t - b.t);

                        marker.style.left = `${stop.t * 100}%`;

                        if (selectedPositionInput) {
                            selectedPositionInput.value = (stop.t * 100).toFixed(1);
                            const disp = selectedPositionInput.nextSibling as HTMLElement;
                            if (disp) disp.textContent = `${(stop.t * 100).toFixed(1)}%`;
                        }

                        renderGradientBar();
                        renderPreviewPattern();
                        drawChannelsPlot();
                        updateExportText();
                    };

                    const onMouseUp = () => {
                        window.removeEventListener('mousemove', onMouseMove);
                        window.removeEventListener('mouseup', onMouseUp);

                        stops.sort((a, b) => a.t - b.t);
                        renderStopMarkers();
                    };

                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                });

                stopsTrack.appendChild(marker);
            });
        };

        // Add stops by clicking the track or canvas directly
        const handleAddStopAtClick = (e: MouseEvent, targetElement: HTMLElement) => {
            const rect = targetElement.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const t = Math.max(0.0, Math.min(1.0, clickX / rect.width));

            const interpolated = getGradientColor(t);
            const newStop: GradientStop = {
                id: 'stop_' + Math.random().toString(36).substr(2, 9),
                t: Math.round(t * 1000) / 1000,
                color: [interpolated[0], interpolated[1], interpolated[2]],
                opacity: interpolated[3]
            };

            stops.push(newStop);
            stops.sort((a, b) => a.t - b.t);
            selectedStopId = newStop.id;

            renderStopMarkers();
            renderGradientBar();
            renderPreviewPattern();
            drawChannelsPlot();
            updateStopUIFields();
            updateExportText();
        };

        stopsTrack.addEventListener('click', (e) => {
            if (e.target !== stopsTrack) return;
            handleAddStopAtClick(e, stopsTrack);
        });

        gradientBarCanvas.addEventListener('click', (e) => {
            handleAddStopAtClick(e, gradientBarCanvas);
        });

        // --- Interaction Handlers on Right Panel Line (Image Sampling Viewport) ---
        rightViewport.onMouseDown = (e) => {
            const dxStart = e.x - lineStart.x;
            const dyStart = e.y - lineStart.y;
            const distStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart);

            const dxEnd = e.x - lineEnd.x;
            const dyEnd = e.y - lineEnd.y;
            const distEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);

            const thresh = 15 / rightViewport.zoom;

            if (distStart < thresh) {
                activeDragEndpoint = 'start';
            } else if (distEnd < thresh) {
                activeDragEndpoint = 'end';
            } else {
                activeDragEndpoint = 'new';
                lineStart = { x: e.x, y: e.y };
                lineEnd = { x: e.x, y: e.y };
            }
            rightViewport.drawOverlay();
        };

        rightViewport.onMouseMove = (e) => {
            if (!activeDragEndpoint) return;
            if (activeDragEndpoint === 'start') {
                lineStart = { x: e.x, y: e.y };
            } else if (activeDragEndpoint === 'end') {
                lineEnd = { x: e.x, y: e.y };
            } else if (activeDragEndpoint === 'new') {
                lineEnd = { x: e.x, y: e.y };
            }
            rightViewport.drawOverlay();
        };

        rightViewport.onMouseUp = () => {
            activeDragEndpoint = null;
            rightViewport.drawOverlay();
        };

        // --- Profiles Sampling & Algorithm Optimization (Ported from palette.html) ---
        const getProfileFromImage = (): Array<{ t: number; color: [number, number, number] }> => {
            const x1 = lineStart.x;
            const y1 = lineStart.y;
            const x2 = lineEnd.x;
            const y2 = lineEnd.y;
            const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            if (dist < 2) return [];

            const profile: Array<{ t: number; color: [number, number, number] }> = [];
            const steps = Math.ceil(dist);
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const x = Math.floor(x1 + (x2 - x1) * t);
                const y = Math.floor(y1 + (y2 - y1) * t);

                if (x >= 0 && x < fullW && y >= 0 && y < fullH) {
                    const idx = (y * fullW + x) * 4;
                    const r = srcData[idx];
                    const g = srcData[idx + 1];
                    const b = srcData[idx + 2];
                    profile.push({ t, color: [r, g, b] });
                }
            }
            return profile;
        };

        const simplifyProfileDP = (profile: Array<{ t: number; color: [number, number, number] }>, segmentsCount: number): GradientStop[] => {
            if (profile.length === 0) return [];

            const MAX_POINTS = 200;
            let workProfile: Array<{ t: number; color: [number, number, number] }> = [];
            if (profile.length > MAX_POINTS) {
                const step = profile.length / MAX_POINTS;
                for (let i = 0; i < MAX_POINTS; i++) {
                    const idx = Math.min(Math.floor(i * step), profile.length - 1);
                    workProfile.push(profile[idx]);
                }
                workProfile.push(profile[profile.length - 1]);
            } else {
                workProfile = [...profile];
            }

            const n = workProfile.length;
            if (segmentsCount >= n - 1) segmentsCount = n - 1;
            if (segmentsCount < 1) segmentsCount = 1;

            const calcError = (startIdx: number, endIdx: number) => {
                if (endIdx - startIdx < 1) return 0;
                const cA = workProfile[startIdx].color;
                const cB = workProfile[endIdx].color;
                let totalError = 0;
                for (let k = startIdx + 1; k < endIdx; k++) {
                    const ratio = (k - startIdx) / (endIdx - startIdx);
                    const r = cA[0] + (cB[0] - cA[0]) * ratio;
                    const g = cA[1] + (cB[1] - cA[1]) * ratio;
                    const b = cA[2] + (cB[2] - cA[2]) * ratio;
                    const actual = workProfile[k].color;
                    totalError += (actual[0] - r) ** 2 + (actual[1] - g) ** 2 + (actual[2] - b) ** 2;
                }
                return totalError;
            };

            const dp = Array.from({ length: segmentsCount + 1 }, () => Array(n).fill(Infinity));
            const parent = Array.from({ length: segmentsCount + 1 }, () => Array(n).fill(0));

            for (let i = 1; i < n; i++) {
                dp[1][i] = calcError(0, i);
                parent[1][i] = 0;
            }

            for (let k = 2; k <= segmentsCount; k++) {
                for (let i = k; i < n; i++) {
                    for (let j = k - 1; j < i; j++) {
                        const currentSegErr = calcError(j, i);
                        const totalErr = dp[k - 1][j] + currentSegErr;
                        if (totalErr < dp[k][i]) {
                            dp[k][i] = totalErr;
                            parent[k][i] = j;
                        }
                    }
                }
            }

            let stopsIndices: number[] = [];
            let currIdx = n - 1;
            stopsIndices.push(currIdx);
            for (let k = segmentsCount; k > 0; k--) {
                const prevIdx = parent[k][currIdx];
                stopsIndices.push(prevIdx);
                currIdx = prevIdx;
            }
            stopsIndices.reverse();

            return stopsIndices.map((idx, arrIndex) => {
                const p = workProfile[idx];
                let tVal = parseFloat(p.t.toFixed(4));
                if (arrIndex === 0) tVal = 0;
                if (arrIndex === stopsIndices.length - 1) tVal = 1;
                return {
                    id: 'stop_' + Math.random().toString(36).substr(2, 9),
                    t: tVal,
                    color: p.color,
                    opacity: 1.0
                };
            });
        };

        const sampleGradientFromImage = () => {
            const profile = getProfileFromImage();
            if (profile.length === 0) {
                return alert('Please draw a line across the source image on the right panel first.');
            }

            if (sampleAlgo === 'dp') {
                stops = simplifyProfileDP(profile, sampleStopsCount);
            } else {
                stops = [];
                const n = profile.length;
                const count = Math.min(sampleStopsCount, n);
                for (let i = 0; i < count; i++) {
                    const tTarget = i / (count - 1);
                    const idx = Math.min(n - 1, Math.round(tTarget * (n - 1)));
                    const p = profile[idx];
                    stops.push({
                        id: 'stop_' + Math.random().toString(36).substr(2, 9),
                        t: Math.round(tTarget * 1000) / 1000,
                        color: p.color,
                        opacity: 1.0
                    });
                }
            }

            if (stops.length < 2) {
                stops = [
                    { id: 'stop_start', t: 0.0, color: [0, 0, 0], opacity: 1.0 },
                    { id: 'stop_end', t: 1.0, color: [255, 255, 255], opacity: 1.0 }
                ];
            }

            stops.sort((a, b) => a.t - b.t);
            selectedStopId = stops[0].id;

            renderStopMarkers();
            renderGradientBar();
            renderPreviewPattern();
            drawChannelsPlot();
            updateStopUIFields();
            updateExportText();
        };

        // --- Sidebar UI Controllers ---
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Pattern & Preview Settings'));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Pattern',
            options: [
                { value: 'linear', text: 'Linear' },
                { value: 'wave', text: 'Wave Pattern' },
                { value: 'radial', text: 'Radial Glow' },
                { value: 'concentric', text: 'Concentric' }
            ],
            value: previewPattern,
            onChange: (v) => {
                previewPattern = v as any;
                renderPreviewPattern();
            }
        }));

        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Selected Stop Properties'));

        // Location position slider
        const posRow = UI.createSliderRow({
            label: 'Location', min: 0, max: 100, step: 0.1, value: 0,
            formatter: (v) => `${Number(v).toFixed(1)}%`,
            onInput: (v) => {
                const stop = stops.find(s => s.id === selectedStopId);
                if (stop) {
                    stop.t = parseFloat(v) / 100;
                    stops.sort((a, b) => a.t - b.t);
                    renderStopMarkers();
                    renderGradientBar();
                    renderPreviewPattern();
                    drawChannelsPlot();
                    updateExportText();
                }
            }
        });
        selectedPositionInput = posRow.querySelector('input[type="range"]') as HTMLInputElement;
        ws.sidebar.appendChild(posRow);

        // Opacity slider
        const opRow = UI.createSliderRow({
            label: 'Opacity', min: 0, max: 100, step: 0.1, value: 100,
            formatter: (v) => `${Number(v).toFixed(1)}%`,
            onInput: (v) => {
                const stop = stops.find(s => s.id === selectedStopId);
                if (stop) {
                    stop.opacity = parseFloat(v) / 100;
                    renderStopMarkers();
                    renderGradientBar();
                    renderPreviewPattern();
                    drawChannelsPlot();
                    updateExportText();
                }
            }
        });
        selectedOpacityInput = opRow.querySelector('input[type="range"]') as HTMLInputElement;
        ws.sidebar.appendChild(opRow);

        // Color Picker Row
        const colorRow = UI.createColorRow({
            label: 'Color',
            value: '#000000',
            onChange: (hex) => {
                const stop = stops.find(s => s.id === selectedStopId);
                if (stop) {
                    const r = parseInt(hex.substring(1, 3), 16);
                    const g = parseInt(hex.substring(3, 5), 16);
                    const b = parseInt(hex.substring(5, 7), 16);
                    stop.color = [r, g, b];
                    renderStopMarkers();
                    renderGradientBar();
                    renderPreviewPattern();
                    drawChannelsPlot();
                    updateExportText();
                }
            }
        });
        selectedColorInput = colorRow.querySelector('input[type="color"]') as HTMLInputElement;
        ws.sidebar.appendChild(colorRow);

        // Delete Stop Button
        deleteStopBtn = UI.createButton({
            label: 'Delete Selected Stop',
            className: 'btn cancel-btn btn-danger',
            style: 'width: 100%; margin-top: 5px; margin-bottom: 10px;',
            onClick: () => {
                if (stops.length <= 2) return;
                const idx = stops.findIndex(s => s.id === selectedStopId);
                if (idx !== -1) {
                    stops.splice(idx, 1);
                    selectedStopId = stops[0].id;
                    renderStopMarkers();
                    renderGradientBar();
                    renderPreviewPattern();
                    drawChannelsPlot();
                    updateStopUIFields();
                    updateExportText();
                }
            }
        });
        ws.sidebar.appendChild(deleteStopBtn);

        // Update properties values based on current active stop selection
        const updateStopUIFields = () => {
            const stop = stops.find(s => s.id === selectedStopId);
            if (!stop) return;

            if (selectedColorInput) {
                const rHex = ("0" + stop.color[0].toString(16)).slice(-2);
                const gHex = ("0" + stop.color[1].toString(16)).slice(-2);
                const bHex = ("0" + stop.color[2].toString(16)).slice(-2);
                selectedColorInput.value = `#${rHex}${gHex}${bHex}`;
                const swatch = selectedColorInput.previousSibling as HTMLElement;
                if (swatch) swatch.style.background = selectedColorInput.value;
            }

            if (selectedOpacityInput) {
                selectedOpacityInput.value = (stop.opacity * 100).toFixed(1);
                const disp = selectedOpacityInput.nextSibling as HTMLElement;
                if (disp) disp.textContent = `${(stop.opacity * 100).toFixed(1)}%`;
            }

            if (selectedPositionInput) {
                selectedPositionInput.value = (stop.t * 100).toFixed(1);
                const disp = selectedPositionInput.nextSibling as HTMLElement;
                if (disp) disp.textContent = `${(stop.t * 100).toFixed(1)}%`;
            }

            if (deleteStopBtn) {
                deleteStopBtn.disabled = stops.length <= 2;
            }
        };

        // --- Sampler Controls Panel ---
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Get Gradient From Image'));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Algorithm',
            options: [
                { value: 'dp', text: 'Optimal (DP Curve)' },
                { value: 'equidistant', text: 'Equidistant Spacing' }
            ],
            value: sampleAlgo,
            onChange: (v) => {
                sampleAlgo = v as any;
            }
        }));

        ws.sidebar.appendChild(UI.createSliderRow({
            label: 'Num Stops', min: 2, max: 30, step: 1, value: sampleStopsCount,
            onInput: (v) => { sampleStopsCount = parseInt(v); }
        }));

        ws.sidebar.appendChild(UI.createButton({
            label: 'Get Gradient From Image',
            className: 'btn',
            style: 'width: 100%; margin-top: 5px; font-weight: bold; background-color: #28a745;',
            onClick: () => {
                sampleGradientFromImage();
            }
        }));

        // --- Code Export Panel ---
        ws.sidebar.appendChild(UI.createNode('div', { className: 'fs-workspace-section-title' }, 'Export Code'));

        ws.sidebar.appendChild(UI.createSelectRow({
            label: 'Format',
            options: [
                { value: 'json', text: 'JSON Format' },
                { value: 'css', text: 'CSS linear-gradient' },
                { value: 'svg', text: 'SVG linearGradient' }
            ],
            value: exportFormat,
            onChange: (v) => {
                exportFormat = v as any;
                updateExportText();
            }
        }));

        ws.sidebar.appendChild(UI.createCheckbox({
            label: 'Use Hex Color Codes',
            value: exportHex,
            onChange: (v) => {
                exportHex = v;
                updateExportText();
            }
        }));

        exportTextarea = UI.createNode('textarea', {
            className: 'gradient-text-export',
            placeholder: 'Paste JSON, CSS, or SVG gradient here to load...'
        }) as HTMLTextAreaElement;
        exportTextarea.addEventListener('input', () => {
            loadGradientFromText(exportTextarea.value);
        });
        ws.sidebar.appendChild(exportTextarea);

        ws.sidebar.appendChild(UI.createButton({
            label: 'Copy Code To Clipboard',
            className: 'btn cancel-btn',
            style: 'width: 100%; margin-top: 5px;',
            onClick: () => {
                navigator.clipboard.writeText(exportTextarea.value);
                alert('Copied to clipboard!');
            }
        }));

        const updateExportText = () => {
            if (!exportTextarea) return;
            const sorted = [...stops].sort((a, b) => a.t - b.t);
            if (exportFormat === 'json') {
                if (exportHex) {
                    const json = sorted.map(s => ({
                        t: s.t,
                        color: formatColor(s.color[0], s.color[1], s.color[2], s.opacity, true)
                    }));
                    exportTextarea.value = JSON.stringify(json, null, 2);
                } else {
                    const json = sorted.map(s => ({
                        t: s.t,
                        color: s.color,
                        opacity: s.opacity
                    }));
                    exportTextarea.value = JSON.stringify(json, null, 2);
                }
            } else if (exportFormat === 'css') {
                const cssStops = sorted.map(s => {
                    const colorStr = formatColor(s.color[0], s.color[1], s.color[2], s.opacity, exportHex);
                    return `${colorStr} ${(s.t * 100).toFixed(1)}%`;
                }).join(', ');
                exportTextarea.value = `background: linear-gradient(90deg, ${cssStops});`;
            } else if (exportFormat === 'svg') {
                const svgStops = sorted.map(s => {
                    const colorStr = exportHex 
                        ? formatColor(s.color[0], s.color[1], s.color[2], 1.0, true).substring(0, 7)
                        : `rgb(${s.color.join(',')})`;
                    return `  <stop offset="${(s.t * 100).toFixed(1)}%" stop-color="${colorStr}" stop-opacity="${s.opacity}" />`;
                }).join('\n');
                exportTextarea.value = `<linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">\n${svgStops}\n</linearGradient>`;
            }
        };

        // Bootstrap visual canvases and reveal workspace
        ws.show();

        setTimeout(() => {
            renderStopMarkers();
            renderGradientBar();
            renderPreviewPattern();
            drawChannelsPlot();
            updateStopUIFields();
            updateExportText();

            // Initial center draw overlay
            rightViewport.onDraw!();
            rightViewport.drawOverlay();
        }, 60);
    },

    injectStyles() {
        if (document.getElementById('gradient-workspace-style')) return;
        const style = document.createElement('style');
        style.id = 'gradient-workspace-style';
        style.textContent = `
            .gradient-editor-bar-wrapper { background: #1e1e1e; border-bottom: 1px solid #333; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; }
            .gradient-bar-container { position: relative; height: 30px; border: 1px solid #333; border-radius: 4px; overflow: visible; background-image: linear-gradient(45deg, #1d1d1d 25%, transparent 25%), linear-gradient(-45deg, #1d1d1d 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1d1d1d 75%), linear-gradient(-45deg, transparent 75%, #1d1d1d 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0px; }
            .gradient-bar-display-canvas { width: 100%; height: 100%; display: block; cursor: crosshair; }
            .gradient-stops-track { position: relative; height: 24px; margin: 0 8px; background: #252526; border: 1px solid #333; border-radius: 3px; cursor: crosshair; }
            .gradient-stop-marker { position: absolute; top: 4px; width: 12px; height: 12px; transform: translateX(-50%) rotate(45deg); cursor: pointer; border: 1.5px solid #aaa; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); transition: border-color 0.1s, transform 0.1s; }
            .gradient-stop-marker:hover { border-color: #fff; transform: translateX(-50%) rotate(45deg) scale(1.1); }
            .gradient-stop-marker.selected { border-color: #007acc; box-shadow: 0 0 4px #007acc; transform: translateX(-50%) rotate(45deg) scale(1.2); z-index: 10; }
            .gradient-text-export { background: #121212; border: 1px solid #333; color: #00ff66; font-family: monospace; font-size: 11px; width: 100%; height: 110px; resize: none; padding: 6px; box-sizing: border-box; border-radius: 4px; margin-top: 5px; }
        `;
        document.head.appendChild(style);
    }
};

if (typeof window !== 'undefined') {
    (window as any).GradientGeneratorWorkspace = GradientGeneratorWorkspace;
}

Filters.register('gradient-generator', {
    name: 'Interactive Gradient Generator',
    mode: 'pixel',
    menu: {
        path: 'Generate',
        label: 'Gradient...',
        order: 5
    },
    apply(l: Layer) {
        GradientGeneratorWorkspace.open();
    }
});
