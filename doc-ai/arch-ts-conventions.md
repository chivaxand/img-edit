---
title: TypeScript and Compiler Conventions
tags: ["architecture", "typescript", "compiler", "conventions", "compatibility", "strict-mode", "esm", "entry-point"]
---

## Core Concepts

The application is written using modern ECMAScript Modules (ESM) with explicit `import` and `export` statements. During development:
- The TypeScript compiler watches the source files (`tsc --watch`) and compiles them into separate JavaScript modules inside the `/dist` directory to verify type safety.
- Concurrently, `esbuild` bundles the entire application starting from a single, unified entry point (`main.ts`) into a single browser-executable bundle (`dist/bundle.js`).
- For production, a Python script (`_merge.py`) can inline this bundle directly into the HTML template for a single-file deployment.

---

## Architecture & Rules

### Accessing Global Libraries (The "Lib" Variable)
- **The Old Global Pattern:** Libraries historically mutated `global.Lib` via IIFE closures.
- **The Modern ESM Pattern:** Libraries inside `/libs/` are standard ES Modules that use `export const [libName] = ...` (e.g., `export const fft = { ... }`).
- **The Barrel Registry:** These libraries are compiled and exported collectively in `libs/index.ts`:
  ```typescript
  import { fft } from './fft';
  import { gif } from './gif';
  
  export const Lib = { fft, gif };
  ```
- **Backward Compatibility:** To prevent breaking unmigrated code, `libs/index.ts` automatically binds the consolidated `Lib` object to the browser's global scope:
  ```typescript
  if (typeof window !== 'undefined') {
      (window as any).Lib = Lib;
  }
  ```

### Resolving Circular Dependencies (The Entry Point Pattern)
Because ES Modules statically analyze and hoist all `import` statements to the top of compiled files, plugins that try to mutate `App.actions` or `App.state` at the top level of their script can execute *before* `App` is fully constructed.

To prevent runtime `TypeError: Cannot read properties of undefined` crashes, we strictly enforce the **Entry Point Pattern**:
- **`app.ts`** must contain only the raw skeleton definition of the `App` object, its core modules, and state. It must **never** import any plugins or directories (actions, tools, filters, gen, analyze) directly.
- **`main.ts`** acts as the single bootstrap file. It imports `app.ts` first, then imports all of the directories (plugins) so they can safely hook into the fully defined `App` object, and finally runs `App.init()`.

### High-Compatibility API Usage
To ensure the application compiles perfectly on default configurations without requiring specific, unconfigured polyfills or modern engine targets:
- **Do not use `Object.entries`:** Use `Object.keys()` combined with standard type-casting.
  ```typescript
  Object.keys(props || {}).forEach(key => {
      const val = (props as any)[key];
  });
  ```
- **Do not use `.padStart()`:** Use standard string manipulation with a `.slice()` fallback.
  ```typescript
  const paddedSeconds = ("00000" + secondsVal).slice(-5);
  ```

### CSS Style Declarations in Strict Mode
In standard CSS style declarations, numeric properties must be formatted strictly as string values.
```typescript
// Incorrect (triggers TS2322)
UI.createNode('div', { style: { bottom: 0, flex: 1 } });

// Correct (TS compliant)
UI.createNode('div', { style: { bottom: '0', flex: '1' } });
```

### Strict Mode, Implicit Any, and DOM Casting
Because `tsconfig.json` enforces `"strict": true`, you must explicitly handle variable typing, object mapping, and DOM attributes:

- **DOM Element Casting:** Base `HTMLElement` does not contain form or canvas properties. Always cast to the specific element type when accessing properties like `.value`, `.max`, or `.getContext`.
  ```typescript
  (limitSlider.input as HTMLInputElement).value = String(activeLimit);
  ```
- **Non-Null Assertions:** When retrieving a canvas context or known DOM node, use `!` to inform the compiler it is not null.
  ```typescript
  const ctx = canvas.getContext('2d')!;
  ```
- **Empty Arrays:** Arrays instantiated without initial values must have a declared type to avoid implicit `any[]` errors.
  ```typescript
  const list: any[] = [];
  ```
- **Object Indexing:** When using variables as object keys, type the object with `Record<string, type>`.
  ```typescript
  const chMap: Record<string, number> = { r: 0, g: 1, b: 2 };
  const srcCh = chMap[channelStr];
  ```
- **Formatter Return Types:** Any custom string formatter functions (e.g. for sliders or status UI) must strictly return a `string` (not a `number`) since TypeScript's strict mode validates assignability to string elements.
  ```typescript
  formatter: (v) => v === 0 ? 'min' : String(v)
  ```
- **Optional Class/Interface Fields on `this`:** When referencing optional fields from the base interface on the `this` context inside custom methods, always provide a fallback to avoid compilation errors due to potential `undefined` values.
  ```typescript
  options: this.fonts || []
  ```

### Object Literals and Custom Helper Methods
When registering modules via `Filters.register(id, def)` or `App.registerTool(def)`, you may need to add custom internal helper methods (e.g., `computeDCT`, `drawRadarGraph`) to the object literal.

The core interfaces (`FilterDef`, `ToolDef`, etc.) are designed with an index signature (`[key: string]: any;`) to permit arbitrary helper methods while maintaining strict type checking and autocompletion for required core properties (like `name`, `mode`, `process`). You do **not** need to cast the object to `any`.

```typescript
Filters.register('my-complex-filter', {
    name: 'Complex Filter',
    mode: 'pixel',
    
    // Standard interface method
    process(data: Uint8ClampedArray, w: number, h: number) {
        this.myCustomHelper(data);
    },

    // Custom internal helper (Permitted by [key: string]: any in the interface)
    myCustomHelper(data: Uint8ClampedArray) {
        // ...
    }
});
```