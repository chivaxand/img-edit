import { Filters } from '../../filters';
import { UI } from '../../ui';
import { Layer } from '../../layers';
import { Lib } from '../../libs/index';

Filters.register('median', {
    name: 'Median',
    mode: 'pixel',
    menu: {
        path: 'Filter/Denoise',
        label: 'Median...',
        order: 1
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            radius: 2
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Removes salt-and-pepper noise by replacing each pixel with the median of its neighbors.'));

        container.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 10, step: 1, value: state.radius,
            onInput: (v: string) => { state.radius = parseInt(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { radius }: any) {
        if (radius <= 0) return;
        
        const src = new Uint8ClampedArray(data);
        const winSize = (2 * radius + 1) ** 2;
        
        // Arrays to hold neighborhood values for sorting
        const rVals = new Uint8Array(winSize);
        const gVals = new Uint8Array(winSize);
        const bVals = new Uint8Array(winSize);

        for (let y = 0; y < h; y++) {
            const yMin = Math.max(0, y - radius);
            const yMax = Math.min(h - 1, y + radius);
            
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const xMin = Math.max(0, x - radius);
                const xMax = Math.min(w - 1, x + radius);
                
                let count = 0;

                // Collect neighbors
                for (let ny = yMin; ny <= yMax; ny++) {
                    const rowOffset = ny * w;
                    for (let nx = xMin; nx <= xMax; nx++) {
                        const nIdx = (rowOffset + nx) * 4;
                        rVals[count] = src[nIdx];
                        gVals[count] = src[nIdx + 1];
                        bVals[count] = src[nIdx + 2];
                        count++;
                    }
                }

                // If boundary (partial window), sorting partial array is needed.
                // For simplicity/speed we just sort the valid count.
                const rSort = rVals.subarray(0, count).sort();
                const gSort = gVals.subarray(0, count).sort();
                const bSort = bVals.subarray(0, count).sort();
                
                const m = Math.floor(count / 2);
                
                data[idx] = rSort[m];
                data[idx + 1] = gSort[m];
                data[idx + 2] = bSort[m];
            }
        }
    }
});
