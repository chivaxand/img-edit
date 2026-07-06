import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('threshold', {
    name: 'Threshold',
    mode: 'pixel',
    menu: {
        path: 'Tone',
        label: 'Threshold...',
        order: 11
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            level: 128
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Converts the image to black and white based on a luminance threshold.'));

        container.appendChild(UI.createSliderRow({
            label: 'Threshold', min: 0, max: 255, step: 1, value: state.level,
            onInput: v => { state.level = parseInt(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { level }: any) {
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
            // Calculate Luminance (Rec. 601)
            const lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
            
            // Apply Threshold
            const val = lum >= level ? 255 : 0;
            
            data[i]   = val;
            data[i+1] = val;
            data[i+2] = val;
            // data[i+3] (Alpha) is preserved
        }
    }
});
