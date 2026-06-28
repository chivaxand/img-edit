import { App, AppActions } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters } from '~/filters';

Filters.register('skew-rotate', {
    name: 'Skew / Rotate',
    mode: 'pixel',
    menu: {
        path: 'Transform',
        label: 'Skew / Rotate...',
        order: 2
    },

    apply(l: Layer, p: any) {
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
        
        ctx.imageSmoothingEnabled = p.smooth;
        ctx.imageSmoothingQuality = p.smooth ? 'high' : 'low';

        ctx.save();
        ctx.translate(-minX, -minY); // Shift to visible area
        ctx.translate(origW/2, origH/2);
        ctx.rotate(rad(p.rotate));
        ctx.transform(1, tanY, tanX, 1, 0, 0);
        ctx.scale(scaleX, scaleY);
        ctx.translate(-origW/2, -origH/2);
        ctx.drawImage(origCanvas, 0, 0);
        ctx.restore();

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
            smooth: true
        };

        const update = () => hooks.preview(p);

        const wInp = UI.createInput('number', { value: p.w }, (t: HTMLInputElement) => {
            p.w = parseFloat(t.value) || 0;
            if (p.scaleLock) { 
                p.h = Math.round(p.w * (p.origH / p.origW)); 
                (hInp as HTMLInputElement).value = p.h.toString(); 
            }
            update();
        });

        const hInp = UI.createInput('number', { value: p.h }, (t: HTMLInputElement) => {
            p.h = parseFloat(t.value) || 0;
            if (p.scaleLock) { 
                p.w = Math.round(p.h * (p.origW / p.origH)); 
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

        update();
    }
});

Filters.register('flip-rotate', {
    name: 'Flip / Rotate',
    mode: 'pixel',
    menu: {
        path: 'Transform',
        label: 'Flip / Rotate...',
        order: 3
    },

    apply(l: Layer, state: any) {
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