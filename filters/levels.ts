import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('levels', {
    name: 'Levels',
    mode: 'pixel',
    
    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        // Analyze Histogram (R, G, B, A separately)
        const w = layer.canvas.width, h = layer.canvas.height;
        const srcData = layer.ctx.getImageData(0, 0, w, h).data;
        
        const histR = new Uint32Array(256);
        const histG = new Uint32Array(256);
        const histB = new Uint32Array(256);
        const histA = new Uint32Array(256);
        let maxCount = 0;
        let maxCountAlpha = 0;

        for (let i = 0; i < srcData.length; i += 4) {
            const r = srcData[i];
            const g = srcData[i + 1];
            const b = srcData[i + 2];
            const a = srcData[i + 3];
            histR[r]++;
            histG[g]++;
            histB[b]++;
            histA[a]++;
        }

        // Find global max for scaling
        for (let i = 0; i < 256; i++) {
            maxCount = Math.max(maxCount, histR[i], histG[i], histB[i]);
            maxCountAlpha = Math.max(maxCountAlpha, histA[i]);
        }

        // State: Store per-channel settings
        const state: Record<string, any> = {
            channel: 'rgb',
            rgb: { min: 0, max: 255 },
            r: { min: 0, max: 255 },
            g: { min: 0, max: 255 },
            b: { min: 0, max: 255 },
            a: { min: 0, max: 255 }
        };

        // Draw Graph
        const canvasObj = UI.createCanvas({ width: 360, height: 100, style: { width: '100%', background: '#222' } });
        const cvs = canvasObj.element;
        const ctx = canvasObj.ctx!;
        container.appendChild(cvs);

        // Helper to draw one channel
        const drawChannel = (hist: Uint32Array, maxCount: number, color: string) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(0, cvs.height);
            const step = cvs.width / 255;
            const maxValue = Math.sqrt(maxCount);

            for (let i = 0; i < 256; i++) {
                const count = hist[i];
                if (count === 0) continue;
                const h = (Math.sqrt(count) / maxValue) * cvs.height; 
                ctx.rect(i * step, cvs.height - h, step, h);
            }
            
            ctx.fill();
        };

        const updateGraph = () => {
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            
            // Use 'screen' blend mode to allow colors to mix (Red + Green = Yellow)
            ctx.globalCompositeOperation = 'screen';
            
            if (state.channel === 'rgb') {
                // Only draw R, G, B in master view
                drawChannel(histR, maxCount, '#ff0000');
                drawChannel(histG, maxCount, '#00ff00');
                drawChannel(histB, maxCount, '#0000ff');
            } else if (state.channel === 'r') {
                drawChannel(histR, maxCount, '#ff0000');
            } else if (state.channel === 'g') {
                drawChannel(histG, maxCount, '#00ff00');
            } else if (state.channel === 'b') {
                drawChannel(histB, maxCount, '#0000ff');
            } else if (state.channel === 'a') {
                drawChannel(histA, maxCountAlpha, '#aaaaaa');
            }

            // Draw Limits / Overlay for current channel
            ctx.globalCompositeOperation = 'source-over';
            const cur = state[state.channel];
            const xMin = cur.min * (cvs.width/255);
            const xMax = cur.max * (cvs.width/255);
            
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, 0, xMin, cvs.height); 
            ctx.fillRect(xMax, 0, cvs.width-xMax, cvs.height); 
            
            // Draw limit lines
            ctx.strokeStyle = '#fff'; 
            ctx.beginPath(); ctx.moveTo(xMin, 0); ctx.lineTo(xMin, cvs.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(xMax, 0); ctx.lineTo(xMax, cvs.height); ctx.stroke();
        };

        const updatePreview = () => {
            updateGraph();
            hooks.preview(state);
        };

        // UI Controls
        container.appendChild(UI.createSelectRow({
            label: 'Channel',
            options: [
                { value: 'rgb', text: 'RGB' },
                { value: 'r', text: 'Red' },
                { value: 'g', text: 'Green' },
                { value: 'b', text: 'Blue' },
                { value: 'a', text: 'Alpha' }
            ],
            value: state.channel,
            onChange: v => {
                state.channel = v;
                // Update sliders to match current channel values
                (minSlider.input as HTMLInputElement).value = String(state[v].min);
                (maxSlider.input as HTMLInputElement).value = String(state[v].max);
                // Trigger event to update text display of sliders
                minSlider.input.dispatchEvent(new Event('input')); 
                maxSlider.input.dispatchEvent(new Event('input'));
                updateGraph();
            }
        }));

        const onSliderChange = (key: string, val: string) => {
            const v = parseInt(val);
            const ch = state.channel;
            
            state[ch][key] = v;

            // If RGB (Master) is selected, sync R, G, B
            if (ch === 'rgb') {
                state.r[key] = v;
                state.g[key] = v;
                state.b[key] = v;
            }
            updatePreview();
        };

        const minSlider = UI.createSlider({ 
            min: 0, max: 255, value: state.rgb.min, 
            onInput: v => onSliderChange('min', v) 
        });
        
        const maxSlider = UI.createSlider({ 
            min: 0, max: 255, value: state.rgb.max, 
            onInput: v => onSliderChange('max', v) 
        });

        container.appendChild(UI.createRow('Black Point', minSlider.container));
        container.appendChild(UI.createRow('White Point', maxSlider.container));
        
        updateGraph();
        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        // Generate LUTs for each channel
        const createLut = (min: number, max: number) => {
            const range = max - min;
            const factor = 255 / (range === 0 ? 1 : range);
            const lut = new Uint8Array(256);
            for (let i = 0; i < 256; i++) {
                lut[i] = Math.max(0, Math.min(255, (i - min) * factor));
            }
            return lut;
        };

        // If params comes from old history or simple call, default to safe values
        const r = params.r || { min:0, max:255 };
        const g = params.g || { min:0, max:255 };
        const b = params.b || { min:0, max:255 };
        const a = params.a || { min:0, max:255 };

        // Handle legacy/simple params (if just min/max provided without channels)
        if (params.min !== undefined && params.r === undefined) {
            r.min = g.min = b.min = params.min;
            r.max = g.max = b.max = params.max;
        }

        const lutR = createLut(r.min, r.max);
        const lutG = createLut(g.min, g.max);
        const lutB = createLut(b.min, b.max);
        const lutA = createLut(a.min, a.max);

        for (let i = 0; i < data.length; i += 4) {
            data[i]   = lutR[data[i]];
            data[i+1] = lutG[data[i+1]];
            data[i+2] = lutB[data[i+2]];
            data[i+3] = lutA[data[i+3]];
        }
    }
});
