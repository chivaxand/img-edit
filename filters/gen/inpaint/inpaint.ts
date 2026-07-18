import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';

import { computeFeatheredMask } from './utils';
import { PushPull } from './push-pull';
import { Diffusion } from './biharmonic-diffusion';
import { SolidColor } from './solid-color';
import { PatchMatch } from './patch-match';
import { TeleaFMM } from './telea-fmm';
import { CoherenceTransportFMM } from './coherence-transport-fmm';
import { PatchMatchCImg } from './patch-match-cimg';

export interface InpaintParameter {
    id: string;
    label: string;
    type: 'slider' | 'select' | 'color';
    min?: number;
    max?: number;
    step?: number;
    options?: { value: string; text: string }[];
    condition?: (settings: any) => boolean;
}

export interface InpaintAlgorithm {
    id: string;
    name: string;
    parameters: InpaintParameter[];
    defaultSettings: Record<string, any>;
    apply: (layer: Layer, maskCanvas: HTMLCanvasElement, settings: any, softness: number) => void;
}

export const INPAINT_ALGORITHMS: InpaintAlgorithm[] = [
    {
        id: 'bct',
        name: 'Coherence Transport (BCT)',
        defaultSettings: { bctRadius: 10, bctTensorRadius: 3 },
        parameters: [
            { id: 'bctRadius', label: 'Search Radius', type: 'slider', min: 2, max: 30, step: 1 },
            { id: 'bctTensorRadius', label: 'Coherence Scale', type: 'slider', min: 1, max: 7, step: 1 }
        ],
        apply: (layer, mask, settings, softness) => CoherenceTransportFMM.inpaint(layer, mask, settings.bctRadius, 25.0, 1.41, settings.bctTensorRadius, softness)
    },
    {
        id: 'biharmonic',
        name: 'Biharmonic Diffusion',
        defaultSettings: { biharmonicSolver: 'bicgstab', biharmonicIterations: 300 },
        parameters: [
            { id: 'biharmonicSolver', label: 'Solver', type: 'select', options: [{ value: 'spsolve', text: 'Direct (Sparse LU)' }, { value: 'bicgstab', text: 'Iterative (BiCGStab)' }] },
            { id: 'biharmonicIterations', label: 'Iterations', type: 'slider', min: 10, max: 500, step: 5, condition: (s) => s.biharmonicSolver === 'bicgstab' }
        ],
        apply: (layer, mask, settings, softness) => Diffusion.inpaintBiharmonic(layer, mask, settings.biharmonicSolver, settings.biharmonicIterations, softness)
    },
    {
        id: 'harmonic',
        name: 'Harmonic Diffusion',
        defaultSettings: { harmonicIterations: 100, harmonicOmega: 1.1 },
        parameters: [
            { id: 'harmonicIterations', label: 'Iterations', type: 'slider', min: 10, max: 500, step: 5 },
            { id: 'harmonicOmega', label: 'SOR Omega', type: 'slider', min: 0.5, max: 1.95, step: 0.05 }
        ],
        apply: (layer, mask, settings, softness) => Diffusion.inpaintHarmonic(layer, mask, settings.harmonicIterations, settings.harmonicOmega, softness)
    },
    {
        id: 'patch_match',
        name: 'Patch match',
        defaultSettings: { patchRadius: 4, patchAccuracy: 50, patchSharpness: 0.0 },
        parameters: [
            { id: 'patchRadius', label: 'Patch Radius', type: 'slider', min: 2, max: 8, step: 1 },
            { id: 'patchAccuracy', label: 'Accuracy', type: 'slider', min: 10, max: 100, step: 5 },
            { id: 'patchSharpness', label: 'Texture Sharpness', type: 'slider', min: 0, max: 100, step: 5 }
        ],
        apply: (layer, mask, settings, softness) => PatchMatch.inpaint(layer, mask, settings.patchRadius, settings.patchAccuracy, settings.patchSharpness / 100, softness)
    },
    {
        id: 'patch_match_cimg',
        name: 'Patch match (CImg)',
        defaultSettings: { 
            cimgPatchSize: 11, 
            cimgLookupSize: 35, 
            cimgBlendSize: 15, 
            cimgBlendScales: 10, 
            cimgBlendOuter: 'true',
            cimgBlendThreshold: 0.0,
            cimgBlendDecay: 0.05
        },
        parameters: [
            { id: 'cimgPatchSize', label: 'Patch Size', type: 'slider', min: 3, max: 21, step: 2 },
            { id: 'cimgLookupSize', label: 'Lookup Size', type: 'slider', min: 4, max: 64, step: 2 },
            { id: 'cimgBlendSize', label: 'Blend Size', type: 'slider', min: 0, max: 50, step: 1 },
            { id: 'cimgBlendScales', label: 'Blend Scales', type: 'slider', min: 0, max: 20, step: 1 },
            { id: 'cimgBlendThreshold', label: 'Blend Threshold', type: 'slider', min: 0.0, max: 1.0, step: 0.05 },
            { id: 'cimgBlendDecay', label: 'Blend Decay', type: 'slider', min: 0.01, max: 0.2, step: 0.01 },
            { id: 'cimgBlendOuter', label: 'Blend Outer Boundary', type: 'select', options: [{ value: 'true', text: 'Enabled' }, { value: 'false', text: 'Disabled' }] }
        ],
        apply: (layer, mask, settings, softness) => PatchMatchCImg.inpaint(
            layer,
            mask,
            settings.cimgPatchSize,
            settings.cimgLookupSize,
            1.0,
            1,
            settings.cimgBlendSize,
            settings.cimgBlendScales,
            settings.cimgBlendOuter === 'true',
            softness,
            settings.cimgBlendThreshold,
            settings.cimgBlendDecay
        )
    },
    {
        id: 'telea',
        name: 'Telea FMM',
        defaultSettings: { teleaRadius: 10 },
        parameters: [
            { id: 'teleaRadius', label: 'Search Radius', type: 'slider', min: 2, max: 15, step: 1 }
        ],
        apply: (layer, mask, settings, softness) => TeleaFMM.inpaint(layer, mask, settings.teleaRadius, softness)
    },
    {
        id: 'solid',
        name: 'Solid Color Fill',
        defaultSettings: { solidColor: '#ffffff' },
        parameters: [
            { id: 'solidColor', label: 'Fill Color', type: 'color' }
        ],
        apply: (layer, mask, settings, softness) => SolidColor.inpaint(layer, mask, settings.solidColor, softness)
    }
];

