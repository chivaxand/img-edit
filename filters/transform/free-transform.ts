import { App, AppActions } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters, FilterContext } from '~/filters';
import { Lib } from '~/libs/index';
import { linalg } from '~/libs/linalg';

Filters.register('free-transform', {
    name: 'Free Transform',
    mode: 'unified',
    menu: {
        path: 'Transform',
        label: 'Free Transform...',
        order: 4
    },

    apply(context: FilterContext) {
        const l = context.layer;
        const p = context.values;
        const origW = p.origW !== undefined ? p.origW : l.width;
        const origH = p.origH !== undefined ? p.origH : l.height;
        const origX = p.origX !== undefined ? p.origX : l.x;
        const origY = p.origY !== undefined ? p.origY : l.y;

        let origCanvas = p.origCanvas;
        if (!origCanvas || !(origCanvas instanceof HTMLCanvasElement)) {
            origCanvas = document.createElement('canvas');
            origCanvas.width = l.canvas.width;
            origCanvas.height = l.canvas.height;
            origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);
        }

        const corners: Array<{ x: number; y: number }> = p.corners || [
            { x: 0, y: 0 },
            { x: origW, y: 0 },
            { x: origW, y: origH },
            { x: 0, y: origH }
        ];

        const minX = Math.min(...corners.map((c: any) => c.x));
        const maxX = Math.max(...corners.map((c: any) => c.x));
        const minY = Math.min(...corners.map((c: any) => c.y));
        const maxY = Math.max(...corners.map((c: any) => c.y));

        const newW = Math.max(1, Math.ceil(maxX - minX));
        const newH = Math.max(1, Math.ceil(maxY - minY));

        const nc = document.createElement('canvas');
        nc.width = newW; nc.height = newH;
        const ctx = nc.getContext('2d')!;

        const srcCorners = [
            { x: 0, y: 0 },
            { x: origW, y: 0 },
            { x: origW, y: origH },
            { x: 0, y: origH }
        ];

        const H = linalg.solveHomography(corners, srcCorners, { method: 'fast' });

        if (H) {
            const a = H[0][0], b = H[0][1], c = H[0][2];
            const d = H[1][0], e = H[1][1], f = H[1][2];
            const g = H[2][0], h = H[2][1];

            const srcCtx = origCanvas.getContext('2d')!;
            const srcData = srcCtx.getImageData(0, 0, origW, origH);
            const src8 = srcData.data;

            const dstData = ctx.createImageData(newW, newH);
            const dst8 = dstData.data;

            const algo = p.interpolation || 'bilinear';
            const interpolationMap: Record<string, string> = {
                'nearest': 'nearest',
                'bilinear': 'bilinear',
                'bicubic': 'bicubic',
                'lanczos': 'lanczos3'
            };

            Lib.image.deform(
                { data: src8, width: origW, height: origH },
                { data: dst8, width: newW, height: newH },
                (x: number, y: number) => {
                    const x_warped = x + minX;
                    const y_warped = y + minY;
                    const denom = g * x_warped + h * y_warped + 1;
                    if (Math.abs(denom) < 0.0001) {
                        return { u: -999999, v: -999999 };
                    }
                    const x_src = (a * x_warped + b * y_warped + c) / denom;
                    const y_src = (d * x_warped + e * y_warped + f) / denom;
                    return { u: x_src, v: y_src };
                }, {
                    interpolation: (interpolationMap[algo] || 'bilinear') as any,
                    boundary: 'constant',
                    antialiasing: !!p.antialiasing
                }
            );

            ctx.putImageData(dstData, 0, 0);
        }

        l.canvas = nc;
        l.width = newW; l.height = newH;
        l.ctx = nc.getContext('2d')!;

        l.x = origX + minX;
        l.y = origY + minY;
    },

    renderUI(root: HTMLElement, l: Layer, hooks: any) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = l.canvas.width;
        origCanvas.height = l.canvas.height;
        origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);

        const p = {
            corners: [
                { x: 0, y: 0 },
                { x: l.width, y: 0 },
                { x: l.width, y: l.height },
                { x: 0, y: l.height }
            ],
            origW: l.width,
            origH: l.height,
            origX: l.x,
            origY: l.y,
            origCanvas: origCanvas,
            interpolation: 'bilinear',
            antialiasing: false
        };

        const canvasContainer = UI.createNode('div', {
            style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 0 15px 0',
                padding: '10px',
                background: '#1a1a1a',
                borderRadius: '6px',
                border: '1px solid #333'
            }
        });

        const intCanvas = UI.createNode('canvas', {
            width: 240,
            height: 240,
            style: {
                background: '#111',
                borderRadius: '4px',
                cursor: 'default',
                boxShadow: 'inset 0 0 8px rgba(0,0,0,0.8)'
            }
        }) as HTMLCanvasElement;

        canvasContainer.appendChild(intCanvas);
        root.appendChild(canvasContainer);

        const update = () => {
            hooks.preview(p);
            drawInteractive();
        };

        const labels = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];
        const inputs: { x: HTMLInputElement; y: HTMLInputElement }[] = [];

        const cornerRows = labels.map((label, idx) => {
            const xInp = UI.createInput('number', { value: Math.round(p.corners[idx].x) }, (t: HTMLInputElement) => {
                p.corners[idx].x = parseFloat(t.value) || 0;
                update();
            });
            const yInp = UI.createInput('number', { value: Math.round(p.corners[idx].y) }, (t: HTMLInputElement) => {
                p.corners[idx].y = parseFloat(t.value) || 0;
                update();
            });

            inputs.push({ x: xInp, y: yInp });

            return UI.createNode('div', { style: 'display:flex; flex-direction:column; gap:4px;' },
                UI.createNode('label', { style: 'font-size:11px; color:#aaa; font-weight:bold;' }, label),
                UI.createNode('div', { style: 'display:flex; gap:4px; align-items:center;' },
                    UI.createNode('span', { style: 'font-size:11px; color:#666;' }, 'X:'), xInp,
                    UI.createNode('span', { style: 'font-size:11px; color:#666;' }, 'Y:'), yInp
                )
            );
        });

        root.appendChild(UI.createGrid(2, cornerRows, { style: { marginBottom: '15px' } }));

        let dragStartCorners: { x: number; y: number }[] | null = null;
        const rotateRow = UI.createAngleRow({
            label: 'Rotate', min: -180, max: 180, value: 0,
            onInput: (v: number) => {
                if (!dragStartCorners) {
                    dragStartCorners = p.corners.map(c => ({ x: c.x, y: c.y }));
                }
                const cx = dragStartCorners.reduce((sum, pt) => sum + pt.x, 0) / 4;
                const cy = dragStartCorners.reduce((sum, pt) => sum + pt.y, 0) / 4;
                const rad = v * Math.PI / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                p.corners.forEach((c, idx) => {
                    const oc = dragStartCorners![idx];
                    c.x = Math.round(cx + (oc.x - cx) * cos - (oc.y - cy) * sin);
                    c.y = Math.round(cy + (oc.x - cx) * sin + (oc.y - cy) * cos);
                    inputs[idx].x.value = c.x.toString();
                    inputs[idx].y.value = c.y.toString();
                });
                update();
            },
            onChange: () => {
                dragStartCorners = null;
                const rotInp = rotateRow.querySelector('input') as HTMLInputElement;
                if (rotInp) {
                    rotInp.value = '0';
                    rotInp.dispatchEvent(new Event('input'));
                }
            }
        });
        root.appendChild(rotateRow);

        root.appendChild(UI.createSelectRow({
            label: 'Interpolation',
            options: [
                { value: 'nearest', text: 'Nearest' },
                { value: 'bilinear', text: 'Bilinear' },
                { value: 'bicubic', text: 'Bicubic' },
                { value: 'lanczos', text: 'Lanczos-3' }
            ],
            value: p.interpolation,
            onChange: (v: string) => { p.interpolation = v; update(); }
        }));

        root.appendChild(UI.createCheckbox({
            label: 'Antialiasing (Super-sampling)',
            value: p.antialiasing,
            onChange: (v: boolean) => { p.antialiasing = v; update(); }
        }));

        let showGrid = false;
        root.appendChild(UI.createCheckbox({
            label: 'Show Grid',
            value: showGrid,
            onChange: (v: boolean) => {
                showGrid = v;
                if (showGrid) {
                    App.state.customOverlay = (ctx: CanvasRenderingContext2D) => {
                        drawGridOverlay(ctx, App.state.width, App.state.height, 9, 9);
                    };
                } else {
                    App.state.customOverlay = null;
                }
                App.render();
            }
        }));

        let activeCorner: number | null = null;
        let activeEdge: number | null = null;
        let isDraggingAll = false;
        let startMouseX = 0;
        let startMouseY = 0;
        let startCorners: { x: number; y: number }[] = [];

        intCanvas.addEventListener('mousedown', (e: MouseEvent) => {
            const rect = intCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const S_view = 100 / Math.max(p.origW, p.origH);
            const cx = 120;
            const cy = 120;

            let closestIdx = -1;
            let minDist = 10;

            const viewCorners = p.corners.map(pt => ({
                x: cx + (pt.x - p.origW / 2) * S_view,
                y: cy + (pt.y - p.origH / 2) * S_view
            }));

            p.corners.forEach((pt, idx) => {
                const vx = cx + (pt.x - p.origW / 2) * S_view;
                const vy = cy + (pt.y - p.origH / 2) * S_view;
                const dist = Math.hypot(mx - vx, my - vy);
                if (dist < minDist) {
                    minDist = dist;
                    closestIdx = idx;
                }
            });

            startMouseX = e.clientX;
            startMouseY = e.clientY;
            startCorners = p.corners.map(c => ({ x: c.x, y: c.y }));

            if (closestIdx !== -1) {
                activeCorner = closestIdx;
                e.preventDefault();
                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            } else {
                let closestEdgeIdx = -1;
                let minEdgeDist = 10;
                const viewMidpoints = [
                    { x: (viewCorners[0].x + viewCorners[1].x) / 2, y: (viewCorners[0].y + viewCorners[1].y) / 2 },
                    { x: (viewCorners[1].x + viewCorners[2].x) / 2, y: (viewCorners[1].y + viewCorners[2].y) / 2 },
                    { x: (viewCorners[2].x + viewCorners[3].x) / 2, y: (viewCorners[2].y + viewCorners[3].y) / 2 },
                    { x: (viewCorners[3].x + viewCorners[0].x) / 2, y: (viewCorners[3].y + viewCorners[0].y) / 2 }
                ];
                viewMidpoints.forEach((mid, idx) => {
                    const dist = Math.hypot(mx - mid.x, my - mid.y);
                    if (dist < minEdgeDist) {
                        minEdgeDist = dist;
                        closestEdgeIdx = idx;
                    }
                });

                if (closestEdgeIdx !== -1) {
                    activeEdge = closestEdgeIdx;
                    e.preventDefault();
                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                } else if (Lib.mesh.isPointInPolygon({ x: mx, y: my }, viewCorners)) {
                    isDraggingAll = true;
                    e.preventDefault();
                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                }
            }
        });

        intCanvas.addEventListener('mousemove', (e: MouseEvent) => {
            if (activeCorner !== null || activeEdge !== null || isDraggingAll) return;
            const rect = intCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const S_view = 100 / Math.max(p.origW, p.origH);
            const cx = 120;
            const cy = 120;

            let onControlPoint = false;
            p.corners.forEach((pt) => {
                const vx = cx + (pt.x - p.origW / 2) * S_view;
                const vy = cy + (pt.y - p.origH / 2) * S_view;
                if (Math.hypot(mx - vx, my - vy) < 10) {
                    onControlPoint = true;
                }
            });

            const viewCorners = p.corners.map(pt => ({
                x: cx + (pt.x - p.origW / 2) * S_view,
                y: cy + (pt.y - p.origH / 2) * S_view
            }));

            if (!onControlPoint) {
                const viewMidpoints = [
                    { x: (viewCorners[0].x + viewCorners[1].x) / 2, y: (viewCorners[0].y + viewCorners[1].y) / 2 },
                    { x: (viewCorners[1].x + viewCorners[2].x) / 2, y: (viewCorners[1].y + viewCorners[2].y) / 2 },
                    { x: (viewCorners[2].x + viewCorners[3].x) / 2, y: (viewCorners[2].y + viewCorners[3].y) / 2 },
                    { x: (viewCorners[3].x + viewCorners[0].x) / 2, y: (viewCorners[3].y + viewCorners[0].y) / 2 }
                ];
                viewMidpoints.forEach((mid) => {
                    if (Math.hypot(mx - mid.x, my - mid.y) < 10) {
                        onControlPoint = true;
                    }
                });
            }

            if (onControlPoint) {
                intCanvas.style.cursor = 'move';
            } else {
                if (Lib.mesh.isPointInPolygon({ x: mx, y: my }, viewCorners)) {
                    intCanvas.style.cursor = 'move';
                } else {
                    intCanvas.style.cursor = 'default';
                }
            }
        });

        const onMouseMove = (e: MouseEvent) => {
            if (activeCorner === null && activeEdge === null && !isDraggingAll) return;

            const S_view = 100 / Math.max(p.origW, p.origH);
            const dx = (e.clientX - startMouseX) / S_view;
            const dy = (e.clientY - startMouseY) / S_view;

            if (activeCorner !== null) {
                p.corners[activeCorner].x = Math.round(startCorners[activeCorner].x + dx);
                p.corners[activeCorner].y = Math.round(startCorners[activeCorner].y + dy);

                inputs[activeCorner].x.value = p.corners[activeCorner].x.toString();
                inputs[activeCorner].y.value = p.corners[activeCorner].y.toString();
            } else if (activeEdge !== null) {
                const idx1 = activeEdge;
                const idx2 = (activeEdge + 1) % 4;

                p.corners[idx1].x = Math.round(startCorners[idx1].x + dx);
                p.corners[idx1].y = Math.round(startCorners[idx1].y + dy);
                p.corners[idx2].x = Math.round(startCorners[idx2].x + dx);
                p.corners[idx2].y = Math.round(startCorners[idx2].y + dy);

                inputs[idx1].x.value = p.corners[idx1].x.toString();
                inputs[idx1].y.value = p.corners[idx1].y.toString();
                inputs[idx2].x.value = p.corners[idx2].x.toString();
                inputs[idx2].y.value = p.corners[idx2].y.toString();
            } else if (isDraggingAll) {
                p.corners.forEach((c, idx) => {
                    c.x = Math.round(startCorners[idx].x + dx);
                    c.y = Math.round(startCorners[idx].y + dy);
                    inputs[idx].x.value = c.x.toString();
                    inputs[idx].y.value = c.y.toString();
                });
            }

            update();
        };

        const onMouseUp = () => {
            activeCorner = null;
            activeEdge = null;
            isDraggingAll = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        const drawInteractive = () => {
            const viewW = intCanvas.width;
            const viewH = intCanvas.height;
            const ctx = intCanvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, viewW, viewH);

            ctx.strokeStyle = '#222';
            ctx.lineWidth = 1;
            for (let i = 20; i < viewW; i += 20) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, viewH); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(viewW, i); ctx.stroke();
            }

            const S_view = 100 / Math.max(p.origW, p.origH);
            const cx = 120;
            const cy = 120;

            const viewCorners = p.corners.map(pt => ({
                x: cx + (pt.x - p.origW / 2) * S_view,
                y: cy + (pt.y - p.origH / 2) * S_view
            }));

            const srcCorners = [
                { x: 0, y: 0 },
                { x: p.origW, y: 0 },
                { x: p.origW, y: p.origH },
                { x: 0, y: p.origH }
            ];

            const H = linalg.solveHomography(viewCorners, srcCorners, { method: 'fast' });

            if (H) {
                const a = H[0][0], b = H[0][1], c = H[0][2];
                const d = H[1][0], e = H[1][1], f = H[1][2];
                const g = H[2][0], h = H[2][1];
                
                const minX_v = Math.max(0, Math.floor(Math.min(...viewCorners.map(pt => pt.x))));
                const maxX_v = Math.min(viewW - 1, Math.ceil(Math.max(...viewCorners.map(pt => pt.x))));
                const minY_v = Math.max(0, Math.floor(Math.min(...viewCorners.map(pt => pt.y))));
                const maxY_v = Math.min(viewH - 1, Math.ceil(Math.max(...viewCorners.map(pt => pt.y))));

                const srcCtx = origCanvas.getContext('2d')!;
                const srcData = srcCtx.getImageData(0, 0, p.origW, p.origH);
                const src8 = srcData.data;

                const dstData = ctx.createImageData(viewW, viewH);
                const dst8 = dstData.data;

                for (let v = minY_v; v <= maxY_v; v++) {
                    for (let u = minX_v; u <= maxX_v; u++) {
                        const denom = g * u + h * v + 1;
                        if (Math.abs(denom) < 0.0001) continue;

                        const x_src = (a * u + b * v + c) / denom;
                        const y_src = (d * u + e * v + f) / denom;

                        if (x_src >= 0 && x_src < p.origW && y_src >= 0 && y_src < p.origH) {
                            const sx = Math.round(x_src);
                            const sy = Math.round(y_src);
                            if (sx >= 0 && sx < p.origW && sy >= 0 && sy < p.origH) {
                                const srcIdx = (sy * p.origW + sx) * 4;
                                const dstIdx = (v * viewW + u) * 4;
                                dst8[dstIdx] = src8[srcIdx];
                                dst8[dstIdx+1] = src8[srcIdx+1];
                                dst8[dstIdx+2] = src8[srcIdx+2];
                                dst8[dstIdx+3] = src8[srcIdx+3] * 0.7;
                            }
                        }
                    }
                }
                ctx.putImageData(dstData, 0, 0);
            }

            ctx.beginPath();
            ctx.moveTo(viewCorners[0].x, viewCorners[0].y);
            for (let i = 1; i < 4; i++) ctx.lineTo(viewCorners[i].x, viewCorners[i].y);
            ctx.closePath();
            ctx.strokeStyle = '#00ffcc';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            const colors = ['#ff3366', '#33ccff', '#ffaa00', '#cc33ff'];
            viewCorners.forEach((pt, idx) => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 6, 0, 2 * Math.PI);
                ctx.fillStyle = colors[idx];
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.fill();
                ctx.stroke();
            });

            const viewMidpoints = [
                { x: (viewCorners[0].x + viewCorners[1].x) / 2, y: (viewCorners[0].y + viewCorners[1].y) / 2 },
                { x: (viewCorners[1].x + viewCorners[2].x) / 2, y: (viewCorners[1].y + viewCorners[2].y) / 2 },
                { x: (viewCorners[2].x + viewCorners[3].x) / 2, y: (viewCorners[2].y + viewCorners[3].y) / 2 },
                { x: (viewCorners[3].x + viewCorners[0].x) / 2, y: (viewCorners[3].y + viewCorners[0].y) / 2 }
            ];
            
            const edgeColors = ['#ff88a3', '#88e3ff', '#ffd280', '#e599ff'];
            viewMidpoints.forEach((pt, idx) => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 5, 0, 2 * Math.PI);
                ctx.fillStyle = edgeColors[idx];
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.fill();
                ctx.stroke();
            });
        };

        update();
    }
});


function drawGridOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, cols: number = 3, rows: number = 3) {
    ctx.save();
    ctx.lineWidth = 1;
    // Draw horizontal lines
    for (let i = 1; i < rows; i++) {
        const y = Math.round((height / rows) * i);
        
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.moveTo(0, y + 1);
        ctx.lineTo(width, y + 1);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    // Draw vertical lines
    for (let j = 1; j < cols; j++) {
        const x = Math.round((width / cols) * j);
        
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.moveTo(x + 1, 0);
        ctx.lineTo(x + 1, height);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    ctx.restore();
}
