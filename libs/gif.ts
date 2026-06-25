// --- High Level Wrapper ---

class Writer {
    width: number;
    height: number;
    palette: number[][];
    buffer: number[];
    core: any;

    constructor(width: number, height: number, { palette, loop = 0 }: any = {}) {
        this.width = width;
        this.height = height;
        
        // 1. Prepare Palette
        let p = palette || this._generateDefaultPalette();
        
        // 2. Pad Palette to Power of 2 (Critical for GIF structure)
        let size = 1;
        while (size < p.length) size <<= 1;
        if (size > 256) throw new Error("Palette too large (max 256)");
        
        // Clone to avoid modifying external ref
        p = [...p];
        // Fill remaining slots with black
        while (p.length < size) p.push([0, 0, 0]);
        
        this.palette = p;

        // 3. Convert to Ints (0xRRGGBB)
        const paletteInts = this.palette.map(c => (c[0] << 16) | (c[1] << 8) | c[2]);
        
        this.buffer = []; 
        
        // 4. Initialize Core
        // Background index set to last color (Transparent/Black) to support 'Restore to Background'
        const bgIndex = this.palette.length - 1;
        
        this.core = new (GifWriter as any)(this.buffer, width, height, { 
            loop, 
            palette: paletteInts,
            background: bgIndex 
        });
    }

    addFrame(source: any, options: any = {}) {
        let { x = 0, y = 0, delay = 10, disposal = 0, transparent } = options;
        
        let data: Uint8ClampedArray | null = null;
        let w = options.w || 0;
        let h = options.h || 0;

        // --- Robust Data Extraction ---
        if (source instanceof ImageData) {
            w = source.width;
            h = source.height;
            data = source.data;
        } 
        else if (source instanceof HTMLCanvasElement) {
            w = source.width;
            h = source.height;
            const ctx = source.getContext('2d');
            if (ctx) data = ctx.getImageData(0, 0, w, h).data;
        } 
        else if (source instanceof CanvasRenderingContext2D) {
            w = source.canvas.width;
            h = source.canvas.height;
            data = source.getImageData(0, 0, w, h).data;
        } 
        else if (source.data && source.width && source.height) {
            // Generic Object with raw data
            w = source.width;
            h = source.height;
            data = source.data;
        }

        // Guard: If we failed to get data or dimensions, stop
        if (!data || w <= 0 || h <= 0) {
            console.warn("GifWriter: Invalid source or dimensions", source);
            return;
        }

        // Quantize RGBA to Palette Indices
        const indices = this._quantize(data, w * h, transparent);

        this.core.addFrame(x, y, w, h, indices, {
            delay,
            disposal,
            transparent
        });
    }

    end(): Uint8Array {
        this.core.end();
        return new Uint8Array(this.buffer);
    }

    _quantize(rgba: Uint8ClampedArray | Uint8Array, len: number, transIndex?: number): Uint8Array {
        const out = new Uint8Array(len);
        const p = this.palette;
        const hasTrans = typeof transIndex === 'number';

        for (let i = 0; i < len; i++) {
            const r = rgba[i * 4];
            const g = rgba[i * 4 + 1];
            const b = rgba[i * 4 + 2];
            const a = rgba[i * 4 + 3];

            // Simple transparency threshold
            if (hasTrans && a < 128) {
                out[i] = transIndex as number;
                continue;
            }

            // Euclidean distance matching
            let minIds = 0;
            let minDest = Number.MAX_VALUE;
            
            for (let j = 0; j < p.length; j++) {
                // Skip the transparent index if we are matching a visible color
                if (hasTrans && j === transIndex) continue;

                const c = p[j];
                const dist = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
                if (dist < minDest) {
                    minDest = dist;
                    minIds = j;
                    if (dist === 0) break;
                }
            }
            out[i] = minIds;
        }
        return out;
    }

