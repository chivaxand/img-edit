import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';

Filters.register('halftone', {
    name: 'Halftone (Newsprint)',
    mode: 'pixel',
    menu: {
        path: 'Filter/Stylize',
        label: 'Halftone (Newsprint)...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            color_model: 'black-on-white',
            gamma: 1.0,
            
            // Channel 1: Red / Cyan / General Black
            pattern: 1,
            period: 12.0,
            angle: 45.0,
            
            // Channel 2: Green / Magenta
            pattern2: 1,
            period2: 12.0,
            angle2: 15.0,
            
            // Channel 3: Blue / Yellow
            pattern3: 1,
            period3: 12.0,
            angle3: 0.0,
            
            // Channel 4: Black (specifically for CMYK)
            pattern4: 1,
            period4: 12.0,
            angle4: 75.0,
            
            black_pullout: 1.0,
            aa_samples: 16,
            turbulence: 0.0,
            angleboost: 0.0,
            blocksize: -1.0
        };

        const update = () => hooks.preview(state);

        const patternOptions = [
            { value: 0, text: 'Line' },
            { value: 1, text: 'Circle' },
            { value: 2, text: 'Diamond' },
            { value: 3, text: 'PSSquare (Euclidian) Dot' },
            { value: 4, text: 'Crossing Lines (Cross)' },
            { value: 5, text: 'Zig zag' },
            { value: 6, text: 'Sine lines' },
            { value: 7, text: 'Wavy dots' }
        ];

        // Mapped UI blocks through global reusable library helpers
        const bwContainer = UI.createSection('Monochrome Pattern Settings');
        const rgbContainer = UI.createSection('RGB Multi-Screen Pattern Settings');
        const cmykContainer = UI.createSection('CMYK Halftoning Settings');

        // Monochrome inputs
        bwContainer.appendChild(UI.createSelectRow({
            label: 'Pattern', options: patternOptions, value: state.pattern,
            onChange: v => { state.pattern = parseInt(v); update(); }
        }));
        bwContainer.appendChild(UI.createSliderRow({
            label: 'Period (Size)', min: 1.0, max: 100.0, step: 0.5, value: state.period,
            onInput: v => { state.period = parseFloat(v); update(); }
        }));
        bwContainer.appendChild(UI.createSliderRow({
            label: 'Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle,
            onInput: v => { state.angle = parseFloat(v); update(); }
        }));

        // RGB screen inputs
        rgbContainer.appendChild(UI.createSubheading('Red Channel', '#f5c6cb'));
        rgbContainer.appendChild(UI.createSelectRow({
            label: 'Red Pattern', options: patternOptions, value: state.pattern2,
            onChange: v => { state.pattern2 = parseInt(v); update(); }
        }));
        rgbContainer.appendChild(UI.createSliderRow({
            label: 'Red Period', min: 1.0, max: 100.0, step: 0.5, value: state.period2,
            onInput: v => { state.period2 = parseFloat(v); update(); }
        }));
        rgbContainer.appendChild(UI.createSliderRow({
            label: 'Red Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle2,
            onInput: v => { state.angle2 = parseFloat(v); update(); }
        }));

        rgbContainer.appendChild(UI.createSubheading('Green Channel', '#c3e6cb'));
        rgbContainer.appendChild(UI.createSelectRow({
            label: 'Green Pattern', options: patternOptions, value: state.pattern3,
            onChange: v => { state.pattern3 = parseInt(v); update(); }
        }));
        rgbContainer.appendChild(UI.createSliderRow({
            label: 'Green Period', min: 1.0, max: 100.0, step: 0.5, value: state.period3,
            onInput: v => { state.period3 = parseFloat(v); update(); }
        }));
        rgbContainer.appendChild(UI.createSliderRow({
            label: 'Green Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle3,
            onInput: v => { state.angle3 = parseFloat(v); update(); }
        }));

        rgbContainer.appendChild(UI.createSubheading('Blue Channel', '#bee5eb'));
        rgbContainer.appendChild(UI.createSelectRow({
            label: 'Blue Pattern', options: patternOptions, value: state.pattern4,
            onChange: v => { state.pattern4 = parseInt(v); update(); }
        }));
        rgbContainer.appendChild(UI.createSliderRow({
            label: 'Blue Period', min: 1.0, max: 100.0, step: 0.5, value: state.period4,
            onInput: v => { state.period4 = parseFloat(v); update(); }
        }));
        rgbContainer.appendChild(UI.createSliderRow({
            label: 'Blue Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle4,
            onInput: v => { state.angle4 = parseFloat(v); update(); }
        }));

        // CMYK split inputs
        cmykContainer.appendChild(UI.createSubheading('Cyan Channel', '#17a2b8'));
        cmykContainer.appendChild(UI.createSelectRow({
            label: 'Cyan Pattern', options: patternOptions, value: state.pattern2,
            onChange: v => { state.pattern2 = parseInt(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Cyan Period', min: 1.0, max: 100.0, step: 0.5, value: state.period2,
            onInput: v => { state.period2 = parseFloat(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Cyan Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle2,
            onInput: v => { state.angle2 = parseFloat(v); update(); }
        }));

        cmykContainer.appendChild(UI.createSubheading('Magenta Channel', '#e83e8c'));
        cmykContainer.appendChild(UI.createSelectRow({
            label: 'Magenta Pattern', options: patternOptions, value: state.pattern3,
            onChange: v => { state.pattern3 = parseInt(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Magenta Period', min: 1.0, max: 100.0, step: 0.5, value: state.period3,
            onInput: v => { state.period3 = parseFloat(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Magenta Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle3,
            onInput: v => { state.angle3 = parseFloat(v); update(); }
        }));

        cmykContainer.appendChild(UI.createSubheading('Yellow Channel', '#ffc107'));
        cmykContainer.appendChild(UI.createSelectRow({
            label: 'Yellow Pattern', options: patternOptions, value: state.pattern4,
            onChange: v => { state.pattern4 = parseInt(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Yellow Period', min: 1.0, max: 100.0, step: 0.5, value: state.period4,
            onInput: v => { state.period4 = parseFloat(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Yellow Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle4,
            onInput: v => { state.angle4 = parseFloat(v); update(); }
        }));

        cmykContainer.appendChild(UI.createSubheading('Black Channel', '#d4d4d4'));
        cmykContainer.appendChild(UI.createSelectRow({
            label: 'Black Pattern', options: patternOptions, value: state.pattern,
            onChange: v => { state.pattern = parseInt(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Black Period', min: 1.0, max: 100.0, step: 0.5, value: state.period,
            onInput: v => { state.period = parseFloat(v); update(); }
        }));
        cmykContainer.appendChild(UI.createSliderRow({
            label: 'Black Angle', min: -180.0, max: 180.0, step: 1.0, value: state.angle,
            onInput: v => { state.angle = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createSelectRow({
            label: 'Color Model',
            options: [
                { value: 'white-on-black', text: 'White on Black' },
                { value: 'black-on-white', text: 'Black on White' },
                { value: 'rgb', text: 'RGB Multi-Screen' },
                { value: 'cmyk', text: 'CMYK Halftoning' }
            ],
            value: state.color_model,
            onChange: v => {
                state.color_model = v;
                updateControls();
                update();
            }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Gamma', min: 0.1, max: 4.0, step: 0.1, value: state.gamma,
            onInput: v => { state.gamma = parseFloat(v); update(); }
        }));

        container.appendChild(bwContainer);
        container.appendChild(rgbContainer);
        container.appendChild(cmykContainer);

        const blackPulloutRow = UI.createSliderRow({
            label: 'Black Pullout', min: 0.0, max: 1.0, step: 0.05, value: state.black_pullout,
            onInput: v => { state.black_pullout = parseFloat(v); update(); }
        });
        container.appendChild(blackPulloutRow);

        container.appendChild(UI.createSliderRow({
            label: 'Anti-Alias Factor', min: 1, max: 64, step: 1, value: state.aa_samples,
            onInput: v => { state.aa_samples = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Turbulence', min: 0.0, max: 1.0, step: 0.05, value: state.turbulence,
            onInput: v => { state.turbulence = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Angle Boost', min: 0.0, max: 4.0, step: 0.1, value: state.angleboost,
            onInput: v => { state.angleboost = parseFloat(v); update(); }
        }));

        const updateControls = () => {
            const m = state.color_model;
            UI.toggle(bwContainer, m === 'white-on-black' || m === 'black-on-white');
            UI.toggle(rgbContainer, m === 'rgb');
            UI.toggle(cmykContainer, m === 'cmyk');
            UI.toggle(blackPulloutRow, m === 'cmyk');
        };

        updateControls();
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, options: any) {
        const {
            color_model,
            gamma = 1.0,
            pattern, period, angle,
            pattern2, period2, angle2,
            pattern3, period3, angle3,
            pattern4, period4, angle4,
            black_pullout,
            aa_samples,
            turbulence,
            angleboost,
            blocksize: blocksizeOpt
        } = options;

        const blocksize = (blocksizeOpt !== undefined && blocksizeOpt >= 0.0) ? blocksizeOpt : 819200.0;
        const degToRad = (deg: number) => deg * Math.PI / 180.0;

        const radAngle = degToRad(angle);
        const radAngle2 = degToRad(angle2);
        const radAngle3 = degToRad(angle3);
        const radAngle4 = degToRad(angle4);

        // Pre-calculated Gamma Look-Up Table (LUT)
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            lut[i] = Math.pow(i / 255.0, gamma);
        }

        if (color_model === 'white-on-black') {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const r = lut[data[idx]];
                    const g = lut[data[idx+1]];
                    const b = lut[data[idx+2]];

                    const luminance = g;
                    const chroma = Math.abs(r - g);
                    const angleMod = Math.abs(b - g);

                    const gray = spachrotyze(
                        x, y,
                        luminance, chroma, angleMod,
                        pattern,
                        period,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle,
                        aa_samples
                    );

                    const finalGray = Math.round(gray * 255);
                    data[idx] = data[idx+1] = data[idx+2] = finalGray;
                }
            }
        } else if (color_model === 'black-on-white') {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const r = lut[data[idx]];
                    const g = lut[data[idx+1]];
                    const b = lut[data[idx+2]];

                    const luminance = g;
                    const chroma = Math.abs(r - g);
                    const angleMod = Math.abs(b - g);

                    const gray = 1.0 - spachrotyze(
                        x, y,
                        1.0 - luminance, chroma, angleMod,
                        pattern,
                        period,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle,
                        aa_samples
                    );

                    const finalGray = Math.round(gray * 255);
                    data[idx] = data[idx+1] = data[idx+2] = finalGray;
                }
            }
        } else if (color_model === 'rgb') {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const r = lut[data[idx]];
                    const g = lut[data[idx+1]];
                    const b = lut[data[idx+2]];

                    const pinch = Math.abs(r - g);
                    const angleMod = Math.abs(b - g);

                    const finalR = spachrotyze(
                        x, y,
                        r, pinch, angleMod,
                        pattern2,
                        period2,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle2,
                        aa_samples
                    );

                    const finalG = spachrotyze(
                        x, y,
                        g, pinch, angleMod,
                        pattern3,
                        period3,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle3,
                        aa_samples
                    );

                    const finalB = spachrotyze(
                        x, y,
                        b, pinch, angleMod,
                        pattern4,
                        period4,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle4,
                        aa_samples
                    );

                    data[idx] = Math.round(finalR * 255);
                    data[idx+1] = Math.round(finalG * 255);
                    data[idx+2] = Math.round(finalB * 255);
                }
            }
        } else if (color_model === 'cmyk') {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    const r = lut[data[idx]];
                    const g = lut[data[idx+1]];
                    const b = lut[data[idx+2]];

                    const pinch = Math.abs(r - g);
                    const angleMod = Math.abs(b - g);

                    let c = 1.0 - r;
                    let m = 1.0 - g;
                    let iy = 1.0 - b;
                    let k = 1.0;

                    if (c < k) k = c;
                    if (m < k) k = m;
                    if (iy < k) k = iy;

                    k = k * black_pullout;

                    if (k < 1.0) {
                        c = (c - k) / (1.0 - k);
                        m = (m - k) / (1.0 - k);
                        iy = (iy - k) / (1.0 - k);
                    } else {
                        c = m = iy = 1.0;
                    }

                    const finalC = spachrotyze(
                        x, y,
                        c, pinch, angleMod,
                        pattern2,
                        period2,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle2,
                        aa_samples
                    );

                    const finalM = spachrotyze(
                        x, y,
                        m, pinch, angleMod,
                        pattern3,
                        period3,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle3,
                        aa_samples
                    );

                    const finalY = spachrotyze(
                        x, y,
                        iy, pinch, angleMod,
                        pattern4,
                        period4,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle4,
                        aa_samples
                    );

                    const finalK = spachrotyze(
                        x, y,
                        k, pinch, angleMod,
                        pattern,
                        period,
                        turbulence,
                        blocksize,
                        angleboost,
                        radAngle,
                        aa_samples
                    );

                    let cOut = finalC;
                    let mOut = finalM;
                    let yOut = finalY;

                    if (finalK < 1.0) {
                        cOut = finalC * (1.0 - finalK) + finalK;
                        mOut = finalM * (1.0 - finalK) + finalK;
                        yOut = finalY * (1.0 - finalK) + finalK;
                    } else {
                        cOut = 1.0;
                        mOut = 1.0;
                        yOut = 1.0;
                    }

                    data[idx] = Math.round((1.0 - cOut) * 255);
                    data[idx+1] = Math.round((1.0 - mOut) * 255);
                    data[idx+2] = Math.round((1.0 - yOut) * 255);
                }
            }
        }
    }
});

// Core spatial vector pattern sampler translated from GEGL's newsprint
function spachrotyze(
    x: number,
    y: number,
    part_white: number,
    offset: number,
    hue: number,
    pattern: number,
    period: number,
    turbulence: number,
    blocksize: number,
    angleboost: number,
    angle: number,
    max_aa_samples: number
): number {
    let acc = 0.0;
    const twist = Math.PI / 2.0 - ((hue * angleboost) + angle);
    const width = period * (1.0 - turbulence) + (period * offset) * turbulence;
    const vec0 = Math.cos(twist);
    const vec1 = Math.sin(twist);

    let xi = 0.5;
    let yi = 0.2;
    let count = 0;
    let inside = 0;
    let old_acc = 0.0;

    const shiftedX = x + period * 2.0;
    const shiftedY = y + period * 2.0;

    for (let i = 0; i < max_aa_samples; i++) {
        // Weyl pseudo-random sequence for optimal anti-alias convergence
        xi = (xi + 0.618033988749854) % 1.0;
        yi = (yi + (0.618033988749854 / 1.61235)) % 1.0;

        old_acc = acc;
        
        const u = ((shiftedX + xi - 0.5 * width) % (blocksize * width) + (blocksize * width)) % (blocksize * width);
        const v = ((shiftedY + yi - 0.5 * width) % (blocksize * width) + (blocksize * width)) % (blocksize * width);

        const w = vec0 * u + vec1 * v;
        const q = vec1 * u - vec0 * v;

        const wperiod = ((w % width) + width) % width;
        const wphase = (wperiod / width) * 2.0 - 1.0;

        const qperiod = ((q % width) + width) % width;
        const qphase = (qperiod / width) * 2.0 - 1.0;

        if (pattern === 0) { // Line
            if (Math.abs(wphase) < part_white) {
                inside++;
            }
        } else if (pattern === 1) { // Circle (Dot)
            if (qphase * qphase + wphase * wphase < part_white * part_white * 2.0) {
                inside++;
            }
        } else if (pattern === 2) { // Diamond
            if ((Math.abs(wphase) + Math.abs(qphase)) / 2.0 < part_white) {
                inside++;
            }
        } else if (pattern === 3) { // PSSquare (Euclidian)
            let ax = Math.abs(wphase);
            let ay = Math.abs(qphase);
            let val = 0.0;

            if (ax + ay > 1.0) {
                ay = 1.0 - ay;
                ax = 1.0 - ax;
                val = 2.0 - Math.hypot(ax, ay);
            } else {
                val = Math.hypot(ax, ay);
            }
            val /= 2.0;
            if (val < part_white) {
                inside++;
            }
        } else if (pattern === 4) { // Cross
            const part_white2 = part_white * part_white;
            if (Math.abs(wphase) < part_white2 || Math.abs(qphase) < part_white2) {
                inside++;
            }
        } else if (pattern === 5) { // Zig zag
            const tri = Math.abs(((q / (width * 1.5)) % 2.0 + 2.0) % 2.0 - 1.0) * 2.0 - 1.0;
            const wz = w + tri * (width * 0.35);
            const wzPeriod = ((wz % width) + width) % width;
            const wzPhase = (wzPeriod / width) * 2.0 - 1.0;
            if (Math.abs(wzPhase) < part_white) {
                inside++;
            }
        } else if (pattern === 6) { // Sine lines
            const sineOffset = Math.sin((2.0 * Math.PI * q) / (3.0 * width)) * (0.25 * width);
            const ws = w + sineOffset;
            const wsPeriod = ((ws % width) + width) % width;
            const wsPhase = (wsPeriod / width) * 2.0 - 1.0;
            if (Math.abs(wsPhase) < part_white) {
                inside++;
            }
        } else if (pattern === 7) { // Wavy dots
            const warpW = Math.sin((2.0 * Math.PI * q) / (2.5 * width)) * (0.18 * width);
            const warpQ = Math.sin((2.0 * Math.PI * w) / (2.5 * width)) * (0.18 * width);
            const ww = w + warpW;
            const qq = q + warpQ;
            const wwPeriod = ((ww % width) + width) % width;
            const wwPhase = (wwPeriod / width) * 2.0 - 1.0;
            const qqPeriod = ((qq % width) + width) % width;
            const qqPhase = (qqPeriod / width) * 2.0 - 1.0;
            if (qqPhase * qqPhase + wwPhase * wwPhase < part_white * part_white * 2.0) {
                inside++;
            }
        }
        count++;

        acc = inside / count;
        if (count > 3 && Math.abs(acc - old_acc) < 0.23) {
            break;
        }
        old_acc = acc;
    }
    return acc;
}