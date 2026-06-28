---
title: Filter Registration and Processing
tags: ["filters", "pixel-manipulation", "menu-integration", "recording", "masking"]
---

## Core Concepts

Filters are registered globally via `Filters.register()`. They support two modes:
1. `css`: Utilizes native browser CSS filters (extremely fast but limited).
2. `pixel`: Directly manipulates a 1D `Uint8ClampedArray` pixel data block.

**Strict Rule:** Pixel processing functions (`process`) must be pure mathematical functions. Do not interact with the DOM or `App.state` inside the `process()` function to guarantee thread-safe operation (e.g. for Web Workers).

---

## Filter Registration Interface (`FilterDef`)

```typescript
export interface FilterDef {
    name: string; // The user-friendly filter name
    mode: 'css' | 'pixel';
    filter?: (values: any) => string; // Required for CSS mode
    params?: FilterParam[]; // Basic slider config (optional)
    process?: (data: Uint8ClampedArray, w: number, h: number, values: any) => void; // Required for pixel mode
    apply?: (layer: Layer, values: any) => void; // Completely overrides processing (optional)
    renderUI?: (root: HTMLElement, layer: Layer, hooks: any) => void; // Custom configuration UI (optional)
    dialogOptions?: { width?: string; maxWidth?: string };
    menu?: { path: string; label?: string; order?: number }; // Dynamic top-menu path registration
    [key: string]: any;
}
```

---

## Overriding Processing via the `apply` Hook

The `apply` callback inside `FilterDef` allows a filter to completely override the default 1D pixel processing loops. This is particularly useful for:
- Core transformation operations (Resize, Rotate, Skew) that change canvas dimensions or layer offsets.
- Multi-layer flattening and advanced vector composites.
- Interactive, multi-canvas full-screen workspaces (e.g. `GrabCut` or `Watershed`).

When `apply` is specified, the system executes it directly and bypasses the native processing dialog and masking pipeline.

---

## Dynamic Menu Integration

The `menu` property inside `FilterDef` allows a filter to automatically inject itself into the top-bar dropdown navigation upon application bootstrap:
```typescript
menu: {
    path: 'Filter/Blur', // Slash-separated path. Handled by Menu.registerDynamicItem
    label: 'My Custom Blur...', // Optional custom label (defaults to def.name)
    order: 10 // Sorting preference within the submenu
}
```

---

## Action Recording & Parameter Sanitation

When a filter is applied, `Filters.applyEffect` automatically logs the operation using `App.recordAction` for the Macro system. 

**Sanitation Behavior:** Before serialization, the engine automatically filters out parameters that are transient, such as DOM nodes, canvas instances, or local cache keys starting with `'orig'`.

---

## Custom Pixel Filter Template

```typescript
import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('my-filter', {
    name: 'My Custom Filter',
    mode: 'pixel',
    menu: { path: 'Filter/Stylize', order: 5 },
    dialogOptions: { width: '300px' },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = { intensity: 50 };

        container.appendChild(UI.createSliderRow({
            label: 'Intensity',
            min: 0, max: 100, value: state.intensity,
            onInput: (v: string) => {
                state.intensity = parseInt(v);
                hooks.preview(state); // Triggers real-time preview
            }
        }));

        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const factor = params.intensity / 100;

        for (let i = 0; i < data.length; i += 4) {
            data[i]     = Math.min(255, data[i] * factor);     // Red
            data[i + 1] = Math.min(255, data[i + 1] * factor); // Green
            data[i + 2] = Math.min(255, data[i + 2] * factor); // Blue
        }
    }
});
```

## Automatic Selection Masking

You **do not** need to write masking logic inside your `process` function. The filter engine automatically matches active selection boundaries and blends the processed and original pixels correctly.
