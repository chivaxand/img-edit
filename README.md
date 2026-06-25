# ImgEdit

A modular, high-performance, and zero-dependency web-based image editor. Built using vanilla TypeScript and the standard Canvas API, this application compiles down to a single self-contained HTML file (`index.html`) that is fully offline-capable.

## Key Features

- **Core Editing Tools:** Move, Pen (Drawing), Eraser, Zoom, and Crop tools.
- **Advanced Filtering Suite:** Standard pixel manipulation filters including Canny Edge Detection, Kuwahara, bilateral blurs, dithering, and custom convolutions.
- **Diagnostic Analyzers:** Digital forensics (JPEG/DCT histogram analysis, wavelet decomposition, spectral analysis), RGB 3D color cubes, focus maps, and surface normal generators.
- **Procedural Generators:** Procedural textures including Uniform/Gaussian White Noise, Blue Noise (Void-and-Cluster approximation), and Perlin Noise with native blending modes.
- **Layer & Selection Systems:** Support for moving, scaling, opacity tuning, blend modes, rasterization, and marching-ants selection boundaries.

## Architecture Guidelines

- `app.ts` represents the raw state skeleton and event bus definitions. It holds zero plugin imports.
- `main.ts` serves as the application bootstrap, loading core math libraries, importing modular plugins (tools, actions, filters, generators, diagnostics), and mounting the DOM.

For comprehensive architectural design principles, consult the documentation inside the `/doc-ai/` directory.

## Development Workflow

### 1. Local Development (Docker & Live-Reload)
Your local development setup utilizes separate module compilation with live-reload to preserve rapid testing cycles. Run the development stack using:

```bash
# Start Docker-compose to spin up the TypeScript compiler, esbuild watcher, and live-server
./run.sh
```

- **Dev Server Address:** `http://localhost:8080/`
- **Entry point:** `img-edit.html` (which points to `dist/bundle.js`)

### 2. Manual Production Compilation
To bundle all assets into a single standalone HTML file locally:

```bash
# 1. Compile the JS bundle
esbuild main.ts --bundle --outfile=dist/bundle.js --minify

# 2. Run the merge script to inline the compiled JS/CSS into a single file
python merge.py
```
The resulting single-file application is generated as `_img-edit.html`.