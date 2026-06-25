---
title: Core Application State and Event Bus
tags: ["architecture", "app", "state management", "event bus", "history", "keybinds"]
---

## Core Concepts

The application uses a centralized, mutable global state object (`App.state`) combined with a custom Event Bus (`App.on`, `App.emit`) to trigger UI updates and re-renders. 

**Strict Rule:** Tools and Filters must never manually manipulate the Canvas DOM or UI panels directly to reflect state changes. They must mutate `App.state` and call `App.emit()` or specific `App.actions`.

## Global Application Structure (`App`)

The global `App` object serves as the backbone of the application, broken into these domains:
*   `App.state` - The single source of truth for canvas size, active tools, colors, layers, and selections.
*   `App.actions` - Global mutators. Any external action file (e.g., `/actions/transform.ts`) injects methods here via `Object.assign(App.actions, { ... })`.
*   `App.utils` - Pure helpers for coordinate mapping, color conversion, and layer lookups.
*   `App.keybinds` - Centralized keyboard shortcut registry.
*   `App.history` - Undo/Redo stack manager based on full layer cloning.

## Core State Object Interface (`AppState`)

```typescript
interface AppState {
    width: number;
    height: number;
    layers: Layer[]; // Index 0 is the TOP visual layer.
    activeLayerId: number | null;
    tool: string; // Current active tool ID
    fg: string; // Hex color
    bg: string; // Hex color
    settings: Record<string, any>;
    isDrawing: boolean;
    start: { x: number; y: number };
    dragOffset: { x: number; y: number };
    zoom: number; // 1 = 100%, 0.5 = 50%
    selection: { 
        active: boolean; 
        mask: HTMLCanvasElement | null; 
        ctx: CanvasRenderingContext2D | null; 
        layerId: number | null 
    };
}
```

## Standard Event Markers

Always emit these specific events after state modifications:
*   `App.emit('render')` - Triggers a full canvas redraw (does not update UI panels).
*   `App.emit('layers:structure')` - Emitted when layers are added, removed, or reordered. Rebuilds the Layer UI panel.
*   `App.emit('layer:props')` - Emitted when layer opacity, blend mode, or transform coordinates change.
*   `App.emit('layer:content')` - Emitted when pixel data on a layer changes (updates thumbnails).
*   `App.emit('tool:change')` - Emitted when the active tool changes.
*   `App.emit('zoom:change')` - Emitted when canvas scale changes.
*   `App.emit('canvas:resize')` - Emitted when the global width/height changes.

## History & Undo Lifecycle

The history stack holds deep copies of layer canvases.
*   **The Anti-Pattern:** Manually caching image data arrays in tool logic to implement custom undo.
*   **The Solution:** Call `App.actions.saveState()` *before* performing any destructive action (drawing, filtering, moving). The engine automatically snapshots the layers via deep canvas copying and stores them in `App.history.stack` (limit 20).

## Global Keybindings (`App.keybinds`)

Tools and actions should register keyboard shortcuts via the central keybind registry rather than listening to the window directly.
```typescript
// Key format strictly uses lowercase, optionally combined with standard modifiers
App.keybinds.register('ctrl+z', () => App.actions.undo());
App.keybinds.register('delete, backspace', () => App.actions.deleteSelection());
```