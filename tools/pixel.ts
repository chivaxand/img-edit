import { App } from '../app';
import { UI } from '../ui';
import { Layer } from '../layers';

// Eyedropper Tool
App.registerTool({
    id: 'eyedropper',
    icon: '🖌',
    title: 'Eyedropper',
    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createNode('div', {style:'padding:5px; color:#888'}, 'Left-click for FG, Right-click for BG color.'));
        if (App.els.canvas) App.els.canvas.oncontextmenu = (e: Event) => e.preventDefault();
    },
    onDeselect() {
        if (App.els.canvas) App.els.canvas.oncontextmenu = null;
    },
    onMouseDown(e: MouseEvent) {
        const pos = App.utils.getPos(e);
        const ctx = App.els.ctx; // Main display context
        const p = ctx.getImageData(pos.x, pos.y, 1, 1).data;
        const hex = App.utils.rgbToHex(p[0], p[1], p[2]);
        
        if (e.button === 2 || e.altKey) {
            App.actions.setColor('bg', hex);
        } else {
            App.actions.setColor('fg', hex);
        }
    }
});

// Shared Flood Fill Logic
const performFloodFill = (layer: Layer, x: number, y: number, options: any = {}) => {
    const { 
        color = {r:0, g:0, b:0}, 
        tolerance = 0, 
        isSelection = false,
        contiguous = true,
        smooth = false 
    } = options;

    // Coordinate conversion
    const lx = Math.floor(App.utils.toLocal(layer, x, 'x'));
    const ly = Math.floor(App.utils.toLocal(layer, y, 'y'));
    if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) return;

    const w = layer.width;
    const h = layer.height;
    const imgData = layer.ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    
    // Get source color
    const idx = (ly * w + lx) * 4;
    const sr = data[idx], sg = data[idx+1], sb = data[idx+2], sa = data[idx+3];
    
    // If filling with same color (and no tolerance), abort to prevent infinite loop/no-op
    if (!isSelection && App.utils.colorsMatch(sr, sg, sb, sa, color.r, color.g, color.b, 255, 0)) return;

    // Handle Active Selection Constraint
    let selData: Uint8ClampedArray | null = null;
    if (!isSelection && App.state.selection.active && App.state.selection.layerId === layer.id && App.state.selection.ctx) {
        try {
            // Retrieve selection mask data
            selData = App.state.selection.ctx.getImageData(0, 0, w, h).data;
            // If the starting pixel is outside the selection, abort immediately
            if (selData[idx + 3] === 0) return null;
        } catch (e) {
            console.warn('FloodFill: Could not read selection mask', e);
        }
    }

    // Helper to check match
    const match = (i: number) => {
        // Selection Constraint
        if (selData && selData[i + 3] === 0) return false;
        // Color Match
        return App.utils.colorsMatch(data[i], data[i+1], data[i+2], data[i+3], sr, sg, sb, sa, tolerance);
    };
    
    // Create Mask Buffer (0 = None, 255 = Selected)
    const maskData = new Uint8ClampedArray(w * h);

    if (contiguous) {
        // Efficient Horizontal Scanline Algorithm
        const stack = [[lx, ly]];

        while (stack.length) {
            let [cx, cy] = stack.pop()!;
            let currIdx = (cy * w + cx) * 4;

            // If already processed, skip
            if (maskData[cy * w + cx]) continue;

            // Move Left: Find the start of the span
            while (cx >= 0 && match(currIdx)) {
                cx--;
                currIdx -= 4;
            }
            cx++;
            currIdx += 4;

            let spanAbove = false;
            let spanBelow = false;

            // Scan Right: Fill span and check rows above/below
            while (cx < w && match(currIdx)) {
                const pIdx = cy * w + cx;
                
                // Mark as processed/selected
                maskData[pIdx] = 255; 

                // Check row above
                if (cy > 0) {
                    const upIdx = pIdx - w;
                    // Check if color matches AND not yet visited (via maskData)
                    if (!maskData[upIdx] && match((upIdx) * 4)) {
                        if (!spanAbove) {
                            stack.push([cx, cy - 1]);
                            spanAbove = true;
                        }
                    } else {
                        spanAbove = false;
                    }
                }

                // Check row below
                if (cy < h - 1) {
                    const downIdx = pIdx + w;
                    if (!maskData[downIdx] && match((downIdx) * 4)) {
                        if (!spanBelow) {
                            stack.push([cx, cy + 1]);
                            spanBelow = true;
                        }
                    } else {
                        spanBelow = false;
                    }
                }

                cx++;
                currIdx += 4;
            }
        }
    } else {
        // Non-contiguous (Global Replace)
        for (let i = 0; i < data.length; i += 4) {
            if (match(i)) {
                maskData[i/4] = 255;
            }
        }
    }

    // Apply Smoothing (Anti-aliasing) to the Mask
    if (smooth) {
        const copy = new Uint8ClampedArray(maskData);
        for (let i = 0; i < maskData.length; i++) {
            // Skip completely empty areas
            if (copy[i] === 0) {
                const c = i % w; 
                // Simple neighbor check to see if we are on edge
                if (!((c > 0 && copy[i-1]) || (c < w-1 && copy[i+1]) || (i >= w && copy[i-w]) || (i < w*(h-1) && copy[i+w]))) continue;
            }
            
            const r = Math.floor(i / w);
            const c = i % w;
            let sum = copy[i] * 4; // Weight center more
            let div = 4;
            
            if (c > 0) { sum += copy[i-1]; div++; }
            if (c < w-1) { sum += copy[i+1]; div++; }
            if (r > 0) { sum += copy[i-w]; div++; }
            if (r < h-1) { sum += copy[i+w]; div++; }
            
            maskData[i] = sum / div;
        }
    }

    // Convert Mask Buffer to Canvas
    const mCanvas = document.createElement('canvas');
    mCanvas.width = w; mCanvas.height = h;
    const mCtx = mCanvas.getContext('2d', { willReadFrequently: true })!;
    const mImgData = mCtx.createImageData(w, h);
    
    for (let i = 0; i < maskData.length; i++) {
        const val = maskData[i];
        if (val > 0) {
            mImgData.data[i*4] = val;   // R
            mImgData.data[i*4+1] = val; // G
            mImgData.data[i*4+2] = val; // B
            mImgData.data[i*4+3] = val; // A
        }
    }
    mCtx.putImageData(mImgData, 0, 0);

    if (isSelection) {
        return mCanvas;
    } else {
        // Fill Application
        // Create a solid color canvas
        const cCanvas = document.createElement('canvas');
        cCanvas.width = w; cCanvas.height = h;
        const cCtx = cCanvas.getContext('2d')!;
        cCtx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
        cCtx.fillRect(0, 0, w, h);

        // Apply the mask to the color (Cut out the shape)
        cCtx.globalCompositeOperation = 'destination-in';
        cCtx.drawImage(mCanvas, 0, 0);

        // Draw the cut-out shape onto the layer
        layer.ctx.save();
        layer.ctx.globalCompositeOperation = 'source-over';
        layer.ctx.drawImage(cCanvas, 0, 0);
        layer.ctx.restore();
        
        return null;
    }
};

