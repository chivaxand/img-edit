import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';
import { InterpolationType, BoundaryMode } from '~/libs/image';

(function() {
    // --- Helper for UI ---
    const createAlgoSelect = (state: any, update: Function) => {
        return UI.createSelectRow({
            label: 'Interpolation',
            value: state.interpolation || 'bilinear',
            options: [
                { value: 'nearest', text: 'Nearest Neighbor' },
                { value: 'bilinear', text: 'Bilinear' },
                { value: 'bicubic', text: 'Bicubic' },
                { value: 'lanczos3', text: 'Lanczos3' }
            ],
            onChange: v => { state.interpolation = v as InterpolationType; update(); }
        });
    };

    const createBoundarySelect = (state: any, update: Function) => {
        return UI.createSelectRow({
            label: 'Boundary Mode',
            value: state.boundary || 'constant',
            options: [
                { value: 'constant', text: 'Constant (Transparent)' },
                { value: 'clamp', text: 'Clamp (Repeat Edge)' },
                { value: 'wrap', text: 'Wrap (Tiled)' },
                { value: 'reflect', text: 'Reflect' }
            ],
            onChange: v => { state.boundary = v as BoundaryMode; update(); }
        });
    };

    // --- Filter Registrations ---
    Filters.register('distort-water', {
        name: 'Water Surface',
        mode: 'pixel',
        menu: {
            path: 'Filter/Distort',
            label: 'Water ripple...',
            order: 4
        },

        renderUI(container: HTMLElement, layer: Layer, hooks: any) {
            const state = { 
                amplitude: 15, 
                frequency: 15, 
                perspective: 60, 
                speed: 10,
                lacunarity: 1.8, 
                gain: 0.5, 
                interpolation: 'bilinear' as InterpolationType,
                boundary: 'constant' as BoundaryMode,
                antialiasing: false
            };
            const update = () => hooks.preview(state);

            container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
                'Simulates chaotic ocean waves using FBM noise.'));

            container.appendChild(UI.createSliderRow({
                label: 'Choppiness', min: 0, max: 100, step: 0.1, value: state.amplitude,
                onInput: v => { state.amplitude = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Scale', min: 1, max: 100, step: 0.1, value: state.frequency,
                onInput: v => { state.frequency = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Perspective', min: 0, max: 100, step: 0.1, value: state.perspective,
                onInput: v => { state.perspective = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Flow', min: 0, max: 360, step: 0.1, value: state.speed,
                onInput: v => { state.speed = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Lacunarity', min: 1.0, max: 4.0, step: 0.05, value: state.lacunarity,
                onInput: v => { state.lacunarity = parseFloat(v); update(); }
            }));
            container.appendChild(UI.createSliderRow({
                label: 'Gain', min: 0.1, max: 0.95, step: 0.05, value: state.gain,
                onInput: v => { state.gain = parseFloat(v); update(); }
            }));
            container.appendChild(createAlgoSelect(state, update));
            container.appendChild(createBoundarySelect(state, update));
            container.appendChild(UI.createCheckbox({
                label: 'Antialiasing (Super-sampling)',
                value: state.antialiasing,
                onChange: v => { state.antialiasing = v; update(); }
            }));
            
            update();
        },

        process(data: Uint8ClampedArray, w: number, h: number, { amplitude, frequency, perspective, speed, lacunarity, gain, interpolation, boundary, antialiasing }: any) {
            if (amplitude === 0) return;

            const iter = 8;
            const time = speed * 0.1;
            const aspect = 1 + (perspective / 30);
            
            const rotAng = 1.75; 
            const cosR = Math.cos(rotAng);
            const sinR = Math.sin(rotAng);
            
            const baseFreqX = frequency / 400;
            const baseFreqY = baseFreqX * aspect;
            const ampFactor = amplitude * 0.5;

            const lac = lacunarity;
            const g = gain;

            const imageWrapper = { data, width: w, height: h };
            Lib.image.deform(imageWrapper, imageWrapper, (x: number, y: number) => {
                let u_offset = 0;
                let v_offset = 0;

                let nx = x * baseFreqX;
                let ny = y * baseFreqY;
                let currentAmp = 1.0;

                for (let i = 0; i < iter; i++) {
                    const speedMod = 1 + i * 0.2;
                    const phaseX = nx + time * speedMod;
                    const phaseY = ny + time * speedMod; 
                    
                    u_offset += Math.cos(phaseX) * currentAmp;
                    v_offset += Math.sin(phaseY) * currentAmp; 

                    const rx = nx * cosR - ny * sinR;
                    const ry = nx * sinR + ny * cosR;

                    nx = rx * lac; 
                    ny = ry * sinR + ny * cosR; // Adjusted matrix transform pass
                    nx = rx * lac;
                    ny = ry * lac;
                    currentAmp *= g; 
                }

                return {
                    u: x + u_offset * ampFactor,
                    v: y + v_offset * ampFactor
                };
            }, { interpolation, boundary, antialiasing });
        }
    });
})();
