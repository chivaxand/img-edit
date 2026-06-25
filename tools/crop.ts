import { App } from '../app';
import { UI } from '../ui';
import { Layer } from '../layers';

App.registerTool({
    id: 'crop',
    icon: '✂',
    title: 'Crop Tool',
    
    // State
    rect: { x:0, y:0, w:0, h:0 } as Record<string, number>,
    drag: null as string | null, // 'create', 'move', 'tl', 'tr', etc.
    dragStart: null as any,
    uiEls: {} as Record<string, HTMLInputElement>,

    onSelect(panel: HTMLElement) {
        // Start with zero selection
        this.rect = { x:0, y:0, w:0, h:0 };
        this.uiEls = {}; 
        
        panel.appendChild(UI.createNode('div', { className: 'panel-header' }, 'Crop Canvas'));
        panel.appendChild(UI.createNode('div', { style:'font-size:11px; color:#aaa; margin-bottom:10px;' }, 'Drag to draw. Double-click to apply.'));
        
        const update = (k: string, v: string) => { this.rect[k] = parseInt(v) || 0; App.render(); };
        const inp = (l: string, k: string) => {
            const el = UI.createInput('number', { value: this.rect[k] }, (v: HTMLInputElement) => update(k, v.value)) as HTMLInputElement;
            this.uiEls[k] = el;
            return UI.createRow(l, el);
        };

        panel.appendChild(UI.createNode('div', {style:'display:flex; gap:5px'}, 
            UI.createNode('div', {style:'flex:1'}, inp('X', 'x'), inp('W', 'w')),
            UI.createNode('div', {style:'flex:1'}, inp('Y', 'y'), inp('H', 'h'))
        ));

        panel.appendChild(UI.createNode('button', { 
            className: 'btn', style: 'width:100%; margin-top:10px;', textContent: 'Apply Crop', 
            on: { click: () => this.apply() } 
        }));

        App.render();
    },

    apply() {
        const r = this.rect;
        // Prevent applying invalid crop
        if (r.w < 1 || r.h < 1) return;

        App.actions.saveState();

        // Shift all layers
        App.state.layers.forEach(l => {
            l.x -= r.x;
            l.y -= r.y;
        });

        // Resize Canvas (updates state width/height)
        App.actions.resizeCanvas(r.w, r.h);

        // Reset tool to move
        App.actions.setTool('move');
    },

    drawUI() {
        const ctx = App.els.ctx;
        const r = this.rect;
        const cw = App.state.width;
        const ch = App.state.height;

        // Darken overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        if (r.w > 0 && r.h > 0) {
            ctx.beginPath();
            ctx.rect(0, 0, cw, ch);
            ctx.rect(r.x, r.y, r.w, r.h);
            ctx.fill('evenodd');
            
            // Draw Box
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.setLineDash([]);

            // Handles
            ctx.fillStyle = '#00f';
            const hSize = 8;
            const drawH = (x: number, y: number) => ctx.fillRect(x - hSize/2, y - hSize/2, hSize, hSize);

            drawH(r.x, r.y); // TL
            drawH(r.x + r.w/2, r.y); // TM
            drawH(r.x + r.w, r.y); // TR
            drawH(r.x, r.y + r.h/2); // ML
            drawH(r.x + r.w, r.y + r.h/2); // MR
            drawH(r.x, r.y + r.h); // BL
            drawH(r.x + r.w/2, r.y + r.h); // BM
            drawH(r.x + r.w, r.y + r.h); // BR
        } else {
            // Nothing selected, just darken slightly or show guide
        }

        // Sync Inputs
        if(this.uiEls.x) {
            this.uiEls.x.value = String(r.x);
            this.uiEls.y.value = String(r.y);
            this.uiEls.w.value = String(r.w);
            this.uiEls.h.value = String(r.h);
        }
    },

    onMouseDown(e: MouseEvent) {
        const m = App.utils.getPos(e);
        const r = this.rect;
        const h = 10;
        
        this.drag = null;

        // Only check handles/move if we have a valid rect
        if (r.w > 0 && r.h > 0) {
            const near = (v1: number, v2: number) => Math.abs(v1 - v2) < h;
            
            if (near(m.x, r.x) && near(m.y, r.y)) this.drag = 'tl';
            else if (near(m.x, r.x+r.w) && near(m.y, r.y)) this.drag = 'tr';
            else if (near(m.x, r.x) && near(m.y, r.y+r.h)) this.drag = 'bl';
            else if (near(m.x, r.x+r.w) && near(m.y, r.y+r.h)) this.drag = 'br';
            else if (near(m.x, r.x + r.w/2) && near(m.y, r.y)) this.drag = 'tm';
            else if (near(m.x, r.x + r.w/2) && near(m.y, r.y+r.h)) this.drag = 'bm';
            else if (near(m.x, r.x) && near(m.y, r.y+r.h/2)) this.drag = 'ml';
            else if (near(m.x, r.x+r.w) && near(m.y, r.y+r.h/2)) this.drag = 'mr';
            else if (m.x > r.x && m.x < r.x+r.w && m.y > r.y && m.y < r.y+r.h) {
                this.drag = 'move';
                this.dragStart = { mx: m.x, my: m.y, rx: r.x, ry: r.y };
                return;
            }
        }

        // If no handle/move clicked, start creating
        if (!this.drag) {
            this.drag = 'create';
            this.dragStart = { x: m.x, y: m.y };
            this.rect = { x: m.x, y: m.y, w: 0, h: 0 };
            App.render();
        }
    },

    onMouseMove(e: MouseEvent) {
        if (!this.drag) return;
        const m = App.utils.getPos(e);
        const r = this.rect;

        if (this.drag === 'create') {
            const minX = Math.min(this.dragStart.x, m.x);
            const minY = Math.min(this.dragStart.y, m.y);
            r.w = Math.abs(m.x - this.dragStart.x);
            r.h = Math.abs(m.y - this.dragStart.y);
            r.x = minX;
            r.y = minY;
        } 
        else if (this.drag === 'move') {
            const dx = m.x - this.dragStart.mx;
            const dy = m.y - this.dragStart.my;
            r.x = Math.round(this.dragStart.rx + dx);
            r.y = Math.round(this.dragStart.ry + dy);
        } 
        else {
            // Resizing
            if (this.drag.includes('l')) { const d = m.x - r.x; r.x += d; r.w -= d; }
            if (this.drag.includes('r')) { r.w = m.x - r.x; }
            if (this.drag.includes('t')) { const d = m.y - r.y; r.y += d; r.h -= d; }
            if (this.drag.includes('b')) { r.h = m.y - r.y; }
        }
        
        // Ensure positive dimensions during resize (create handles this via Math.abs)
        if (this.drag !== 'create' && this.drag !== 'move') {
            if (r.w < 0) { r.x += r.w; r.w = Math.abs(r.w); this.drag = this.drag.replace('l','x').replace('r','l').replace('x','r'); }
            if (r.h < 0) { r.y += r.h; r.h = Math.abs(r.h); this.drag = this.drag.replace('t','x').replace('b','t').replace('x','b'); }
        }

        App.render();
    },

    onMouseUp() { this.drag = null; },
    
    onDoubleClick() {
        this.apply();
    }
});