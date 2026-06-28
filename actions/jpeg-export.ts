import { App } from '~/app';
import { UI } from '~/ui';
import { Layers } from '~/layers';

export const JpegExport = {
    settings: {
        quality: 90,
        bgColor: '#ffffff'
    },

    open() {
        this.renderUI();
    },

    renderUI() {
        const content = UI.createNode('div', { style: 'display:flex; flex-direction:column; gap:12px; min-width:280px; padding:5px;' });

        // Quality setting (0 - 100)
        const qualitySlider = UI.createSliderRow({
            label: 'Quality (%)',
            min: 0,
            max: 100,
            value: this.settings.quality,
            onInput: (v: string) => this.settings.quality = parseInt(v)
        });

        // Background color for transparency replacement
        const colorRow = UI.createColorRow({
            label: 'BG Color',
            value: this.settings.bgColor,
            onChange: (v: string) => this.settings.bgColor = v
        });

        content.appendChild(qualitySlider);
        content.appendChild(colorRow);

        // Export and Cancel actions
        const btnRow = UI.createNode('div', { className: 'popup-actions' });
        const btnClose = UI.createNode('button', { className: 'btn cancel-btn', textContent: 'Cancel', on: { click: () => App.popup!.close() } });
        const btnExport = UI.createNode('button', { className: 'btn', textContent: 'Export JPEG', on: { click: () => this.generate() } });

        btnRow.appendChild(btnClose);
        btnRow.appendChild(btnExport);
        content.appendChild(btnRow);

        App.popup!.setHtml('<h3>Export JPEG</h3>');
        const body = App.popup!.content;
        body.innerHTML = '';
        body.appendChild(content);

        App.popup!.show();
    },

    generate() {
        const canvasW = App.state.width;
        const canvasH = App.state.height;

        const tempCv = document.createElement('canvas');
        tempCv.width = canvasW;
        tempCv.height = canvasH;
        const tempCtx = tempCv.getContext('2d')!;

        // Replace transparency with the selected background color
        tempCtx.fillStyle = this.settings.bgColor;
        tempCtx.fillRect(0, 0, canvasW, canvasH);

        // Render layers visually from bottom to top
        for (let i = App.state.layers.length - 1; i >= 0; i--) {
            const l = App.state.layers[i];
            if (l.visible) {
                tempCtx.save();
                tempCtx.globalAlpha = l.opacity;
                tempCtx.globalCompositeOperation = (l.blend || 'source-over') as GlobalCompositeOperation;
                
                Layers.render(tempCtx, l);
                
                tempCtx.restore();
            }
        }

        // Dynamically resolve filename from loaded state parameters
        let baseName = 'export';
        const stateAny = App.state as any;
        if (stateAny.filename) {
            const parts = String(stateAny.filename).split('.');
            if (parts.length > 1) parts.pop();
            baseName = parts.join('.');
        } else if (stateAny.name) {
            const parts = String(stateAny.name).split('.');
            if (parts.length > 1) parts.pop();
            baseName = parts.join('.');
        }

        const qualityVal = Math.max(0, Math.min(100, this.settings.quality)) / 100;
        const dataUrl = tempCv.toDataURL('image/jpeg', qualityVal);

        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${baseName}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        App.recordAction(`api.exportJPEG(${this.settings.quality}, '${this.settings.bgColor}');`);

        App.popup!.close();
    }
};