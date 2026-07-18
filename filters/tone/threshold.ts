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
        const state: Record<string, any> = {
            method: 'global',
            channelMode: 'luminance',
            level: 128,
            enableR: true, levelR: 128,
            enableG: true, levelG: 128,
            enableB: true, 
            enableA: false, levelA: 128,
            radius: 15,
            t: 15
        };

        const update = () => {
            updateGraph();
            hooks.preview(state);
        };

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Converts the image to binary/thresholded values globally or adaptively.'));

        // Method Selector
        const methodSelect = UI.createSelectRow({
            label: 'Method',
            options: [
                { value: 'global', text: 'Fixed Threshold' },
                { value: 'adaptive', text: 'Adaptive (Bradley)' }
            ],
            value: state.method,
            onChange: v => {
                state.method = v;
                toggleSections();
                update();
            }
        });
        container.appendChild(methodSelect);

        // Channel Mode Selector
        const channelModeSelect = UI.createSelectRow({
            label: 'Channel Mode',
            options: [
                { value: 'luminance', text: 'Luminance' },
                { value: 'individual', text: 'Per-Channel' }
            ],
            value: state.channelMode,
            onChange: v => {
                state.channelMode = v;
                toggleSections();
                update();
            }
        });
        container.appendChild(channelModeSelect);

        // Analyze Histogram
        const w = layer.canvas.width, h = layer.canvas.height;
        const srcData = layer.ctx.getImageData(0, 0, w, h).data;

        const lum = Lib.image.toGrayscale(srcData, w, h);
        const histLum = Lib.image.histogram(lum, { bins: 256, range: [0, 1] });
        const histR = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 0), { bins: 256, range: [0, 255] });
        const histG = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 1), { bins: 256, range: [0, 255] });
        const histB = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 2), { bins: 256, range: [0, 255] });
        const histA = Lib.image.histogram(Lib.image.extractChannel(srcData, w, h, 3), { bins: 256, range: [0, 255] });

        let maxCountLum = 0;
        let maxCountRGB = 0;
        let maxCountA = 0;
        for (let i = 0; i < 256; i++) {
            maxCountLum = Math.max(maxCountLum, histLum[i]);
            maxCountRGB = Math.max(maxCountRGB, histR[i], histG[i], histB[i]);
            maxCountA = Math.max(maxCountA, histA[i]);
        }

        // Draw Graph
        const canvasObj = UI.createCanvas({ width: 360, height: 100, style: { width: '100%', background: '#222', marginBottom: '10px' } });
        const cvs = canvasObj.element;
        const ctx = canvasObj.ctx!;
        container.appendChild(cvs);

        const updateGraph = () => {
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            
            if (state.channelMode === 'luminance') {
                drawHistogramChannel(ctx, cvs, histLum, maxCountLum, '#888888');
                if (state.method === 'global') {
                    drawThresholdLine(ctx, cvs, state.level, '#ffffff');
                }
            } else {
                ctx.globalCompositeOperation = 'screen';
                if (state.enableR) drawHistogramChannel(ctx, cvs, histR, maxCountRGB, '#ff0000');
                if (state.enableG) drawHistogramChannel(ctx, cvs, histG, maxCountRGB, '#00ff00');
                if (state.enableB) drawHistogramChannel(ctx, cvs, histB, maxCountRGB, '#0000ff');
                if (state.enableA) drawHistogramChannel(ctx, cvs, histA, maxCountA, '#aaaaaa');
                
                ctx.globalCompositeOperation = 'source-over';
                if (state.method === 'global') {
                    if (state.enableR) drawThresholdLine(ctx, cvs, state.levelR, '#ff4444');
                    if (state.enableG) drawThresholdLine(ctx, cvs, state.levelG, '#44ff44');
                    if (state.enableB) drawThresholdLine(ctx, cvs, state.levelB, '#4444ff');
                    if (state.enableA) drawThresholdLine(ctx, cvs, state.levelA, '#aaaaaa');
                }
            }
        };

        // Section: Global Luminance
        const globalLumSection = UI.createStack('vertical', [
            UI.createSliderRow({
                label: 'Threshold', min: 0, max: 255, step: 1, value: state.level,
                onInput: v => { state.level = parseInt(v); update(); }
            })
        ]);

        // Section: Global Individual Channels
        const createChannelControl = (chanName: string, label: string, enableKey: string, levelKey: string) => {
            const sliderRow = UI.createSliderRow({
                label: `${label} Threshold`, min: 0, max: 255, step: 1, value: state[levelKey],
                onInput: v => { state[levelKey] = parseInt(v); update(); }
            });
            UI.toggle(sliderRow, state[enableKey]);

            const checkbox = UI.createCheckbox({
                label: `Apply to ${label}`,
                value: state[enableKey],
                onChange: (val) => {
                    state[enableKey] = val;
                    UI.toggle(sliderRow, val);
                    update();
                }
            });

            const row = UI.createStack('vertical', [checkbox, sliderRow]);

            return { row, sliderRow };
        };

        const rCtrl = createChannelControl('R', 'Red', 'enableR', 'levelR');
        const gCtrl = createChannelControl('G', 'Green', 'enableG', 'levelG');
        const bCtrl = createChannelControl('B', 'Blue', 'enableB', 'levelB');
        const aCtrl = createChannelControl('A', 'Alpha', 'enableA', 'levelA');

        const globalIndivSection = UI.createStack('vertical', [
            rCtrl.row, gCtrl.row, bCtrl.row, aCtrl.row
        ], { style: { gap: '4px' } });

        const otsuBtn = UI.createButton({
            label: 'Auto Threshold (Otsu)',
            style: { width: '100%', marginBottom: '10px' },
            onClick: () => {
                if (state.channelMode === 'luminance') {
                    setSliderValue(globalLumSection, computeOtsu(histLum));
                } else {
                    if (state.enableR) setSliderValue(rCtrl.sliderRow, computeOtsu(histR));
                    if (state.enableG) setSliderValue(gCtrl.sliderRow, computeOtsu(histG));
                    if (state.enableB) setSliderValue(bCtrl.sliderRow, computeOtsu(histB));
                    if (state.enableA) setSliderValue(aCtrl.sliderRow, computeOtsu(histA));
                }
            }
        });
        container.appendChild(otsuBtn);

        container.appendChild(globalLumSection);
        container.appendChild(globalIndivSection);

        // Section: Adaptive parameters
        const adaptiveParamsSection = UI.createStack('vertical', [
            UI.createSliderRow({
                label: 'Radius', min: 1, max: 100, step: 1, value: state.radius,
                onInput: v => { state.radius = parseInt(v); update(); }
            }),
            UI.createSliderRow({
                label: 'Sensitivity (%)', min: 0, max: 50, step: 1, value: state.t,
                onInput: v => { state.t = parseInt(v); update(); }
            })
        ]);
        container.appendChild(adaptiveParamsSection);

        // Section: Adaptive Individual Channel Checkboxes
        const createAdaptiveCheckbox = (label: string, key: string) => {
            return UI.createCheckbox({
                label: `Adaptive ${label}`, value: state[key],
                onChange: val => {
                    state[key] = val;
                    update();
                }
            });
        };

        const adaptiveChecks = UI.createStack('vertical', [
            createAdaptiveCheckbox('Red Channel', 'enableR'),
            createAdaptiveCheckbox('Green Channel', 'enableG'),
            createAdaptiveCheckbox('Blue Channel', 'enableB'),
            createAdaptiveCheckbox('Alpha Channel', 'enableA')
        ], { style: { gap: '6px' } });

        const adaptiveIndivSection = UI.createStack('vertical', [
            UI.createSubheading('Select Channels for Adaptive Threshold:'),
            adaptiveChecks
        ], { style: { gap: '8px', marginBottom: '10px' } });
        container.appendChild(adaptiveIndivSection);

        const toggleSections = () => {
            const isGlobal = state.method === 'global';
            const isLum = state.channelMode === 'luminance';

            UI.toggle(otsuBtn, isGlobal);
            UI.toggle(globalLumSection, isGlobal && isLum);
            UI.toggle(globalIndivSection, isGlobal && !isLum);
            UI.toggle(adaptiveParamsSection, !isGlobal);
            UI.toggle(adaptiveIndivSection, !isGlobal && !isLum);

            if (isGlobal && !isLum) {
                UI.toggle(rCtrl.sliderRow, state.enableR);
                UI.toggle(gCtrl.sliderRow, state.enableG);
                UI.toggle(bCtrl.sliderRow, state.enableB);
                UI.toggle(aCtrl.sliderRow, state.enableA);
            }
        };

        toggleSections();
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const {
            method = 'global',
            channelMode = 'luminance',
            level = 128,
            enableR = true, levelR = 128,
            enableG = true, levelG = 128,
            enableB = true, levelB = 128,
            enableA = false, levelA = 128,
            radius = 15,
            t = 15
        } = params;

        if (method === 'global') {
            if (channelMode === 'luminance') {
                const len = data.length;
                for (let i = 0; i < len; i += 4) {
                    const lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
                    const val = lum >= level ? 255 : 0;
                    data[i]   = val;
                    data[i+1] = val;
                    data[i+2] = val;
                }
            } else {
                const len = data.length;
                for (let i = 0; i < len; i += 4) {
                    if (enableR) data[i]   = data[i] >= levelR ? 255 : 0;
                    if (enableG) data[i+1] = data[i+1] >= levelG ? 255 : 0;
                    if (enableB) data[i+2] = data[i+2] >= levelB ? 255 : 0;
                    if (enableA) data[i+3] = data[i+3] >= levelA ? 255 : 0;
                }
            }
        } else {
            // Adaptive threshold (Bradley)
            const computeIntegralImage = (chanData: Float32Array): Float64Array => {
                const intImg = new Float64Array((w + 1) * (h + 1));
                for (let y = 1; y <= h; y++) {
                    let rowSum = 0;
                    const rowOffset = y * (w + 1);
                    const prevRowOffset = (y - 1) * (w + 1);
                    const srcRowOffset = (y - 1) * w;
                    for (let x = 1; x <= w; x++) {
                        rowSum += chanData[srcRowOffset + (x - 1)];
                        intImg[rowOffset + x] = intImg[prevRowOffset + x] + rowSum;
                    }
                }
                return intImg;
            };

            if (channelMode === 'luminance') {
                const lum = new Float32Array(w * h);
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const idx = (y * w + x) * 4;
                        lum[y * w + x] = data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114;
                    }
                }

                const intImg = computeIntegralImage(lum);
                const intW = w + 1;
                const countFactor = 1.0 - (t / 100);

                for (let y = 0; y < h; y++) {
                    const y0 = Math.max(0, y - radius);
                    const y1 = Math.min(h - 1, y + radius);
                    const y1_offset = (y1 + 1) * intW;
                    const y0_offset = y0 * intW;

                    for (let x = 0; x < w; x++) {
                        const x0 = Math.max(0, x - radius);
                        const x1 = Math.min(w - 1, x + radius);
                        const count = (x1 - x0 + 1) * (y1 - y0 + 1);

                        const sum = intImg[y1_offset + (x1 + 1)] 
                                  + intImg[y0_offset + x0] 
                                  - intImg[y1_offset + x0] 
                                  - intImg[y0_offset + (x1 + 1)];

                        const idx = (y * w + x) * 4;
                        const val = lum[y * w + x];
                        const threshold = (sum / count) * countFactor;
                        const finalVal = val < threshold ? 0 : 255;

                        data[idx] = data[idx + 1] = data[idx + 2] = finalVal;
                    }
                }
            } else {
                const countFactor = 1.0 - (t / 100);
                const intW = w + 1;

                const channels = [
                    { enabled: enableR, offset: 0 },
                    { enabled: enableG, offset: 1 },
                    { enabled: enableB, offset: 2 },
                    { enabled: enableA, offset: 3 }
                ];

                for (const chan of channels) {
                    if (!chan.enabled) continue;

                    const chanData = new Float32Array(w * h);
                    for (let i = 0; i < w * h; i++) {
                        chanData[i] = data[i * 4 + chan.offset];
                    }

                    const intImg = computeIntegralImage(chanData);

                    for (let y = 0; y < h; y++) {
                        const y0 = Math.max(0, y - radius);
                        const y1 = Math.min(h - 1, y + radius);
                        const y1_offset = (y1 + 1) * intW;
                        const y0_offset = y0 * intW;

                        for (let x = 0; x < w; x++) {
                            const x0 = Math.max(0, x - radius);
                            const x1 = Math.min(w - 1, x + radius);
                            const count = (x1 - x0 + 1) * (y1 - y0 + 1);

                            const sum = intImg[y1_offset + (x1 + 1)] 
                                      + intImg[y0_offset + x0] 
                                      - intImg[y1_offset + x0] 
                                      - intImg[y0_offset + (x1 + 1)];

                            const idx = (y * w + x) * 4 + chan.offset;
                            const val = chanData[y * w + x];
                            const threshold = (sum / count) * countFactor;

                            data[idx] = val < threshold ? 0 : 255;
                        }
                    }
                }
            }
        }
    }
});

