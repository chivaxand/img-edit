---
title: Filter Registration and Processing
tags: ["image processing", "filters", "pixel manipulation", "registration"]
---

## Architecture/Rules

Filters are registered globally via `Filters.register()`. They support two modes:
1.  `css`: Utilizes native browser CSS filters (fast, limited).
2.  `pixel`: Iterates over raw `Uint8ClampedArray` pixel data for custom algorithms.

**Strict Rule:** Pixel processing functions must be purely mathematical. Do not interact with the DOM or `App.state` inside the `process()` function to ensure future compatibility with Web Workers.

## Implementation Template

### Custom Pixel Filter Template

```typescript
Filters.register('my-filter', {
    name: 'My Custom Filter',
    mode: 'pixel',
    
    // Optional: Define custom dialog dimensions
    dialogOptions: { width: '300px' },

    // 1. Render UI and handle state
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

        // Initial preview
        hooks.preview(state);
    },

    // 2. Pure processing function
    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const factor = params.intensity / 100;

        for (let i = 0; i < data.length; i += 4) {
            // Apply math to r, g, b
            data[i]     = Math.min(255, data[i] * factor);     // R
            data[i + 1] = Math.min(255, data[i + 1] * factor); // G
            data[i + 2] = Math.min(255, data[i + 2] * factor); // B
            // data[i + 3] is Alpha
        }
    }
});
```

### Automatic Masking
You do not need to handle selections or masks inside the `process` function. The `Filters` core engine automatically isolates processing to the bounded box of the active selection mask and blends the original/filtered pixels automatically.
