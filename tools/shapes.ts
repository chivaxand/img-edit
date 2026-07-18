import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

// Shape Tools: Line
App.registerTool({
    id: 'line',
    icon: '╱',
    title: 'Line',
    settings: { stroke: 4, startCap: 'none', endCap: 'none' },
    onSelect(panel: HTMLElement) {
        const s = this.settings;
        const set = (k: string, v: any) => this.settings[k] = v;

        panel.appendChild(UI.createRow('Thickness', UI.createInput('number', { value: s.stroke }, (v: HTMLInputElement) => set('stroke', parseInt(v.value) || 1))));

        // Start Cap selection
        panel.appendChild(UI.createSelectRow({
            label: 'Start',
            value: s.startCap,
            options: [
                { value: 'none', text: 'None' },
                { value: 'arrow', text: 'Arrow' },
                { value: 'circle', text: 'Circle' }
            ],
            onChange: (v: string) => set('startCap', v)
        }));

        // End Cap selection
        panel.appendChild(UI.createSelectRow({
            label: 'End',
            value: s.endCap,
            options: [
                { value: 'none', text: 'None' },
                { value: 'arrow', text: 'Arrow' },
                { value: 'circle', text: 'Circle' }
            ],
            onChange: (v: string) => set('endCap', v)
        }));
    },
    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        if (l.type === 'text') { alert('Rasterize text layer to draw on it.'); return; }

        App.actions.saveState();
        App.state.isDrawing = true;
        App.state.start = App.utils.getPos(e);
    },
    onMouseMove(e: MouseEvent) {
        if (!App.state.isDrawing) return;
        App.render();
        const pos = App.utils.getPos(e);

        const ctx = App.els.ctx;
        const s = App.state.start;
        const set = this.settings;

        this.drawLineWithCaps(ctx, s.x, s.y, pos.x, pos.y, set.stroke, set.startCap, set.endCap, App.state.fg);
    },
    onMouseUp(e: MouseEvent) {
        if (!App.state.isDrawing) return;
        App.state.isDrawing = false;
        const l = App.utils.getActive();
        if (!l) return;
        const pos = App.utils.getPos(e);
        const sx = App.utils.toLocal(l, App.state.start.x, 'x'), sy = App.utils.toLocal(l, App.state.start.y, 'y');
        const ex = App.utils.toLocal(l, pos.x, 'x'), ey = App.utils.toLocal(l, pos.y, 'y');

        Lib.canvas.drawSelectionMasked(l, App.state.selection, (ctx) => {
            this.drawLineWithCaps(ctx, sx, sy, ex, ey, this.settings.stroke, this.settings.startCap, this.settings.endCap, App.state.fg);
        });

        App.recordAction(`api.drawLine(${Math.round(sx)}, ${Math.round(sy)}, ${Math.round(ex)}, ${Math.round(ey)}, ${this.settings.stroke}, '${this.settings.startCap}', '${this.settings.endCap}', '${App.state.fg}');`);
        App.render();
    },
    drawLineWithCaps(
        ctx: CanvasRenderingContext2D,
        sx: number, sy: number,
        ex: number, ey: number,
        strokeWidth: number,
        startCap: string,
        endCap: string,
        color: string
    ) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) {
            ctx.restore();
            return;
        }

        const angle = Math.atan2(dy, dx);
        const ux = dx / len;
        const uy = dy / len;

        const arrowLen = Math.max(12, strokeWidth * 4);
        const arrowAngle = 0.5;
        const circleRadius = Math.max(5, strokeWidth * 1.5);

        let shortenStart = 0;
        let shortenEnd = 0;

        if (startCap === 'arrow') {
            shortenStart = arrowLen * 0.8;
        } else if (startCap === 'circle') {
            shortenStart = circleRadius * 0.5;
        }

        if (endCap === 'arrow') {
            shortenEnd = arrowLen * 0.8;
        } else if (endCap === 'circle') {
            shortenEnd = circleRadius * 0.5;
        }

        // Draw line safely pulled back inside filled caps
        if (len > shortenStart + shortenEnd) {
            ctx.beginPath();
            ctx.moveTo(sx + shortenStart * ux, sy + shortenStart * uy);
            ctx.lineTo(ex - shortenEnd * ux, ey - shortenEnd * uy);
            ctx.stroke();
        }

        const drawArrowhead = (x: number, y: number, ang: number) => {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(
                x - arrowLen * Math.cos(ang - arrowAngle),
                y - arrowLen * Math.sin(ang - arrowAngle)
            );
            ctx.lineTo(
                x - arrowLen * Math.cos(ang + arrowAngle),
                y - arrowLen * Math.sin(ang + arrowAngle)
            );
            ctx.closePath();
            ctx.fill();
        };

        const drawCircleCap = (x: number, y: number) => {
            ctx.beginPath();
            ctx.arc(x, y, circleRadius, 0, Math.PI * 2);
            ctx.fill();
        };

        // Render cap markers exactly at endpoints
        if (endCap === 'arrow') {
            drawArrowhead(ex, ey, angle);
        } else if (endCap === 'circle') {
            drawCircleCap(ex, ey);
        }

        if (startCap === 'arrow') {
            drawArrowhead(sx, sy, angle + Math.PI);
        } else if (startCap === 'circle') {
            drawCircleCap(sx, sy);
        }

        ctx.restore();
    }
});

