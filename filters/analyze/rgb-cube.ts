import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('rgb-cube', {
    name: 'Color Space Visualizer',
    mode: 'pixel',
    menu: {
        path: 'Analyze',
        label: 'RGB Cube...',
        order: 5
    },

    dialogOptions: { width: '90%', maxWidth: '720px' },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        // --- Setup State & Canvas ---
        const width = 750;
        const height = 500;
        const state = {
            allPoints: [] as any[],  // All unique colors found
            points: [] as any[],     // Visible points (filtered)
            rotation: { x: 0.5, y: 0.0 },
            dist: 500,
            useFreq: true,
            colorSpace: 'RGB', // RGB, YCbCr, XYZ, Lab, HSI, HSV, HSL
            isDragging: false,
            lastMouse: { x:0, y:0 },
            stride: 4,      
            limit: 50000    
        };

        const canvas = UI.createNode('canvas', { width, height, style: 'background:#222; cursor:grab; width:100%; border:1px solid #444;' }) as HTMLCanvasElement;
        const ctx = canvas.getContext('2d', { alpha: false })!;
        
        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Visualizes color distribution in 3D space. Drag to Rotate • Scroll to Zoom.'));
        
        container.appendChild(canvas);

        // Stats Label
        const statLabel = UI.createNode('div', { style:'font-size:11px; color:#888; margin:5px 0;' }, 'Initializing...');
        container.appendChild(statLabel);

        // --- Controls ---
        const controls = UI.createNode('div', { style: 'display:flex; flex-direction:column; gap:5px;' });
        container.appendChild(controls);

        // Color Space Selector
        controls.appendChild(UI.createSelectRow({
            label: 'Color Space',
            options: ['RGB', 'YCbCr', 'XYZ', 'Lab', 'HSI', 'HSV', 'HSL'],
            value: state.colorSpace,
            onChange: (v: any) => {
                state.colorSpace = v;
                analyzeData();
            }
        }));

        // Stride Slider
        const strideSlider = UI.createSlider({
            min: 1, max: 32, value: state.stride, step: 1,
            onInput: (val: any) => { 
                state.stride = parseInt(val);
                analyzeData();
            },
            formatter: (v: any) => v + 'px'
        });

        // Limit Slider
        const limitSlider = UI.createSlider({
            min: 100, max: 100000, value: state.limit, step: 100,
            onInput: (val: any) => {
                state.limit = parseInt(val);
                updateVisiblePoints();
            }
        });

        controls.appendChild(UI.createRow('Pixel Stride', strideSlider.container));
        controls.appendChild(UI.createRow('Limit Points', limitSlider.container));

        container.appendChild(UI.createCheckbox({
            label: 'Opacity by Frequency', value: state.useFreq,
            onChange: (v: any) => { state.useFreq = v; requestAnimationFrame(loop); }
        }));

        // --- Data Logic ---
        
        // Grab raw data ONCE
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const imgData = layer.ctx.getImageData(0, 0, w, h).data;

        // Math Helpers
        const toYCbCr = (r: number, g: number, b: number) => {
            const y  = 0.299*r + 0.587*g + 0.114*b;
            const cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
            const cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
            return [y, cb, cr];
        };

        const toXYZ = (r: number, g: number, b: number) => {
            // sRGB to XYZ (D65)
            let R = r/255, G = g/255, B = b/255;
            R = R > 0.04045 ? Math.pow((R+0.055)/1.055, 2.4) : R/12.92;
            G = G > 0.04045 ? Math.pow((G+0.055)/1.055, 2.4) : G/12.92;
            B = B > 0.04045 ? Math.pow((B+0.055)/1.055, 2.4) : B/12.92;
            
            const X = (R*0.4124 + G*0.3576 + B*0.1805) * 255; 
            const Y = (R*0.2126 + G*0.7152 + B*0.0722) * 255;
            const Z = (R*0.0193 + G*0.1192 + B*0.9505) * 255;
            return [X, Y, Z];
        };

        const toLab = (r: number, g: number, b: number) => {
            // RGB -> XYZ
            let R = r/255, G = g/255, B = b/255;
            R = R > 0.04045 ? Math.pow((R+0.055)/1.055, 2.4) : R/12.92;
            G = G > 0.04045 ? Math.pow((G+0.055)/1.055, 2.4) : G/12.92;
            B = B > 0.04045 ? Math.pow((B+0.055)/1.055, 2.4) : B/12.92;
            
            let x = (R*0.4124 + G*0.3576 + B*0.1805) / 0.95047;
            let y = (R*0.2126 + G*0.7152 + B*0.0722) / 1.00000;
            let z = (R*0.0193 + G*0.1192 + B*0.9505) / 1.08883;

            const eps = 0.008856, kap = 903.3;
            x = x > eps ? Math.cbrt(x) : (kap * x + 16) / 116;
            y = y > eps ? Math.cbrt(y) : (kap * y + 16) / 116;
            z = z > eps ? Math.cbrt(z) : (kap * z + 16) / 116;

            const L = (116 * y) - 16;
            const A = 500 * (x - y);
            const B_ = 200 * (y - z);
            return [L, A, B_];
        };

        const toHSI = (r: number, g: number, b: number) => {
            const R = r/255, G = g/255, B = b/255;
            const I = (R + G + B) / 3;
            const min = Math.min(R, G, B);
            let S = 1 - (3 / (R+G+B+0.001)) * min;
            if (R+G+B === 0) S = 0;
            
            let H = 0;
            const num = 0.5 * ((R - G) + (R - B));
            const den = Math.sqrt((R - G)*(R - G) + (R - B)*(G - B));
            if (den > 0.00001) {
                const theta = Math.acos(num / den);
                H = (B > G) ? (2 * Math.PI - theta) : theta;
            }
            return [H, S, I]; // H (rad), S (0-1), I (0-1)
        };

        const toHSV = (r: number, g: number, b: number) => {
            const R = r/255, G = g/255, B = b/255;
            const max = Math.max(R, G, B), min = Math.min(R, G, B);
            const d = max - min;
            let h = 0;
            const s = max === 0 ? 0 : d / max;
            const v = max;
            if (max !== min) {
                switch (max) {
                    case R: h = (G - B) / d + (G < B ? 6 : 0); break;
                    case G: h = (B - R) / d + 2; break;
                    case B: h = (R - G) / d + 4; break;
                }
                h /= 6;
            }
            return [h * Math.PI * 2, s, v]; // H (rad), S (0-1), V (0-1)
        }
        
        const toHSL = (r: number, g: number, b: number) => {
            const R = r/255, G = g/255, B = b/255;
            const max = Math.max(R, G, B), min = Math.min(R, G, B);
            let h = 0, s, l = (max + min) / 2;
            if (max === min) {
                h = s = 0;
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case R: h = (G - B) / d + (G < B ? 6 : 0); break;
                    case G: h = (B - R) / d + 2; break;
                    case B: h = (R - G) / d + 4; break;
                }
                h /= 6;
            }
            return [h * Math.PI * 2, s, l]; 
        };

        const updateVisiblePoints = () => {
            // Slice the sorted array based on the limit slider
            state.points = state.allPoints.slice(0, state.limit);
            statLabel.textContent = `Displaying ${state.points.length} of ${state.allPoints.length} unique colors (${state.colorSpace}, Stride: ${state.stride})`;
            requestAnimationFrame(loop);
        };

        const analyzeData = () => {
            statLabel.textContent = "Analyzing...";
            
            // Use timeout to allow UI render to update label before heavy calculation
            setTimeout(() => {
                const freqMap = new Map();
                const len = imgData.length;
                
                // Pass 1: Sampling with probabilistic stride to avoid aliasing
                let i = 0;
                while (i < len) {
                    const a = imgData[i+3];
                    if (a >= 10) { 
                        const key = (imgData[i] << 16) | (imgData[i+1] << 8) | imgData[i+2];
                        freqMap.set(key, (freqMap.get(key) || 0) + 1);
                    }

                    // Random step to prevent grid artifacts. Average step size equals state.stride.
                    const step = state.stride > 1 ? Math.floor(Math.random() * (state.stride * 2 - 1)) + 1 : 1;
                    i += step * 4;
                }

                // Find Max Frequency
                let maxCount = 1;
                for(const count of freqMap.values()) if(count > maxCount) maxCount = count;

                // Pass 2: Build Points
                state.allPoints = [];
                const space = state.colorSpace;

                freqMap.forEach((count, key) => {
                    const r = (key >> 16) & 0xFF;
                    const g = (key >> 8) & 0xFF;
                    const b = key & 0xFF;
                    
                    let tx, ty, tz;

                    if (space === 'RGB') {
                        tx = r - 127.5; ty = -(g - 127.5); tz = b - 127.5;
                    } 
                    else if (space === 'YCbCr') {
                        const [Y, Cb, Cr] = toYCbCr(r,g,b);
                        tx = Cb - 128; ty = -(Y - 128); tz = Cr - 128;
                    }
                    else if (space === 'XYZ') {
                        const [X, Y, Z] = toXYZ(r,g,b);
                        tx = X - 127.5; ty = -(Y - 127.5); tz = Z - 127.5;
                    }
                    else if (space === 'Lab') {
                        const [L, A, B_] = toLab(r,g,b);
                        tx = A; ty = -(L * 2.55 - 127.5); tz = B_;
                    }
                    else if (space === 'HSI') {
                        const [H, S, I] = toHSI(r,g,b);
                        const rad = S * 127.5;
                        tx = rad * Math.cos(H); tz = rad * Math.sin(H); ty = -(I * 255 - 127.5);
                    }
                    else if (space === 'HSV') {
                        const [H, S, V] = toHSV(r,g,b);
                        const rad = S * 127.5;
                        tx = rad * Math.cos(H); tz = rad * Math.sin(H); ty = -(V * 255 - 127.5);
                    }
                    else if (space === 'HSL') {
                        const [H, S, L] = toHSL(r,g,b);
                        const rad = S * 127.5;
                        tx = rad * Math.cos(H); tz = rad * Math.sin(H); ty = -(L * 255 - 127.5);
                    }

                    state.allPoints.push({
                        r, g, b, tx, ty, tz,
                        color: `rgb(${r},${g},${b})`,
                        count: count,
                        alpha: Math.log(count + 1) / Math.log(maxCount + 1)
                    });
                });

                // Pass 3: Sort by Frequency
                state.allPoints.sort((a, b) => b.count - a.count);

                // Update Limit Slider Bounds
                const total = state.allPoints.length;
                (limitSlider.input as HTMLInputElement).max = String(total);
                
                // Smart Default: If current limit is higher than total, clamp it visualy
                let activeLimit = Math.min(state.limit, total);
                if (state.limit === 50000 && total < 50000) activeLimit = total;
                (limitSlider.input as HTMLInputElement).value = String(activeLimit);
                const disp = limitSlider.container.querySelector('span');
                if(disp) disp.textContent = String(activeLimit);
                
                state.limit = activeLimit;
                updateVisiblePoints();
            }, 10);
        };

        // --- 3D Logic ---
        const project = (x: number, y: number, z: number) => {
            const cy = Math.cos(state.rotation.y), sy = Math.sin(state.rotation.y);
            let x1 = x * cy - z * sy;
            let z1 = x * sy + z * cy;
            
            const cx = Math.cos(state.rotation.x), sx = Math.sin(state.rotation.x);
            let y2 = y * cx - z1 * sx;
            let z2 = y * sx + z1 * cx;

            const depth = z2 + state.dist;
            if (depth <= 0) return null;
            const scale = 600 / depth;
            
            return { x: x1 * scale + width/2, y: y2 * scale + height/2, scale, depth };
        };

        const drawLine = (list: any[], r1: number, g1: number, b1: number, r2: number, g2: number, b2: number, color: string, txt?: string) => {
            const off = 127.5;
            const p1 = project(r1-off, -(g1-off), b1-off);
            const p2 = project(r2-off, -(g2-off), b2-off);
            if(p1 && p2) {
                list.push({ type:'line', x1:p1.x, y1:p1.y, x2:p2.x, y2:p2.y, d:(p1.depth+p2.depth)/2, c:color });
                if(txt) list.push({ type:'text', x:p2.x+5, y:p2.y+5, d:p2.depth, c:color, txt });
            }
        };

        const loop = () => {
            if (!canvas.isConnected) return; 

            ctx.fillStyle = "#222";
            ctx.fillRect(0, 0, width, height);
            
            const list: any[] = [];
            const pointSize = 2.0;

            // Points
            for (let i = 0; i < state.points.length; i++) {
                const p = state.points[i];
                const proj = project(p.tx, p.ty, p.tz);
                if (proj) {
                    const col = state.useFreq ? `rgba(${p.r},${p.g},${p.b},${p.alpha.toFixed(2)})` : p.color;
                    list.push({ type:'point', x:proj.x, y:proj.y, s:pointSize*proj.scale, c:col, d:proj.depth });
                }
            }

            // Wireframe / Axes
            const isCyl = ['HSI', 'HSV', 'HSL'].includes(state.colorSpace);

            if (!isCyl) {
                // Box Wireframe (0..255 range reference)
                const c = [[0,0,0],[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255],[0,255,255],[255,255,255]];
                const edges = [[0,1],[0,2],[0,3],[1,4],[2,4],[1,5],[3,5],[2,6],[3,6],[4,7],[5,7],[6,7]];
                edges.forEach(e => {
                    const c1 = c[e[0]], c2 = c[e[1]];
                    drawLine(list, c1[0],c1[1],c1[2], c2[0],c2[1],c2[2], 'rgba(255,255,255,0.1)');
                });
            } else {
                // Cylindrical Guides. Top/Bottom circles
                const steps = 24;
                for(let i=0; i<steps; i++) {
                    const t1 = (i/steps)*Math.PI*2, t2 = ((i+1)/steps)*Math.PI*2;
                    const r = 127.5, cx = 127.5, cz = 127.5;
                    [0, 255].forEach(y => {
                        drawLine(list, cx+Math.cos(t1)*r, y, cz+Math.sin(t1)*r, cx+Math.cos(t2)*r, y, cz+Math.sin(t2)*r, 'rgba(255,255,255,0.1)');
                    });
                }
                drawLine(list, 127.5,0,127.5, 127.5,255,127.5, 'rgba(255,255,255,0.2)');
            }

            // Axes Labels
            const allAxes: Record<string, any> = {
                'RGB':   { l:['R','G','B'], c:['#f44','#4f4','#44f'] },
                'YCbCr': { l:['Cb','Y','Cr'], c:['#44f','#fff','#f44'] },
                'XYZ':   { l:['X','Y','Z'], c:['#f44','#4f4','#44f'] },
                'Lab':   { l:['a','L','b'], c:['#f44','#fff','#44f'] },
                'HSI':   { l:['','I',''], c:['#000','#fff','#000'] },
                'HSV':   { l:['','V',''], c:['#000','#fff','#000'] },
                'HSL':   { l:['','L',''], c:['#000','#fff','#000'] }
            };
            let axes = allAxes[state.colorSpace];

            if (axes) {
                if(axes.l[0]) drawLine(list, 0,0,0, 255,0,0, axes.c[0], axes.l[0]);
                if(axes.l[1]) drawLine(list, 0,0,0, 0,255,0, axes.c[1], axes.l[1]);
                if(axes.l[2]) drawLine(list, 0,0,0, 0,0,255, axes.c[2], axes.l[2]);
            }
            
            if (isCyl) {
               drawLine(list, 127.5,0,127.5, 255,0,127.5, '#f00', '0°'); 
               drawLine(list, 127.5,0,127.5, 127.5,0,255, '#00f', '90°'); 
            }

            // 4. Sort & Draw
            list.sort((a,b) => b.d - a.d);

            for (let item of list) {
                if(item.type === 'point') {
                    ctx.fillStyle = item.c;
                    ctx.beginPath();
                    //ctx.fillRect(item.x-item.s/2, item.y-item.s/2, item.s, item.s);
                    ctx.arc(item.x, item.y, item.s/2, 0, Math.PI*2); ctx.fill();
                } 
                else if (item.type === 'line') {
                    ctx.strokeStyle = item.c;
                    ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(item.x1, item.y1); ctx.lineTo(item.x2, item.y2); ctx.stroke();
                }
                else if (item.type === 'text') {
                    ctx.fillStyle = item.c;
                    ctx.font = 'bold 12px monospace';
                    ctx.fillText(item.txt, item.x, item.y);
                }
            }
        };

        // --- Interaction ---
        canvas.addEventListener('mousedown', (e: MouseEvent) => { state.isDragging=true; state.lastMouse={x:e.clientX, y:e.clientY}; canvas.style.cursor='grabbing'; });
        window.addEventListener('mouseup', () => { state.isDragging=false; canvas.style.cursor='grab'; });
        window.addEventListener('mousemove', (e: MouseEvent) => {
            if(!state.isDragging) return;
            const dx = e.clientX - state.lastMouse.x;
            const dy = e.clientY - state.lastMouse.y;
            state.rotation.y += dx * 0.01;
            state.rotation.x += dy * 0.01;
            state.rotation.x = Math.max(-1.5, Math.min(1.5, state.rotation.x));
            state.lastMouse = {x:e.clientX, y:e.clientY};
            requestAnimationFrame(loop);
        });
        canvas.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            state.dist *= Math.exp(e.deltaY * 0.001);
            state.dist = Math.max(100, Math.min(2000, state.dist));
            requestAnimationFrame(loop);
        });

        // Start
        analyzeData();
    },

    process(data: Uint8ClampedArray, w: number, h: number) { 
        // No-op: Analysis only
    }
});