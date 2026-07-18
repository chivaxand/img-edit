import { App, AppActions } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters, FilterContext } from '~/filters';
import { Lib } from '~/libs/index';

Filters.register('skew-rotate', {
    name: 'Skew / Rotate',
    mode: 'unified',
    menu: {
        path: 'Transform',
        label: 'Skew / Rotate...',
        order: 2
    },

    apply(context: FilterContext) {
        const l = context.layer;
        const p = context.values;
        const origW = p.origW !== undefined ? p.origW : l.width;
        const origH = p.origH !== undefined ? p.origH : l.height;
        const origX = p.origX !== undefined ? p.origX : l.x;
        const origY = p.origY !== undefined ? p.origY : l.y;

        // Automatically resolve or fallback to cloned layer canvas if programmatic macro execution
        let origCanvas = p.origCanvas;
        if (!origCanvas || !(origCanvas instanceof HTMLCanvasElement)) {
            origCanvas = document.createElement('canvas');
            origCanvas.width = l.canvas.width;
            origCanvas.height = l.canvas.height;
            origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);
        }

        const scaleX = p.w / origW;
        const scaleY = p.h / origH;
        const rad = (d: number) => d * Math.PI / 180;
        const tanX = Math.tan(rad(p.skewX));
        const tanY = Math.tan(rad(p.skewY));

        // Calculate new bounding box using DOMMatrix
        const m = new DOMMatrix()
            .translate(origW/2, origH/2) // Pivot center
            .rotate(p.rotate)
            .multiply(new DOMMatrix([1, tanY, tanX, 1, 0, 0]))
            .scale(scaleX, scaleY)
            .translate(-origW/2, -origH/2);

        const corners = [{x:0,y:0}, {x:origW,y:0}, {x:0,y:origH}, {x:origW,y:origH}]
            .map(pt => new DOMPoint(pt.x, pt.y).matrixTransform(m));
        const minX = Math.min(...corners.map(c => c.x));
        const maxX = Math.max(...corners.map(c => c.x));
        const minY = Math.min(...corners.map(c => c.y));
        const maxY = Math.max(...corners.map(c => c.y));
        const newW = Math.max(1, Math.ceil(maxX - minX));
        const newH = Math.max(1, Math.ceil(maxY - minY));

        const nc = document.createElement('canvas');
        nc.width = newW; nc.height = newH;
        const ctx = nc.getContext('2d')!;
        
        const algo = p.interpolation || (p.smooth ? 'bilinear' : 'nearest');

        if (algo === 'bicubic' || algo === 'lanczos') {
            const srcCtx = origCanvas.getContext('2d')!;
            const srcData = srcCtx.getImageData(0, 0, origW, origH);
            const src8 = srcData.data;

            const dstData = ctx.createImageData(newW, newH);
            const dst8 = dstData.data;

            const r_rad = rad(p.rotate);
            const cos = Math.cos(r_rad);
            const sin = Math.sin(r_rad);
            const D = 1 - tanX * tanY;

            const cx_src = origW / 2;
            const cy_src = origH / 2;

            const antialiasing = !!p.antialiasing;

            Lib.image.deform(
                { data: src8, width: origW, height: origH },
                { data: dst8, width: newW, height: newH },
                (u: number, v: number) => {
                    const y0 = (v + minY) - cy_src;
                    const x0 = (u + minX) - cx_src;

                    const x1 = x0 * cos + y0 * sin;
                    const y1 = -x0 * sin + y0 * cos;

                    let x2 = x1;
                    let y2 = y1;
                    if (Math.abs(D) > 0.0001) {
                        x2 = (x1 - y1 * tanX) / D;
                        y2 = (-x1 * tanY + y1) / D;
                    }

                    const x3 = x2 / scaleX;
                    const y3 = y2 / scaleY;

                    return {
                        u: x3 + cx_src,
                        v: y3 + cy_src
                    };
                }, {
                    interpolation: algo === 'lanczos' ? 'lanczos3' : 'bicubic',
                    boundary: 'constant',
                    antialiasing
                }
            );

            ctx.putImageData(dstData, 0, 0);
        } else {
            ctx.imageSmoothingEnabled = algo === 'bilinear';
            ctx.imageSmoothingQuality = algo === 'bilinear' ? 'high' : 'low';

            ctx.save();
            ctx.translate(-minX, -minY); // Shift to visible area
            ctx.translate(origW/2, origH/2);
            ctx.rotate(rad(p.rotate));
            ctx.transform(1, tanY, tanX, 1, 0, 0);
            ctx.scale(scaleX, scaleY);
            ctx.translate(-origW/2, -origH/2);
            ctx.drawImage(origCanvas, 0, 0);
            ctx.restore();
        }

        // Apply to layer
        l.canvas = nc;
        l.width = newW; l.height = newH;
        l.ctx = nc.getContext('2d')!;
        
        // Adjust position to keep center in place
        const cx = origX + origW/2;
        const cy = origY + origH/2;
        l.x = cx - newW/2;
        l.y = cy - newH/2;
    },

    renderUI(root: HTMLElement, l: Layer, hooks: any) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = l.canvas.width;
        origCanvas.height = l.canvas.height;
        origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);

        const p = {
            w: l.canvas.width,
            h: l.canvas.height,
            origW: l.canvas.width,
            origH: l.canvas.height,
            origX: l.x,
            origY: l.y,
            origCanvas: origCanvas,
            scaleLock: true,
            rotate: 0,
            skewX: 0,
            skewY: 0,
            smooth: true,
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

        const matrixContainer = UI.createNode('div', {
            style: {
                marginTop: '8px',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: '#aaa',
                textAlign: 'center',
                background: '#222',
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #444',
                display: 'inline-block',
                width: '180px'
            }
        });
        canvasContainer.appendChild(matrixContainer);

        root.appendChild(canvasContainer);

        const update = () => {
            hooks.preview(p);
            drawInteractive();
            updateMatrixDisplay();
        };

        const wInp = UI.createInput('number', { value: p.w }, (t: HTMLInputElement) => {
            p.w = parseFloat(t.value) || 0;
            if (p.scaleLock) { 
                p.h = Math.round(p.w * (p.origH / p.origW)); 
                hInp.value = p.h.toString(); 
            }
            update();
        });

        const hInp = UI.createInput('number', { value: p.h }, (t: HTMLInputElement) => {
            p.h = parseFloat(t.value) || 0;
            if (p.scaleLock) { 
                p.w = Math.round(p.h * (p.origW / p.origH)); 
                wInp.value = p.w.toString(); 
            }
            update();
        });
        
        const linkCheck = UI.createCheckbox({
            label: 'Link', value: p.scaleLock,
            onChange: (v: boolean) => { p.scaleLock = v; update(); }
        });

        root.appendChild(UI.createRow('Size', UI.createStack('horizontal', [
            wInp, UI.createNode('span', { style: 'margin: 0 4px;' }, 'x'), hInp, linkCheck
        ], { style: { gap: '5px', marginBottom: '0' } })));

        const rotRow = UI.createAngleRow({
            label: 'Rotate (°)', min: -180, max: 180, value: 0,
            onInput: (v: number) => { p.rotate = v; update(); }
        });
        const rotInp = rotRow.querySelector('input') as HTMLInputElement;
        root.appendChild(rotRow);

        const skewXRow = UI.createSliderRow({ label: 'Skew X (°)', min: -89, max: 89, value: 0, onInput: (v: string) => { p.skewX = parseFloat(v); update(); } });
        const skewXInp = skewXRow.querySelector('input') as HTMLInputElement;
        root.appendChild(skewXRow);

        const skewYRow = UI.createSliderRow({ label: 'Skew Y (°)', min: -89, max: 89, value: 0, onInput: (v: string) => { p.skewY = parseFloat(v); update(); } });
        const skewYInp = skewYRow.querySelector('input') as HTMLInputElement;
        root.appendChild(skewYRow);

        root.appendChild(UI.createSelectRow({
            label: 'Interpolation',
            options: [
                { value: 'bilinear', text: 'Bilinear' },
                { value: 'bicubic', text: 'Bicubic' },
                { value: 'lanczos', text: 'Lanczos-3' },
                { value: 'nearest', text: 'Nearest' }
            ],
            value: p.interpolation,
            onChange: (v: string) => { p.interpolation = v; p.smooth = v === 'bilinear'; update(); }
        }));

        root.appendChild(UI.createCheckbox({
            label: 'Antialiasing (Super-sampling)',
            value: p.antialiasing,
            onChange: (v: boolean) => { p.antialiasing = v; update(); }
        }));

        let activeHandle: 'right' | 'top' | 'rotate' | null = null;
        let startMouseAngle = 0;
        let startRotate = 0;

        const getHandleCoords = () => {
            const S_view = 100 / Math.max(p.origW, p.origH);
            const cx = 120;
            const cy = 120;

            const rad = (d: number) => d * Math.PI / 180;
            const r = rad(p.rotate);
            const cos = Math.cos(r);
            const sin = Math.sin(r);
            const tanX = Math.tan(rad(p.skewX));
            const tanY = Math.tan(rad(p.skewY));

            const scaleX = p.w / p.origW;
            const scaleY = p.h / p.origH;

            // Right handle: local (origW/2, 0)
            const rx_s = (p.origW / 2) * scaleX;
            const ry_s = 0;
            const rx_k = rx_s + ry_s * tanX;
            const ry_k = rx_s * tanY + ry_s;
            const rx_r = rx_k * cos - ry_k * sin;
            const ry_r = rx_k * sin + ry_k * cos;
            const rightPt = { x: cx + rx_r * S_view, y: cy + ry_r * S_view };

            // Top handle: local (0, -origH/2)
            const tx_s = 0;
            const ty_s = (-p.origH / 2) * scaleY;
            const tx_k = tx_s + ty_s * tanX;
            const ty_k = tx_s * tanY + ty_s;
            const tx_r = tx_k * cos - ty_k * sin;
            const ty_r = tx_k * sin + ty_k * cos;
            const topPt = { x: cx + tx_r * S_view, y: cy + ty_r * S_view };

            // Rotate handle: placed at angle theta + 135 degrees, radius 35 on view canvas
            const rotAng = r + 135 * Math.PI / 180;
            const rotatePt = { x: cx + Math.cos(rotAng) * 35, y: cy + Math.sin(rotAng) * 35 };

            return { rightPt, topPt, rotatePt, cx, cy, S_view };
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!activeHandle) return;
            const rect = intCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const { cx, cy, S_view } = getHandleCoords();

            if (activeHandle === 'rotate') {
                const currentMouseAngle = Math.atan2(my - cy, mx - cx);
                let deltaAngle = (currentMouseAngle - startMouseAngle) * 180 / Math.PI;
                let newRot = startRotate + deltaAngle;
                newRot = ((newRot + 180) % 360 + 360) % 360 - 180;
                const rotVal = Math.round(newRot * 10) / 10;
                rotInp.value = rotVal.toString();
                rotInp.dispatchEvent(new Event('input'));
            } else {
                const x_r = (mx - cx) / S_view;
                const y_r = (my - cy) / S_view;

                const rad = (d: number) => d * Math.PI / 180;
                const r = rad(-p.rotate);
                const cos = Math.cos(r);
                const sin = Math.sin(r);

                const x_k = x_r * cos - y_r * sin;
                const y_k = x_r * sin + y_r * cos;

                if (activeHandle === 'right') {
                    const wNew = Math.max(1, Math.round(x_k * 2));
                    wInp.value = wNew.toString();
                    wInp.dispatchEvent(new Event('input'));

                    if (Math.abs(x_k) > 0.01) {
                        const skewYRad = Math.atan(y_k / x_k);
                        let skewYVal = Math.round((skewYRad * 180 / Math.PI) * 10) / 10;
                        skewYVal = Math.max(-89, Math.min(89, skewYVal));
                        skewYInp.value = skewYVal.toString();
                        skewYInp.dispatchEvent(new Event('input'));
                    }
                } else if (activeHandle === 'top') {
                    const hNew = Math.max(1, Math.round(-y_k * 2));
                    hInp.value = hNew.toString();
                    hInp.dispatchEvent(new Event('input'));

                    if (Math.abs(y_k) > 0.01) {
                        const skewXRad = Math.atan(x_k / y_k);
                        let skewXVal = Math.round((skewXRad * 180 / Math.PI) * 10) / 10;
                        skewXVal = Math.max(-89, Math.min(89, skewXVal));
                        skewXInp.value = skewXVal.toString();
                        skewXInp.dispatchEvent(new Event('input'));
                    }
                }
            }
        };

        const onMouseUp = () => {
            activeHandle = null;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        intCanvas.addEventListener('mousedown', (e: MouseEvent) => {
            const rect = intCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const { rightPt, topPt, rotatePt, cx, cy } = getHandleCoords();

            const dist = (p1: {x:number, y:number}, x: number, y: number) => {
                return Math.sqrt((p1.x - x)**2 + (p1.y - y)**2);
            };

            if (dist(rightPt, mx, my) < 8) {
                activeHandle = 'right';
            } else if (dist(topPt, mx, my) < 8) {
                activeHandle = 'top';
            } else if (dist(rotatePt, mx, my) < 8) {
                activeHandle = 'rotate';
                startMouseAngle = Math.atan2(my - cy, mx - cx);
                startRotate = p.rotate;
            } else {
                activeHandle = null;
            }

            if (activeHandle) {
                e.preventDefault();
                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            }
        });

        const drawInteractive = () => {
            const ctx = intCanvas.getContext('2d');
            if (!ctx) return;

            const W = intCanvas.width;
            const H = intCanvas.height;
            ctx.clearRect(0, 0, W, H);

            ctx.strokeStyle = '#222';
            ctx.lineWidth = 1;
            for (let i = 20; i < W; i += 20) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i, H);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(W, i);
                ctx.stroke();
            }

            const { rightPt, topPt, rotatePt, cx, cy, S_view } = getHandleCoords();

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(p.rotate * Math.PI / 180);
            
            const tanX = Math.tan(p.skewX * Math.PI / 180);
            const tanY = Math.tan(p.skewY * Math.PI / 180);
            ctx.transform(1, tanY, tanX, 1, 0, 0);

            const scaleX = p.w / p.origW;
            const scaleY = p.h / p.origH;
            ctx.scale(scaleX * S_view, scaleY * S_view);

            ctx.globalAlpha = 0.6;
            ctx.drawImage(origCanvas, -p.origW / 2, -p.origH / 2);
            ctx.restore();

            const corners = [
                { x: -p.origW/2, y: -p.origH/2 },
                { x: p.origW/2, y: -p.origH/2 },
                { x: p.origW/2, y: p.origH/2 },
                { x: -p.origW/2, y: p.origH/2 }
            ].map(pt => {
                const rad = (d: number) => d * Math.PI / 180;
                const r = rad(p.rotate);
                const cos = Math.cos(r);
                const sin = Math.sin(r);
                const tX = Math.tan(rad(p.skewX));
                const tY = Math.tan(rad(p.skewY));
                const sX = p.w / p.origW;
                const sY = p.h / p.origH;

                const xs = pt.x * sX;
                const ys = pt.y * sY;
                const xk = xs + ys * tX;
                const yk = xs * tY + ys;
                const xr = xk * cos - yk * sin;
                const yr = xk * sin + yk * cos;

                return { x: cx + xr * S_view, y: cy + yr * S_view };
            });

            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            corners.forEach(c => ctx.lineTo(c.x, c.y));
            ctx.closePath();
            ctx.strokeStyle = '#00ffcc';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(rightPt.x, rightPt.y);
            ctx.strokeStyle = '#ff3366';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(topPt.x, topPt.y);
            ctx.strokeStyle = '#33ccff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, 35, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(rightPt.x, rightPt.y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = '#ff3366';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(topPt.x, topPt.y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = '#33ccff';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(rotatePt.x, rotatePt.y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffaa00';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
        };

        const updateMatrixDisplay = () => {
            const rad = (d: number) => d * Math.PI / 180;
            const r = rad(p.rotate);
            const cos = Math.cos(r);
            const sin = Math.sin(r);
            const tanX = Math.tan(rad(p.skewX));
            const tanY = Math.tan(rad(p.skewY));
            const sx = p.w / p.origW;
            const sy = p.h / p.origH;

            const a = sx * (cos - tanY * sin);
            const b = sx * (sin + tanY * cos);
            const c = sy * (tanX * cos - sin);
            const d = sy * (tanX * sin + cos);

            matrixContainer.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 4px; color: #00ffcc;">Transformation Matrix</div>
                <div style="display: grid; grid-template-columns: repeat(2, 60px); gap: 4px; justify-content: center; font-size: 12px;">
                    <div style="border-right: 1px solid #444; padding-right: 4px;">${a.toFixed(3)}</div>
                    <div>${c.toFixed(3)}</div>
                    <div style="border-right: 1px solid #444; padding-right: 4px;">${b.toFixed(3)}</div>
                    <div>${d.toFixed(3)}</div>
                </div>
            `;
        };

        update();
    }
});

Filters.register('flip-rotate', {
    name: 'Flip / Rotate',
    mode: 'unified',
    menu: {
        path: 'Transform',
        label: 'Flip / Rotate...',
        order: 3
    },

    apply(context: FilterContext) {
        const l = context.layer;
        const state = context.values;
        const origW = state.origW !== undefined ? state.origW : l.width;
        const origH = state.origH !== undefined ? state.origH : l.height;
        const origX = state.origX !== undefined ? state.origX : l.x;
        const origY = state.origY !== undefined ? state.origY : l.y;

        // Automatically resolve or fallback to cloned layer canvas if programmatic macro execution
        let origCanvas = state.origCanvas;
        if (!origCanvas || !(origCanvas instanceof HTMLCanvasElement)) {
            origCanvas = document.createElement('canvas');
            origCanvas.width = l.canvas.width;
            origCanvas.height = l.canvas.height;
            origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);
        }

        const isVertical = Math.abs(state.rotate) === 90;
        const newW = isVertical ? origH : origW;
        const newH = isVertical ? origW : origH;

        const nc = document.createElement('canvas');
        nc.width = newW; nc.height = newH;
        const ctx = nc.getContext('2d')!;
        
        ctx.save();
        ctx.translate(newW / 2, newH / 2);
        ctx.rotate(state.rotate * Math.PI / 180);
        ctx.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
        ctx.drawImage(origCanvas, -origW / 2, -origH / 2);
        ctx.restore();

        l.canvas = nc;
        l.width = newW; 
        l.height = newH;
        l.ctx = nc.getContext('2d')!;
        
        // Maintain center point
        const cx = origX + origW/2;
        const cy = origY + origH/2;
        l.x = cx - newW/2;
        l.y = cy - newH/2;
    },
    
    renderUI(root: HTMLElement, l: Layer, hooks: any) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = l.canvas.width;
        origCanvas.height = l.canvas.height;
        origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);

        const state = {
            flipX: false,
            flipY: false,
            rotate: 0, // 0, 90, 180, -90
            origW: l.width,
            origH: l.height,
            origX: l.x,
            origY: l.y,
            origCanvas: origCanvas
        };

        const update = () => hooks.preview(state);

        root.appendChild(UI.createStack('horizontal', [
            UI.createCheckbox({ label: 'Flip Horizontal (X)', value: state.flipX, onChange: (v: boolean) => { state.flipX = v; update(); } }),
            UI.createCheckbox({ label: 'Flip Vertical (Y)', value: state.flipY, onChange: (v: boolean) => { state.flipY = v; update(); } })
        ], { style: { gap: '15px', marginBottom: '10px' } }));

        root.appendChild(UI.createSelectRow({
            label: 'Rotate',
            options: [
                { value: 0, text: '0°' },
                { value: 90, text: '+90° (CW)' },
                { value: -90, text: '-90° (CCW)' },
                { value: 180, text: '180°' }
            ],
            value: 0,
            onChange: (v: string) => { state.rotate = parseInt(v); update(); }
        }));

        update();
    }
});

export const transformActions: Pick<AppActions, 'openTransformDialog' | 'openFlipRotateDialog'> = {
    openTransformDialog() {
        const l = App.utils.getActive();
        if (!l) return alert('No active layer selected.');
        Filters.run('skew-rotate');
    },

    openFlipRotateDialog() {
        const l = App.utils.getActive();
        if (!l) return alert('No active layer selected.');
        Filters.run('flip-rotate');
    }
};
