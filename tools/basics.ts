import { App } from '../app';
import { UI } from '../ui';
import { Layer } from '../layers';

// Move Tool
App.registerTool({
    id: 'move',
    icon: '✥',
    title: 'Move',
    onSelect: (panel: HTMLElement) => {
        panel.appendChild(UI.createNode('div', {style:{padding:'5px', color:'#666'}}, 'Click and drag to move layer.'));
    },
    onMouseDown: (e: MouseEvent) => {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        App.actions.saveState();
        App.state.isDrawing = true;
        const pos = App.utils.getPos(e);
        App.state.dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
    },
    onMouseMove: (e: MouseEvent) => {
        if (!App.state.isDrawing) return;
        const l = App.utils.getActive();
        if (!l) return;
        const pos = App.utils.getPos(e);
        l.x = Math.round(pos.x - App.state.dragOffset.x); 
        l.y = Math.round(pos.y - App.state.dragOffset.y);
        App.emit('layer:props');
    },
    onMouseUp: () => { App.state.isDrawing = false; }
});

// Pen & Eraser Tools
['pen', 'eraser'].forEach(type => {
    App.registerTool({
        id: type,
        icon: type === 'pen' ? '✎' : '⌫',
        title: type === 'pen' ? 'Pen' : 'Eraser',
        settings: { size: type === 'eraser' ? 30 : 5 },
        onSelect(panel: HTMLElement) {
            panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 100, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        },
        onMouseDown(e: MouseEvent) {
            const l = App.utils.getActive();
            if (!l || !l.visible) return;
            if (!App.utils.layerIs(l, 'editable')) { 
                alert('Layer is not editable (rasterize first).'); 
                return; 
            }
            
            App.actions.saveState();
            App.state.isDrawing = true;
            const pos = App.utils.getPos(e);
            
            // Store last position
            App.state.last = { 
                x: App.utils.toLocal(l, pos.x, 'x'), 
                y: App.utils.toLocal(l, pos.y, 'y') 
            };

            // Prepare scratch canvas if selection is active
            const sel = App.state.selection;
            if (sel.active && sel.mask && sel.layerId === l.id) {
                App.state.scratch = document.createElement('canvas');
                App.state.scratch.width = l.canvas.width;
                App.state.scratch.height = l.canvas.height;
            } else {
                App.state.scratch = null;
            }

            // Start path for direct drawing
            if (!App.state.scratch) {
                l.ctx.beginPath();
                l.ctx.moveTo(App.state.last.x, App.state.last.y);
                l.ctx.lineCap = 'round'; l.ctx.lineJoin = 'round';
                l.ctx.lineWidth = this.settings.size;
                l.ctx.globalCompositeOperation = type === 'eraser' ? 'destination-out' : 'source-over';
                l.ctx.strokeStyle = App.state.fg;
            }
        },
        onMouseMove(e: MouseEvent) {
            if (!App.state.isDrawing) return;
            const l = App.utils.getActive();
            if (!l) return;
            const pos = App.utils.getPos(e);
            const curr = {
                x: App.utils.toLocal(l, pos.x, 'x'),
                y: App.utils.toLocal(l, pos.y, 'y')
            };

            if (App.state.scratch) {
                // Draw masked segment
                const ctx = App.state.scratch.getContext('2d')!;
                ctx.clearRect(0, 0, App.state.scratch.width, App.state.scratch.height);
                
                // Draw segment to scratch
                ctx.beginPath();
                ctx.moveTo(App.state.last.x, App.state.last.y);
                ctx.lineTo(curr.x, curr.y);
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.lineWidth = this.settings.size;
                ctx.strokeStyle = App.state.fg;
                ctx.globalCompositeOperation = 'source-over';
                ctx.stroke();

                // Mask with selection
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(App.state.selection.mask, 0, 0);

                // Draw result to layer
                l.ctx.globalCompositeOperation = type === 'eraser' ? 'destination-out' : 'source-over';
                l.ctx.drawImage(App.state.scratch, 0, 0);
            } else {
                // Direct draw
                l.ctx.lineTo(curr.x, curr.y);
                l.ctx.stroke();
            }
            
            App.state.last = curr;
            App.emit('render');
        },
        onMouseUp() { 
            App.state.isDrawing = false; 
            App.state.scratch = null;
        }
    });
});

// Zoom Tool
App.registerTool({
    id: 'zoom',
    icon: '🔍',
    title: 'Zoom',
    onSelect: (panel: HTMLElement) => {
        const pct = Math.round(App.state.zoom * 100) + '%';
        panel.appendChild(UI.createRow('Level', UI.createNode('strong', {}, pct)));
        const row = UI.createNode('div', { style:'display:flex; gap:5px; margin-top:10px;' });
        row.appendChild(UI.createNode('button', { className:'btn', textContent:'-', on:{click:() => App.actions.stepZoom(-1)} }));
        row.appendChild(UI.createNode('button', { className:'btn', textContent:'100%', on:{click:() => App.actions.setZoom(1)} }));
        row.appendChild(UI.createNode('button', { className:'btn', textContent:'+', on:{click:() => App.actions.stepZoom(1)} }));
        panel.appendChild(row);
        panel.appendChild(UI.createNode('div', {style:'margin-top:10px; font-size:11px; color:#888;'}, 'Right-click or Alt+Click to Zoom Out.'));
        if (App.els.canvas) App.els.canvas.oncontextmenu = (e: Event) => e.preventDefault();
    },
    onDeselect: () => {
        if (App.els.canvas) App.els.canvas.oncontextmenu = null;
    },
    onMouseDown: (e: MouseEvent) => {
        const dir = (e.altKey || e.button === 2) ? -1 : 1;
        App.actions.stepZoom(dir);
    },
    onKeyDown: (e: KeyboardEvent) => {
        if (e.key === '=' || e.key === '+') { App.actions.stepZoom(1); return true; }
        if (e.key === '-') { App.actions.stepZoom(-1); return true; }
        if (e.key === '0' || e.key === '*') { App.actions.setZoom(1); return true; }
        return false;
    }
});