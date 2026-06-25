---
title: UI Component Library and Popup System
tags: ["ui", "components", "dom", "rendering", "filters", "popup"]
---

## Core Philosophy

The `UI` framework is a minimal, vanilla TypeScript library used to construct dialogs, tool sidebars, and filter popups without external dependencies (like React) or raw `innerHTML` string parsing. 

**Strict Rules:**
1. **Never use `.innerHTML`** to generate form controls, as it drops event listeners. Always use `UI.create*` methods.
2. **Never manually set `.style.display = 'none'`** to hide elements. Always use `UI.toggle()`.
3. **Never block the UI thread during `renderUI`.** Heavy preprocessing (like looping 4 million pixels to build a histogram) must be deferred asynchronously.

---

## The Core Builder: `UI.createNode`

`UI.createNode` is the engine behind all DOM generation in the app. It dynamically translates properties, events, classes, and datasets into strict, type-safe HTML elements.

```typescript
UI.createNode(tag: string, props?: UIProps, ...children: Array<Node | string>): HTMLElement;
```

### The `UIProps` Interface & Processing Behavior

```typescript
interface UIProps {
    id?: string;
    className?: string;
    style?: string | Partial<CSSStyleDeclaration>;
    on?: Record<string, EventListener | EventListenerObject>;
    classList?: string[];
    dataset?: Record<string, string>;
    textContent?: string;
    innerHTML?: string;
    value?: string | number;
    checked?: boolean;
    type?: string;
    [key: string]: any; // Fallback attributes for native DOM element compatibility
}
```

When properties are supplied to `UI.createNode`, the parser processes them using these strict rules:

*   **`on` (Events):** Event listeners are bound directly using `el.addEventListener(eventName, handler)`.
*   **`style`:** If a `string`, it replaces `el.style.cssText`. If a `Partial<CSSStyleDeclaration>` object, styles are mapped via `Object.assign(el.style, val)`. Note that numeric properties must be explicitly declared as strings in strict mode (e.g. `{ flex: '1', bottom: '0' }`).
*   **`classList`:** An array of class names appended cleanly via `el.classList.add()`.
*   **`dataset`:** Key-value pairs mapped onto the element's custom `data-*` attributes via `Object.assign(el.dataset, val)`.
*   **Children Appending:** Each element in the `children` array is analyzed. If it is a native `Node`, it is appended directly. If it is a string or primitive, it is automatically converted into a safe `TextNode` (preventing script injection).

### Example Practical Usage
```typescript
const container = UI.createNode('div', {
    id: 'my-wrapper',
    className: 'container-active',
    classList: ['shadowed', 'rounded'],
    style: { display: 'flex', gap: '10px', marginTop: '15px' },
    dataset: { actionId: 'filter-brightness' },
    on: {
        click: (e) => console.log('Clicked', e.target)
    }
}, UI.createNode('span', {}, 'Inner Label'), 'Text node content');
```

---

## Control Option Interfaces Reference

Every interactive form component accepts a unified configuration options interface to allow strict-mode type checking.

### 1. `UISliderOpts`
Used for raw sliders and form row slider controls.
*   **`label`** (`string | null`): Text header displayed left of the control.
*   **`min`** (`number`): The minimum boundary.
*   **`max`** (`number`): The maximum boundary.
*   **`value`** (`number | string`): Initial position of the thumb handle.
*   **`step`** (`number | null`): Resolution increments. If `null`, defaults to `0.01` when `max <= 1`, and `1` otherwise.
*   **`onInput`** (`(val: string) => void`): Callback fired continuously as the slider is dragged.
*   **`onChange`** (`(val: string) => void`): Callback fired only when the slider thumb is released.
*   **`formatter`** (`(val: string | number) => string`): Formatter callback for the value preview node on the right. Must strictly return a `string` under strict compiler rules.

### 2. `UICheckboxOpts`
Used to render single tick/toggle elements.
*   **`label`** (`string`): Label description rendered to the right of the checkbox.
*   **`value`** (`boolean`): Initial tick state.
*   **`onChange`** (`(checked: boolean) => void`): Triggers when state toggles.
*   **`props`** (`any`): Optional additional parameters applied to the raw input element.

### 3. `UISelectOpts`
Used to represent dropdown selection fields.
*   **`label`** (`string | null`): Header descriptor left of the select dropdown.
*   **`value`** (`any`): Initial selected item value.
*   **`options`** (`Array<string | number | { value: any; text: string }>`): An array of strings or key-value object mappings to build the options array.
*   **`onChange`** (`(val: string) => void`): Event triggered when selection changes.

