import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('convolution', {
    name: 'Convolution Matrix',
    mode: 'pixel',
    menu: {
        path: 'Filter/Edge Detection',
        label: 'Convolution Matrix...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            operator: 'sobel', // sobel, scharr, prewitt, roberts, laplacian, sharpen, box
            size: 3,
            direction: 'both', // both, x, y
            grayscale: false,
            offset: 0,
            strength: 1.0
        };

        const update = () => hooks.preview(state);

        const updateControls = () => {
            const op = state.operator;
            
            // Handle Size Visibility
            const isFixed = ['roberts', 'scharr'].includes(op);
            (sizeRow as HTMLElement).style.display = isFixed ? 'none' : 'flex';

            // Handle Direction Visibility
            const isGradient = ['sobel', 'scharr', 'prewitt', 'roberts'].includes(op);
            (dirRow as HTMLElement).style.display = isGradient ? 'flex' : 'none';
        };

        // Operator Selector
        container.appendChild(UI.createSelectRow({
            label: 'Operator',
            options: [
                { value: 'sobel', text: 'Sobel' },
                { value: 'scharr', text: 'Scharr' },
                { value: 'prewitt', text: 'Prewitt' },
                { value: 'roberts', text: 'Roberts (2x2)' },
                { value: 'laplacian', text: 'Laplacian' },
                { value: 'sharpen', text: 'Sharpen' },
                { value: 'box', text: 'Box Blur' }
            ],
            value: state.operator,
            onChange: (v: string) => { 
                state.operator = v; 
                updateControls(); 
                update(); 
            }
        }));

        // Kernel Size Selector
        const sizeRow = UI.createSelectRow({
            label: 'Kernel Size',
            options: [3, 5, 7],
            value: state.size,
            onChange: (v: string) => { state.size = parseInt(v); update(); }
        });
        container.appendChild(sizeRow);

        // Direction Selector
        const dirRow = UI.createSelectRow({
            label: 'Direction',
            options: [
                { value: 'both', text: 'Both / Magnitude' },
                { value: 'x', text: 'Horizontal (Dx)' },
                { value: 'y', text: 'Vertical (Dy)' }
            ],
            value: state.direction,
            onChange: (v: string) => { state.direction = v; update(); }
        });
        container.appendChild(dirRow);

        // Options
        container.appendChild(UI.createCheckbox({
            label: 'Process as Grayscale',
            value: state.grayscale,
            onChange: (v: boolean) => { state.grayscale = v; update(); }
        }));

        // Sliders
        container.appendChild(UI.createSliderRow({
            label: 'Strength', min: 0.1, max: 10, step: 0.1, value: state.strength,
            onInput: (v: string) => { state.strength = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Offset', min: -255, max: 255, step: 1, value: state.offset,
            onInput: (v: string) => { state.offset = parseInt(v); update(); }
        }));

        updateControls();
        update();
    },

    // --- Kernel Generation ---

    getKernels(op: string, requestedSize: number) {
        // Enforce fixed sizes for specific operators
        let size = requestedSize;
        if (op === 'scharr') size = 3; 

        if (op === 'roberts') {
            return {
                kx: [[1, 0], [0, -1]],
                ky: [[0, 1], [-1, 0]],
                center: 0
            };
        }

        const center = Math.floor(size / 2);
        let kx: number[][] = [], ky: number[][] = [];

        if (['sobel', 'prewitt', 'scharr'].includes(op)) {
            let smooth: number[] = [], diff: number[] = [];
            
            if (op === 'sobel') {
                if (size === 3) { 
                    smooth = [1, 2, 1]; 
                    diff = [1, 0, -1]; 
                } else if (size === 5) {
                    smooth = [1, 4, 6, 4, 1];
                    diff = [1, 2, 0, -2, -1]; 
                } else { // 7
                    smooth = [1, 6, 15, 20, 15, 6, 1];
                    diff = [1, 4, 5, 0, -5, -4, -1];
                }
            } else if (op === 'scharr') {
                smooth = [3, 10, 3];
                diff = [1, 0, -1]; 
            } else if (op === 'prewitt') {
                smooth = Array(size).fill(1);
                diff = Array(size).fill(0);
                const mid = Math.floor(size/2);
                for(let i=0; i<mid; i++) { diff[i] = 1; diff[size-1-i] = -1; }
            }

            // Normalize
            const sSum = smooth.reduce((a,b)=>a+b, 0);
            const dSum = diff.reduce((a,b)=>a+Math.abs(b), 0);
            const scale = 1 / (sSum * dSum || 1);
            
            for(let y=0; y<size; y++) {
                const rowX: number[] = [], rowY: number[] = [];
                for(let x=0; x<size; x++) {
                    // Gx = Smooth(y) * Diff(x)
                    rowX.push(smooth[y] * -diff[x] * scale); 
                    // Gy = Diff(y) * Smooth(x)
                    rowY.push(-diff[y] * smooth[x] * scale);
                }
                kx.push(rowX);
                ky.push(rowY);
            }
        }
        else if (op === 'laplacian') {
            // Isotropic Laplacian
            let k: number[][] = [];
            if (size === 3) {
                k = [[0, 1, 0], [1, -4, 1], [0, 1, 0]];
            } else if (size === 5) {
                k = [
                    [0, 0, 1, 0, 0],
                    [0, 1, 2, 1, 0],
                    [1, 2, -16, 2, 1],
                    [0, 1, 2, 1, 0],
                    [0, 0, 1, 0, 0]
                ];
            } else {
                k = [
                    [0,0,1,1,1,0,0],
                    [0,1,3,3,3,1,0],
                    [1,3,0,-7,0,3,1],
                    [1,3,-7,-24,-7,3,1],
                    [1,3,0,-7,0,3,1],
                    [0,1,3,3,3,1,0],
                    [0,0,1,1,1,0,0]
                ];
            }
            kx = k; ky = k;
        }
        else if (op === 'sharpen') {
             if (size === 3) {
                kx = [[0, -1, 0], [-1, 5, -1], [0, -1, 0]];
             } else {
                const val = -1;
                kx = Array(size).fill(0).map(() => Array(size).fill(val));
                kx[center][center] = (size * size); 
             }
             ky = kx;
        }
        else if (op === 'box') {
            const val = 1 / (size * size);
            kx = Array(size).fill(0).map(() => Array(size).fill(val));
            ky = kx;
        }
        
        return { kx, ky, center };
    },

    process(data: Uint8ClampedArray, w: number, h: number, { operator, size, direction, grayscale, offset, strength }: any) {
        const { kx, ky, center } = this.getKernels(operator, size);
        const isMono = (operator === 'laplacian' || operator === 'sharpen' || operator === 'box');
        
        const src = new Uint8ClampedArray(data);
        
        let lum: Float32Array | null = null;
        if (grayscale) {
            lum = new Float32Array(w * h);
            for(let i=0; i<w*h; i++) {
                lum[i] = src[i*4]*0.299 + src[i*4+1]*0.587 + src[i*4+2]*0.114;
            }
        }

        // Accessor
        const getVal = (arr: Float32Array | null, x: number, y: number, c: number): number => {
            if(x < 0) x = 0; else if(x >= w) x = w - 1;
            if(y < 0) y = 0; else if(y >= h) y = h - 1;
            
            if (arr && arr === lum) return arr[y*w + x];
            return src[(y*w+x)*4 + c];
        };

        const convolve = (x: number, y: number, c: number, k: number[][]): number => {
            let sum = 0;
            const s = k.length;
            for(let i=0; i<s; i++) {
                const row = k[i];
                const py = y + i - center;
                for(let j=0; j<s; j++) {
                    sum += getVal(lum, x + j - center, py, c) * row[j];
                }
            }
            return sum;
        };

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const channels = grayscale ? [0] : [0, 1, 2];
                let r=0, g=0, b=0;
                
                for (let c of channels) {
                    let val = 0;
                    
                    if (isMono || direction === 'x') {
                         val = convolve(x, y, c, kx);
                    } else if (direction === 'y') {
                         val = convolve(x, y, c, ky);
                    } else {
                         const vx = convolve(x, y, c, kx);
                         const vy = convolve(x, y, c, ky);
                         val = Math.hypot(vx, vy);
                    }
                    
                    val = val * strength + offset;
                    
                    if(grayscale) { 
                        r = val; g = val; b = val; 
                    } else {
                        if(c===0) r=val;
                        if(c===1) g=val;
                        if(c===2) b=val;
                    }
                }
                
                data[idx]   = Math.min(255, Math.max(0, r));
                data[idx+1] = Math.min(255, Math.max(0, g));
                data[idx+2] = Math.min(255, Math.max(0, b));
            }
        }
    }
});
