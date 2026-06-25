---
title: Core Data and Math Libraries (Lib)
tags: ["libraries", "math", "image processing", "fft", "wavelet", "gif"]
---

## Core Philosophy

The global `Lib` namespace provides zero-dependency, highly optimized mathematical and image processing utilities. 
*   **Data Types:** Image processing functions primarily operate on flat `Float32Array` or `Uint8ClampedArray` to maximize performance.
*   **2D Matrices:** FFT and Kernel operations heavily use arrays of arrays (`Float32Array[]` or `number[][]`).

---

## Image Processing (`Lib.image`)

Utility methods for manipulating spatial image data, separating channels, and edge detection.

### Key Methods

```typescript
// Converts raw RGBA to a flat Float32Array (0.0 - 1.0)
Lib.image.toGrayscale(data: Uint8ClampedArray, w: number, h: number, options?: { method?: 'rec601'|'rec709'|'average', gamma?: number }): Float32Array;

// Extracts a single channel (0=R, 1=G, 2=B, 3=A) into a flat Float32Array (0-255)
Lib.image.extractChannel(rgbaData: Uint8ClampedArray, w: number, h: number, channel: number): Float32Array;

// Writes a 2D float array back into a specific RGBA channel
Lib.image.writeChannel(targetData: Uint8ClampedArray, source2D: Float32Array[], w: number, h: number, channel: number): void;

// Pads a flat 1D image array into a 2D array. Modes: 'constant', 'symmetric', 'reflect', 'mirror'
Lib.image.padTo2D(flatData: Float32Array, srcW: number, srcH: number, targetW: number, targetH: number, mode?: string): Float32Array[];

// 1D Convolution (used for separable filters)
Lib.image.convolve1d(data: Float32Array, w: number, h: number, kernel: Float32Array, vertical: boolean, mode?: string): Float32Array;

// Computes structural gradients (edges) using central difference
Lib.image.computeGradients(flatData: Float32Array, w: number, h: number, targetSize: number, useWindow?: boolean): Float32Array[];
```

### Typical Usage
```typescript
// Extracting and modifying the Red channel
const redFlat = Lib.image.extractChannel(imageData, w, h, 0);
const red2D = Lib.image.padTo2D(redFlat, w, h, 256, 256, 'reflect');
// ... do math on red2D ...
Lib.image.writeChannel(imageData, red2D, w, h, 0);
```

---

## Fourier Transforms (`Lib.fft`)

Handles 1D/2D Fast Fourier Transforms (FFT) and Discrete Cosine Transforms (DCT). It supports arbitrary image sizes using Bluestein's algorithm when dimensions are not powers of 2.

Complex numbers are represented as an object: `{ re: Float32Array[], im: Float32Array[] }`.

### Key Methods

```typescript
// 2D FFT / IFFT
Lib.fft.fft2d(real: number[][] | Float32Array[], imag?: number[][] | Float32Array[] | null): { re: Float32Array[], im: Float32Array[] };
Lib.fft.ifft2d(real: Float32Array[], imag: Float32Array[]): { re: Float32Array[], im: Float32Array[] };

// 2D DCT / IDCT (Returns real numbers only)
Lib.fft.dct2d(input: number[][] | Float32Array[]): Float32Array[];
Lib.fft.idct2d(input: number[][] | Float32Array[]): Float32Array[];

// Centering and Padding
Lib.fft.shift(data: { re: Float32Array[], im: Float32Array[] }): { re: Float32Array[], im: Float32Array[] };
Lib.fft.prepareKernel(kernel: number[][], width: number, height: number): Float32Array[];

// Complex Math
Lib.fft.multiply(a: Complex, b: Complex): Complex;
Lib.fft.magnitude(data: Complex): Float32Array[];
```

### Typical FFT Convolution Usage
```typescript
const F = Lib.fft.fft2d(paddedImage);
const paddedKernel = Lib.fft.prepareKernel(kernelMatrix, targetW, targetH);
const H = Lib.fft.fft2d(paddedKernel);

const G = Lib.fft.multiply(F, H);
const result = Lib.fft.ifft2d(G.re, G.im).re;
```

---

## Spatial Kernels (`Lib.kernel`)

Generates normalized 2D matrices for convolutions.

### Key Methods

```typescript
// Returns a 2D Gaussian matrix (sum = 1)
Lib.kernel.gaussian(size: number, sigma: number): number[][];

// Returns an anti-aliased motion blur line
Lib.kernel.motion(size: number, angleDeg: number): number[][];

// Returns a circular defocus disk
Lib.kernel.disk(size: number, radius?: number): number[][];
```

---

## Plotting & Rendering (`Lib.plot`)

Used primarily by analyzers to render mathematical matrices (like FFT spectrums or DCT histograms) into HTML Canvas elements using scientific colormaps.

### Key Methods

```typescript
Lib.plot.renderMatrix(
    data: number[][] | Float32Array[], 
    canvas: HTMLCanvasElement, 
    options?: { palette?: string, gamma?: number, ignoreDC?: boolean, logScale?: boolean }
): void;

// Available Palettes: 'seismic', 'bwr', 'hot', 'grayscale', 'bone'
```

### Typical Usage
```typescript
const mag = Lib.fft.magnitude(spectrum);
const shifted = Lib.fft.shift({ re: mag, im: mag }).re;
Lib.plot.renderMatrix(shifted, canvasElement, { palette: 'hot', logScale: true, ignoreDC: true });
```

---

## Wavelet Transforms (`Lib.wavelet`)

Provides Discrete Wavelet Transforms (DWT) using the Haar wavelet.

### Key Methods

```typescript
// Performs Multilevel 2D Haar Transform
Lib.wavelet.wavedec2(data: Float32Array, w: number, h: number, maxLevels: number): Array<{
    data?: Float32Array, // Only on the LL (Low-Pass) final result
    LH?: Float32Array,   // Horizontal Detail
    HL?: Float32Array,   // Vertical Detail
    HH?: Float32Array,   // Diagonal Detail
    nw: number,          // Width at this level
    nh: number           // Height at this level
}>;
```

---

## GIF Exporting (`Lib.gif`)

A lightweight encoder for generating animated GIFs from canvas elements.

### Typical Usage
```typescript
const writer = new Lib.gif.Writer(canvasWidth, canvasHeight, { loop: 0 });

// Add frames
writer.addFrame(layer.canvas, { delay: 10, disposal: 2 });
writer.addFrame(layer.canvas, { delay: 10, disposal: 2 });

// Render
const uint8Data = writer.end();
const blob = new Blob([uint8Data], { type: 'image/gif' });
```