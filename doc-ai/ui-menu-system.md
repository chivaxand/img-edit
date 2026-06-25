---
title: Top Menu Bar System
tags: ["ui", "menu", "navigation", "actions"]
---

## Core Concepts

The application's top navigation bar is generated dynamically from a single configuration object located in `menu.ts`. The structure defines standard dropdowns (File, Filter, Generate, Layer) and automatically hooks into `App.actions` or `Filters.run()`.

The menu is designed to handle infinitely nested submenus and handles native UI click-away and hover behaviors automatically.

## Architecture/Rules

The entire layout is driven by `Menu.structure`. To add a new action, filter, or generator to the application, you **must** append a new entry to the appropriate category array within `menu.ts`.

### Menu Item Types

`MenuItemDef` objects support three primary types of entries:

1.  **Action Item:** Triggers a function immediately.
    ```typescript
    { label: 'Export Base64', action: () => App.actions.exportBase64() },
    // Most filters are triggered this way:
    { label: 'Gaussian Blur...', action: () => Filters.run('blur') }
    ```
2.  **Submenu:** Opens a nested fly-out menu.
    ```typescript
    { 
        label: 'Denoise', 
        submenu: [
            { label: 'Median...', action: () => Filters.run('median') },
            { label: 'Non-Local Means...', action: () => Filters.run('nlm') }
        ]
    }
    ```
3.  **Separator:** A visual divider line.
    ```typescript
    { type: 'separator' }
    ```

### Adding New Tools/Filters to the Menu

If you create a new feature, follow this routing protocol:
*   Did you create a new **Procedural Texture**? Put it in the `Generate` menu.
*   Did you create a **Canvas Resizer/Transformer**? Put it in the `Transform` menu.
*   Did you create a new **Visual Analyzer**? Put it in the `Analyze` menu.
*   Did you create an **Image Effect/Filter**? Put it in the `Filter` menu under an appropriate submenu (`Enhance`, `Stylize`, `Distort`, etc.).

### Keyboard Shortcuts
Note that placing `(Ctrl+A)` inside the label of a menu item is strictly visual. Actual keyboard shortcut bindings must be registered separately via `App.keybinds.register('ctrl+a', ...)` in `app.ts`.