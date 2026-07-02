import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

App.registerTool({
    id: 'clone',
    icon: '⧉',
    title: 'Clone Stamp',
    settings: { size: 40, hardness: 50, spacing: 10, alignment: 'none', alpha: 1.0 },
    
    // State
    sourceAnchor: null as { x: number, y: number, layer: Layer } | null,
    offset: null as { dx: number, dy: number } | null,
    distanceAccumulator: 0,
    
    // Offscreen canvases for soft brush stamping
    brushCanvas: null as HTMLCanvasElement | null,
    tempCanvas: null as HTMLCanvasElement | null,
    
    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createNode('div', {style:'padding:5px; color:#aaa; font-size:11px; line-height:1.4'}, 'Alt+Click to set source.<br/>Draw to copy pixels.'));
        panel.appendChild(UI.createSliderRow({ label: 'Size', min: 1, max: 200, value: this.settings.size, onInput: (v: string) => this.settings.size = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Hardness', min: 0, max: 100, value: this.settings.hardness, onInput: (v: string) => this.settings.hardness = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Spacing', min: 1, max: 200, value: this.settings.spacing, onInput: (v: string) => this.settings.spacing = parseInt(v) }));
        panel.appendChild(UI.createSliderRow({ label: 'Alpha', min: 1, max: 100, value: Math.round(this.settings.alpha * 100), onInput: (v: string) => this.settings.alpha = parseInt(v) / 100 }));
        panel.appendChild(UI.createSelectRow({
            label: 'Align',
            value: this.settings.alignment,
            options: [
                { value: 'aligned', text: 'Aligned' },
                { value: 'none', text: 'None' }
            ],
            onChange: (v: string) => this.settings.alignment = v
        }));
    },
    
    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;

        const pos = App.utils.getPos(e);
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        // Set Source Anchor
        if (e.altKey) {
            this.sourceAnchor = { x: lx, y: ly, layer: l };
            this.offset = null; 
            App.render();
            return;
        }

        if (!this.sourceAnchor) {
            alert('Alt+Click to set a source point first.');
            return;
        }
        
        if (!App.utils.layerIs(l, 'editable')) {
            alert('Layer is not editable (rasterize first).'); 
            return;
        }

        App.actions.saveState();
        App.state.isDrawing = true;
        
        // Calculate offset if starting a fresh aligned anchor or if using 'none' alignment
        if (this.settings.alignment === 'none' || !this.offset) {
            this.offset = {
                dx: lx - this.sourceAnchor.x,
                dy: ly - this.sourceAnchor.y
            };
        }

        App.state.last = { x: lx, y: ly };

        // Prepare Brush Mask Canvas
        const size = this.settings.size;
        this.brushCanvas = document.createElement('canvas');
        this.brushCanvas.width = size;
        this.brushCanvas.height = size;
        const bCtx = this.brushCanvas.getContext('2d')!;
        
        const r = size / 2;
        const grad = bCtx.createRadialGradient(r, r, 0, r, r, r);
        
        // Hardness maps directly to the inner solid color stop (0% = 0, 100% = 1)
        const stop0 = Math.max(0, Math.min(1, this.settings.hardness / 100));
        
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        if (stop0 < 1 && stop0 > 0) grad.addColorStop(stop0, 'rgba(0,0,0,1)');
        if (stop0 < 1) grad.addColorStop(1, 'rgba(0,0,0,0)');
        
        bCtx.fillStyle = grad;
        bCtx.beginPath();
        bCtx.arc(r, r, r, 0, Math.PI * 2);
        bCtx.fill();

        // Prepare Temporary Stamping Canvas
        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = size;
        this.tempCanvas.height = size;

        // Prepare scratch canvas if selection is active
        const sel = App.state.selection;
        if (sel.active && sel.mask && sel.layerId === l.id) {
            App.state.scratch = document.createElement('canvas');
            App.state.scratch.width = l.canvas.width;
            App.state.scratch.height = l.canvas.height;
        } else {
            App.state.scratch = null;
        }

        // Draw initial dab and reset spacing accumulator
        const spacingPx = Math.max(1, this.settings.size * (this.settings.spacing / 100));
        this.distanceAccumulator = spacingPx;
        this.stampDabs(l, App.state.last, App.state.last, true);
        App.emit('render');
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

        this.stampDabs(l, App.state.last, curr, false);
        
        App.state.last = curr;
        App.emit('render');
    },
    
    onMouseUp() {
        if (App.state.isDrawing) {
            App.state.isDrawing = false;
            App.state.scratch = null;
            this.brushCanvas = null;
            this.tempCanvas = null;
            this.distanceAccumulator = 0;
        }
    },

    stampDabs(layer: Layer, p1: {x: number, y: number}, p2: {x: number, y: number}, isInitial: boolean) {
        const size = this.settings.size;
        const r = size / 2;
        const spacingPx = Math.max(1, size * (this.settings.spacing / 100));
        
        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === layer.id;
        let targetCtx = layer.ctx;
        
        // If selection is active, we stamp onto a cleared scratchpad for the current segment
        if (hasSel && App.state.scratch) {
            targetCtx = App.state.scratch.getContext('2d')!;
            targetCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        }
        
        const tCtx = this.tempCanvas!.getContext('2d', { willReadFrequently: true })!;
        
        const stampAt = (px: number, py: number) => {
            const sx = px - this.offset!.dx;
            const sy = py - this.offset!.dy;
            
            tCtx.clearRect(0, 0, size, size);
            
            // 1. Draw Source Pixels
            tCtx.drawImage(
                this.sourceAnchor!.layer.canvas, 
                Math.round(sx - r), Math.round(sy - r), size, size, 
                0, 0, size, size
            );
                
            // 2. Mask with Brush Hardness Map
            tCtx.globalCompositeOperation = 'destination-in';
            tCtx.drawImage(this.brushCanvas!, 0, 0);
            tCtx.globalCompositeOperation = 'source-over';
            
            // 3. Stamp to Target Context
            const prevAlpha = targetCtx.globalAlpha;
            targetCtx.globalAlpha = this.settings.alpha;
            targetCtx.drawImage(this.tempCanvas!, Math.round(px - r), Math.round(py - r));
            targetCtx.globalAlpha = prevAlpha;
        };

        if (isInitial) {
            stampAt(p1.x, p1.y);
        } else {
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (dist > 0) {
                const dx = (p2.x - p1.x) / dist;
                const dy = (p2.y - p1.y) / dist;
                
                let d = this.distanceAccumulator;
                while (d <= dist) {
                    stampAt(p1.x + dx * d, p1.y + dy * d);
                    d += spacingPx;
                }
                this.distanceAccumulator = d - dist; // Save the leftover distance for the next frame
            }
        }
        
        // If selection is active, mask the segment scratchpad and merge to layer
        if (hasSel && App.state.scratch) {
            targetCtx.globalCompositeOperation = 'destination-in';
            targetCtx.drawImage(sel.mask!, 0, 0);
            
            layer.ctx.globalCompositeOperation = 'source-over';
            layer.ctx.drawImage(App.state.scratch, 0, 0);
        }
    },

    drawUI() {
        if (this.sourceAnchor) {
            const ctx = App.els.ctx;
            const l = this.sourceAnchor.layer;
            if (!l.visible) return;
            
            let lx = this.sourceAnchor.x;
            let ly = this.sourceAnchor.y;
            
            // Move tracking crosshair dynamically when painting
            if (this.offset && App.state.isDrawing) {
                lx = App.state.last.x - this.offset.dx;
                ly = App.state.last.y - this.offset.dy;
            }

            const gx = lx * (l.width / l.canvas.width) + l.x;
            const gy = ly * (l.height / l.canvas.height) + l.y;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(gx - 6, gy);
            ctx.lineTo(gx + 6, gy);
            ctx.moveTo(gx, gy - 6);
            ctx.lineTo(gx, gy + 6);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Only render preview size-circle on the static anchor indicator
            if (lx === this.sourceAnchor.x && ly === this.sourceAnchor.y) {
                ctx.beginPath();
                ctx.arc(gx, gy, this.settings.size / 2 * (l.width / l.canvas.width), 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.lineDashOffset = 4;
                ctx.stroke();
            }
            
            ctx.restore();
        }
    }
});