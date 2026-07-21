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
    dialogOptions: { width: '90%', maxWidth: '600px' }, // custom width (optional)

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
        const color = parseHexColor(tintColor);
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
                    const nx = (x - w / 2) / w;
                    const ny = (y - h / 2) / h;
                    const dist = nx * cos + ny * sin;
                    const norm = Math.max(0, Math.min(1, dist + 0.5));
                    const rgb = plot.getColor(norm, palette as PaletteName);
                    r = rgb[0];
                    g = rgb[1];
                    b = rgb[2];
                } else if (drawPattern === 'noise') {
                    const noiseVal = Math.random();
                    const rgb = plot.getColor(noiseVal, palette as PaletteName);
                    r = rgb[0];
                    g = rgb[1];
                    b = rgb[2];
                }
                r = (r - 128) * contrast + 128;
                g = (g - 128) * contrast + 128;
                b = (b - 128) * contrast + 128;
                pixels[idx]     = Math.max(0, Math.min(255, Math.round(r * factor * (color[0] / 255))));
                pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(g * factor * (color[1] / 255))));
                pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(b * factor * (color[2] / 255))));
                pixels[idx + 3] = 255;
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

        // ----- Multi-Slider Demo Control -----
        root.appendChild(UI.createSubheading('Multi-Slider'));
        root.appendChild(UI.createHint('Click and drag handles to adjust. Alt+Click on a standard handle to split it (feather range).'));
        
        // Splittable handles initialized with standard numbers
        const toneBoundsControl = UI.createMultiSlider({
            label: 'Tone', min: 0, max: 255, step: 1,
            background: ['#3a1a1a', '#1a3a1a', '#1a1a3a'], // custom gradient stops
            handles: [
                { id: 'low', value: 64, color: '#ff5555', shape: 'triangle', label: 'Shadow', splittable: true },
                { id: 'high', value: [180, 190], color: '#55aaff', shape: 'triangle', label: 'Highlight', splittable: true }
            ],
            onInput: (values) => {
                // values.low and values.high are guaranteed to be [number, number]
                console.log('Tone bounds values:', values);
                const [lowMin, lowMax] = values.low as [number, number];
                console.log(`Shadow range: ${lowMin} - ${lowMax}`);
            }
        });
        root.appendChild(toneBoundsControl);

        // Standard non-splittable multi-slider
        const contrastControl = UI.createMultiSlider({
            label: 'Contrast', min: 0.0, max: 5.0, step: 0.1, precision: 1,
            background: '#1a1a1a',
            handles: [
                { id: 'mid', value: 1.5, color: '#00ffcc', shape: 'triangle' },
                { id: 'max', value: 3.8, color: '#ff00ff', shape: 'triangle' }
            ],
            onInput: (values) => {
                console.log('Contrast values:', values);
                const mid = values.mid as number;
                console.log(`Midpoint value: ${mid}`);
            }
        });
        root.appendChild(contrastControl);

        root.appendChild(UI.createSubheading('Layout Builders Demonstration'));
        
        // ----- Selection-Driven Pattern Generator Section -----
        root.appendChild(UI.createRadioGroup({
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
        }));

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
                UI.toggle(advancedSection, v);
                update();
            }
        });
        root.appendChild(advToggle);

        // Advanced container initialized to match checkbox state
        const advancedSection = UI.createStack('vertical', [], { hidden: true });

        // Double column grid layout
        advancedSection.appendChild(UI.createGrid(2, [
            UI.createRow('Min X', UI.createInput('number', { value: state.gridValue1, min: 0, max: 100 }, (t) => { state.gridValue1 = parseInt(t.value) || 0; update(); })),
            UI.createRow('Max X', UI.createInput('number', { value: state.gridValue2, min: 0, max: 100 }, (t) => { state.gridValue2 = parseInt(t.value) || 0; update(); }))
        ]));

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
        const leftLabel = UI.createNode('span', { textContent: 'Padding (px)', style: 'font-size: 11px;' });
        const extraPaddingSlider = UI.createSliderRow({
            label: null, min: 0, max: 50, step: 1, value: state.extraPadding,
            onInput: (v) => { 
                state.extraPadding = parseInt(v);
                update(); 
            }
        });
        const splitRow = UI.createSplitRow(leftLabel, extraPaddingSlider);
        advancedSection.appendChild(UI.createSection('Split row', splitRow));

        root.appendChild(advancedSection);

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

        root.appendChild(UI.createSection('Section demo', basicGroup));

        // Expandable details section inside advanced controls
        root.appendChild(
            UI.createExpandableSection({
                title: 'Collapsible Calibration Information',
                initiallyExpanded: false
            },
            UI.createHint('These values calibrate parameters used strictly\ninside advanced image segmentation math paths.'))
        );

        // Custom canvas and action button demonstration section
        const testCanvasObj = UI.createCanvas({
            width: 200, height: 60, bg: 'grid',
            style: { border: '1px solid #555', borderRadius: '4px', margin: '5px auto', display: 'block' }
        });
        const ctx = testCanvasObj.ctx;
        if (ctx) {
            drawCanvasPlaceholderText(ctx);
        }
        const testBtn = UI.createButton({
            label: 'Generate Pattern',
            style: { width: '100%', marginTop: '5px' },
            onClick: () => {
                if (ctx) {
                    drawRandomHslStripes(ctx, 200, 60);
                }
            }
        });

        root.appendChild(UI.createSection('Canvas and Button Demo', testCanvasObj.element, testBtn));

        update();
    }
});

// --- Helpers ---

function parseHexColor(hex: string): [number, number, number] {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [255, 255, 255];
}

function drawCanvasPlaceholderText(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#0f0';
    ctx.font = '12px monospace';
    ctx.fillText('Click button below', 35, 35);
}

function drawRandomHslStripes(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.clearRect(0, 0, width, height);
    for (let x = 0; x < width; x += 10) {
        ctx.fillStyle = `hsl(${(x + Math.random() * 50) % 360}, 80%, 50%)`;
        ctx.fillRect(x, 0, 8, height);
    }
}
