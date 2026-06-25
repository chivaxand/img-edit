---
title: Procedural Pixel Generators
tags: ["generators", "noise", "perlin", "filters", "procedural"]
---

## Core Concepts

Generators (such as White Noise, Perlin Noise, and Blue Noise) mathematically produce texture or noise patterns. Architecturally, generators are implemented exactly like standard image **Filters** (`mode: 'pixel'`) via the `Filters.register()` system.

The key difference lies in their behavior: Instead of reading and distorting the existing `data` array of the layer based on spatial logic (like a Blur does), generators overwrite or blend their procedurally generated values into the `data` array.

Because generators are built on top of the standard `Filters` engine, **Selection Masking** is handled automatically. If a user creates a selection mask, the generator only applies its noise to the pixels within that selection.

## Generator Architecture

A standard generator implementation must include robust blending logic. Because generators often overlay noise onto an existing image (e.g., adding film grain), providing user-controlled blend modes (Mix, Overlay, Add, Multiply) is critical.

### The Blending Template
Most generators should use this standard blending formula block inside their `process` function:

```typescript
// 1. Calculate the raw noise value
const noiseVal = Math.random() * 255; 

// 2. Blend Mode Helper
const alpha = opacity / 100;

const applyBlend = (bg: number, fg: number) => {
    if (blendMode === 'replace') return fg;
    
    let res = fg;
    if (blendMode === 'add') {
        res = bg + fg;
    } else if (blendMode === 'multiply') {
        res = (bg * fg) / 255;
    } else if (blendMode === 'screen') {
        res = 255 - (255 - bg) * (255 - fg) / 255;
    } else if (blendMode === 'overlay') {
        // Overlay provides excellent realistic film grain
        res = bg < 128 
            ? (2 * bg * fg / 255) 
            : (255 - 2 * (255 - bg) * (255 - fg) / 255);
    }
    
    // Apply final opacity mix
    return bg * (1 - alpha) + res * alpha;
};

// 3. Write out to the array
data[idx] = applyBlend(data[idx], noiseVal);
data[idx+1] = applyBlend(data[idx+1], noiseVal);
data[idx+2] = applyBlend(data[idx+2], noiseVal);
if (blendMode === 'replace') data[idx+3] = 255; 
```

## Performance Considerations

*   **Caching:** Complex generators (like Void-and-Cluster Blue Noise) are extremely computationally heavy. If parameters like size and scale don't change frequently between redraws (e.g., the user is only sliding the opacity bar), the core mask should be generated once and cached.
*   **Math Intensity:** Pre-calculate `Math.sin`/`Math.cos` where possible or use fast approximations if looping millions of times.