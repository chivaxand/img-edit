import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('saturate', { 
    name: 'Saturation & Vibrance', 
    mode: 'pixel',
    menu: {
        path: 'Color',
        label: 'Saturation...',
        order: 102
    },

    params: [
        {id:'level', label:'Saturation', type:'range', min:0, max:200, val:100},
        {id:'vibrance', label:'Vibrance', type:'range', min:-100, max:100, val:0}
    ],
    process: (data: Uint8ClampedArray, w: number, h: number, { level, vibrance }: any) => {
        const sat = level / 100; // 0 to 2
        const vib = vibrance / 100; // -1 to 1

        for(let i=0; i<data.length; i+=4) {
            let r = data[i], g = data[i+1], b = data[i+2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

            // Standard Saturation
            if (sat !== 1) {
                r = lum + (r - lum) * sat;
                g = lum + (g - lum) * sat;
                b = lum + (b - lum) * sat;
            }

            // Vibrance
            if (vib !== 0) {
                const max = Math.max(r, Math.max(g, b));
                const min = Math.min(r, Math.min(g, b));
                const currentSat = (max - min) / 255;
                let vibFactor = 1 + (vib * (1 - currentSat));
                r = lum + (r - lum) * vibFactor;
                g = lum + (g - lum) * vibFactor;
                b = lum + (b - lum) * vibFactor;
            }

            data[i]   = Math.max(0, Math.min(255, r));
            data[i+1] = Math.max(0, Math.min(255, g));
            data[i+2] = Math.max(0, Math.min(255, b));
        }
    }
});
