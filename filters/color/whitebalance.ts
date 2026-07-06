import { App } from '~/app';
import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('whitebalance', {
    name: 'White Balance / Color Correction',
    mode: 'pixel',
    menu: {
        path: 'Color',
        label: 'White Balance...',
        order: 101
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { color: '#ffffff', temp: 0, tint: 0, manR: 0, manG: 0, manB: 0, preserveLuma: false };
        const update = () => hooks.preview(state);
        
        // Thumbnail with Eye Dropper
        const canvasObj = UI.createCanvas({
            source: layer.canvas,
            on: { click: (e: Event) => pick(e as MouseEvent) }
        });
        const cvs = canvasObj.element;
        const ctx = canvasObj.ctx!;
        
        container.appendChild(UI.createNode('div', {className:'popup-hint'}, 'Pick a neutral color to auto-correct, or use sliders below.'));
        container.appendChild(cvs);

        // Current Reference Display
        const swatch = UI.createNode('div', { className:'c-swatch', style:`background:${state.color}; display:inline-block; position:static; width:20px; height:20px; border:1px solid #555; vertical-align:middle;` });
        const valLabel = UI.createNode('span', { style:'margin-left:10px; font-family:monospace; color:#fff;' }, 'Reference');
        container.appendChild(UI.createRow('Picker', UI.createNode('div', {}, swatch, valLabel)));

        // Sliders
        container.appendChild(UI.createNode('div', {className:'popup-subtitle'}, 'Global Temperature'));
        container.appendChild(UI.createSliderRow({ label: 'Temp', min: -100, max: 100, value: state.temp, onInput: v => { state.temp = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Tint', min: -100, max: 100, value: state.tint, onInput: v => { state.tint = parseInt(v); update(); } }));

        container.appendChild(UI.createNode('div', {className:'popup-subtitle'}, 'Manual Channels'));
        
        // Helper for colored labels
        const coloredRow = (lbl: string, val: number, color: string, setter: (v: string) => void) => {
            const row = UI.createSliderRow({ label: lbl, min: -100, max: 100, value: val, onInput: setter });
            row.style.color = color;
            return row;
        };

        container.appendChild(coloredRow('Red', state.manR, '#ff8888', v => { state.manR = parseInt(v); update(); }));
        container.appendChild(coloredRow('Green', state.manG, '#88ff88', v => { state.manG = parseInt(v); update(); }));
        container.appendChild(coloredRow('Blue', state.manB, '#8888ff', v => { state.manB = parseInt(v); update(); }));

        container.appendChild(UI.createCheckbox({ label: 'Preserve Luminosity', value: state.preserveLuma, onChange: v => { state.preserveLuma = v; update(); } }));

        const pick = (e: MouseEvent) => {
            const r = cvs.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            const p = ctx.getImageData(x, y, 1, 1).data;
            const hex = App.utils.rgbToHex(p[0], p[1], p[2]);
            state.color = hex;
            swatch.style.background = hex;
            valLabel.textContent = `R${p[0]} G${p[1]} B${p[2]}`;
            update();
        };
        
        update();
    },
    
    process(data: Uint8ClampedArray, w: number, h: number, { color, temp, tint, manR, manG, manB, preserveLuma }: any) {
        const rgb = App.utils.hexToRgb(color)!;
        
        // Calculate Base Multipliers (Picker)
        // Goal: Bring the picked color to Neutral White (255, 255, 255)
        const sr = Math.max(rgb.r, 1);
        const sg = Math.max(rgb.g, 1);
        const sb = Math.max(rgb.b, 1);
        
        // Using 255 as target essentially "Exposes to the right" based on the picked pixel
        let gr = 255 / sr;
        let gg = 255 / sg;
        let gb = 255 / sb;
        
        // Apply Temp / Tint
        // Temp: +Warm (Boost R, Cut B)
        const t = temp / 100;
        const tn = tint / 100;

        gr *= Math.pow(1.2, t);
        gb *= Math.pow(1.2, -t);
        gg *= Math.pow(1.2, -tn); // Tint: Green vs Magenta

        // Apply Manual Channel Gains
        // Mapping: -100 -> 0.5x, 0 -> 1x, 100 -> 2x
        const getManMult = (v: number) => v >= 0 ? (1 + v/100) : (1 / (1 + Math.abs(v)/100));
        gr *= getManMult(manR);
        gg *= getManMult(manG);
        gb *= getManMult(manB);

        // Normalize Gains for "Default" Exposure behavior
        if (!preserveLuma) {
            const lumaSrc = sr*0.299 + sg*0.587 + sb*0.114;
            const lumaDst = (sr*gr)*0.299 + (sg*gg)*0.587 + (sb*gb)*0.114;
            const norm = lumaDst > 0 ? (lumaSrc / lumaDst) : 1;
            gr *= norm;
            gg *= norm;
            gb *= norm;
        }

        // Apply to Pixels
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];

            let nr = r * gr;
            let ng = g * gg;
            let nb = b * gb;

            if (preserveLuma) {
                const lo = r*0.299 + g*0.587 + b*0.114;
                const ln = nr*0.299 + ng*0.587 + nb*0.114;
                
                if (ln > 0.1) {
                    const scale = lo / ln;
                    nr *= scale;
                    ng *= scale;
                    nb *= scale;
                }
            }

            data[i]   = Math.min(255, nr);
            data[i+1] = Math.min(255, ng);
            data[i+2] = Math.min(255, nb);
        }
    }
});