// Shape Tools: Rect, Circle
[
    { id: 'rect', icon: '⬜', title: 'Rect' },
    { id: 'circle', icon: '◯', title: 'Circle' }
].forEach(tool => {
    App.registerTool({
        id: tool.id,
        icon: tool.icon,
        title: tool.title,
        settings: { stroke: 2, fill: true, useStroke: false, radius: 0 },
        onSelect(panel: HTMLElement) {
            const s = this.settings;
            const set = (k: string, v: any) => this.settings[k] = v;
            panel.appendChild(UI.createRow('Stroke', UI.createInput('number', {value:s.stroke}, (v: HTMLInputElement) => set('stroke', parseInt(v.value)))));
            const checkRow = UI.createNode('div', {style:{display:'flex', gap:'15px'}});
            checkRow.appendChild(UI.createCheckbox({ label: 'Stroke', value: s.useStroke, onChange: (v: boolean) => set('useStroke', v) }));
            checkRow.appendChild(UI.createCheckbox({ label: 'Fill', value: s.fill, onChange: (v: boolean) => set('fill', v) }));
            panel.appendChild(UI.createRow(null, checkRow));

            if(tool.id === 'rect') {
                panel.appendChild(UI.createRow('Radius', UI.createInput('number', {value:s.radius}, (v: HTMLInputElement) => set('radius', parseInt(v.value)))));
            }
        },
        onMouseDown(e: MouseEvent) {
            const l = App.utils.getActive();
            if (!l || !l.visible) return;
            if(l.type === 'text') { alert('Rasterize text layer to draw on it.'); return; }
            
            App.actions.saveState();
            App.state.isDrawing = true;
            App.state.start = App.utils.getPos(e);
        },
        onMouseMove(e: MouseEvent) {
            if (!App.state.isDrawing) return;
            App.render(); 
            const pos = App.utils.getPos(e);
            // Draw Preview
            const ctx = App.els.ctx;
            const s = App.state.start;
            const set = this.settings;
            ctx.save();
            ctx.strokeStyle = App.state.fg; 
            ctx.fillStyle = App.state.bg; 
            ctx.lineWidth = set.stroke;
            ctx.beginPath();
            const w = pos.x - s.x, h = pos.y - s.y;
            if(tool.id === 'rect') {
                if(ctx.roundRect) ctx.roundRect(s.x, s.y, w, h, set.radius); else ctx.rect(s.x, s.y, w, h);
            } else {
                ctx.ellipse(s.x+w/2, s.y+h/2, Math.abs(w)/2, Math.abs(h)/2, 0, 0, Math.PI*2);
            }
            if(set.fill) ctx.fill();
            if(set.useStroke) ctx.stroke();
            ctx.restore();
        },
        onMouseUp(e: MouseEvent) {
            if (!App.state.isDrawing) return;
            App.state.isDrawing = false;
            const l = App.utils.getActive();
            if (!l) return;
            const pos = App.utils.getPos(e);
            const sx = App.utils.toLocal(l, App.state.start.x, 'x'), sy = App.utils.toLocal(l, App.state.start.y, 'y');
            const ex = App.utils.toLocal(l, pos.x, 'x'), ey = App.utils.toLocal(l, pos.y, 'y');
            
            Lib.canvas.drawSelectionMasked(l, App.state.selection, (ctx) => {
                App.utils.prepCtx(ctx, this.settings);
                ctx.strokeStyle = App.state.fg;
                ctx.fillStyle = App.state.bg;
                ctx.lineWidth = this.settings.stroke;

                ctx.beginPath();
                const w = ex-sx, h = ey-sy;
                if(tool.id === 'rect') {
                    if(ctx.roundRect) ctx.roundRect(sx, sy, w, h, this.settings.radius);
                    else ctx.rect(sx, sy, w, h);
                } else {
                    ctx.ellipse(sx+w/2, sy+h/2, Math.abs(w)/2, Math.abs(h)/2, 0, 0, Math.PI*2);
                }
                if(this.settings.fill) ctx.fill();
                if(this.settings.useStroke) ctx.stroke();
            });
            
            App.recordAction(`api.drawShape('${tool.id}', ${Math.round(sx)}, ${Math.round(sy)}, ${Math.round(ex)}, ${Math.round(ey)}, ${this.settings.stroke}, ${this.settings.fill}, ${this.settings.useStroke}, ${this.settings.radius});`);
            App.render();
        }
    });
});
