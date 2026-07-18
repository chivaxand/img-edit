import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('levels', {
    name: 'Levels',
    mode: 'pixel',
    menu: {
        path: 'Tone',
        label: 'Levels...',
        order: 5
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        // Analyze Histogram (R, G, B, A separately)
        const w = layer.canvas.width, h = layer.canvas.height;
        const srcData = layer.ctx.getImageData(0, 0, w, h).data;
        
        const histR = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 0), { bins: 256, range: [0, 255] });
        const histG = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 1), { bins: 256, range: [0, 255] });
        const histB = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 2), { bins: 256, range: [0, 255] });
        const histA = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 3), { bins: 256, range: [0, 255] });
        let maxCount = 0;
        let maxCountAlpha = 0;

        // Find global max for scaling
        for (let i = 0; i < 256; i++) {
            maxCount = Math.max(maxCount, histR[i], histG[i], histB[i]);
            maxCountAlpha = Math.max(maxCountAlpha, histA[i]);
        }

        // State: Store per-channel settings
        const state: Record<string, any> = {
            channel: 'rgb',
            rgb: { min: 0, max: 255, outMin: 0, outMax: 255 },
            r: { min: 0, max: 255, outMin: 0, outMax: 255 },
            g: { min: 0, max: 255, outMin: 0, outMax: 255 },
            b: { min: 0, max: 255, outMin: 0, outMax: 255 },
            a: { min: 0, max: 255, outMin: 0, outMax: 255 }
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
                rebuildSliders();
                updateGraph();
            }
        }));

        const slidersContainer = UI.createNode('div');
        container.appendChild(slidersContainer);

        const rebuildSliders = () => {
            slidersContainer.innerHTML = '';
            const ch = state.channel;
            const cur = state[ch];

            const inputSlider = UI.createMultiSlider({
                label: 'Input Levels', min: 0, max: 255, step: 1,
                handles: [
                    { id: 'min', value: cur.min, color: '#000000', label: 'Black' },
                    { id: 'max', value: cur.max, color: '#ffffff', label: 'White' }
                ],
                onInput: (values) => {
                    cur.min = values.min as number;
                    cur.max = values.max as number;
                    if (ch === 'rgb') {
                        state.r.min = cur.min; state.r.max = cur.max;
                        state.g.min = cur.min; state.g.max = cur.max;
                        state.b.min = cur.min; state.b.max = cur.max;
                    }
                    updatePreview();
                }
            });

            const outputSlider = UI.createMultiSlider({
                label: 'Output Levels', min: 0, max: 255, step: 1,
                handles: [
                    { id: 'outMin', value: cur.outMin, color: '#444444', label: 'Min' },
                    { id: 'outMax', value: cur.outMax, color: '#dddddd', label: 'Max' }
                ],
                onInput: (values) => {
                    cur.outMin = values.outMin as number;
                    cur.outMax = values.outMax as number;
                    if (ch === 'rgb') {
                        state.r.outMin = cur.outMin; state.r.outMax = cur.outMax;
                        state.g.outMin = cur.outMin; state.g.outMax = cur.outMax;
                        state.b.outMin = cur.outMin; state.b.outMax = cur.outMax;
                    }
                    updatePreview();
                }
            });

            slidersContainer.appendChild(inputSlider);
            slidersContainer.appendChild(outputSlider);
        };

        rebuildSliders();
        updateGraph();
        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        // Generate LUTs for each channel
        const createLut = (min: number, max: number, outMin: number = 0, outMax: number = 255) => {
            const range = max - min;
            const factor = range === 0 ? 0 : 1 / range;
            const lut = new Uint8Array(256);
            for (let i = 0; i < 256; i++) {
                const normalized = Math.max(0, Math.min(1, (i - min) * factor));
                lut[i] = Math.max(0, Math.min(255, Math.round(outMin + normalized * (outMax - outMin))));
            }
            return lut;
        };

        const getChannelParams = (ch: any) => {
            return {
                min: ch?.min !== undefined ? ch.min : 0,
                max: ch?.max !== undefined ? ch.max : 255,
                outMin: ch?.outMin !== undefined ? ch.outMin : 0,
                outMax: ch?.outMax !== undefined ? ch.outMax : 255
            };
        };

        const r = getChannelParams(params.r);
        const g = getChannelParams(params.g);
        const b = getChannelParams(params.b);
        const a = getChannelParams(params.a);

        // Handle legacy/simple params (if just min/max provided without channels)
        if (params.min !== undefined && params.r === undefined) {
            r.min = g.min = b.min = params.min;
            r.max = g.max = b.max = params.max;
        }

        const lutR = createLut(r.min, r.max, r.outMin, r.outMax);
        const lutG = createLut(g.min, g.max, g.outMin, g.outMax);
        const lutB = createLut(b.min, b.max, b.outMin, b.outMax);
        const lutA = createLut(a.min, a.max, a.outMin, a.outMax);

        for (let i = 0; i < data.length; i += 4) {
            data[i]   = lutR[data[i]];
            data[i+1] = lutG[data[i+1]];
            data[i+2] = lutB[data[i+2]];
            data[i+3] = lutA[data[i+3]];
        }
    }
});
