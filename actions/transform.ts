import { App, AppActions } from '../app';
import { UI } from '../ui';
import { Layer } from '../layers';

export const transformActions: Pick<AppActions, 'openTransformDialog' | 'openFlipRotateDialog'> = {
    openTransformDialog() {
        const l = App.utils.getActive();
        if (!l) return alert('No active layer selected.');

        // Save original state for preview restoration
        const origState = {
            canvas: l.canvas,
            x: l.x, y: l.y,
            w: l.width, h: l.height
        };
        const origW = l.canvas.width;
        const origH = l.canvas.height;

        // Params
        const p = { w: origW, h: origH, scaleLock: true, rotate: 0, skewX: 0, skewY: 0, smooth: true };

        const update = () => {
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
            
            ctx.imageSmoothingEnabled = p.smooth;
            ctx.imageSmoothingQuality = p.smooth ? 'high' : 'low';

            ctx.save();
            ctx.translate(-minX, -minY); // Shift to visible area
            ctx.translate(origW/2, origH/2);
            ctx.rotate(rad(p.rotate));
            ctx.transform(1, tanY, tanX, 1, 0, 0);
            ctx.scale(scaleX, scaleY);
            ctx.translate(-origW/2, -origH/2);
            ctx.drawImage(origState.canvas, 0, 0);
            ctx.restore();

            // Apply to layer for preview
            l.canvas = nc;
            l.width = newW; l.height = newH;
            // Adjust position to keep center in place
            const cx = origState.x + origState.w/2;
            const cy = origState.y + origState.h/2;
            l.x = cx - newW/2;
            l.y = cy - newH/2;

            App.render();
        };

        const html = `
            <h3>Skew / Rotate</h3>
            <div id="tr-root"></div>
            <div style="margin-top:15px; display:flex; justify-content:flex-end; gap:10px;">
                <button class="cancel-btn" id="btn-cancel">Cancel</button>
                <button id="btn-apply">Apply</button>
            </div>
        `;
        App.popup!.setHtml(html);
        const root = App.popup!.getById('tr-root')!;

        const wInp = UI.createInput('number', { value: p.w }, (t: HTMLInputElement) => {
            p.w = parseFloat(t.value) || 0;
            if (p.scaleLock) { 
                p.h = Math.round(p.w * (origH / origW)); 
                (hInp as HTMLInputElement).value = p.h.toString(); 
            }
            update();
        });

        const hInp = UI.createInput('number', { value: p.h }, (t: HTMLInputElement) => {
            p.h = parseFloat(t.value) || 0;
            if (p.scaleLock) { 
                p.w = Math.round(p.h * (origW / origH)); 
                (wInp as HTMLInputElement).value = p.w.toString(); 
            }
            update();
        });
        
        const linkCheck = UI.createInput('checkbox', { checked: true }, (t: HTMLInputElement) => { p.scaleLock = t.checked; update(); });

        const sizeControls = UI.createNode('div', { style: { display: 'flex', gap: '5px', alignItems: 'center' } },
            wInp, UI.createNode('span', {}, 'x'), hInp,
            UI.createNode('label', { style: { margin: '0 0 0 5px', display: 'flex', alignItems: 'center' } }, linkCheck, 'Link')
        );
        root.appendChild(UI.createRow('Size', sizeControls));

        root.appendChild(UI.createSliderRow({ label: 'Rotate (°)', min: -180, max: 180, value: 0, onInput: (v: string) => { p.rotate = parseFloat(v); update(); } }));
        root.appendChild(UI.createSliderRow({ label: 'Skew X (°)', min: -89, max: 89, value: 0, onInput: (v: string) => { p.skewX = parseFloat(v); update(); } }));
        root.appendChild(UI.createSliderRow({ label: 'Skew Y (°)', min: -89, max: 89, value: 0, onInput: (v: string) => { p.skewY = parseFloat(v); update(); } }));

        root.appendChild(UI.createSelectRow({
            label: 'Interpolation',
            options: [
                { value: '1', text: 'Bilinear (Smooth)' },
                { value: '0', text: 'Nearest (Pixelated)' }
            ],
            value: '1',
            onChange: (v: string) => { p.smooth = v === '1'; update(); }
        }));

        App.popup!.onClick('btn-cancel', () => {
            l.canvas = origState.canvas;
            l.x = origState.x; l.y = origState.y;
            l.width = origState.w; l.height = origState.h;
            App.render();
            App.popup!.close();
        });

        App.popup!.onClick('btn-apply', () => {
            // Restore original state temporarily so history saves the "Before" state correctly
            const finalState = { canvas: l.canvas, x: l.x, y: l.y, w: l.width, h: l.height };
            l.canvas = origState.canvas;
            l.x = origState.x; l.y = origState.y;
            l.width = origState.w; l.height = origState.h;

            App.actions.saveState();

            // Reapply transformed state
            l.canvas = finalState.canvas;
            l.x = finalState.x; l.y = finalState.y;
            l.width = finalState.w; l.height = finalState.h;

            if (App.actions.deselect) App.actions.deselect();
            l.ctx = l.canvas.getContext('2d')!;
            App.ui.refreshLayers(); 
            App.ui.updateProps();
            App.popup!.close();
        });

        App.popup!.show();
    },

    openFlipRotateDialog() {
        const l = App.utils.getActive();
        if (!l) return alert('No active layer selected.');

        const origState = {
            canvas: l.canvas,
            x: l.x, y: l.y,
            w: l.width, h: l.height
        };

        const state = {
            flipX: false,
            flipY: false,
            rotate: 0 // 0, 90, 180, -90
        };

        const update = () => {
            const isVertical = Math.abs(state.rotate) === 90;
            const newW = isVertical ? origState.h : origState.w;
            const newH = isVertical ? origState.w : origState.h;

            const nc = document.createElement('canvas');
            nc.width = newW; nc.height = newH;
            const ctx = nc.getContext('2d')!;
            
            ctx.save();
            ctx.translate(newW / 2, newH / 2);
            ctx.rotate(state.rotate * Math.PI / 180);
            ctx.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
            ctx.drawImage(origState.canvas, -origState.w / 2, -origState.h / 2);
            ctx.restore();

            l.canvas = nc;
            l.width = newW; 
            l.height = newH;
            
            // Maintain center point
            const cx = origState.x + origState.w/2;
            const cy = origState.y + origState.h/2;
            l.x = cx - newW/2;
            l.y = cy - newH/2;

            App.render();
        };

        const html = `
            <h3>Flip / Rotate</h3>
            <div id="fr-root"></div>
            <div style="margin-top:15px; display:flex; justify-content:flex-end; gap:10px;">
                <button class="cancel-btn" id="btn-cancel">Cancel</button>
                <button id="btn-apply">Apply</button>
            </div>
        `;
        App.popup!.setHtml(html);
        const root = App.popup!.getById('fr-root')!;

        const chkRow = UI.createNode('div', {style:'display:flex; gap:15px; margin-bottom:10px'});
        chkRow.appendChild(UI.createCheckbox({ label: 'Flip Horizontal (X)', value: state.flipX, onChange: (v: boolean) => { state.flipX = v; update(); } }));
        chkRow.appendChild(UI.createCheckbox({ label: 'Flip Vertical (Y)', value: state.flipY, onChange: (v: boolean) => { state.flipY = v; update(); } }));
        root.appendChild(chkRow);

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

        App.popup!.onClick('btn-cancel', () => {
            l.canvas = origState.canvas;
            l.x = origState.x; l.y = origState.y;
            l.width = origState.w; l.height = origState.h;
            App.render();
            App.popup!.close();
        });

        App.popup!.onClick('btn-apply', () => {
            // Restore original first so 'Undo' works from a clean state
            const finalCanvas = l.canvas;
            const finalX = l.x, finalY = l.y, finalW = l.width, finalH = l.height;

            l.canvas = origState.canvas;
            l.x = origState.x; l.y = origState.y;
            l.width = origState.w; l.height = origState.h;

            App.actions.saveState();

            // Apply new state
            l.canvas = finalCanvas;
            l.x = finalX; l.y = finalY;
            l.width = finalW; l.height = finalH;
            l.ctx = l.canvas.getContext('2d')!;
            
            if (App.actions.deselect) App.actions.deselect();
            App.ui.refreshLayers();
            App.ui.updateProps();
            App.popup!.close();
        });

        App.popup!.show();
    }
};
