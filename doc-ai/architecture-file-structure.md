---
title: Global File Structure and Directory Map
tags: ["architecture", "file-structure", "compilation", "directories", "esm", "bundling"]
---

## Core Concepts

The project is structured as a **modular monolith** optimized for a single-file deployment. While development happens across highly modular ES Modules (maximizing code isolation and LLM context limits), the files are compiled, bundled via `esbuild`, and merged into a single, self-contained `img-edit.html` file.

---

## Directory Map

### Root Files
- `img-edit.html` - The application's UI template and final production container.
- `main.ts` - **The Bootstrap Entry Point.** It loads `libs/index.ts`, `app.ts` (skeleton), then loads all modular plugins (actions, tools, filters, generators, analyzers), and finally registers the DOM initialization hooks.
- `app.ts` - Application skeleton, keybindings, event-bus registration, and central coordinate system mapping. No side-effect plugins should be imported here.
- `ui.ts` - The custom, programmatic UI builder (`UI` object) and popup window manager (`Popup` class).
- `ui-popup.ts` - Handles standard program modals and movable parameter dialog frames.
- `ui-fullscreen.ts` - The universal full-screen workspace overlay for complex multi-canvas or interactive features.
- `layers.ts` - The core layers manager and standard layer definitions (`raster`, `text`).
- `filters.ts` - The global filter registration, live preview runner, and selection-masking engines.
- `menu.ts` - Application top-bar menus, drop-downs, and menu action bindings.
- `tsconfig.json` - Compiler configurations targeting ES2016 with `"moduleResolution": "node"` for clean module matching.
- `_merge.py` - Python script that takes the bundled JS, CSS styles, and inlines them directly into `img-edit.html` for single-file deployment.

### Domain Directories
All domain directories use **Barrel Files (`index.ts`)** to consolidate and load their local modules cleanly as a single namespace.
- `/doc-ai/` - Flat directory containing Markdown files representing the project's Knowledge Base (RAG context).
- `/libs/` - Standard core mathematical, plotting, and image manipulation libraries (FFT, wavelet, plotting).
- `/actions/` - Non-interactive UI dialog actions (e.g., resizing canvas, layer scaling, merges, flips, rotations).
- `/tools/` - Interactive, mouse-driven canvas manipulation tools (e.g., crop, select, brushes, shapes).
- `/filters/` - Standard image filters.
  - `/filters/denoise/` - Specialized pixel denoising algorithms (BM3D, NLM, TV, Median).
- `/analyze/` - Specialized visual diagnostic and analytical tools (Forensic analyzer, focus maps, spectral analysis, RGB cube).
- `/gen/` - Procedural noise and image generators (White noise, Perlin, Blue noise).
- `/tests/` - Non-browser unit and execution tests.

---

## Code Placement Rules

When requesting an LLM to generate code or when creating files yourself, strictly enforce these structural boundaries:

| If you are adding a... | Place it in... | Naming Convention |
| :--- | :--- | :--- |
| Mouse/Interactive tool | `/tools/` | `[tool-name].ts` |
| Image modification filter | `/filters/` | `[filter-name].ts` |
| Deep math helper library | `/libs/` | `[library-name].ts` |
| Diagnostic analyzer | `/analyze/` | `[analyzer-name].ts` |
| Procedural generator | `/gen/` | `[generator-name].ts` |
| Menu action / Dialog wrapper | `/actions/` | `[action-name].ts` |
| AI Architectural Rule | `/doc-ai/` | `[prefix]-[topic].md` |

---

## The Build and Injection Workflow

**TypeScript Files (`*.ts`)** follow two parallel pipelines:
- **Type-Checking:** `*.ts` → `tsc --watch` → `dist/` *(Type-safe ESM Modules)*
- **Bundling & Merge:** `*.ts` → `esbuild main.ts` → `dist/bundle.js` → Python `_merge.py` → `img-edit.html` *(Single-File Deployment)*

- **Development:** Developers edit modular `.ts` files inside domain folders. 
- **Compilation:** The TypeScript compiler (`tsc --watch`) compiles files to `/dist` to ensure zero compilation errors. Concurrently, `esbuild` bundles starting from `main.ts` into a unified `dist/bundle.js` bundle in real-time.
- **Merge:** For deployment, the python `_merge.py` script reads the bundled JS, style templates, and inlines them directly into the target scripts tags inside `img-edit.html`.
- **Distribution:** The output is a single, independent HTML file that runs instantly on any server, device, or offline workspace.