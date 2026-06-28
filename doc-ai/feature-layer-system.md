---
title: Layer Registration and Management
tags: ["layers", "canvas", "rendering", "registration", "interfaces"]
---

## Core Concepts

The application supports multiple layer types (`raster`, `text`). To add a new type of layer, register it via `Layers.register()`.

Every layer is guaranteed to have a dedicated offscreen `HTMLCanvasElement` and `CanvasRenderingContext2D`.

---

## Rendering Order (Crucial Architectural Rule)

- `App.state.layers[0]` represents the **Top** visual layer.
- `App.state.layers[App.state.layers.length - 1]` represents the **Bottom** visual layer.
- When creating/adding layers, `unshift()` is used to push them to the top.
- The core rendering loop iterates backwards (`for (let i = length - 1; i >= 0; i--)`) to draw layers from bottom to top.

---

## Interfaces

### Core Layer Instance (`Layer`)
```typescript
interface Layer {
    id: number;
    type: string;
    name: string;
    visible: boolean;
    opacity: number;
    blend: string; // e.g. 'source-over', 'multiply'
    x: number; // Global X offset on main canvas
    y: number; // Global Y offset on main canvas
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    [key: string]: any; // Extended settings (e.g. text options)
}
```

### Layer Type Definition (`LayerDef`)
```typescript
interface LayerDef {
    traits?: Record<string, boolean>; // e.g. { editable: boolean, filterable: boolean }
    fonts?: string[]; // Custom parameter (for text layers)
    init?: (l: any, params: any) => void;
    update?: (l: Layer, props?: any) => void;
    draw?: (ctx: CanvasRenderingContext2D, l: Layer) => void;
    buildUI?: (container: HTMLElement, state: any, onChange: (k: string, v: any) => void) => void;
    renderSettings?: (panel: HTMLElement, l: Layer, actions: any) => void;
}
```

---

## Layer Registration Template

```typescript
import { Layers, Layer } from '~/layers';
import { UI } from '~/ui';

Layers.register('custom-type', {
    // Traits decide compatibility with tools/filters. Checked via App.utils.layerIs(layer, 'transformable')
    traits: { editable: false, filterable: false, transformable: true },

    init(l: any, params: any) {
        l.name = params.name || 'Custom Layer';
        l.canvas = document.createElement('canvas');
        l.canvas.width = params.width;
        l.canvas.height = params.height;
        l.ctx = l.canvas.getContext('2d')!;
        
        this.update!(l, params);
    },

    update(l: Layer, props?: any) {
        if (props) Object.assign(l, props);
        // Execute private redraw operations on l.canvas / l.ctx
    },

    // Optional: Overrides default canvas drawing in App.render()
    draw(ctx: CanvasRenderingContext2D, l: Layer) {
        // Defaults to: ctx.drawImage(l.canvas, l.x, l.y, l.width, l.height);
    },

    // Optional: Renders settings in the Sidebar when this layer is selected
    renderSettings(panel: HTMLElement, l: Layer, actions: any) {
        panel.appendChild(UI.createNode('div', {}, 'Custom Settings'));
    }
});
```