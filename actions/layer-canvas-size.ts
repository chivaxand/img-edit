import { App, AppActions } from '../app';
import { UI } from '../ui';

export const layerCanvasSizeActions: Pick<AppActions, 'openLayerCanvasSizeDialog'> = {
    openLayerCanvasSizeDialog() {
        const l = App.utils.getActive();
        if (!l) return alert('No active layer selected.');

        const state = {
        w: l.width,
        h: l.height,
        anchor: 4, // 0-8, 4 is center
        fill: 'transparent', // transparent, color, repeat, reflect, clamp
        color: App.state.bg,
        constrain: true
    };
    const ratio = l.width / l.height;

    const html = `
        <h3>Layer Canvas Size</h3>
        <div id="cs-root"></div>
        <div style="margin-top:15px; display:flex; justify-content:flex-end; gap:10px;">
            <button class="cancel-btn" id="btn-cancel">Cancel</button>
            <button id="btn-apply">Apply</button>
        </div>
    `;
    App.popup!.setHtml(html);
    const root = App.popup!.getById('cs-root')!;

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
    });
    const hInp = UI.createInput('number', { value: state.h, min: 1 }, (t: HTMLInputElement) => {
        state.h = parseInt(t.value) || 1;
        updateInputs('h');
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
                on: { click: () => { state.anchor = idx; renderGrid(); } }
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
        }
    });
    root.appendChild(fillSelect);

    const colorRow = UI.createColorRow({
        label: 'Color',
        value: state.color,
        onChange: (v: string) => state.color = v
    });
    colorRow.style.display = 'none';
    root.appendChild(colorRow);

    // --- Actions ---
    App.popup!.onClick('btn-cancel', () => App.popup!.close());
    App.popup!.onClick('btn-apply', () => {
        const nw = parseInt(state.w.toString());
        const nh = parseInt(state.h.toString());
        if (nw < 1 || nh < 1) return alert('Invalid dimensions');

        App.actions.saveState();

        // 1. Calculate Offset based on Anchor
        let ox = 0, oy = 0;
        const dw = nw - l.width;
        const dh = nh - l.height;

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
            const pattern = ctx.createPattern(l.canvas, 'repeat')!;
            ctx.fillStyle = pattern;
            ctx.save();
            ctx.translate(ox, oy);
            ctx.fillRect(-ox, -oy, nw, nh);
            ctx.restore();
        } else if (state.fill === 'clamp') {
            // Draw original stretched to fill
            // Corners
            ctx.drawImage(l.canvas, 0, 0, 1, 1, 0, 0, ox+1, oy+1); // TL
            ctx.drawImage(l.canvas, l.width-1, 0, 1, 1, ox+l.width-1, 0, nw-(ox+l.width)+1, oy+1); // TR
            ctx.drawImage(l.canvas, 0, l.height-1, 1, 1, 0, oy+l.height-1, ox+1, nh-(oy+l.height)+1); // BL
            ctx.drawImage(l.canvas, l.width-1, l.height-1, 1, 1, ox+l.width-1, oy+l.height-1, nw-(ox+l.width)+1, nh-(oy+l.height)+1); // BR
            
            // Edges
            ctx.drawImage(l.canvas, 0, 0, l.width, 1, ox, 0, l.width, oy); // Top
            ctx.drawImage(l.canvas, 0, l.height-1, l.width, 1, ox, oy+l.height, l.width, nh-(oy+l.height)); // Bottom
            ctx.drawImage(l.canvas, 0, 0, 1, l.height, 0, oy, ox, l.height); // Left
            ctx.drawImage(l.canvas, l.width-1, 0, 1, l.height, ox+l.width, oy, nw-(ox+l.width), l.height); // Right
        } else if (state.fill === 'reflect') {
            // Helper to draw flipped
            const drawFlip = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, scX: number, scY: number) => {
                ctx.save();
                ctx.translate(dx + (scX<0?dw:0), dy + (scY<0?dh:0));
                ctx.scale(scX, scY);
                ctx.drawImage(l.canvas, sx, sy, sw, sh, 0, 0, dw, dh);
                ctx.restore();
            };
            
            // Fill 3x3 Grid around center
            // 1 2 3
            // 4 5 6 (5 is original)
            // 7 8 9
            
            // Top
            if (oy > 0) {
                drawFlip(0, 0, l.width, l.height, ox, oy-l.height, l.width, l.height, 1, -1); // 2
                if (ox > 0) drawFlip(0, 0, l.width, l.height, ox-l.width, oy-l.height, l.width, l.height, -1, -1); // 1
                if (ox+l.width < nw) drawFlip(0, 0, l.width, l.height, ox+l.width, oy-l.height, l.width, l.height, -1, -1); // 3
            }
            // Bottom
            if (oy + l.height < nh) {
                drawFlip(0, 0, l.width, l.height, ox, oy+l.height, l.width, l.height, 1, -1); // 8
                if (ox > 0) drawFlip(0, 0, l.width, l.height, ox-l.width, oy+l.height, l.width, l.height, -1, -1); // 7
                if (ox+l.width < nw) drawFlip(0, 0, l.width, l.height, ox+l.width, oy+l.height, l.width, l.height, -1, -1); // 9
            }
            // Left
            if (ox > 0) drawFlip(0, 0, l.width, l.height, ox-l.width, oy, l.width, l.height, -1, 1); // 4
            // Right
            if (ox + l.width < nw) drawFlip(0, 0, l.width, l.height, ox+l.width, oy, l.width, l.height, -1, 1); // 6
        }

        // 4. Draw Original Image
        ctx.drawImage(l.canvas, ox, oy);

        // 5. Update Layer
        l.canvas = nc;
        l.width = nw;
        l.height = nh;
        l.ctx = ctx;
        // Shift layer position to match the visual anchor change
        l.x -= ox;
        l.y -= oy;

        App.emit('layers:structure');
        App.emit('layer:props');
        App.popup!.close();
    });

    App.popup!.show();
}
};