Filters.register('inpaint', {
    name: 'Inpaint Selection',
    mode: 'unified',
    menu: {
        path: 'Generate',
        label: 'Inpaint Selection...',
        order: 11
    },

    apply(context: FilterContext) {
        const { layer, values, selection } = context;
        if (!selection.active || !selection.mask) {
            alert('Please select an area first.');
            return;
        }

        const method = values.method || 'bct';
        const softness = values.softness !== undefined ? values.softness : 0;
        const algo = INPAINT_ALGORITHMS.find(a => a.id === method) || INPAINT_ALGORITHMS[0];
        algo.apply(layer, selection.mask, values, softness);
    },

    renderUI(root: HTMLElement, layer: Layer, hooks: any) {
        const state: any = { method: 'bct', softness: 0 };
        INPAINT_ALGORITHMS.forEach(algo => Object.assign(state, algo.defaultSettings));

        const update = () => hooks.preview(state);

        root.appendChild(UI.createSelectRow({
            label: 'Method',
            options: INPAINT_ALGORITHMS.map(a => ({ value: a.id, text: a.name })),
            value: state.method,
            onChange: (v) => { state.method = v; updateVisibility(); update(); }
        }));

        const rows: { el: HTMLElement, algoId: string, condition?: (s: any) => boolean }[] = [];

        INPAINT_ALGORITHMS.forEach(algo => {
            algo.parameters.forEach(param => {
                let el: HTMLElement;
                if (param.type === 'slider') {
                    el = UI.createSliderRow({
                        label: param.label, min: param.min!, max: param.max!, step: param.step!, value: state[param.id],
                        onInput: (v) => { state[param.id] = parseFloat(v); updateVisibility(); update(); }
                    });
                } else if (param.type === 'select') {
                    el = UI.createSelectRow({
                        label: param.label, options: param.options!, value: state[param.id],
                        onChange: (v) => { state[param.id] = v; updateVisibility(); update(); }
                    });
                } else if (param.type === 'color') {
                    el = UI.createColorRow({
                        label: param.label, value: state[param.id],
                        onChange: (v) => { state[param.id] = v; updateVisibility(); update(); }
                    });
                }
                root.appendChild(el!);
                rows.push({ el: el!, algoId: algo.id, condition: param.condition });
            });
        });

        root.appendChild(UI.createSliderRow({
            label: 'Edge Softness', min: 0, max: 50, step: 1, value: state.softness,
            onInput: (v) => { state.softness = parseInt(v); update(); }
        }));

        const updateVisibility = () => {
            rows.forEach(r => {
                const isVisible = r.algoId === state.method && (!r.condition || r.condition(state));
                UI.toggle(r.el, isVisible);
            });
        };

        updateVisibility();
        update();
    }
});


// ---------- GLOBAL EXPORT INTERFACES (BACKWARD COMPATIBLE WRAPPERS) ----------

export function pushPullInitialize(
    pixels: Uint8ClampedArray,
    w: number,
    h: number,
    mask: Uint8Array,
    maskedIndices: number[]
) {
    PushPull.initialize(pixels, w, h, mask, maskedIndices);
}

export function inpaintBiharmonic(
    layer: Layer,
    maskCanvas: HTMLCanvasElement,
    solver = 'bicgstab',
    iterations = 150,
    softness = 0
) {
    Diffusion.inpaintBiharmonic(layer, maskCanvas, solver, iterations, softness);
}

export function inpaintHarmonic(layer: Layer, maskCanvas: HTMLCanvasElement, iterations = 100, omega = 1.1, softness = 0) {
    Diffusion.inpaintHarmonic(layer, maskCanvas, iterations, omega, softness);
}

export function inpaintSolid(layer: Layer, maskCanvas: HTMLCanvasElement, hexColor: string, softness = 0) {
    SolidColor.inpaint(layer, maskCanvas, hexColor, softness);
}

export function inpaintPatchBased(
    layer: Layer,
    maskCanvas: HTMLCanvasElement,
    radius = 4,
    accuracy = 90,
    sharpness = 0.7,
    softness = 0
) {
    PatchMatch.inpaint(layer, maskCanvas, radius, accuracy, sharpness, softness);
}

export function inpaintTelea(
    layer: Layer,
    maskCanvas: HTMLCanvasElement,
    range = 5,
    softness = 0
) {
    TeleaFMM.inpaint(layer, maskCanvas, range, softness);
}

export function inpaintBCT(
    layer: Layer,
    maskCanvas: HTMLCanvasElement,
    range = 10,
    tensorRadius = 3,
    softness = 0
) {
    CoherenceTransportFMM.inpaint(layer, maskCanvas, range, 25.0, 1.41, tensorRadius, softness);
}