// Flood Fill Tool
App.registerTool({
    id: 'bucket',
    icon: '🪣',
    title: 'Flood Fill (G)',
    settings: { tolerance: 32, contiguous: true, smoothFill: false },
    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Tolerance', min: 0, max: 255, value: this.settings.tolerance, onInput: (v: string) => this.settings.tolerance = parseInt(v) }));
        panel.appendChild(UI.createCheckbox({ label: 'Contiguous', value: this.settings.contiguous, onChange: (v: boolean) => this.settings.contiguous = v }));
        panel.appendChild(UI.createCheckbox({ label: 'Smooth', value: this.settings.smoothFill, onChange: (v: boolean) => this.settings.smoothFill = v }));
    },
    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        if (l.type === 'text') { alert('Rasterize text layer first.'); return; }

        App.actions.saveState();
        const pos = App.utils.getPos(e);
        const rgb = App.utils.hexToRgb(App.state.fg);
        
        performFloodFill(l, pos.x, pos.y, {
            color: rgb,
            tolerance: this.settings.tolerance,
            contiguous: this.settings.contiguous,
            smooth: this.settings.smoothFill,
            isSelection: false
        });
        App.render();
    }
});

// Magic Wand Tool
App.registerTool({
    id: 'wand',
    icon: '🪄',
    title: 'Magic Wand (W)',
    settings: { tolerance: 32, contiguous: true, smoothSelect: false },
    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSliderRow({ label: 'Tolerance', min: 0, max: 255, value: this.settings.tolerance, onInput: (v: string) => this.settings.tolerance = parseInt(v) }));
        panel.appendChild(UI.createCheckbox({ label: 'Contiguous', value: this.settings.contiguous, onChange: (v: boolean) => this.settings.contiguous = v }));
        panel.appendChild(UI.createCheckbox({ label: 'Smooth', value: this.settings.smoothSelect, onChange: (v: boolean) => this.settings.smoothSelect = v }));
        panel.appendChild(UI.createNode('div', {style:'padding:5px; color:#888; font-size:11px'}, 'Click to select area.'));
    },
    onMouseDown(e: MouseEvent) {
        const l = App.utils.getActive();
        if (!l || !l.visible) return;
        
        const pos = App.utils.getPos(e);
        const mask = performFloodFill(l, pos.x, pos.y, {
            tolerance: this.settings.tolerance,
            contiguous: this.settings.contiguous,
            smooth: this.settings.smoothSelect,
            isSelection: true
        });
        
        if (mask) {
            App.state.selection.layerId = l.id;
            App.state.selection.mask = mask;
            App.state.selection.ctx = mask.getContext('2d', { willReadFrequently: true });
            App.state.selection.active = true;
            App.render();
        }
    }
});