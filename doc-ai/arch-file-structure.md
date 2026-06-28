---
title: Global File Structure and Directory Map
tags: ["architecture", "file-structure", "compilation", "directories", "esm", "bundling"]
---

## Core Concepts

The project is structured as a **modular monolith** optimized for a single-file deployment. While development happens across highly modular ES Modules, files are compiled, bundled via `esbuild`, and merged into a single, self-contained `img-edit.html` file.

---

## Directory Map

### Root Files
- `img-edit.html` - The application's UI template and final production container.
- `main.ts` - **The Bootstrap Entry Point.** It loads `libs/index.ts` and `app.ts`, then imports all plugins (actions, tools, filters, generators, analyzers), and triggers `App.init()`.
- `app.ts` - Application skeleton, keybindings, event-bus registration, and coordinate mappings. It must never import any plugins or directories directly.
- `ui.ts` - The custom, programmatic UI builder (`UI` object).
- `ui-popup.ts` - Standard modal popups and movable parameter dialogs.
- `ui-fullscreen.ts` - Universal full-screen workspace overlay for complex diagnostic/interactive features.
- `layers.ts` - Core layers manager and standard layer definitions (`raster`, `text`).
- `filters.ts` - Global filter registration, live preview runner, and selection-masking engines.
- `menu.ts` - Application top-bar menus, drop-downs, and menu action bindings.
- `tsconfig.json` - Compiler configurations targeting ES2016.
- `_merge.py` / `merge.py` - Scripts that inline the bundle JS and CSS directly into `img-edit.html`.

### Domain Directories
All domain directories use **Barrel Files (`index.ts`)** to consolidate and load their local modules cleanly.
- `/doc-ai/` - Flat directory containing Markdown files representing the project's Knowledge Base (RAG context).
- `/libs/` - Standard core mathematical, plotting, and image libraries (FFT, wavelet, plotting).
- `/actions/` - Non-interactive UI dialog actions (e.g., resizing canvas, layers scale, scripts).
- `/tools/` - Interactive, mouse-driven canvas manipulation tools (e.g., crop, select, brushes, shapes).
- `/filters/` - Standard image filters, procedural generators, and visual analyzers.

---

## Code Placement Rules

When adding a new file or feature, strictly enforce these boundaries:

| If you are adding a... | Place it in... | Naming Convention | Reference Doc |
| :--- | :--- | :--- | :--- |
| Mouse/Interactive tool | `/tools/` | `[tool-name].ts` | `feature-tool-system.md` |
| Image modification filter | `/filters/` | `[filter-name].ts` | `feature-filter-system.md` |
| Deep math helper library | `/libs/` | `[library-name].ts` | `core-libraries.md` |
| Macro / script operation | `/actions/script.ts` | — | `feature-macro-system.md` |
| Menu action / Dialog wrapper | `/actions/` | `[action-name].ts` | `feature-actions-pattern.md` |
| AI Architectural Rule | `/doc-ai/` | `[prefix]-[topic].md` | `KNOWLEDGE_BASE_MANIFEST.md` |

---

## The Build and Injection Workflow

**TypeScript Files (`*.ts`)** follow two parallel pipelines:
- **Type-Checking:** `*.ts` → `tsc --watch` → `dist/` *(Type-safe ESM Modules)*
- **Bundling & Merge:** `*.ts` → `esbuild main.ts` → `dist/bundle.js` → Python `merge.py` → `img-edit.html` *(Single-File Deployment)*

The output is a single, independent HTML file that runs instantly in any environment.