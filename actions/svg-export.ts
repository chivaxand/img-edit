import { App } from '~/app';
import { UI } from '~/ui';
import { Layers } from '~/layers';

export const SvgExport = {
    settings: {
        width: 800,
        height: 600,
        unit: 'mm',
        dpi: 300,
        keepRatio: true,
        format: 'image/png',
        quality: 90,
        bgColor: '#ffffff'
    },

    toInches(val: number, unit: string, dpi: number) {
        if (unit === 'px') return val / dpi;
        if (unit === 'mm') return val / 25.4;
        if (unit === 'cm') return val / 2.54;
        if (unit === 'mil') return val / 1000;
        return val; // 'in'
    },

    fromInches(inches: number, unit: string, dpi: number) {
        if (unit === 'px') return Number((inches * dpi).toFixed(0));
        if (unit === 'mm') return Number((inches * 25.4).toFixed(2));
        if (unit === 'cm') return Number((inches * 2.54).toFixed(2));
        if (unit === 'mil') return Number((inches * 1000).toFixed(2));
        return Number(inches.toFixed(2)); // 'in'
    },

    fromPixels(px: number, unit: string, dpi: number) {
        return this.fromInches(px / dpi, unit, dpi);
    },

    convertUnit(val: number, from: string, to: string, dpi: number) {
        return this.fromInches(this.toInches(val, from, dpi), to, dpi);
    },

    open() {
        this.settings.unit = 'mm';
        this.settings.dpi = 300;
        this.settings.width = this.fromPixels(App.state.width, this.settings.unit, this.settings.dpi);
        this.settings.height = this.fromPixels(App.state.height, this.settings.unit, this.settings.dpi);
        this.renderUI();
    },

    renderUI() {
        const content = UI.createNode('div', { style: 'display:flex; flex-direction:column; gap:12px; min-width:320px; padding:5px;' });

        const unitOptions = [
            { value: 'mm', text: 'Millimeters (mm)' },
            { value: 'cm', text: 'Centimeters (cm)' },
            { value: 'in', text: 'Inches (in)' },
            { value: 'mil', text: 'Mils (mil)' },
            { value: 'px', text: 'Pixels (px)' }
        ];

        const formatOptions = [
            { value: 'image/png', text: 'PNG (Lossless)' },
            { value: 'image/jpeg', text: 'JPEG (Lossy)' }
        ];

        let wInp: HTMLInputElement;
        let hInp: HTMLInputElement;
        let dpiInp: HTMLInputElement;

        const updateInputs = () => {
            if (wInp) wInp.value = this.settings.width.toString();
            if (hInp) hInp.value = this.settings.height.toString();
            if (dpiInp) dpiInp.value = this.settings.dpi.toString();
        };

        dpiInp = UI.createInput('number', { value: this.settings.dpi }, (t: HTMLInputElement) => {
            const newDpi = parseInt(t.value) || 300;
            if (newDpi > 0) {
                this.settings.dpi = newDpi;
                this.settings.width = this.fromPixels(App.state.width, this.settings.unit, this.settings.dpi);
                this.settings.height = this.fromPixels(App.state.height, this.settings.unit, this.settings.dpi);
                updateInputs();
            }
        });
        const dpiRow = UI.createRow('DPI', dpiInp);

        const unitRow = UI.createSelectRow({
            label: 'Unit',
            options: unitOptions,
            value: this.settings.unit,
            onChange: (v: string) => {
                this.settings.width = this.convertUnit(this.settings.width, this.settings.unit, v, this.settings.dpi);
                this.settings.height = this.convertUnit(this.settings.height, this.settings.unit, v, this.settings.dpi);
                this.settings.unit = v;
                updateInputs();
            }
        });

        wInp = UI.createInput('number', { value: this.settings.width, step: 'any' }, (t: HTMLInputElement) => {
            const newW = parseFloat(t.value) || 0;
            this.settings.width = newW;

            const inches = this.toInches(newW, this.settings.unit, this.settings.dpi);
            if (inches > 0) {
                this.settings.dpi = Math.round(App.state.width / inches);
            }

            if (this.settings.keepRatio && App.state.width > 0) {
                this.settings.height = parseFloat((this.settings.width * (App.state.height / App.state.width)).toFixed(2));
            }
            updateInputs();
        });

        hInp = UI.createInput('number', { value: this.settings.height, step: 'any' }, (t: HTMLInputElement) => {
            const newH = parseFloat(t.value) || 0;
            this.settings.height = newH;

            const inches = this.toInches(newH, this.settings.unit, this.settings.dpi);
            if (inches > 0) {
                this.settings.dpi = Math.round(App.state.height / inches);
            }

            if (this.settings.keepRatio && App.state.height > 0) {
                this.settings.width = parseFloat((this.settings.height * (App.state.width / App.state.height)).toFixed(2));
            }
            updateInputs();
        });

        const dimRow = UI.createRow('Size', UI.createNode('div', { style: 'display:flex; gap:5px; align-items:center;' }, 
            wInp, UI.createNode('span', {}, 'x'), hInp
        ));

        const ratioRow = UI.createCheckbox({
            label: 'Keep Aspect Ratio',
            value: this.settings.keepRatio,
            onChange: (v: boolean) => this.settings.keepRatio = v
        });

        const formatRow = UI.createSelectRow({
            label: 'Image Format',
            options: formatOptions,
            value: this.settings.format,
            onChange: (v: string) => {
                this.settings.format = v;
                qualitySlider.style.display = v === 'image/jpeg' ? 'flex' : 'none';
                colorRow.style.display = v === 'image/jpeg' ? 'flex' : 'none';
            }
        });

        const qualitySlider = UI.createSliderRow({
            label: 'JPEG Quality',
            min: 0, max: 100, value: this.settings.quality,
            onInput: (v: string) => this.settings.quality = parseInt(v)
        });
        qualitySlider.style.display = this.settings.format === 'image/jpeg' ? 'flex' : 'none';

        const colorRow = UI.createColorRow({
            label: 'BG Color',
            value: this.settings.bgColor,
            onChange: (v: string) => this.settings.bgColor = v
        });
        colorRow.style.display = this.settings.format === 'image/jpeg' ? 'flex' : 'none';

        content.appendChild(dpiRow);
        content.appendChild(unitRow);
        content.appendChild(dimRow);
        content.appendChild(ratioRow);
        content.appendChild(formatRow);
        content.appendChild(qualitySlider);
        content.appendChild(colorRow);

        const btnRow = UI.createNode('div', { className: 'popup-actions' });
        const btnClose = UI.createNode('button', { className: 'btn cancel-btn', textContent: 'Cancel', on: { click: () => App.popup!.close() } });
        const btnExport = UI.createNode('button', { className: 'btn', textContent: 'Export SVG', on: { click: () => this.generate() } });

        btnRow.appendChild(btnClose);
        btnRow.appendChild(btnExport);
        content.appendChild(btnRow);

        App.popup!.setHtml('<h3>Export SVG</h3>');
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

        if (this.settings.format === 'image/jpeg') {
            tempCtx.fillStyle = this.settings.bgColor;
            tempCtx.fillRect(0, 0, canvasW, canvasH);
        }

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
        const dataUrl = tempCv.toDataURL(this.settings.format, qualityVal);

        let svgUnitStrW = this.settings.unit === 'px' ? '' : this.settings.unit;
        let svgUnitStrH = this.settings.unit === 'px' ? '' : this.settings.unit;
        let finalW = this.settings.width;
        let finalH = this.settings.height;

        // SVG specification does not support "mil", so convert to inches internally
        if (this.settings.unit === 'mil') {
            finalW = this.settings.width / 1000;
            finalH = this.settings.height / 1000;
            svgUnitStrW = 'in';
            svgUnitStrH = 'in';
        }

        const svgString = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${finalW}${svgUnitStrW}" height="${finalH}${svgUnitStrH}" viewBox="0 0 ${canvasW} ${canvasH}">
    <image href="${dataUrl}" xlink:href="${dataUrl}" width="${canvasW}" height="${canvasH}" />
</svg>`;

        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        App.recordAction(`api.exportSVG(${JSON.stringify(this.settings)});`);
        App.popup!.close();
    }
};
