import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

interface GifFrame {
    id: number;
    layer: Layer;
    include: boolean;
    delay: number;
}

export const GifExport = {
    settings: {
        loop: 0,
        globalDelay: 500, // ms
    },
    frames: [] as GifFrame[],
    listContainer: null as HTMLElement | null,

    open() {
        this.frames = App.state.layers.map((l: Layer) => ({
            id: l.id,
            layer: l,
            include: l.visible,
            delay: 100 // default 100ms
        }));

        this.renderUI();
    },

    renderUI() {
        const content = UI.createNode('div', { style: 'display:flex; flex-direction:column; gap:10px; height:100%;' });

        // --- 1. Global Settings & Tools ---
        const settingsGroup = UI.createNode('div', { 
            style: 'padding-bottom:10px; border-bottom:1px solid #3e3e42; display:flex; justify-content:space-between; align-items:center;' 
        });
        
        // Loop Option
        const loopWrap = UI.createNode('div', { style: 'display:flex; align-items:center;' });
        loopWrap.appendChild(UI.createCheckbox({
            label: 'Loop',
            value: this.settings.loop === 0,
            onChange: (b: boolean) => this.settings.loop = b ? 0 : 1
        }));
        settingsGroup.appendChild(loopWrap);

        // Reverse Button
        const btnReverse = UI.createNode('button', { 
            className: 'btn', 
            style: 'padding: 4px 8px; font-size:11px; background:#444;',
            textContent: 'Reverse Order',
            title: 'Reverse frame order',
            on: { click: () => {
                this.frames.reverse();
                this.refreshList();
            }}
        });
        settingsGroup.appendChild(btnReverse);

        // --- 2. Frame List Container ---
        this.listContainer = UI.createNode('div', { 
            className: 'gif-list-container',
            style: 'max-height:350px; overflow-y:auto; background:#1e1e1e; border:1px solid #3e3e42; padding:2px;' 
        });

        // --- 3. Footer ---
        const footer = UI.createNode('div', { style:'display:flex; flex-direction:column; gap:10px; margin-top:5px;' });
        footer.appendChild(UI.createNode('div', { className:'popup-hint' }, 'Drag items to reorder. Frames play Top-to-Bottom.'));

        const btnRow = UI.createNode('div', { className: 'popup-actions' });
        const btnClose = UI.createNode('button', { className: 'btn cancel-btn', textContent: 'Close', on: { click: () => App.popup!.close() } });
        const btnExport = UI.createNode('button', { className: 'btn', textContent: 'Export GIF', on: { click: () => this.generate() } });

        btnRow.appendChild(btnClose);
        btnRow.appendChild(btnExport);
        footer.appendChild(btnRow);

        content.appendChild(settingsGroup);
        content.appendChild(this.listContainer);
        content.appendChild(footer);

        App.popup!.setHtml('<h3>Export GIF</h3>');
        const body = App.popup!.content;
        body.innerHTML = '';
        body.appendChild(content);
        
        this.refreshList();
        
        App.popup!.show();
    },

    refreshList() {
        if (!this.listContainer) return;
        this.listContainer.innerHTML = '';
        this.frames.forEach((f, index) => {
            const row = this.createFrameRow(f, index);
            this.listContainer!.appendChild(row);
        });
    },

    createFrameRow(f: GifFrame, index: number) {
        const row = UI.createNode('div', { 
            draggable: 'true',
            style: 'display:flex; align-items:center; gap:8px; padding:6px; border-bottom:1px solid #333; font-size:12px; background:#252526; user-select:none;',
            dataset: { index: index.toString() }
        });

        row.addEventListener('dragstart', (e: DragEvent) => {
            e.dataTransfer!.setData('text/plain', index.toString());
            e.dataTransfer!.effectAllowed = 'move';
            row.style.opacity = '0.5';
        });
        
        row.addEventListener('dragend', () => {
            row.style.opacity = '1';
            // Clear any drop indicators
            if (this.listContainer) {
                Array.from(this.listContainer.children).forEach(c => (c as HTMLElement).style.borderTop = 'none');
            }
        });

        row.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault(); 
            e.dataTransfer!.dropEffect = 'move';
            row.style.borderTop = '2px solid #007acc';
        });

        row.addEventListener('dragleave', () => {
            row.style.borderTop = 'none';
        });

        row.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            row.style.borderTop = 'none';
            const fromIdx = parseInt(e.dataTransfer!.getData('text/plain'));
            const toIdx = index;
            
            if (fromIdx !== toIdx && !isNaN(fromIdx)) {
                // Move item in array
                const item = this.frames.splice(fromIdx, 1)[0];
                this.frames.splice(toIdx, 0, item);
                // Re-render
                this.refreshList();
            }
        });

        // --- Row Content ---
        // Grab Handle
        row.appendChild(UI.createNode('span', { 
            style: 'cursor:grab; color:#555; font-size:14px; padding:0 4px;', 
            textContent: '☰' 
        }));

        // Checkbox (Include)
        row.appendChild(UI.createInput('checkbox', { checked: f.include }, (t: HTMLInputElement) => f.include = t.checked));
        
        // Thumbnail
        row.appendChild(UI.createNode('img', { 
            src: f.layer.canvas.toDataURL(), 
            style: 'width:32px; height:32px; object-fit:contain; background:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMCAwSDRWNEgwem00IDhIOFY0SDR6IiBmaWxsPSIjY2NjIi8+PC9zdmc+"); border:1px solid #555;' 
        }));

        // Info Text
        row.appendChild(UI.createNode('div', { style: 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' },
            UI.createNode('div', { style: 'font-weight:bold' }, `Frame ${index + 1}`),
            UI.createNode('div', { style: 'color:#888' }, f.layer.name)
        ));

        // Delay Input
        row.appendChild(UI.createNode('span', { style:'color:#aaa' }, 'ms:'));
        row.appendChild(UI.createInput('number', { 
            value: f.delay, 
            style: 'width:60px; text-align:right;',
            min: 10, step: 10
        }, (t: HTMLInputElement) => f.delay = parseInt(t.value)));

        return row;
    },

    generate() {
        const validFrames = this.frames.filter(f => f.include);
        if (validFrames.length === 0) {
            alert("No frames selected.");
            return;
        }

        const btn = App.popup!.content.querySelector('button.btn:last-child') as HTMLButtonElement;
        const oldText = btn.textContent;
        btn.textContent = 'Processing...';
        btn.disabled = true;

        setTimeout(() => {
            try {
                const canvasW = App.state.width;
                const canvasH = App.state.height;
                const gif = new Lib.gif.Writer(canvasW, canvasH, { loop: this.settings.loop });

                validFrames.forEach(f => {
                    const l = f.layer;
                    const rect = Lib.canvas.getIntersection(l, canvasW, canvasH);

                    if (rect.w > 0 && rect.h > 0) {
                        const { canvas: tempCv, ctx: tempCtx } = Lib.canvas.create(rect.w, rect.h);
                        tempCtx.drawImage(l.canvas, rect.sx, rect.sy, rect.w, rect.h, 0, 0, rect.w, rect.h);

                        const delayCS = Math.max(1, Math.round(f.delay / 10));

                        gif.addFrame(tempCv, {
                            x: rect.x, 
                            y: rect.y,
                            delay: delayCS,
                            disposal: 2, 
                            transparent: 255
                        });
                    }
                });

                const data = gif.end();
                const blob = new Blob([data], { type: 'image/gif' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = 'animation.gif';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                const frameSettings = this.frames.map(f => ({
                    id: f.id,
                    include: f.include,
                    delay: f.delay
                }));
                App.recordAction(`api.exportGIF(${this.settings.loop}, ${JSON.stringify(frameSettings)});`);
            } catch (e: any) {
                console.error(e);
                alert("Error generating GIF: " + e.message);
            } finally {
                btn.textContent = oldText;
                btn.disabled = false;
            }
        }, 50);
    }
};
