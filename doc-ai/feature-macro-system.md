---
title: Scripting and Macro Recording System
tags: ["macros", "scripting", "recording", "sandbox", "api"]
---

## Core Concepts

The application features a built-in JavaScript scripting environment and action recorder. Users can run sequential macro scripts in real-time or record their interface actions to automatically compile repeatable scripts.

---

## Execution Sandbox

Macros are evaluated dynamically using a structured Function wrapper. The script execution context has access to a dedicated wrapper API (`api`), the core `App` object, and the `Filters` utility:

```typescript
const fn = new Function("api", "App", "Filters", `
    return (async () => {
        ${code}
    })();
`);
await fn(ScriptAPI, App, Filters);
```

---

## Script Recorder Workflow

The recorder captures user actions and logs them as clean JavaScript commands.
- **Toggling Recorder:** Toggled via `App.actions.toggleRecording()`. It manages `App.state.recording`.
- **Recording Steps:** Actions invoke `App.recordAction("api.call(args);")` during operation. If recording is active, this appends the command string to `App.state.recordedSteps`.
- **Recorder Safety:** During macro script execution, the recording state is briefly suspended to prevent running scripts from recording themselves and producing circular infinite loops.

---

## Scripting API Reference (`api`)

The following methods are exposed via the `api` (`ScriptAPI`) parameter to scripts:

### Canvas Operations
- `api.resizeCanvas(w: number, h: number)` - Re-adjusts global canvas dimensions.
- `api.increaseCanvasSize(percent: number)` - Offsets existing layers and increases dimensions by a relative percentage.
- `api.crop(x: number, y: number, w: number, h: number)` - Crops global canvas to coordinates.

### Layer Operations
- `api.addEmptyLayer()` - Appends a new blank layer at the top.
- `api.duplicateActiveLayer()` - Copies active layer.
- `api.deleteActiveLayer()` - Removes active layer.
- `api.setActiveLayerIndex(index: number)` - Targets a specific layer by index.
- `api.setActiveLayerOpacity(op: number)` - Sets active opacity (0-100 or 0-1).
- `api.setActiveLayerName(name: string)` - Changes layer name.
- `api.translateActiveLayer(dx: number, dy: number)` - Shifts layer position.
- `api.mergeActiveLayerDown()` - Flattens active layer with the layer below it.
- `api.moveActiveLayer(dir: number)` - Swaps layer index in rendering list (e.g. `-1` for Up, `1` for Down).

### Selections
- `api.selectNone()` - Cancels active selection mask.
- `api.selectLayerAlpha()` - Generates selection outline from active layer alpha channel.
- `api.growSelection(px: number)` - Expands active selection mask outwards.
- `api.fillSelection(colorHex: string)` - Fills selection area with a solid color.

### Image Processing
- `api.applyFilter(filterId: string, params?: Record<string, any>)` - Executes registered filter.
- `api.setColor(type: 'fg' | 'bg', val: string)` - Sets active colors.
- `api.floodFill(x, y, colorHex, tolerance, contiguous, smooth)` - Executes bucket fill.
- `api.magicWandSelect(x, y, tolerance, contiguous, smooth)` - Generates mask based on pixel color similarity.

### Drawing and Vector Shapes
- `api.drawLine(sx, sy, ex, ey, strokeWidth, startCap, endCap, colorHex)` - Draws line.
- `api.drawShape(type: 'rect' | 'circle', sx, sy, ex, ey, strokeWidth, fill, useStroke, radius)` - Draws shapes.

### Exporting
- `api.exportPNG()` - Initiates PNG browser download.
- `api.exportJPEG(quality, bgColor)` - Initiates JPEG export.
- `api.exportGIF(loop, frames)` - Generates animated GIF.