// --- Helpers ---

function computeOtsu(hist: Uint32Array): number {
    let total = 0;
    for (let i = 0; i < 256; i++) {
        total += hist[i];
    }
    if (total === 0) return 128;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
        sum += i * hist[i];
    }
    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        wF = total - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const varBetween = wB * wF * (mB - mF) * (mB - mF);
        if (varBetween > varMax) {
            varMax = varBetween;
            threshold = t;
        }
    }
    return threshold;
}

function setSliderValue(rowEl: HTMLElement, val: number) {
    const input = rowEl.querySelector('input[type="range"]') as HTMLInputElement | null;
    if (input) {
        input.value = String(val);
        input.dispatchEvent(new Event('input'));
    }
}

function drawHistogramChannel(ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement, hist: Uint32Array, maxCount: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, cvs.height);
    const step = cvs.width / 255;
    const maxValue = Math.sqrt(maxCount) || 1;

    for (let i = 0; i < 256; i++) {
        const count = hist[i];
        if (count === 0) continue;
        const h = (Math.sqrt(count) / maxValue) * cvs.height; 
        ctx.rect(i * step, cvs.height - h, step, h);
    }
    
    ctx.fill();
}

function drawThresholdLine(ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement, val: number, color: string) {
    const x = val * (cvs.width / 255);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cvs.height);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 4, cvs.height);
    ctx.lineTo(x + 4, cvs.height);
    ctx.lineTo(x, cvs.height - 6);
    ctx.fill();
}
