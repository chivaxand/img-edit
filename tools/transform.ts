import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

export const TransformTool = {
    id: 'transform' as const,
    title: 'Free Transform',
    icon: '⤢',
    sortOrder: 190,
    finishOnLayerSwitch: true,
    
    // State
    active: false,
    layer: null as Layer | null,
    origCanvas: null as HTMLCanvasElement | null,
    params: { x:0, y:0, w:0, h:0, r:0 } as Record<string, number>,
    drag: null as any, // { mode: 'move'|'scale'|'rotate', startX, startY, startP }
    uiEls: {} as Record<string, HTMLInputElement>, // References to input elements

    onSelect(panel: HTMLElement) {
        const l = App.utils.getActive();
        if (!l) {
            panel.appendChild(UI.createNode('div', {style:'padding:5px; color:#888'}, 'Select a layer to transform.'));
            return;
        }
        
        this.layer = l;
        this.active = true;
        
        // Clone original canvas for non-destructive preview
        this.origCanvas = document.createElement('canvas');
        this.origCanvas.width = l.canvas.width;
        this.origCanvas.height = l.canvas.height;
        this.origCanvas.getContext('2d')!.drawImage(l.canvas, 0, 0);

        // Init params
        this.params = { x: l.x, y: l.y, w: l.width, h: l.height, r: 0 };
        
        // Hide actual layer, we will draw the preview
        l.visible = false; 
        App.render();
        
        // Helper to update params from input
        const updateParam = (k: string, val: string) => {
            const v = parseFloat(val);
            if (!isNaN(v)) {
                if (k === 'r') this.params[k] = v * Math.PI / 180;
                else this.params[k] = v;
                App.render();
                this.drawUI!();
            }
        };

        // Create Inputs
        const inp = (lbl: string, k: string, props: any = {}) => {
            const el = UI.createInput('number', { value: (k==='r' ? 0 : Math.round(this.params[k])), ...props }, (t: HTMLInputElement) => updateParam(k, t.value)) as HTMLInputElement;
            this.uiEls[k] = el;
            return UI.createRow(lbl, el);
        };

        panel.appendChild(UI.createNode('div', {style:'display:flex; gap:5px'}, 
            UI.createNode('div', {style:'flex:1'}, inp('X', 'x'), inp('W', 'w')),
            UI.createNode('div', {style:'flex:1'}, inp('Y', 'y'), inp('H', 'h'))
        ));
        panel.appendChild(inp('Rotate (°)', 'r'));

        panel.appendChild(UI.createHint('Drag corners to Scale. Drag outer handle to Rotate.', { style: 'margin: 10px 0;' }));
        
        const btnApply = UI.createNode('button', { className: 'btn', style: 'width:100%', textContent: 'Apply', on: { click: () => this.apply() } });
        panel.appendChild(btnApply);

        this.drawUI!();
    },

    onDeselect() {
        if (this.layer) {
            this.layer.visible = true; // Restore visibility if canceled
            this.active = false;
            this.layer = null;
            this.uiEls = {};
            App.render();
        }
    },

    updateInputs() {
        if (!this.uiEls.x) return;
        this.uiEls.x.value = String(Math.round(this.params.x));
        this.uiEls.y.value = String(Math.round(this.params.y));
        this.uiEls.w.value = String(Math.round(this.params.w));
        this.uiEls.h.value = String(Math.round(this.params.h));
        this.uiEls.r.value = String(Math.round(this.params.r * 180 / Math.PI));
    },

    apply() {
        if (!this.layer || !this.origCanvas) return;
        
        this.layer.visible = true;
        App.actions.saveState();
        if (App.actions.deselect) App.actions.deselect();

        // Create new canvas with transformed image
        const rad = this.params.r;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const nw = Math.ceil(this.params.w * cos + this.params.h * sin);
        const nh = Math.ceil(this.params.w * sin + this.params.h * cos);

        const nc = document.createElement('canvas');
        nc.width = nw; nc.height = nh;
        const ctx = nc.getContext('2d')!;

        ctx.translate(nw/2, nh/2);
        ctx.rotate(this.params.r);
        ctx.translate(-this.params.w/2, -this.params.h/2);
        
        // Use high quality smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.origCanvas, 0, 0, this.params.w, this.params.h);

        // Update Layer
        this.layer.canvas = nc;
        this.layer.ctx = nc.getContext('2d')!;
        this.layer.width = nw;
        this.layer.height = nh;
        
        // Center position adjustment
        const cx = this.params.x + this.params.w/2;
        const cy = this.params.y + this.params.h/2;
        this.layer.x = cx - nw/2;
        this.layer.y = cy - nh/2;
        
        this.active = false;
        this.layer = null;
        
        App.actions.setTool('pointer');
        App.render();
    },

    drawUI() {
        if (!this.active || !this.layer || !this.origCanvas) return;
        const ctx = App.els.ctx;
        const p = this.params;
        
        // Draw Preview
        const cx = p.x + p.w/2;
        const cy = p.y + p.h/2;
        
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(p.r);
        ctx.translate(-p.w/2, -p.h/2);
        
        ctx.globalAlpha = this.layer.opacity;
        ctx.globalCompositeOperation = this.layer.blend as GlobalCompositeOperation;
        ctx.drawImage(this.origCanvas, 0, 0, p.w, p.h);
        
        // Draw Controls (Overlay)
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#007acc';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, p.w, p.h);

        // Handles
        ctx.fillStyle = '#fff';
        const hSize = 8;
        const drawH = (x: number, y: number) => {
            ctx.strokeRect(x - hSize/2, y - hSize/2, hSize, hSize);
            ctx.fillRect(x - hSize/2, y - hSize/2, hSize, hSize);
        };

        drawH(0, 0); // TL
        drawH(p.w, 0); // TR
        drawH(0, p.h); // BL
        drawH(p.w, p.h); // BR
        
        // Rotate Handle
        ctx.beginPath();
        ctx.moveTo(p.w/2, 0);
        ctx.lineTo(p.w/2, -25);
        ctx.stroke();
        ctx.fillStyle = '#007acc';
        ctx.beginPath();
        ctx.arc(p.w/2, -25, 5, 0, Math.PI*2);
        ctx.fill();

        ctx.restore();
    },

    // Helpers for interaction
    getLocalPoint(e: MouseEvent) {
        const m = App.utils.getPos(e);
        const p = this.params;
        const cx = p.x + p.w/2;
        const cy = p.y + p.h/2;
        
        // Rotate point around center inverse to layer rotation
        const dx = m.x - cx;
        const dy = m.y - cy;
        const r = -p.r;
        
        return {
            x: dx * Math.cos(r) - dy * Math.sin(r) + p.w/2,
            y: dx * Math.sin(r) + dy * Math.cos(r) + p.h/2,
            rawX: m.x, rawY: m.y
        };
    },

    onMouseDown(e: MouseEvent) {
        if (!this.active) return;
        const pt = this.getLocalPoint(e);
        const p = this.params;
        const h = 10; // Hit radius
        this.drag = { startX: pt.rawX, startY: pt.rawY, startP: {...p} };

        // Hit Test
        if (Math.abs(pt.x - p.w/2) < h && pt.y < -15) this.drag.mode = 'rotate';
        else if (Math.abs(pt.x) < h && Math.abs(pt.y) < h) this.drag.mode = 'tl';
        else if (Math.abs(pt.x - p.w) < h && Math.abs(pt.y) < h) this.drag.mode = 'tr';
        else if (Math.abs(pt.x) < h && Math.abs(pt.y - p.h) < h) this.drag.mode = 'bl';
        else if (Math.abs(pt.x - p.w) < h && Math.abs(pt.y - p.h) < h) this.drag.mode = 'br';
        else if (pt.x > 0 && pt.x < p.w && pt.y > 0 && pt.y < p.h) this.drag.mode = 'move';
        else this.drag = null;
    },

    onMouseMove(e: MouseEvent) {
        if (!this.active) return;
        const pt = this.getLocalPoint(e);
        
        if (!this.drag) {
            App.els.canvas.style.cursor = 'default';
            return;
        }

        const d = this.drag;
        const dx = pt.rawX - d.startX;
        const dy = pt.rawY - d.startY;

        if (d.mode === 'move') {
            this.params.x = d.startP.x + dx;
            this.params.y = d.startP.y + dy;
        } else if (d.mode === 'rotate') {
            const cx = d.startP.x + d.startP.w/2;
            const cy = d.startP.y + d.startP.h/2;
            this.params.r = Math.atan2(pt.rawY - cy, pt.rawX - cx) + Math.PI/2;
        } else {
            // Scaling logic
            // Identify Anchor Point (Opposite to handle) in World Space
            const getCorner = (mode: string, p: Record<string, number>) => {
                const cx = p.x + p.w/2, cy = p.y + p.h/2;
                const loc = ({
                    tl: {x: -p.w/2, y: -p.h/2}, tr: {x: p.w/2, y: -p.h/2},
                    bl: {x: -p.w/2, y: p.h/2},  br: {x: p.w/2, y: p.h/2}
                } as Record<string, {x: number, y: number}>)[mode];
                return {
                    x: cx + loc.x * Math.cos(p.r) - loc.y * Math.sin(p.r),
                    y: cy + loc.x * Math.sin(p.r) + loc.y * Math.cos(p.r)
                };
            };

            const anchorMap: Record<string, string> = { tl:'br', tr:'bl', bl:'tr', br:'tl' };
            const anchor = getCorner(anchorMap[d.mode], d.startP);
            
            // Current Mouse is the new handle position
            const curr = { x: pt.rawX, y: pt.rawY };
            
            // Calculate new distance between Anchor and Mouse
            // Project vector (Anchor -> Mouse) onto the local axes (defined by rotation)
            const vec = { x: curr.x - anchor.x, y: curr.y - anchor.y };
            const axisX = { x: Math.cos(d.startP.r), y: Math.sin(d.startP.r) };
            const axisY = { x: -Math.sin(d.startP.r), y: Math.cos(d.startP.r) };
            
            let newW = vec.x * axisX.x + vec.y * axisX.y;
            let newH = vec.x * axisY.x + vec.y * axisY.y;
            
            // Adjust signs based on which corner (Logic: anchor is always 0,0 relative to new size)
            if (d.mode === 'tl') { newW = -newW; newH = -newH; }
            if (d.mode === 'tr') { newH = -newH; }
            if (d.mode === 'bl') { newW = -newW; }
            
            // Apply min size
            if(newW < 5) newW = 5;
            if(newH < 5) newH = 5;

            // Calculate new Center
            const midX = (anchor.x + curr.x) / 2;
            const midY = (anchor.y + curr.y) / 2;

            this.params.w = Math.abs(newW);
            this.params.h = Math.abs(newH);
            this.params.x = midX - this.params.w/2;
            this.params.y = midY - this.params.h/2;
        }

        this.updateInputs(); // Sync UI
        App.render();
        this.drawUI!();
    },

    onMouseUp() {
        this.drag = null;
    },

    onDoubleClick() {
        this.apply();
    },

    onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            this.apply();
            return true;
        }
        return false;
    }
};


declare global {
    interface ToolRegistry {
        transform: typeof TransformTool;
    }
}

App.registerTool(TransformTool);