    _generateDefaultPalette(): number[][] {
        const p: number[][] = [];
        const steps = [0, 0x33, 0x66, 0x99, 0xCC, 0xFF];
        // 6x6x6 Web Safe (216 colors)
        for (let r of steps) {
            for (let g of steps) {
                for (let b of steps) p.push([r, g, b]);
            }
        }
        
        // Fill up to 255 with grayscale ramp
        while(p.length < 255) {
            const val = Math.floor((p.length - 216) * (255 / (255 - 216)));
            p.push([val, val, val]);
        }

        // Index 255: Reserved for Transparent (using Black as placeholder)
        p.push([0, 0, 0]); 

        return p;
    }
}

// --- Core Library (Strict Mode) ---

function GifWriter(this: any, buf: number[], width: number, height: number, gopts?: any) {
    var p = 0;
    var gopts = gopts === undefined ? {} : gopts;
    var loopCount = gopts.loop === undefined ? null : gopts.loop;
    var globalPalette = gopts.palette === undefined ? null : gopts.palette;

    if (width <= 0 || height <= 0 || width > 65535 || height > 65535) throw new Error("Width/Height invalid.");

    function checkPaletteAndNumColors(palette: number[]) {
        var numColors = palette.length;
        if (numColors < 2 || numColors > 256 || numColors & (numColors - 1)) {
            // Auto-fix non-power-of-two palette lengths for robustness
            if (numColors & (numColors - 1)) {
                    while(numColors & (numColors - 1)) numColors++;
            }
        }
        return numColors;
    }

    buf[p++] = 0x47; buf[p++] = 0x49; buf[p++] = 0x46; // GIF
    buf[p++] = 0x38; buf[p++] = 0x39; buf[p++] = 0x61; // 89a

    var gpNumColorsPow2 = 0;
    var background = 0;
    if (globalPalette !== null) {
        var gpNumColors = checkPaletteAndNumColors(globalPalette);
        while (gpNumColors >>= 1) ++gpNumColorsPow2;
        gpNumColors = 1 << gpNumColorsPow2;
        --gpNumColorsPow2;
        if (gopts.background !== undefined) background = gopts.background;
    }

    buf[p++] = width & 0xff; buf[p++] = width >> 8 & 0xff;
    buf[p++] = height & 0xff; buf[p++] = height >> 8 & 0xff;
    buf[p++] = (globalPalette !== null ? 0x80 : 0) | gpNumColorsPow2;
    buf[p++] = background;
    buf[p++] = 0;

    if (globalPalette !== null) {
        for (var i = 0, il = globalPalette.length; i < il; ++i) {
            var rgb = globalPalette[i];
            buf[p++] = rgb >> 16 & 0xff;
            buf[p++] = rgb >> 8 & 0xff;
            buf[p++] = rgb & 0xff;
        }
    }

    if (loopCount !== null) {
        buf[p++] = 0x21; buf[p++] = 0xff; buf[p++] = 0x0b;
        buf[p++] = 0x4e; buf[p++] = 0x45; buf[p++] = 0x54; buf[p++] = 0x53; // NETS
        buf[p++] = 0x43; buf[p++] = 0x41; buf[p++] = 0x50; buf[p++] = 0x45; // CAPE
        buf[p++] = 0x32; buf[p++] = 0x2e; buf[p++] = 0x30;                  // 2.0
        buf[p++] = 0x03; buf[p++] = 0x01;
        buf[p++] = loopCount & 0xff; buf[p++] = loopCount >> 8 & 0xff;
        buf[p++] = 0x00;
    }

    var ended = false;

    this.addFrame = function(x: number, y: number, w: number, h: number, indexedPixels: Uint8Array, opts?: any) {
        if (ended === true) { --p; ended = false; }
        opts = opts || {};
        
        var palette = opts.palette || globalPalette;
        if (!palette) throw new Error("Palette required.");
        
        var numColors = checkPaletteAndNumColors(palette);
        var minCodeSize = 0;
        while (numColors >>= 1) ++minCodeSize;
        numColors = 1 << minCodeSize;

        var delay = opts.delay || 0;
        var disposal = opts.disposal || 0;
        var transparentIndex = opts.transparent;
        var useTransparency = (transparentIndex !== undefined && transparentIndex !== null);

        if (disposal !== 0 || useTransparency || delay !== 0) {
            buf[p++] = 0x21; buf[p++] = 0xf9; buf[p++] = 4;
            buf[p++] = disposal << 2 | (useTransparency ? 1 : 0);
            buf[p++] = delay & 0xff; buf[p++] = delay >> 8 & 0xff;
            buf[p++] = useTransparency ? transparentIndex : 0;
            buf[p++] = 0;
        }

        buf[p++] = 0x2c;
        buf[p++] = x & 0xff; buf[p++] = x >> 8 & 0xff;
        buf[p++] = y & 0xff; buf[p++] = y >> 8 & 0xff;
        buf[p++] = w & 0xff; buf[p++] = w >> 8 & 0xff;
        buf[p++] = h & 0xff; buf[p++] = h >> 8 & 0xff;
        buf[p++] = (opts.palette ? (0x80 | (minCodeSize - 1)) : 0);

        if (opts.palette) {
            for (var i = 0, il = opts.palette.length; i < il; ++i) {
                var rgb = opts.palette[i];
                buf[p++] = rgb >> 16 & 0xff; buf[p++] = rgb >> 8 & 0xff; buf[p++] = rgb & 0xff;
            }
        }

        p = GifWriterOutputLZWCodeStream(buf, p, minCodeSize < 2 ? 2 : minCodeSize, indexedPixels);
    };

    this.end = function() {
        if (ended === false) { buf[p++] = 0x3b; ended = true; }
        return p;
    };
}

