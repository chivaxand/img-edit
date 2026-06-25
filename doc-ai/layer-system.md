---
title: Layer Registration and Management
tags: ["layers", "canvas", "rendering", "registration", "interfaces"]
---

## Core Concepts

The application supports multiple layer types (`raster`, `text`). To add a new type of layer, it must be registered via `Layers.register()`.

Every layer is guaranteed to have a dedicated offscreen `HTMLCanvasElement` and `CanvasRenderingContext2D`. 

### Rendering Order (Crucial Architectural Rule)
*   `App.state.layers[0]` represents the **Top** layer visually.
*   `App.state.layers[App.state.layers.length - 1]` represents the **Bottom** layer visually.
*   When adding a new layer, `unshift()` is used. The rendering loop iterates backwards (`for (let i = length - 1; i >= 0; i--)`) to draw from bottom to top.

## Interfaces

```typescript
interface Layer {
    id: number;
    type: string;
    name: string;
    visible: boolean;
    opacity: number;
    blend: string; // e.g., 'source-over', 'multiply'
    x: number; // Global X offset relative to main canvas
    y: number; // Global Y offset relative to main canvas
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    [key: string]: any; // Extended properties (e.g., text, font, color)
}

interface LayerDef {
    traits?: Record<string, boolean>;
    fonts?: string[];
    init?: (l: any, params: any) => void;
    update?: (l: Layer, props?: any) => void;
    draw?: (ctx: CanvasRenderingContext2D, l: Layer) => void;
    buildUI?: (container: HTMLElement, state: any, onChange: (k: string, v: any) => void) => void;
    renderSettings?: (panel: HTMLElement, l: Layer, actions: any) => void;
}
```

## Implementation Template

### Registering a New Layer Type

```typescript
Layers.register('custom-type', {
    // Traits dictate what tools/filters can interact with this layer.
    // Checked via App.utils.layerIs(layer, 'transformable')
    traits: { editable: false, filterable: false, transformable: true },

    // Called when App.actions.createLayer is invoked
    init(l: any, params: any) {
        l.name = params.name || 'Custom Layer';
        l.canvas = document.createElement('canvas');
        l.canvas.width = params.width;
        l.canvas.height = params.height;
        l.ctx = l.canvas.getContext('2d')!;
        
        // Setup initial canvas state
        this.update!(l, params);
    },

    // Called when properties change
    update(l: Layer, props?: any) {
        if (props) Object.assign(l, props);
        // Custom redraw logic on the layer's private canvas
    },

    // Optional: Overrides default canvas drawing in App.render()
    draw(ctx: CanvasRenderingContext2D, l: Layer) {
        // Default behavior if omitted: 
        // ctx.drawImage(l.canvas, l.x, l.y, l.width, l.height);
    },

    // Optional: Renders settings in the Tool Settings Sidebar when layer is selected
    renderSettings(panel: HTMLElement, l: Layer, actions: any) {
        panel.appendChild(UI.createNode('div', {}, 'Custom Layer Settings'));
    }
});
```