import { App, AppActions } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Filters, FilterContext } from '~/filters';

Filters.register('layer-canvas-size', {
    name: 'Layer Canvas Size',
    mode: 'unified',
    menu: {
        path: 'Layer',
        label: 'Layer Size...',
        order: 3
    },

    apply(context: FilterContext) {
        const l = context.layer;
        const state = context.values;
        const origW = state.origW !== undefined ? state.origW : l.width;
        const origH = state.origH !== undefined ? state.origH : l.height;

        // Automatically resolve or fallback to cloned layer canvas if programmatic macro execution
        let origCanvas = state.origCanvas;
        if (!origCanvas || !(origCanvas instanceof HTMLCanvasElement)) {
            origCanvas = document.createElement('canvas');
            origCanvas.width = l.canvas.width;
            origCanvas.height = l.canvas.height;
            origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);
        }

        const nw = parseInt(state.w.toString());
        const nh = parseInt(state.h.toString());

        // 1. Calculate Offset based on Anchor
        let ox = 0, oy = 0;
        const dw = nw - origW;
        const dh = nh - origH;

        // X Axis
        if ([0, 3, 6].includes(state.anchor)) ox = 0; // Left
        else if ([1, 4, 7].includes(state.anchor)) ox = dw / 2; // Center
        else ox = dw; // Right

        // Y Axis
        if ([0, 1, 2].includes(state.anchor)) oy = 0; // Top
        else if ([3, 4, 5].includes(state.anchor)) oy = dh / 2; // Middle
        else oy = dh; // Bottom

        ox = Math.round(ox);
        oy = Math.round(oy);

        // 2. Create new Canvas
        const nc = document.createElement('canvas');
        nc.width = nw; nc.height = nh;
        const ctx = nc.getContext('2d')!;

        // 3. Fill Background Logic
        if (state.fill === 'color') {
            ctx.fillStyle = state.color;
            ctx.fillRect(0, 0, nw, nh);
        } else if (state.fill === 'repeat') {
            const pattern = ctx.createPattern(origCanvas, 'repeat')!;
            ctx.fillStyle = pattern;
            ctx.save();
            ctx.translate(ox, oy);
            ctx.fillRect(-ox, -oy, nw, nh);
            ctx.restore();
        } else if (state.fill === 'clamp') {
            // Draw original stretched to fill
            // Corners
            ctx.drawImage(origCanvas, 0, 0, 1, 1, 0, 0, ox+1, oy+1); // TL
            ctx.drawImage(origCanvas, origW-1, 0, 1, 1, ox+origW-1, 0, nw-(ox+origW)+1, oy+1); // TR
            ctx.drawImage(origCanvas, 0, origH-1, 1, 1, 0, oy+origH-1, ox+1, nh-(oy+origH)+1); // BL
            ctx.drawImage(origCanvas, origW-1, origH-1, 1, 1, ox+origW-1, oy+origH-1, nw-(ox+origW)+1, nh-(oy+origH)+1); // BR
            
            // Edges
            ctx.drawImage(origCanvas, 0, 0, origW, 1, ox, 0, origW, oy); // Top
            ctx.drawImage(origCanvas, 0, origH-1, origW, 1, ox, oy+origH, origW, nh-(oy+origH)); // Bottom
            ctx.drawImage(origCanvas, 0, 0, 1, origH, 0, oy, ox, origH); // Left
            ctx.drawImage(origCanvas, origW-1, 0, 1, origH, ox+origW, oy, nw-(ox+origW), origH); // Right
        } else if (state.fill === 'reflect') {
            // Helper to draw flipped
            const drawFlip = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, scX: number, scY: number) => {
                ctx.save();
                ctx.translate(dx + (scX<0?dw:0), dy + (scY<0?dh:0));
                ctx.scale(scX, scY);
                ctx.drawImage(origCanvas, sx, sy, sw, sh, 0, 0, dw, dh);
                ctx.restore();
            };
            
            // Fill 3x3 Grid around center
            // 1 2 3
            // 4 5 6 (5 is original)
            // 7 8 9
            
            // Top
            if (oy > 0) {
                drawFlip(0, 0, origW, origH, ox, oy-origH, origW, origH, 1, -1); // 2
                if (ox > 0) drawFlip(0, 0, origW, origH, ox-origW, oy-origH, origW, origH, -1, -1); // 1
                if (ox+origW < nw) drawFlip(0, 0, origW, origH, ox+origW, oy-origH, origW, origH, -1, -1); // 3
            }
            // Bottom
            if (oy + origH < nh) {
                drawFlip(0, 0, origW, origH, ox, oy+origH, origW, origH, 1, -1); // 8
                if (ox > 0) drawFlip(0, 0, origW, origH, ox-origW, oy+origH, origW, origH, -1, -1); // 7
                if (ox+origW < nw) drawFlip(0, 0, origW, origH, ox+origW, oy+origH, origW, origH, -1, -1); // 9
            }
            // Left
            if (ox > 0) drawFlip(0, 0, origW, origH, ox-origW, oy, origW, origH, -1, 1); // 4
            // Right
            if (ox + origW < nw) drawFlip(0, 0, origW, origH, ox+origW, oy, origW, origH, -1, 1); // 6
        }

        // 4. Draw Original Image
        ctx.drawImage(origCanvas, ox, oy);

        // 5. Update Layer
        l.canvas = nc;
        l.width = nw;
        l.height = nh;
        l.ctx = ctx;
        // Shift layer position to match the visual anchor change
        l.x -= ox;
        l.y -= oy;
    },
    
    renderUI(root: HTMLElement, l: Layer, hooks: any) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = l.canvas.width;
        origCanvas.height = l.canvas.height;
        origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);

        const state = {
            w: l.width,
            h: l.height,
            anchor: 4, // 0-8, 4 is center
            fill: 'transparent', // transparent, color, repeat, reflect, clamp
            color: App.state.bg,
            constrain: true,
            origW: l.width,
            origH: l.height,
            origCanvas: origCanvas
        };
        const ratio = l.width / l.height;

        const update = () => hooks.preview(state);

        // Helper to sync inputs
        const updateInputs = (source: string) => {
            if (state.constrain) {
                if (source === 'w') {
                    state.h = Math.max(1, Math.round(state.w / ratio));
                    (hInp as HTMLInputElement).value = state.h.toString();
                } else if (source === 'h') {
                    state.w = Math.max(1, Math.round(state.h * ratio));
                    (wInp as HTMLInputElement).value = state.w.toString();
                }
            }
        };

        // --- 1. Dimensions ---
        const wInp = UI.createInput('number', { value: state.w, min: 1 }, (t: HTMLInputElement) => {
            state.w = parseInt(t.value) || 1;
            updateInputs('w');
            update();
        });
        const hInp = UI.createInput('number', { value: state.h, min: 1 }, (t: HTMLInputElement) => {
            state.h = parseInt(t.value) || 1;
            updateInputs('h');
            update();
        });

        root.appendChild(UI.createRow('Width', wInp));
        root.appendChild(UI.createRow('Height', hInp));

        // Constrain Checkbox
        const constrainCheck = UI.createCheckbox({
            label: 'Constrain Proportions',
            value: state.constrain,
            onChange: (v: boolean) => {
                state.constrain = v;
                if (v) updateInputs('w'); // Sync immediately if enabled
                update();
            }
        });
        // Align with inputs (empty label on left)
        root.appendChild(UI.createRow('', constrainCheck));

        root.appendChild(UI.createNode('div', { className: 'popup-separator' }));

        // --- 2. Anchor Grid ---
        const grid = UI.createNode('div', { 
            style: 'display:grid; grid-template-columns:repeat(3, 1fr); gap:2px; width:120px; margin:0 auto;' 
        });
        
        const anchors = [
            '↖', '↑', '↗',
            '←', '•', '→',
            '↙', '↓', '↘'
        ];

        const renderGrid = () => {
            grid.innerHTML = '';
            anchors.forEach((symbol, idx) => {
                const btn = UI.createNode('button', {
                    style: `padding:0; height:36px; font-size:20px; background:${state.anchor === idx ? '#007acc' : '#333'}; border:1px solid #555; cursor:pointer; width:100%; margin:0; display:flex; align-items:center; justify-content:center;`,
                    textContent: symbol,
                    on: { click: () => { state.anchor = idx; renderGrid(); update(); } }
                });
                grid.appendChild(btn);
            });
        };
        renderGrid();

        root.appendChild(UI.createRow('Anchor', grid));
        root.appendChild(UI.createNode('div', { className: 'popup-separator' }));

        // --- 3. Fill Options ---
        const fillSelect = UI.createSelectRow({
            label: 'Extension Fill',
            options: [
                { value: 'transparent', text: 'Transparent' },
                { value: 'color', text: 'Background Color' },
                { value: 'repeat', text: 'Repeat (Tile)' },
                { value: 'reflect', text: 'Reflect' },
                { value: 'clamp', text: 'Clamp (Edge)' }
            ],
            value: state.fill,
            onChange: (v: string) => {
                state.fill = v;
                colorRow.style.display = v === 'color' ? 'flex' : 'none';
                update();
            }
        });
        root.appendChild(fillSelect);

        const colorRow = UI.createColorRow({
            label: 'Color',
            value: state.color,
            onChange: (v: string) => {
                state.color = v;
                update();
            }
        });
        colorRow.style.display = 'none';
        root.appendChild(colorRow);

        update();
    }
});

export const layerCanvasSizeActions: Pick<AppActions, 'openLayerCanvasSizeDialog'> = {
    openLayerCanvasSizeDialog() {
        const l = App.utils.getActive();
        if (!l) return alert('No active layer selected.');
        Filters.run('layer-canvas-size');
    }
};