function GifWriterOutputLZWCodeStream(buf: number[], p: number, minCodeSize: number, indexStream: Uint8Array): number {
    buf[p++] = minCodeSize;
    var curSubblock = p++;
    var clearCode = 1 << minCodeSize;
    var codeMask = clearCode - 1;
    var eoiCode = clearCode + 1;
    var nextCode = eoiCode + 1;
    var curCodeSize = minCodeSize + 1;
    var curShift = 0;
    var cur = 0;

    function emitBytesToBuffer(bitBlockSize: number) {
        while (curShift >= bitBlockSize) {
            buf[p++] = cur & 0xff;
            cur >>= 8; curShift -= 8;
            if (p === curSubblock + 256) {
                buf[curSubblock] = 255;
                curSubblock = p++;
            }
        }
    }

    function emitCode(c: number) {
        cur |= c << curShift;
        curShift += curCodeSize;
        emitBytesToBuffer(8);
    }

    var ibCode = indexStream[0] & codeMask;
    var codeTable: Record<number, number> = {};
    emitCode(clearCode);

    for (var i = 1, il = indexStream.length; i < il; ++i) {
        var k = indexStream[i] & codeMask;
        var curKey = ibCode << 8 | k;
        var curCode = codeTable[curKey];

        if (curCode === undefined) {
            cur |= ibCode << curShift;
            curShift += curCodeSize;
            while (curShift >= 8) {
                buf[p++] = cur & 0xff;
                cur >>= 8; curShift -= 8;
                if (p === curSubblock + 256) {
                    buf[curSubblock] = 255;
                    curSubblock = p++;
                }
            }

            if (nextCode === 4096) {
                emitCode(clearCode);
                nextCode = eoiCode + 1;
                curCodeSize = minCodeSize + 1;
                codeTable = {};
            } else {
                if (nextCode >= (1 << curCodeSize)) ++curCodeSize;
                codeTable[curKey] = nextCode++;
            }
            ibCode = k;
        } else {
            ibCode = curCode;
        }
    }
    emitCode(ibCode);
    emitCode(eoiCode);
    emitBytesToBuffer(1);

    if (curSubblock + 1 === p) buf[curSubblock] = 0;
    else {
        buf[curSubblock] = p - curSubblock - 1;
        buf[p++] = 0;
    }
    return p;
}

export const gif = { Writer, Core: { GifWriter } };