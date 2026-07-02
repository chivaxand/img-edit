import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

App.registerTool({
    id: 'gradient',
    icon: '🌈',
    title: 'Gradient Tool (G)',
    settings: { type: 'linear', colors: 'fg-bg', strict: false },

    startPos: null as { x: number, y: number } | null,

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSelectRow({
            label: 'Type',
            value: this.settings.type,
            options: [
                { value: 'linear', text: 'Linear' },
                { value: 'radial', text: 'Radial' }
            ],
            onChange: (v: string) => this.settings.type = v
        }));

        panel.appendChild(UI.createSelectRow({
            label: 'Gradient',
            value: this.settings.colors,
            options: [
                { value: 'fg-bg', text: 'Foreground to Background' },
                { value: 'fg-trans', text: 'Foreground to Transparent' }
            ],
            onChange: (v: string) => this.settings.colors = v
        }));

        panel.appendChild(UI.createCheckbox({
            label: 'Strict Span (Start to End only)',
            value: this.settings.strict,
            onChange: (v: boolean) => this.settings.strict = v
        }));
    },

    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        if (!App.utils.layerIs(l, 'editable')) { 
            alert('Layer is not editable (rasterize first).'); 
            return; 
        }

        App.state.isDrawing = true;
        this.startPos = App.utils.getPos(e);
    },

    onMouseMove(e: MouseEvent) {
        if (!App.state.isDrawing || !this.startPos) return;
        App.render();
        
        const pos = App.utils.getPos(e);
        const ctx = App.els.ctx;

        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(this.startPos.x, this.startPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.strokeStyle = '#000';
        ctx.lineDashOffset = 4;
        ctx.stroke();
        ctx.restore();
    },

    onMouseUp(e: MouseEvent) {
        if (!App.state.isDrawing || !this.startPos) return;
        App.state.isDrawing = false;

        const l = App.utils.getActive();
        if (!l) return;

        const pos = App.utils.getPos(e);
        const sx = App.utils.toLocal(l, this.startPos.x, 'x');
        const sy = App.utils.toLocal(l, this.startPos.y, 'y');
        const ex = App.utils.toLocal(l, pos.x, 'x');
        const ey = App.utils.toLocal(l, pos.y, 'y');

        const dist = Math.hypot(ex - sx, ey - sy);
        if (dist < 5) return;

        App.actions.saveState();

        const sel = App.state.selection;
        const hasSel = sel.active && sel.mask && sel.layerId === l.id;

        const temp = document.createElement('canvas');
        temp.width = l.canvas.width;
        temp.height = l.canvas.height;
        const tCtx = temp.getContext('2d')!;

        let grad: CanvasGradient;
        if (this.settings.type === 'radial') {
            grad = tCtx.createRadialGradient(sx, sy, 0, sx, sy, dist);
        } else {
            grad = tCtx.createLinearGradient(sx, sy, ex, ey);
        }

        const fg = App.state.fg;
        const bg = App.state.bg;

        if (this.settings.colors === 'fg-bg') {
            grad.addColorStop(0, fg);
            grad.addColorStop(1, bg);
        } else {
            grad.addColorStop(0, fg);
            const rgb = App.utils.hexToRgb(fg) || { r: 0, g: 0, b: 0 };
            grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        }

        tCtx.save();
        if (this.settings.strict) {
            if (this.settings.type === 'radial') {
                tCtx.beginPath();
                tCtx.arc(sx, sy, dist, 0, Math.PI * 2);
                tCtx.clip();
            } else {
                const dx = ex - sx;
                const dy = ey - sy;
                const len = Math.hypot(dx, dy);
                if (len > 0) {
                    const ux = dx / len;
                    const uy = dy / len;
                    const px = -uy;
                    const py = ux;
                    const d = Math.max(temp.width, temp.height) * 4;

                    tCtx.beginPath();
                    tCtx.moveTo(sx + px * d, sy + py * d);
                    tCtx.lineTo(sx - px * d, sy - py * d);
                    tCtx.lineTo(ex - px * d, ey - py * d);
                    tCtx.lineTo(ex + px * d, ey + py * d);
                    tCtx.closePath();
                    tCtx.clip();
                }
            }
        }

        tCtx.fillStyle = grad;
        tCtx.fillRect(0, 0, temp.width, temp.height);
        tCtx.restore();

        if (hasSel) {
            tCtx.globalCompositeOperation = 'destination-in';
            tCtx.drawImage(sel.mask!, 0, 0);
        }

        l.ctx.save();
        l.ctx.globalCompositeOperation = 'source-over';
        l.ctx.drawImage(temp, 0, 0);
        l.ctx.restore();

        App.recordAction(`api.applyFilter('gradient', ${JSON.stringify({
            type: this.settings.type,
            colors: this.settings.colors,
            strict: this.settings.strict,
            sx, sy, ex, ey
        })});`);

        this.startPos = null;
        App.render();
    }
});