---
title: Tool Registration and Lifecycle
tags: ["feature", "tools", "events", "canvas", "interaction"]
---

## Core Concepts

Tools handle interactive behaviors (mouse dragging, drawing, selecting) on the main canvas. They are registered globally via `App.registerTool()` and routed through `App.events`.

*   Only one tool is active at a time (`App.state.tool`).
*   Tools process coordinates differently depending on whether they manipulate the **Global Canvas Space** (like cropping/selection) or the **Layer Local Space** (like drawing/erasing).

## Interfaces

```typescript
interface ToolDef {
    id: string;
    icon: string;
    title: string;
    settings?: any; // Persistent state for the tool UI (e.g., radius, tolerance)
    finishOnLayerSwitch?: boolean; // If true, tool auto-deselects when user clicks a different layer

    // UI Lifecycle
    onSelect?: (panel: HTMLElement) => void; // Builds the tool settings panel UI
    onDeselect?: () => void; // Cleans up when switching to another tool
    drawUI?: () => void; // Renders custom overlays on top of the main canvas (e.g., transform handles)

    // Interaction Lifecycle
    onMouseDown?: (e: MouseEvent) => void;
    onMouseMove?: (e: MouseEvent) => void;
    onMouseUp?: (e: MouseEvent) => void;
    onDoubleClick?: (e: MouseEvent) => void;
    onKeyDown?: (e: KeyboardEvent) => boolean; // Return true to consume the event

    [key: string]: any; // Allow custom helper methods
}
```

## Coordinate System Utilities

Because layers can be moved independently of the main canvas, mouse coordinates must be translated correctly using `App.utils`.

1.  **Global Viewport to Canvas Space:**
    ```typescript
    // Converts raw mouse X/Y to absolute Main Canvas coordinates (accounting for zoom and CSS scaling)
    const pos = App.utils.getPos(e); 
    ```

2.  **Canvas Space to Layer Space:**
    ```typescript
    // Converts absolute Canvas coordinates to relative Layer pixels (accounting for layer offset)
    const localX = App.utils.toLocal(layer, pos.x, 'x');
    const localY = App.utils.toLocal(layer, pos.y, 'y');
    ```

## Tool Implementation Template

```typescript
App.registerTool({
    id: 'my-tool',
    icon: '✦',
    title: 'My Custom Tool',
    settings: { radius: 10 },
    
    onSelect(panel: HTMLElement) {
        // Build settings UI inside the sidebar
        panel.appendChild(UI.createSliderRow({
            label: 'Radius', min: 1, max: 100, value: this.settings.radius,
            onInput: (v: string) => this.settings.radius = parseInt(v)
        }));
    },
    
    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;

        // Check if layer supports manipulation
        if (!App.utils.layerIs(l, 'editable')) return alert('Layer is not editable.');

        // Snapshot before doing destructive actions
        App.actions.saveState();
        App.state.isDrawing = true;
    },
    
    onMouseMove(e: MouseEvent) {
        if (!App.state.isDrawing) return;
        
        const pos = App.utils.getPos(e);
        // Do math, mutate layer ctx, etc...
        
        App.emit('render'); // Redraw canvas visually
    },
    
    onMouseUp(e: MouseEvent) {
        App.state.isDrawing = false;
        App.emit('layer:content'); // Force thumbnail UI update
    },

    drawUI() {
        // Renders visual overlays (like crop bounds or selection boxes) on top of everything.
        // Called automatically at the end of App.render().
        const ctx = App.els.ctx;
        ctx.strokeStyle = 'red';
        ctx.strokeRect(0, 0, 100, 100);
    }
});
```