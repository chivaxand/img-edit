import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';

Filters.register('solid-fill', {
    name: 'Solid Fill',
    mode: 'pixel',
    menu: {
        path: 'Generate',
        label: 'Solid Fill...',
        order: 1
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            color: '#007acc',
            opacity: 100,
            replace: false
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createColorRow({
            label: 'Color',
            value: state.color,
            onChange: (v: string) => { state.color = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Opacity',
            min: 0,
            max: 100,
            value: state.opacity,
            onInput: (v: any) => { state.opacity = parseInt(v); update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Replace Content',
            value: state.replace,
            onChange: (v: boolean) => { state.replace = v; update(); }
        }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { color, opacity, replace } = params;
        const alpha = opacity / 100;

        const parseHex = (hex: string) => {
            if (!hex) return { r: 0, g: 0, b: 0 };
            const clean = hex.replace('#', '');
            const num = parseInt(clean, 16);
            return {
                r: (num >> 16) & 255,
                g: (num >> 8) & 255,
                b: num & 255
            };
        };

        const col = parseHex(color);

        for (let i = 0; i < data.length; i += 4) {
            if (replace) {
                data[i]     = col.r;
                data[i + 1] = col.g;
                data[i + 2] = col.b;
                data[i + 3] = Math.round(alpha * 255);
            } else {
                data[i]     = Math.round(data[i] * (1 - alpha) + col.r * alpha);
                data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + col.g * alpha);
                data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + col.b * alpha);
                data[i + 3] = 255;
            }
        }
    }
});