### 4. `UIRadioOpts`
Used to present single-selection options visible at all times.
*   **`label`** (`string | null`): Header descriptor.
*   **`value`** (`any`): Initial checked radio button value.
*   **`options`** (`Array<string | number | { value: any; label?: string; text?: string }>`): Items to map inside the layout.
*   **`name`** (`string`): Optional standard HTML name attribute. If omitted, generates a unique, collision-free ID automatically.
*   **`layout`** (`'row' | 'column'`): Determines layout alignment via CSS Flexbox.
*   **`onChange`** (`(val: any) => void`): Triggered when an unchecked option is selected.

### 5. `UIColorOpts`
Used for swatch and custom color spectrum selection.
*   **`label`** (`string | null`): Label descriptor.
*   **`value`** (`string`): Initial color in hex format (e.g. `'#007acc'`).
*   **`onChange`** (`(val: string) => void`): Callback triggered when a new color value is committed.

### 6. `UIButtonOpts`
Configuration for action buttons.
*   **`label`** (`string`): Visual text on the button.
*   **`onClick`** (`(e: Event) => void`): Action callback on mouse clicks.
*   **`className`** (`string`): Additional CSS classes (e.g., `'cancel-btn'`, `'btn'`).
*   **`style`** (`any`): Inline CSS string or styling object mapping.

### 7. `UICanvasOpts`
Configurations for generated Canvas elements.
*   **`width`** (`number`): Initial resolution width.
*   **`height`** (`number`): Initial resolution height.
*   **`source`** (`HTMLCanvasElement`): Source canvas to scale, display, and clone data from.
*   **`maxW`** (`number`): Scaling width constraint boundary (defaults to `300`).
*   **`maxH`** (`number`): Scaling height constraint boundary (defaults to `200`).
*   **`bg`** (`'grid' | string`): Set as `'grid'` to render a standard transparent checkerboard pattern. Any other value applies the CSS property directly.
*   **`on`** (`Record<string, Function>`): Map of direct canvas interaction events.
*   **`style`** (`string | Record<string, string>`): Directly applied styling constraints.

---

## Standard Helper Components API

All programmatic UI creation elements must follow this API schema:

```typescript
// Standard Row wrapper: combines any control with a label layout on the left
UI.createRow(label: string | null, content: HTMLElement): HTMLElement;

// Raw single input element generator
UI.createInput(type: string, props: UIProps, onInput: (target: HTMLInputElement) => void): HTMLInputElement;

// Styled standard button
UI.createButton(opts: UIButtonOpts): HTMLElement;

// Lower-level slider wrapper (generates a container with custom value readout badge)
UI.createSlider(opts: UISliderOpts): { container: HTMLElement, input: HTMLInputElement };

// Standardized full form-width slider row
UI.createSliderRow(opts: UISliderOpts): HTMLElement;

// Text-wrapped checkbox input row
UI.createCheckbox(opts: UICheckboxOpts): HTMLElement;

// Standardized context-appropriate description or help information text element
UI.createHint(text: string, props?: UIProps): HTMLElement;

// Dropdown picker select element
UI.createSelectRow(opts: UISelectOpts): HTMLElement;

// Multi-choice selection group
UI.createRadioGroup(opts: UIRadioOpts): HTMLElement;

// Color swatches with absolute canvas picker hook
UI.createColorRow(opts: UIColorOpts): HTMLElement;

// Render-ready canvas with standard 2D contexts
UI.createCanvas(opts: UICanvasOpts): { element: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null };

// Safe layout visibility toggler
UI.toggle(element: HTMLElement, isVisible: boolean, displayMode?: string): void;
```

---

## Best Practices & Patterns for Filters

### Pattern: State Management, Shared Controls & Conditional Rendering
When building multi-algorithm filters, reuse common parameters (like `radius`) across modes instead of duplicating UI elements. To show/hide specific controls based on a dropdown, always use a centralized `updateControls()` function combined with `UI.toggle()`.

```typescript
renderUI(container: HTMLElement, layer: Layer, hooks: any) {
    const state = { mode: 'blur', radius: 5 };
    const update = () => hooks.preview(state);

    // Shared control used by multiple modes
    const radiusSlider = UI.createSliderRow({
        label: 'Radius', min: 1, max: 10, value: state.radius,
        onInput: (v: string) => { state.radius = parseFloat(v); update(); }
    });

    const updateControls = () => {
        // Correct way to toggle visibility based on state
        UI.toggle(radiusSlider, state.mode === 'blur', 'flex');
    };

    container.appendChild(UI.createSelectRow({
        label: 'Mode', options: ['blur', 'sharpen'], value: state.mode,
        onChange: (v: string) => { state.mode = v; updateControls(); update(); }
    }));
    
    container.appendChild(radiusSlider);

    updateControls();
    update();
}
```

