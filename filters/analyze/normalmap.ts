import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('normalmap', {
    name: 'Normal Map',
    mode: 'pixel',
    menu: {
        path: 'Analyze',
        label: 'Normal Map...',
        order: 7
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            gradScale: 5.0,    // Intensity
            gradNormalize: true,
            directXConvention: false
        };

        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const status = UI.createNode('div', { className: 'popup-hint', style: 'white-space: pre-wrap;' }, 'Generates a normal map from image luminance.');

        container.appendChild(UI.createSliderRow({
            label: 'Intensity', min: 1, max: 20, step: 0.5, value: state.gradScale,
            onInput: (v: any) => { state.gradScale = parseFloat(v); hooks.preview(state); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Normalize', value: state.gradNormalize,
            onChange: (v: any) => { state.gradNormalize = v; hooks.preview(state); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'DirectX convention (+Y down)', value: state.directXConvention,
            onChange: (v: any) => { state.directXConvention = v; hooks.preview(state); }
        }));

        container.appendChild(status);
        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { gradScale, gradNormalize, directXConvention } = params;
        const len = w * h;
        const luma = new Float32Array(w * h);
        
        // Convert to Luma
        for (let i = 0, j = 0; i < len * 4; i += 4, j++) {
            luma[j] = data[i] * 0.2126 + data[i+1] * 0.7152 + data[i+2] * 0.0722;
        }
        
        // Compute raw gradients
        const dxs = new Float32Array(w * h);
        const dys = new Float32Array(w * h);
        let maxMag = 0;
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                let dx = 0, dy = 0;

                // Horizontal dx
                if (x > 0 && x < w - 1) dx = (luma[i+1] - luma[i-1]) * 0.5;
                else if (x > 0) dx = luma[i] - luma[i-1];
                else if (x < w - 1) dx = luma[i+1] - luma[i];
                
                // Vertical dy
                if (y > 0 && y < h - 1) dy = (luma[i + w] - luma[i - w]) * 0.5;
                else if (y > 0) dy = luma[i] - luma[i - w];
                else if (y < h - 1) dy = luma[i + w] - luma[i];

                dxs[i] = dx;
                dys[i] = dy;
                
                const mag = Math.sqrt(dxs[i]*dxs[i] + dys[i]*dys[i]);
                if (mag > maxMag) maxMag = mag;
            }
        }
        
        // Global normalization if enabled
        if (gradNormalize && maxMag > 0) {
            const factor = 1 / maxMag;
            for (let i = 0; i < w * h; i++) {
                dxs[i] *= factor;
                dys[i] *= factor;
            }
        }

        // Apply intensity scale
        for (let i = 0; i < w * h; i++) {
            dxs[i] *= gradScale;
            dys[i] *= gradScale;
        }

        // Compute normals map
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const idx = i * 4;
                
                const dx = -dxs[i]; 
                const dy = dys[i];
                const vecMag = Math.sqrt(dx*dx + dy*dy + 1);
                
                const nx = dx / vecMag;
                const ny = dy / vecMag * (directXConvention ? -1 : 1); // Flip Y for DirectX
                const nz = 1 / vecMag;
                
                let r = (nx + 1) * 127.5;
                let g = (ny + 1) * 127.5;
                let b = (nz + 1) * 127.5;
                
                data[idx]   = r < 0 ? 0 : (r > 255 ? 255 : Math.round(r));
                data[idx+1] = g < 0 ? 0 : (g > 255 ? 255 : Math.round(g));
                data[idx+2] = b < 0 ? 0 : (b > 255 ? 255 : Math.round(b));
                data[idx+3] = 255;
            }
        }
    }
});