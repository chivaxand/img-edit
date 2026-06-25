import { App } from '../app';
import { Filters } from '../filters';
import { UI } from '../ui';
import { Layer } from '../layers';
import { Lib } from '../libs/index';

Filters.register('chromakey', {
    name: 'Chroma Key (Remove BG)',
    mode: 'pixel',

    // Helper: RGB (0-255) to HSL (0-1)
    rgbToHsl(r: number, g: number, b: number) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h: number = 0, s: number = 0, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; 
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h, s, l };
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { 
            method: 'hsl', // hsl or rgb
            color: '#00ff00', 
            tolH: 80, tolS: 70, tolL: 90, 
            tolRgb: 20, // 0-100
            smoothness: 10, spill: 10, edge: 60,
            clipB: 0, clipW: 100,
            showMask: false
        };

        const update = () => {
            const isHsl = state.method === 'hsl';
            hslControls.forEach(el => (el as HTMLElement).style.display = isHsl ? 'flex' : 'none');
            spillControls.forEach(el => (el as HTMLElement).style.display = isHsl ? 'flex' : 'none');
            rgbControls.forEach(el => (el as HTMLElement).style.display = isHsl ? 'none' : 'flex');
            hooks.preview(state);
        };

        // Preview Canvas (Eye Dropper)
        const { element: cvs, ctx } = UI.createCanvas({
            source: layer.canvas,
            bg: 'grid',
            on: { click: (e: any) => pickColor(e) }
        });
        
        container.appendChild(cvs);
        container.appendChild(UI.createNode('div', { className: 'popup-hint', style: 'text-align:center' }, 'Click image above to pick Key Color.'));

        // Method Selector
        container.appendChild(UI.createSelectRow({
            label: 'Method', 
            options: [
                { value: 'hsl', text: 'HSL (Green/Blue Screen)' },
                { value: 'rgb', text: 'RGB (White/Black/Solid)' }
            ],
            value: state.method, 
            onChange: (v: string) => { state.method = v; update(); }
        }));

        // Color Picker
        const colorRow = UI.createColorRow({ label: 'Key Color', value: state.color, onChange: (v: string) => { state.color = v; update(); } });
        const colorInput = colorRow.querySelector('input[type=color]') as HTMLInputElement;
        const colorSwatch = colorRow.querySelector('.c-swatch') as HTMLElement;
        container.appendChild(colorRow);

        // Eye Dropper Logic
        const pickColor = (e: MouseEvent) => {
            const r = cvs.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            const p = ctx!.getImageData(x, y, 1, 1).data;
            const hex = App.utils.rgbToHex(p[0], p[1], p[2]);
            state.color = hex;
            colorInput.value = hex;
            colorSwatch.style.background = hex;
            update();
        };

        container.appendChild(UI.createCheckbox({ label: 'Show Alpha Mask (Black/White)', value: state.showMask, onChange: (v: boolean) => { state.showMask = v; update(); } }));

        container.appendChild(UI.createNode('div', {className:'popup-separator'}, ''));
        container.appendChild(UI.createNode('div', {className:'popup-subtitle'}, 'Tolerance'));

        // Sliders
        const hslControls = [
            UI.createSliderRow({ label: 'Hue (Deg)', min: 1, max: 180, value: state.tolH, onInput: (v: string) => { state.tolH = parseInt(v); update(); } }),
            UI.createSliderRow({ label: 'Sat (%)', min: 1, max: 100, value: state.tolS, onInput: (v: string) => { state.tolS = parseInt(v); update(); } }),
            UI.createSliderRow({ label: 'Light (%)', min: 1, max: 100, value: state.tolL, onInput: (v: string) => { state.tolL = parseInt(v); update(); } })
        ];
        hslControls.forEach(el => container.appendChild(el));

        const rgbControls = [
            UI.createSliderRow({ label: 'Color Tol.', min: 1, max: 100, value: state.tolRgb, onInput: (v: string) => { state.tolRgb = parseInt(v); update(); } })
        ];
        rgbControls.forEach(el => container.appendChild(el));

        container.appendChild(UI.createSliderRow({ label: 'Smoothness', min: 0, max: 50, value: state.smoothness, onInput: (v: string) => { state.smoothness = parseInt(v); update(); } }));

        container.appendChild(UI.createNode('div', {className:'popup-separator'}, ''));
        container.appendChild(UI.createNode('div', {className:'popup-subtitle'}, 'Matte Refinement'));

        container.appendChild(UI.createSliderRow({ label: 'Clip Black', min: 0, max: 100, value: state.clipB, onInput: (v: string) => { state.clipB = parseInt(v); update(); } }));
        container.appendChild(UI.createSliderRow({ label: 'Clip White', min: 0, max: 100, value: state.clipW, onInput: (v: string) => { state.clipW = parseInt(v); update(); } }));
        
        // Spill Correction (HSL Only)
        const spillHead = UI.createNode('div', {className:'popup-subtitle'}, 'Spill Correction');
        const spillControls = [
            spillHead,
            UI.createSliderRow({ label: 'Spill Reduce', min: 0, max: 100, value: state.spill, onInput: (v: string) => { state.spill = parseInt(v); update(); } }),
            UI.createSliderRow({ label: 'Edge Despill', min: 0, max: 100, value: state.edge, onInput: (v: string) => { state.edge = parseInt(v); update(); } })
        ];
        spillControls.forEach(el => container.appendChild(el));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const trgb = App.utils.hexToRgb(params.color) || {r:0, g:255, b:0};
        
        // Common Params
        const smooth = params.smoothness / 100;
        const clipB = (params.clipB / 100) * 255;
        const clipW = (params.clipW / 100) * 255; 
        
        const isRgb = params.method === 'rgb';

        // HSL Mode Pre-calc
        let targetHsl: { h: number, s: number, l: number } = { h: 0, s: 0, l: 0 }, tH = 0, tS = 0, tL = 0, spill = 0, edgeSpill = 0;
        if (!isRgb) {
            targetHsl = this.rgbToHsl(trgb.r, trgb.g, trgb.b);
            tH = Math.max(0.001, params.tolH / 360); 
            tS = Math.max(0.001, params.tolS / 100); 
            tL = Math.max(0.001, params.tolL / 100);
            spill = params.spill / 100;
            edgeSpill = params.edge / 100;
        }

        // RGB Mode Pre-calc
        // Max distance in RGB cube is sqrt(255^2 * 3) ~ 441.67
        const maxRgbDist = 441.67;
        const tRgb = Math.max(0.001, params.tolRgb / 100);

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            let dist = 0;
            
            // HSL Params for spill (needs to be scoped here)
            let p: { h: number, s: number, l: number } = { h: 0, s: 0, l: 0 }, dh = 0;

            if (isRgb) {
                // RGB Euclidean Distance
                const dr = r - trgb.r;
                const dg = g - trgb.g;
                const db = b - trgb.b;
                const rawDist = Math.sqrt(dr*dr + dg*dg + db*db) / maxRgbDist;
                
                // Scale distance relative to tolerance (Normalizing for common logic below)
                // If rawDist == tRgb, dist should be 1.0
                dist = rawDist / tRgb;

            } else {
                // HSL Distance
                p = this.rgbToHsl(r, g, b);

                // Calc Delta Hue
                dh = Math.abs(p.h - targetHsl.h);
                if (dh > 0.5) dh = 1.0 - dh;

                const ds = Math.abs(p.s - targetHsl.s);
                const dl = Math.abs(p.l - targetHsl.l);

                // Euclidean Distance in Ellipsoid
                dist = Math.sqrt(
                    (dh / tH) ** 2 + 
                    (ds / tS) ** 2 + 
                    (dl / tL) ** 2
                );
            }

            let alpha = 255;
            let isNearBorder = false;

            if (dist < 1.0) {
                // Inside core tolerance -> transparent
                alpha = 0;
            } else if (dist < 1.0 + smooth) {
                // Feathering edge
                alpha = 255 * ((dist - 1.0) / smooth);
                isNearBorder = true;
            } else if (dist < 1.0 + smooth + 0.3) {
                // Just outside the feathering zone
                isNearBorder = true;
            }

            // Apply Clip (Levels) to Alpha
            if (alpha < 255 && alpha > 0) {
                if (alpha <= clipB) {
                    alpha = 0;
                } else if (alpha >= clipW) {
                    alpha = 255;
                } else {
                    alpha = ((alpha - clipB) / (clipW - clipB)) * 255;
                }
            }

            // Spill Removal (HSL Only)
            if (!isRgb && alpha > 0) {
                let spillFactor = 0;
                
                // General Spill
                if (spill > 0) {
                    if (dh < tH * 2 && Math.abs(p.s - targetHsl.s) < tS * 2) {
                        spillFactor = spill * (1.0 - dh/(tH*2));
                    }
                }
                
                // Edge Spill
                if (edgeSpill > 0 && isNearBorder) {
                    if (dh < tH * 5) {
                        spillFactor = Math.max(spillFactor, edgeSpill);
                    }
                }

                if (spillFactor > 0) {
                    const gray = r * 0.299 + g * 0.587 + b * 0.114;
                    spillFactor = Math.min(1.0, spillFactor);
                    data[i]   = r * (1 - spillFactor) + gray * spillFactor;
                    data[i+1] = g * (1 - spillFactor) + gray * spillFactor;
                    data[i+2] = b * (1 - spillFactor) + gray * spillFactor;
                }
            }

            if (params.showMask) {
                // Render Mask View (Black & White)
                const v = Math.min(255, Math.floor(alpha));
                data[i] = v;
                data[i+1] = v;
                data[i+2] = v;
                data[i+3] = 255;
            } else {
                // Render Composite
                data[i+3] = Math.min(data[i+3], Math.floor(alpha));
            }
        }
    }
});