### Pattern: Grouped Control Containers & Dynamic Hints
When a specific mode requires multiple unique controls (e.g., checkboxes, secondary sliders), do not toggle them individually. Wrap them in a generic `div` container and toggle the entire container. Pair this with a dynamic hint label to explain the current mode.

```typescript
renderUI(container: HTMLElement, layer: Layer, hooks: any) {
    const state = { mode: 'basic', gamma: 2.2, linear: false };
    const update = () => hooks.preview(state);

    // Dynamic Hint Label
    const statusLabel = UI.createNode('div', { className: 'popup-hint' }, 'Select a mode.');
    container.appendChild(statusLabel);

    // Mode Selector
    container.appendChild(UI.createSelectRow({
        label: 'Mode', options: ['basic', 'advanced'], value: state.mode,
        onChange: (v: string) => { state.mode = v; updateControls(); update(); }
    }));

    // Grouped Mode-Specific Controls
    const advancedGroup = UI.createNode('div', { style: { display: 'none' } });
    
    advancedGroup.appendChild(UI.createSliderRow({
        label: 'Gamma', min: 0.1, max: 5, value: state.gamma,
        onInput: (v: string) => { state.gamma = parseFloat(v); update(); }
    }));
    
    advancedGroup.appendChild(UI.createCheckbox({
        label: 'Linear Space', value: state.linear,
        onChange: (v: boolean) => { state.linear = v; update(); }
    }));
    
    container.appendChild(advancedGroup);

    const updateControls = () => {
        // Toggle the entire group at once
        UI.toggle(advancedGroup, state.mode === 'advanced', 'block');
        // Update contextual help text
        statusLabel.textContent = state.mode === 'basic' ? 'Basic filtering active.' : 'Advanced gamma correction enabled.';
    };

    updateControls();
    update();
}
```

### Pattern: Asynchronous Pre-Processing (For Histograms / Heavy Scans)
If a filter needs to read `layer.ctx.getImageData()` to build an initial UI graph (like Curves or Levels), you must not block the initial render.

```typescript
renderUI(container: HTMLElement, layer: Layer, hooks: any) {
    const state = { value: 0 };
    
    // 1. Render empty UI instantly
    container.appendChild(UI.createNode('div', { id: 'loading', className: 'popup-hint' }, 'Analyzing Image...'));
    const canvasContainer = UI.createNode('div');
    container.appendChild(canvasContainer);

    // 2. Defer heavy work
    requestAnimationFrame(() => {
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const data = layer.ctx.getImageData(0, 0, w, h).data;
        
        // Loop millions of pixels here...
        
        // 3. Update UI
        UI.toggle(container.querySelector('#loading') as HTMLElement, false);
        canvasContainer.appendChild(UI.createCanvas({ width: 256, height: 100 }).element);
        hooks.preview(state);
    });
}
```

### Pattern: Interactive Visualizers & Custom Canvases
For complex visual analyzers (like 3D plots, radar graphs, or custom scopes), use `UI.createNode('canvas')`, bind mouse/wheel interaction events, and implement a `requestAnimationFrame` loop. **Crucial Rule:** Always check `canvas.isConnected` to stop the loop when the popup is closed to prevent memory leaks.

```typescript
renderUI(container: HTMLElement, layer: Layer, hooks: any) {
    const canvas = UI.createNode('canvas', { 
        width: 300, height: 200, 
        style: 'background:#222; cursor:grab; width:100%; border:1px solid #444;' 
    }) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    
    const state = { rotation: 0, isDragging: false };

    // Bind interactive events
    canvas.addEventListener('mousedown', () => { state.isDragging = true; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', () => { state.isDragging = false; canvas.style.cursor = 'grab'; });
    window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!state.isDragging) return;
        state.rotation += e.movementX * 0.01;
        requestAnimationFrame(render);
    });

    const render = () => {
        // Stop animation loop if the user closes the popup
        if (!canvas.isConnected) return; 
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // ... custom drawing logic using state.rotation ...
    };

    container.appendChild(canvas);
    requestAnimationFrame(render);
}
```