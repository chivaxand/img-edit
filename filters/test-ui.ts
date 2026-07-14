import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { plot, PaletteName } from '~/libs/plot';

Filters.register('test-ui', {
    name: 'UI Elements Test',
    mode: 'unified',
    menu: {
        path: 'Generate',
        label: 'UI Elements Test...',
        order: 0
    },

    apply(context: FilterContext) {
        const { layer, values } = context;
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;

        const factor = values.brightnessMultiplier !== undefined ? values.brightnessMultiplier : 1.0;
        const contrast = values.contrast !== undefined ? values.contrast : 1.0;
        const tintColor = values.tintColor || '#ffffff';
        const drawPattern = values.drawPattern || 'none';
        const angle = values.angle !== undefined ? values.angle : 0;
        const palette = values.colorMap || 'grayscale';

        // Helper to convert hex values into RGB arrays
        const parseHex = (hex: string) => {
            const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [255, 255, 255];
        };
        const color = parseHex(tintColor);

        const rad = (angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                
                let r = pixels[idx];
                let g = pixels[idx + 1];
                let b = pixels[idx + 2];

                if (drawPattern === 'gradient') {
                    // Draw a diagonal gradient rotated by angle
                    const nx = (x - w / 2) / w;
                    const ny = (y - h / 2) / h;
                    const dist = nx * cos + ny * sin;
                    const norm = Math.max(0, Math.min(1, dist + 0.5));
                    const rgb = plot.getColor(norm, palette as PaletteName);
                    r = rgb[0];
                    g = rgb[1];
                    b = rgb[2];
                } else if (drawPattern === 'noise') {
                    // Pseudo-random noise mapped to color palette
                    const noiseVal = Math.random();
                    const rgb = plot.getColor(noiseVal, palette as PaletteName);
                    r = rgb[0];
                    g = rgb[1];
                    b = rgb[2];
                }

                // Apply Contrast centered around 128
                r = (r - 128) * contrast + 128;
                g = (g - 128) * contrast + 128;
                b = (b - 128) * contrast + 128;

                // Apply Brightness multiplier & Tint color
                pixels[idx]     = Math.max(0, Math.min(255, Math.round(r * factor * (color[0] / 255))));
                pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(g * factor * (color[1] / 255))));
                pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(b * factor * (color[2] / 255))));
            }
        }

        ctx.putImageData(imgData, 0, 0);
    },

    renderUI(root: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            brightnessMultiplier: 1.0,
            contrast: 1.0,
            angle: 45,
            tintColor: '#ffffff',
            colorMap: 'grayscale' as PaletteName,
            drawPattern: 'none' as 'none' | 'gradient' | 'noise',
            showAdvanced: false,
            gridValue1: 10,
            gridValue2: 90,
            activeTheme: 'Dark Space',
            extraPadding: 5
        };

        const update = () => hooks.preview(state);

        root.appendChild(UI.createSubheading('Layout Builders Demonstration'));

        // ----- Basic Parameters Section -----
        const basicGroup = UI.createNode('div');

        basicGroup.appendChild(UI.createSliderRow({
            label: 'Brightness',
            min: 0.1, max: 2.0, step: 0.05, value: state.brightnessMultiplier,
            onInput: (v) => { state.brightnessMultiplier = parseFloat(v); update(); }
        }));

        basicGroup.appendChild(UI.createSliderRow({
            label: 'Contrast',
            min: 0.1, max: 3.0, step: 0.05, value: state.contrast,
            onInput: (v) => { state.contrast = parseFloat(v); update(); }
        }));

        basicGroup.appendChild(UI.createAngleRow({
            label: 'Pattern Angle',
            value: state.angle,
            min: 0, max: 360, step: 1,
            onInput: (v) => { state.angle = v; update(); }
        }));

        root.appendChild(UI.createSection('Basic Adjustment Parameters', basicGroup));

        // ----- Selection-Driven Pattern Generator Section -----
        const patternRadio = UI.createRadioGroup({
            label: 'Generator Pattern',
            options: [
                { value: 'none', text: 'Original Layer Image' },
                { value: 'gradient', text: 'Rotated Color Gradient' },
                { value: 'noise', text: 'Stochastic Color Noise' }
            ],
            value: state.drawPattern,
            layout: 'column',
            onChange: (v) => {
                state.drawPattern = v as 'none' | 'gradient' | 'noise';
                UI.toggle(paletteRow, state.drawPattern !== 'none');
                update();
            }
        });
        root.appendChild(UI.createSection('Dynamic Canvas Pattern Generator', patternRadio));

        // Palette Selector (conditional visibility mapped to selection)
        const paletteRow = UI.createPaletteSelectRow({
            label: 'Spectrum Palette',
            value: state.colorMap,
            onChange: (v) => { state.colorMap = v; update(); }
        });
        UI.toggle(paletteRow, state.drawPattern !== 'none');
        root.appendChild(paletteRow);

        // ----- Interactive Advanced Toggle Checkbox -----
        const advToggle = UI.createCheckbox({
            label: 'Show Advanced Controls',
            value: state.showAdvanced,
            onChange: (v) => {
                state.showAdvanced = v;
                UI.toggle(advancedSection, v, 'block');
                update();
            }
        });
        root.appendChild(advToggle);

        // Advanced container initialized to match checkbox state
        const advancedSection = UI.createNode('div', { style: 'display: none;' });

        // Double column grid layout
        const gridContainer = UI.createGrid(2, [
            UI.createSliderRow({
                label: 'Min X', min: 0, max: 100, value: state.gridValue1,
                onInput: (v) => { state.gridValue1 = parseInt(v); update(); }
            }),
            UI.createSliderRow({
                label: 'Max X', min: 0, max: 100, value: state.gridValue2,
                onInput: (v) => { state.gridValue2 = parseInt(v); update(); }
            })
        ]);
        advancedSection.appendChild(UI.createSection('Grid Limits Configuration', gridContainer));

        // Color selector
        advancedSection.appendChild(UI.createColorRow({
            label: 'RGB Color Tint',
            value: state.tintColor,
            onChange: (v) => { state.tintColor = v; update(); }
        }));

        // Theme dropdown
        advancedSection.appendChild(UI.createSelectRow({
            label: 'Editor Theme',
            options: [
                { value: 'Dark Space', text: 'Dark Space (Default)' },
                { value: 'Light Space', text: 'Light Space (High Contrast)' }
            ],
            value: state.activeTheme,
            onChange: (v) => { state.activeTheme = v; update(); }
        }));

        // Split Row layout (Two opposing items aligned on same line)
        const leftLabel = UI.createNode('span', { textContent: 'Editor Sizing Padding (px)', style: 'font-size: 11px;' });
        const extraPaddingSlider = UI.createSliderRow({
            label: null,
            min: 0, max: 50, step: 1, value: state.extraPadding,
            onInput: (v) => { 
                state.extraPadding = parseInt(v); 
                expandableSection.style.padding = `${state.extraPadding}px`;
                update(); 
            }
        });
        const splitRow = UI.createSplitRow(leftLabel, extraPaddingSlider);
        advancedSection.appendChild(UI.createSection('Sizing & Alignment Spacing', splitRow));

        // Expandable details section inside advanced controls
        const expandableSection = UI.createExpandableSection({
            title: 'Collapsible Calibration Information',
            initiallyExpanded: false
        }, UI.createHint('These values calibrate parameters used strictly inside advanced image segmentation math paths.'));
        
        advancedSection.appendChild(expandableSection);
        root.appendChild(advancedSection);

        update();
    }
});