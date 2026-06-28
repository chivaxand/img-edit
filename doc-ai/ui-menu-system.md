---
title: Top Menu Bar System
tags: ["ui", "menu", "navigation", "actions", "dynamic-registration", "separators"]
---

## Core Concepts

The application's top navigation bar is generated dynamically from a combination of the static configuration array in `menu.ts` and dynamic registrations added at runtime (e.g. by filters, analyzers, or custom actions).

The menu supports infinitely nested submenus, click-away closures, and automatic hover flyout behaviors.

---

## Adding Menu Items

There are two primary patterns to append actions, tools, filters, or diagnostics to the menu bar:

### 1. Static Configuration (`menu.ts`)
Used primarily for core tools and application-level actions (File operations, Undo/Redo, basic Layer controls) that remain fixed in the UI.

### 2. Dynamic Registration (Recommended for Filters & Actions)
Plugins can register themselves dynamically on startup using `Menu.registerDynamicItem()` without editing `menu.ts`. This is done automatically if `def.menu` is supplied in `Filters.register()`.

```typescript
Menu.registerDynamicItem('Filter/Stylize', {
    label: 'My Custom Stylizer...',
    action: () => Filters.run('my-filter')
}, 10); // Order priority inside the 'Stylize' submenu
```

---

## Static-Dynamic Interleaving and Separators

To keep menus highly organized, the static configuration in `menu.ts` can define placeholders and separators with an explicit `order` parameter. 

When dynamic items are registered, the menu list is automatically re-sorted. Dynamic items with custom `order` properties are seamlessly interleaved before, between, or after static items and separators.

### Configuration Template for Static Interleaving
```typescript
{
    label: 'Color',
    items: [
        // Placeholders for separators with order boundaries
        { type: 'separator', order: 100 }
    ]
}
```
With this setup:
- Basic filters registering with `order` values between `1` and `99` sort above the first separator.
- Intermediate adjustments registering with `order` values of `101+` sort below the separator.

---

## Menu Item Interface (`MenuItemDef`)

```typescript
export interface MenuItemDef {
    label?: string; // Text display
    type?: string; // Set to 'separator' for horizontal lines
    disabled?: boolean;
    action?: () => void; // Trigger callback
    items?: MenuItemDef[]; // Child items
    submenu?: MenuItemDef[]; // Alternative child items representation
    order?: number; // Sorting priority (defaults to 1000)
}
```

---

## Architectural Placement Guidelines

When mapping path parameters in dynamic actions, adhere to these standards:
- **`Generate/`** - Procedural textures, noises, and pattern generators.
- **`Transform/`** - Canvas resizers, rotation tools, layers canvas modifications.
- **`Analyze/`** - Visual diagnostics, split-screen compare tools, and scopes.
- **`Filter/`** - Image modification effects, split into submenus (`Blur`, `Denoise`, `Enhance`, `Edge Detection`, `Stylize`, `Distort`, `Segmentation`).
- **`Tone/`** - Luminance, contrast, exposure, black/white points, levels, and curves.
- **`Color/`** - Chroma shifting, hue, temperature, white balance, grayscale, and color balance.
