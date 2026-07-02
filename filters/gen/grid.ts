import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';

Filters.register('grid', {
    name: 'Generate Grid',
    mode: 'pixel',
    menu: {
        path: 'Generate',
        label: 'Grid...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            offsetX: 0,
            offsetY: 0,
            blend: 'mix',
            opacity: 100,

            l1Enabled: true,
            l1W: 16,
            l1H: 16,
            l1LineWidth: 1,
            l1Color: '#999999',
            l1Opacity: 100,

            l2Enabled: false,
            l2W: 64,
            l2H: 64,
            l2LineWidth: 1,
            l2Color: '#eeeeee',
            l2Opacity: 100
        };

        const update = () => hooks.preview(state);

        const l1Group = UI.createNode('div');
        const l2Group = UI.createNode('div');

        const updateControls = () => {
            UI.toggle(l1Group, state.l1Enabled, 'block');
            UI.toggle(l2Group, state.l2Enabled, 'block');
        };

        // --- Level 1 Settings ---
        container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Level 1 Grid'));
        container.appendChild(UI.createCheckbox({
            label: 'Enable Level 1',
            value: state.l1Enabled,
            onChange: (v: boolean) => {
                state.l1Enabled = v;
                updateControls();
                update();
            }
        }));

        l1Group.appendChild(UI.createSliderRow({
            label: 'Cell Width (W)',
            min: 2,
            max: 500,
            value: state.l1W,
            onInput: (v: any) => { state.l1W = parseInt(v); update(); }
        }));
        l1Group.appendChild(UI.createSliderRow({
            label: 'Cell Height (H)',
            min: 2,
            max: 500,
            value: state.l1H,
            onInput: (v: any) => { state.l1H = parseInt(v); update(); }
        }));
        l1Group.appendChild(UI.createSliderRow({
            label: 'Line Width',
            min: 1,
            max: 20,
            value: state.l1LineWidth,
            onInput: (v: any) => { state.l1LineWidth = parseInt(v); update(); }
        }));
        l1Group.appendChild(UI.createColorRow({
            label: 'Color',
            value: state.l1Color,
            onChange: (v: string) => { state.l1Color = v; update(); }
        }));
        l1Group.appendChild(UI.createSliderRow({
            label: 'Opacity',
            min: 0,
            max: 100,
            value: state.l1Opacity,
            onInput: (v: any) => { state.l1Opacity = parseInt(v); update(); }
        }));
        container.appendChild(l1Group);

        // --- Level 2 Settings ---
        container.appendChild(UI.createNode('div', { className: 'popup-subtitle' }, 'Level 2 Grid'));
        container.appendChild(UI.createCheckbox({
            label: 'Enable Level 2',
            value: state.l2Enabled,
            onChange: (v: boolean) => {
                state.l2Enabled = v;
                updateControls();
                update();
            }
        }));

        l2Group.appendChild(UI.createSliderRow({
            label: 'Cell Width (W)',
            min: 2,
            max: 500,
            value: state.l2W,
            onInput: (v: any) => { state.l2W = parseInt(v); update(); }
        }));
        l2Group.appendChild(UI.createSliderRow({
            label: 'Cell Height (H)',
            min: 2,
            max: 500,
            value: state.l2H,
            onInput: (v: any) => { state.l2H = parseInt(v); update(); }
        }));
        l2Group.appendChild(UI.createSliderRow({
            label: 'Line Width',
            min: 1,
            max: 20,
            value: state.l2LineWidth,
            onInput: (v: any) => { state.l2LineWidth = parseInt(v); update(); }
        }));
        l2Group.appendChild(UI.createColorRow({
            label: 'Color',
            value: state.l2Color,
            onChange: (v: string) => { state.l2Color = v; update(); }
        }));
        l2Group.appendChild(UI.createSliderRow({
            label: 'Opacity',
            min: 0,
            max: 100,
            value: state.l2Opacity,
            onInput: (v: any) => { state.l2Opacity = parseInt(v); update(); }
        }));
        container.appendChild(l2Group);

        // --- Global Settings ---
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
                { value: 'mix', text: 'Mix (Normal)' },
                { value: 'replace', text: 'Replace (Generator)' },
                { value: 'overlay', text: 'Overlay' },
                { value: 'multiply', text: 'Multiply' },
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

        updateControls();
        update();
    },

    process(this: any, data: Uint8ClampedArray, w: number, h: number, params: any) {
        const {
            offsetX,
            offsetY,
            blend,
            opacity,
            l1Enabled,
            l1W,
            l1H,
            l1LineWidth,
            l1Color,
            l1Opacity,
            l2Enabled,
            l2W,
            l2H,
            l2LineWidth,
            l2Color,
            l2Opacity
        } = params;

        // Decodes a standard hex string to rgb components
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

        const l1Col = parseHex(l1Color);
        const l1A = l1Opacity / 100;
        const l2Col = parseHex(l2Color);
        const l2A = l2Opacity / 100;

        let x = 0;
        let y = 0;
        const globalAlpha = opacity / 100;

        for (let i = 0; i < data.length; i += 4) {
            let drawGrid = false;
            let gridR = 0;
            let gridG = 0;
            let gridB = 0;
            let gridA = 0;

            if (l1Enabled) {
                const cx = x - offsetX;
                const cy = y - offsetY;
                const modX = ((cx % l1W) + l1W) % l1W;
                const modY = ((cy % l1H) + l1H) % l1H;

                if (modX < l1LineWidth || modY < l1LineWidth) {
                    drawGrid = true;
                    gridR = l1Col.r;
                    gridG = l1Col.g;
                    gridB = l1Col.b;
                    gridA = l1A;
                }
            }

            if (l2Enabled) {
                const cx = x - offsetX;
                const cy = y - offsetY;
                const modX = ((cx % l2W) + l2W) % l2W;
                const modY = ((cy % l2H) + l2H) % l2H;

                if (modX < l2LineWidth || modY < l2LineWidth) {
                    if (drawGrid) {
                        const a1 = gridA;
                        const a2 = l2A;
                        const outA = a2 + a1 * (1 - a2);
                        if (outA > 0) {
                            gridR = Math.round((l2Col.r * a2 + gridR * a1 * (1 - a2)) / outA);
                            gridG = Math.round((l2Col.g * a2 + gridG * a1 * (1 - a2)) / outA);
                            gridB = Math.round((l2Col.b * a2 + gridB * a1 * (1 - a2)) / outA);
                        }
                        gridA = outA;
                    } else {
                        drawGrid = true;
                        gridR = l2Col.r;
                        gridG = l2Col.g;
                        gridB = l2Col.b;
                        gridA = l2A;
                    }
                }
            }

            const finalAlpha = gridA * globalAlpha;

            if (drawGrid) {
                const bgR = data[i];
                const bgG = data[i + 1];
                const bgB = data[i + 2];

                if (blend === 'replace') {
                    data[i] = gridR;
                    data[i + 1] = gridG;
                    data[i + 2] = gridB;
                    data[i + 3] = Math.round(finalAlpha * 255);
                } else {
                    let fgR = gridR;
                    let fgG = gridG;
                    let fgB = gridB;

                    if (blend === 'add') {
                        fgR = Math.min(255, bgR + gridR);
                        fgG = Math.min(255, bgG + gridG);
                        fgB = Math.min(255, bgB + gridB);
                    } else if (blend === 'multiply') {
                        fgR = (bgR * gridR) / 255;
                        fgG = (bgG * gridG) / 255;
                        fgB = (bgB * gridB) / 255;
                    } else if (blend === 'overlay') {
                        const overlayChan = (bg: number, fg: number) => {
                            return bg < 128
                                ? (2 * bg * fg / 255)
                                : (255 - 2 * (255 - bg) * (255 - fg) / 255);
                        };
                        fgR = overlayChan(bgR, gridR);
                        fgG = overlayChan(bgG, gridG);
                        fgB = overlayChan(bgB, gridB);
                    }

                    data[i] = Math.round(bgR * (1 - finalAlpha) + fgR * finalAlpha);
                    data[i + 1] = Math.round(bgG * (1 - finalAlpha) + fgG * finalAlpha);
                    data[i + 2] = Math.round(bgB * (1 - finalAlpha) + fgB * finalAlpha);
                }
            } else {
                if (blend === 'replace') {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                    data[i + 3] = 0;
                }
            }

            x++;
            if (x >= w) {
                x = 0;
                y++;
            }
        }
    }
});