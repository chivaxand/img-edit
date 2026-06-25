---
title: Action Dialogs and Live Previews
tags: ["actions", "popup", "preview", "history", "transform"]
---

## Core Concepts

The `App.actions` object contains methods that modify the canvas, layers, or global state. When an action requires a UI dialog with a **Live Preview** (e.g., resizing, skewing, rotating), a strict state-restoration pattern must be followed to avoid corrupting the `App.history` stack.

## Architecture/Rules

1.  **Never mutate the original state permanently during preview.**
2.  **Save the Original State:** Before applying any temporary transformations to a layer's canvas, cache its original `canvas`, `x`, `y`, `width`, and `height`.
3.  **The Update Loop:** Create an internal `update()` function that recalculates the transformation from the *original* cached state to a *new temporary* canvas, then assigns it to the layer and calls `App.render()`.
4.  **Handling Cancel:** If the user clicks Cancel, restore the layer properties from the original cache and call `App.render()`.
5.  **Handling Apply (Crucial):** 
    *   Restore the layer to the original cache *first*.
    *   Call `App.actions.saveState()` so the undo stack records the clean, original state.
    *   Apply the final transformed state to the layer.

## Implementation Template

```typescript
App.actions.openMyCustomDialog = function() {
    const l = App.utils.getActive();
    if (!l) return alert('No active layer selected.');

    // 1. Cache Original State
    const origState = {
        canvas: l.canvas,
        x: l.x, y: l.y,
        w: l.width, h: l.height
    };

    const state = { value: 0 };

    // 2. The Preview Update Loop
    const update = () => {
        const nc = document.createElement('canvas');
        nc.width = origState.w; nc.height = origState.h;
        const ctx = nc.getContext('2d')!;
        
        // ... apply transformations to ctx using origState.canvas ...
        
        l.canvas = nc;
        App.render(); // Redraw canvas with temporary layer
    };

    // 3. Build UI
    App.popup!.setHtml(`
        <h3>My Action</h3>
        <div id="action-root"></div>
        <div class="popup-actions">
            <button class="cancel-btn" id="btn-cancel">Cancel</button>
            <button id="btn-apply">Apply</button>
        </div>
    `);

    // 4. Cancel Handler
    App.popup!.onClick('btn-cancel', () => {
        l.canvas = origState.canvas;
        l.x = origState.x; l.y = origState.y;
        l.width = origState.w; l.height = origState.h;
        App.render();
        App.popup!.close();
    });

    // 5. Apply Handler
    App.popup!.onClick('btn-apply', () => {
        // Cache the final processed canvas
        const finalCanvas = l.canvas;
        
        // Restore to original so History saves the "Before" state
        l.canvas = origState.canvas;
        l.x = origState.x; l.y = origState.y;
        l.width = origState.w; l.height = origState.h;
        
        App.actions.saveState(); // Save to Undo stack
        
        // Re-apply final result
        l.canvas = finalCanvas;
        l.ctx = l.canvas.getContext('2d')!;
        
        App.ui.refreshLayers();
        App.popup!.close();
    });

    App.popup!.show();
};
```