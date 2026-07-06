import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';

Filters.register('lines', {
    name: 'Generate Lines / Checkerboard',
    mode: 'pixel',
    menu: {
        path: 'Generate',
        label: 'Lines & Checkerboard...',
        order: 6
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            pattern: 'lines',
            lineWidth: 20,
            spaceWidth: 20,
            angle: 45,
            antialiasing: true,
            lineColor: '#ffffff',
            lineOpacity: 100,
            spaceColor: '#000000',
            spaceOpacity: 0, // Default to transparent space
            offsetX: 0,
            offsetY: 0,
            blend: 'mix',
            opacity: 100
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createRadioGroup({
            label: 'Pattern Type',
            options: [
                { value: 'lines', text: 'Lines' },
                { value: 'checkerboard', text: 'Checkerboard' }
            ],
            value: state.pattern,
            layout: 'row',
            onChange: (v: any) => { state.pattern = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Width (Line/Square)',
            min: 1,
            max: 500,
            value: state.lineWidth,
            onInput: (v: any) => { state.lineWidth = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Height/Space',
            min: 1,
            max: 500,
            value: state.spaceWidth,
            onInput: (v: any) => { state.spaceWidth = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Angle (Degrees)',
            min: 0,
            max: 360,
            value: state.angle,
            onInput: (v: any) => { state.angle = parseInt(v); update(); }
        }));

        container.appendChild(UI.createCheckbox({
            label: 'Antialiasing (Smooth Edges)',
            value: state.antialiasing,
            onChange: (v: boolean) => { state.antialiasing = v; update(); }
        }));

        // --- Colors ---
        container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Pattern Colors'));

        container.appendChild(UI.createColorRow({
            label: 'Color 1 (Line/Square)',
            value: state.lineColor,
            onChange: (v: string) => { state.lineColor = v; update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Color 1 Opacity',
            min: 0,
            max: 100,
            value: state.lineOpacity,
            onInput: (v: any) => { state.lineOpacity = parseInt(v); update(); }
        }));

        container.appendChild(UI.createColorRow({
            label: 'Color 2 (Space/Square)',
            value: state.spaceColor,
            onChange: (v: string) => { state.spaceColor = v; update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Color 2 Opacity',
            min: 0,
            max: 100,
            value: state.spaceOpacity,
            onInput: (v: any) => { state.spaceOpacity = parseInt(v); update(); }
        }));

        // --- Placement & Blending ---
        container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Global Settings'));

        container.appendChild(UI.createSliderRow({
            label: 'Offset X',
            min: 0,
            max: 500,
            value: state.offsetX,
            onInput: (v: any) => { state.offsetX = parseInt(v); update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Offset Y',
            min: 0,
            max: 500,
            value: state.offsetY,
            onInput: (v: any) => { state.offsetY = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSelectRow({
            label: 'Blend Mode',
            options: [
                { value: 'replace', text: 'Replace (Generator)' },
                { value: 'mix', text: 'Mix (Normal)' },
                { value: 'overlay', text: 'Overlay' },
                { value: 'multiply', text: 'Multiply' },
                { value: 'screen', text: 'Screen' },
                { value: 'add', text: 'Add (Linear Dodge)' }
            ],
            value: state.blend,
            onChange: (v: any) => { state.blend = v; update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Opacity',
            min: 0,
            max: 100,
            value: state.opacity,
            onInput: (v: any) => { state.opacity = parseInt(v); update(); }
        }));

        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const {
            pattern,
            lineWidth,
            spaceWidth,
            angle,
            antialiasing,
            lineColor,
            lineOpacity,
            spaceColor,
            spaceOpacity,
            offsetX,
            offsetY,
            blend,
            opacity
        } = params;

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

        const c1 = parseHex(lineColor);
        const a1 = lineOpacity / 100;
        const c2 = parseHex(spaceColor);
        const a2 = spaceOpacity / 100;

        const globalAlpha = opacity / 100;
        const angleRad = (angle * Math.PI) / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        // Computes continuous line boundary coverage factor between [0.0, 1.0]
        const getLineFactor = (u: number, wl: number, ws: number) => {
            const T = wl + ws;
            let uMod = u % T;
            if (uMod < 0) uMod += T;

            if (!antialiasing) {
                return uMod < wl ? 1.0 : 0.0;
            }

            const halfEps = 0.5;

            // Transition region around the right edge
            if (uMod >= wl - halfEps && uMod <= wl + halfEps) {
                return 1.0 - (uMod - (wl - halfEps)) / (2.0 * halfEps);
            }

            // Transition region around the left edge wrapping at boundaries
            if (uMod >= T - halfEps) {
                const shifted = uMod - T;
                return (shifted + halfEps) / (2.0 * halfEps);
            }
            if (uMod <= halfEps) {
                return (uMod + halfEps) / (2.0 * halfEps);
            }

            // Inside the active line body
            if (uMod > halfEps && uMod < wl - halfEps) {
                return 1.0;
            }

            // Outside inside the empty space
            return 0.0;
        };

        let x = 0;
        let y = 0;

        for (let i = 0; i < data.length; i += 4) {
            const cx = x - offsetX;
            const cy = y - offsetY;

            // Project coordinates onto rotated orthogonal plane
            const u = cx * cosA + cy * sinA;
            const v = -cx * sinA + cy * cosA;

            let f = 0;
            if (pattern === 'checkerboard') {
                const fu = getLineFactor(u, lineWidth, spaceWidth);
                const fv = getLineFactor(v, lineWidth, spaceWidth);
                f = fu * (1.0 - fv) + fv * (1.0 - fu);
            } else {
                f = getLineFactor(u, lineWidth, spaceWidth);
            }

            // Premultiplied alpha calculation to handle transparent space color correctly
            let patR = 0;
            let patG = 0;
            let patB = 0;
            const patA = a1 * f + a2 * (1.0 - f);

            if (patA > 0.0001) {
                patR = (c1.r * a1 * f + c2.r * a2 * (1.0 - f)) / patA;
                patG = (c1.g * a1 * f + c2.g * a2 * (1.0 - f)) / patA;
                patB = (c1.b * a1 * f + c2.b * a2 * (1.0 - f)) / patA;
            }

            const bgR = data[i];
            const bgG = data[i + 1];
            const bgB = data[i + 2];
            const bgA = data[i + 3];

            const finalAlpha = patA * globalAlpha;

            if (blend === 'replace') {
                data[i] = Math.round(patR);
                data[i + 1] = Math.round(patG);
                data[i + 2] = Math.round(patB);
                data[i + 3] = Math.round(finalAlpha * 255);
            } else {
                let fgR = patR;
                let fgG = patG;
                let fgB = patB;

                if (blend === 'add') {
                    fgR = Math.min(255, bgR + patR);
                    fgG = Math.min(255, bgG + patG);
                    fgB = Math.min(255, bgB + patB);
                } else if (blend === 'multiply') {
                    fgR = (bgR * patR) / 255;
                    fgG = (bgG * patG) / 255;
                    fgB = (bgB * patB) / 255;
                } else if (blend === 'screen') {
                    fgR = 255 - (255 - bgR) * (255 - patR) / 255;
                    fgG = 255 - (255 - bgG) * (255 - patG) / 255;
                    fgB = 255 - (255 - bgB) * (255 - patB) / 255;
                } else if (blend === 'overlay') {
                    const overlayChan = (bg: number, fg: number) => {
                        return bg < 128
                            ? (2 * bg * fg / 255)
                            : (255 - 2 * (255 - bg) * (255 - fg) / 255);
                    };
                    fgR = overlayChan(bgR, patR);
                    fgG = overlayChan(bgG, patG);
                    fgB = overlayChan(bgB, patB);
                }

                // Standard alpha-compositing equations
                const bgAFloat = bgA / 255;
                const outA = finalAlpha + bgAFloat * (1.0 - finalAlpha);

                if (outA > 0.0001) {
                    data[i] = Math.round((fgR * finalAlpha + bgR * bgAFloat * (1.0 - finalAlpha)) / outA);
                    data[i + 1] = Math.round((fgG * finalAlpha + bgG * bgAFloat * (1.0 - finalAlpha)) / outA);
                    data[i + 2] = Math.round((fgB * finalAlpha + bgB * bgAFloat * (1.0 - finalAlpha)) / outA);
                }
                data[i + 3] = Math.round(outA * 255);
            }

            x++;
            if (x >= w) {
                x = 0;
                y++;
            }
        }
    }
});