---
title: Core Application State and Event Bus
tags: ["app", "state-management", "event-bus", "history", "keybindings", "recording"]
---

## Core Concepts

The application uses a centralized, mutable global state object (`App.state`) combined with an Event Bus (`App.on`, `App.emit`) to trigger UI updates and re-renders.

**Strict Rule:** Tools and Filters must never manually manipulate the Canvas DOM or sidebar elements directly to reflect changes. They must mutate `App.state` and call `App.emit()` or specific actions.

---

## App State Interface Reference (`AppState`)

```typescript
interface AppState {
    width: number;
    height: number;
    layers: Layer[]; // Index 0 is the TOP visual layer.
    activeLayerId: number | null;
    tool: string; // Current active tool ID
    fg: string; // Foreground Hex color
    bg: string; // Background Hex color
    settings: Record<string, any>;
    isDrawing: boolean;
    start: { x: number; y: number };
    dragOffset: { x: number; y: number };
    zoom: number; // Scale factor (e.g. 1 = 100%)
    recording: boolean; // Flag if macro recording is active
    recordedSteps: string[]; // Steps recorded as JS api code strings
    selection: { 
        active: boolean; 
        mask: HTMLCanvasElement | null; 
        ctx: CanvasRenderingContext2D | null; 
        layerId: number | null;
        outline: HTMLCanvasElement | null; // Precomputed boundary outline
        antOffset: number; // Scrolling dash offset
        animating: boolean; // Active animation loop state
        pattern: HTMLCanvasElement | null; // Cached marching ants stroke pattern
        antsCanvas: HTMLCanvasElement | null; // Offscreen scratch selection canvas
        antsCtx: CanvasRenderingContext2D | null;
        showBorder: boolean; // True if outline border should render
    };
}
```

---

## Standard Event Markers

Always emit these specific events after state modifications to trigger respective UI updates:

- `'render'` - Full canvas redraw (does not update sidebars).
- `'layers:structure'` - Triggered when layers are added, removed, duplicated, or reordered. Rebuilds the layer panel.
- `'layer:props'` - Triggered when opacity, blend mode, coordinates, or selection border visibility changes.
- `'layer:content'` - Triggered when pixel data on a layer changes (updates thumbnails).
- `'tool:change'` - Triggered when active tool changes (updates sidebar settings).
- `'zoom:change'` - Triggered when zoom level changes.
- `'canvas:resize'` - Triggered when global dimensions change.
- `'record:update'` - Triggered when macro recording starts, stops, or adds steps.

---

## History & Undo Lifecycle

The history stack holds deep copies of layer canvases.
- **Save State:** Call `App.actions.saveState()` *before* performing any destructive action (drawing, filtering, transforms).
- **Undo Operation:** Handled via `App.actions.undo()`. It pops the last snapshot, replaces dimensions and layers, and emits `canvas:resize` and `'layers:structure'`.

---

## Global Keybindings (`App.keybinds`)

Tools and actions register keyboard shortcuts via the central registry:
```typescript
// Key format strictly uses lowercase, optionally combined with standard modifiers
App.keybinds.register('ctrl+z', () => App.actions.undo());
App.keybinds.register('delete, backspace', () => { if(App.state.selection.active) App.actions.deleteSelection(); });
```