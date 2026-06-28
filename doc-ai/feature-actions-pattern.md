---
title: Action Dialogs and Live Previews
tags: ["actions", "popup", "preview", "history", "recording", "transform"]
---

## Core Concepts

`App.actions` houses operations that alter layers, dimensions, or state. Actions requiring configuration inputs (e.g. Resizing, Skewing, Rotating) must follow a strict **State-Restoration Pattern** to keep the preview visual, the history stack pristine, and the macro system recorded.

---

## Architecture & Rules

1. **Never mutate original state permanently during preview.**
2. **Cache Original State:** Store copies of original layer properties (`canvas`, `x`, `y`, `width`, `height`) before applying preview adjustments.
3. **The Preview Update Loop:** Implement a local `update()` function executing the logic on a fresh temporary canvas from the original cached elements, assigning it to the layer, and calling `App.render()`.
4. **Handling Cancel:** Revert to cached original state and dismiss the popup.
5. **Handling Apply (Crucial):**
   - Restore properties to the original cached state first.
   - Invoke `App.actions.saveState()` to register the "Before" state in the history stack.
   - Apply the final processed state.
   - Record the finalized API action via `App.recordAction("api.methodName(...)");` to enable macro reproduction.

---

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
        
        // 6. Record Macro Step
        App.recordAction(`api.myCustomAction(${state.value});`);
        
        App.ui.refreshLayers();
        App.popup!.close();
    });

    App.popup!.show();
};
```