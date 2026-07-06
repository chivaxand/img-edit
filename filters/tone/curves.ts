import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('curves', {
    name: 'Curves',
    mode: 'pixel',
    menu: {
        path: 'Tone',
        label: 'Curves...',
        order: 6
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const size = 256;
        
        // Channel Selector
        const channelSelect = UI.createSelectRow({
            label: 'Channel',
            options: [
                { value: 'rgb', text: 'RGB' },
                { value: 'r', text: 'Red' },
                { value: 'g', text: 'Green' },
                { value: 'b', text: 'Blue' },
                { value: 'a', text: 'Alpha' }
            ],
            value: 'rgb',
            onChange: v => {
                state.channel = v;
                activePointIdx = -1;
                draw();
            }
        });
        container.appendChild(channelSelect);

        const canvasObj = UI.createCanvas({ 
            width: size, height: size, 
            style: { background: '#222' } 
        });
        const cvs = canvasObj.element;
        const ctx = canvasObj.ctx!;
        
        container.appendChild(cvs);
        container.appendChild(UI.createNode('div', { className: 'popup-hint', style: 'text-align:center' }, 'Click to add point. Drag to move. Double-click to remove.'));

        // Histogram Data
        const w = layer.canvas.width, h = layer.canvas.height;
        const srcData = layer.ctx.getImageData(0, 0, w, h).data;
        
        const histR = new Uint32Array(256);
        const histG = new Uint32Array(256);
        const histB = new Uint32Array(256);
        const histA = new Uint32Array(256);
        let maxCount = 0;
        let maxCountAlpha = 0;
        
        for (let i = 0; i < srcData.length; i += 4) {
            histR[srcData[i]]++;
            histG[srcData[i+1]]++;
            histB[srcData[i+2]]++;
            histA[srcData[i+3]]++;
        }
        
        // Find global max
        for(let i=0; i<256; i++) {
            maxCount = Math.max(maxCount, histR[i], histG[i], histB[i]);
            maxCountAlpha = Math.max(maxCountAlpha, histA[i]);
        }
        if (maxCount === 0) maxCount = 1;
        if (maxCountAlpha === 0) maxCountAlpha = 1;

        // State: Control Points per channel
        const defaultCurve = () => [{x:0, y:0}, {x:255, y:255}];
        const state: Record<string, any> = {
            channel: 'rgb',
            rgb: defaultCurve(),
            r: defaultCurve(),
            g: defaultCurve(),
            b: defaultCurve(),
            a: defaultCurve()
        };

        let activePointIdx = -1;
        let drag = false;

        // Natural Cubic Spline
        const calculateSpline = (pts: {x: number, y: number}[]) => {
            const n = pts.length - 1;
            const x = pts.map(p => p.x);
            const a = pts.map(p => p.y);
            const h = new Float32Array(n);
            const A = new Float32Array(n);
            const l = new Float32Array(n + 1);
            const u = new Float32Array(n + 1);
            const z = new Float32Array(n + 1);
            const c = new Float32Array(n + 1);
            const b = new Float32Array(n);
            const d = new Float32Array(n);
            for (let i = 0; i < n; i++) h[i] = x[i+1] - x[i];
            for (let i = 1; i < n; i++) {
                A[i] = 3 * (a[i+1] - a[i]) / h[i] - 3 * (a[i] - a[i-1]) / h[i-1];
            }
            l[0] = 1; u[0] = 0; z[0] = 0;
            for (let i = 1; i < n; i++) {
                l[i] = 2 * (x[i+1] - x[i-1]) - h[i-1] * u[i-1];
                u[i] = h[i] / l[i];
                z[i] = (A[i] - h[i-1] * z[i-1]) / l[i];
            }
            l[n] = 1; z[n] = 0; c[n] = 0;
            for (let i = n - 1; i >= 0; i--) {
                c[i] = z[i] - u[i] * c[i+1];
                b[i] = (a[i+1] - a[i]) / h[i] - h[i] * (c[i+1] + 2 * c[i]) / 3;
                d[i] = (c[i+1] - c[i]) / (3 * h[i]);
            }
            return { x, a, b, c, d };
        };

        const getLUT = (points: {x: number, y: number}[]) => {
            const pts = [...points]; // Copy to avoid mutation of state order if called elsewhere
            // Sort and handle duplicates
            pts.sort((a,b) => a.x - b.x);
            // Ensure unique X (shift slightly if needed)
            for(let i=1; i<pts.length; i++) {
                if(pts[i].x <= pts[i-1].x) pts[i].x = pts[i-1].x + 1;
            }

            const spline = calculateSpline(pts);
            const lut = new Uint8Array(256);
            let sIdx = 0;

            for (let i = 0; i < 256; i++) {
                // Find segment
                while (sIdx < pts.length - 2 && i > pts[sIdx+1].x) sIdx++;
                
                const dx = i - spline.x[sIdx];
                
                // Extrapolation (Linear) for out of bounds
                let val;
                if (i < pts[0].x) val = pts[0].y; // Clamp start
                else if (i > pts[pts.length-1].x) val = pts[pts.length-1].y; // Clamp end
                else {
                    // Spline Interpolation
                    val = spline.a[sIdx] + spline.b[sIdx] * dx + spline.c[sIdx] * dx * dx + spline.d[sIdx] * dx * dx * dx;
                }
                
                lut[i] = Math.max(0, Math.min(255, Math.round(val)));
            }
            return lut;
        };

        // Draw Function
        const draw = () => {
            ctx.clearRect(0, 0, size, size);
            
            // Grid
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
            ctx.beginPath();
            for(let i=1; i<4; i++) {
                const p = i * (size/4);
                ctx.moveTo(p, 0); ctx.lineTo(p, size);
                ctx.moveTo(0, p); ctx.lineTo(size, p);
            }
            ctx.stroke();

            // Histogram (RGB Additive)
            ctx.globalCompositeOperation = 'screen';
            const drawHist = (hist: Uint32Array, color: string, maxVal: number) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(0, size);
                for(let i=0; i<256; i++) {
                    const hVal = (hist[i] / maxVal) * size;
                    ctx.lineTo(i, size - hVal);
                }
                ctx.lineTo(size, size);
                ctx.fill();
            };

            const ch = state.channel;
            if (ch === 'rgb') {
                drawHist(histR, '#ff0000', maxCount);
                drawHist(histG, '#00ff00', maxCount);
                drawHist(histB, '#0000ff', maxCount);
            } else if (ch === 'r') drawHist(histR, '#ff0000', maxCount);
            else if (ch === 'g') drawHist(histG, '#00ff00', maxCount);
            else if (ch === 'b') drawHist(histB, '#0000ff', maxCount);
            else if (ch === 'a') drawHist(histA, '#aaaaaa', maxCountAlpha);

            // Curve
            ctx.globalCompositeOperation = 'source-over';
            const points = state[ch] as {x: number, y: number}[];
            const lut = getLUT(points);
            ctx.strokeStyle = ch==='rgb' ? '#007acc' : (ch==='r'?'#f55':(ch==='g'?'#5f5':(ch==='b'?'#55f':'#aaa')));
            ctx.lineWidth = 2;
            ctx.beginPath();
            for(let i=0; i<256; i++) {
                const y = size - lut[i]; // Invert Y
                if(i===0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
            }
            ctx.stroke();

            // Points
            points.forEach((p, i) => {
                const px = p.x;
                const py = size - p.y;
                ctx.fillStyle = i === activePointIdx ? '#fff' : ctx.strokeStyle;
                ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill();
                if(i === activePointIdx) {
                    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
                }
            });
        };

        // Interaction
        const getMousePos = (e: MouseEvent) => {
            const r = cvs.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };

        cvs.onmousedown = (e: MouseEvent) => {
            const m = getMousePos(e);
            const points = state[state.channel] as {x: number, y: number}[];
            const hitDist = 8;
            activePointIdx = points.findIndex(p => Math.abs(p.x - m.x) < hitDist && Math.abs((size - p.y) - m.y) < hitDist);
            
            if (activePointIdx === -1) {
                // Add new point
                const valY = Math.max(0, Math.min(255, size - m.y));
                const valX = Math.max(0, Math.min(255, m.x));
                points.push({ x: valX, y: valY });
                // Sort to find correct index
                points.sort((a,b) => a.x - b.x);
                activePointIdx = points.findIndex(p => p.x === valX && p.y === valY);
            }
            drag = true;
            draw();
        };

        window.addEventListener('mousemove', (e: Event) => {
            if (!drag || activePointIdx === -1) return;
            
            const m = getMousePos(e as MouseEvent);
            let valX = Math.max(0, Math.min(255, m.x));
            let valY = Math.max(0, Math.min(255, size - m.y));

            const points = state[state.channel] as {x: number, y: number}[];
            const p = points[activePointIdx];
            p.x = valX;
            p.y = valY;
            
            // Keep points sorted so active index stays tracking the right object
            const activeObj = points[activePointIdx];
            points.sort((a,b) => a.x - b.x);
            activePointIdx = points.indexOf(activeObj);

            draw();
            hooks.preview(state);
        });

        window.addEventListener('mouseup', () => { drag = false; });

        cvs.ondblclick = (e: MouseEvent) => {
            const m = getMousePos(e);
            const points = state[state.channel] as {x: number, y: number}[];
            const hit = points.findIndex(p => Math.abs(p.x - m.x) < 8 && Math.abs((size - p.y) - m.y) < 8);
            if (hit !== -1 && points.length > 2) { 
                points.splice(hit, 1);
                activePointIdx = -1;
                draw();
                hooks.preview(state);
            }
        };

        draw();
        hooks.preview(state);
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        if (!params) return;
        
        // Helper to generate LUT
        const generateLUT = (points: {x: number, y: number}[]) => {
            if (!points || points.length < 2) {
                const l = new Uint8Array(256);
                for(let i=0; i<256; i++) l[i] = i;
                return l;
            }
            // Ensure points are sorted
            const pts = [...points].sort((a,b) => a.x - b.x);
            for(let i=1; i<pts.length; i++) if(pts[i].x <= pts[i-1].x) pts[i].x = pts[i-1].x + 0.1;

            const n = pts.length - 1;
            const x = pts.map(p => p.x);
            const a = pts.map(p => p.y);
            const h_arr = new Float32Array(n);
            const A = new Float32Array(n);
            const l = new Float32Array(n + 1);
            const u = new Float32Array(n + 1);
            const z = new Float32Array(n + 1);
            const c = new Float32Array(n + 1);
            const b = new Float32Array(n);
            const d = new Float32Array(n);

            for (let i = 0; i < n; i++) h_arr[i] = x[i+1] - x[i];
            for (let i = 1; i < n; i++) A[i] = 3 * (a[i+1] - a[i]) / h_arr[i] - 3 * (a[i] - a[i-1]) / h_arr[i-1];
            l[0] = 1; u[0] = 0; z[0] = 0;
            for (let i = 1; i < n; i++) {
                l[i] = 2 * (x[i+1] - x[i-1]) - h_arr[i-1] * u[i-1];
                u[i] = h_arr[i] / l[i];
                z[i] = (A[i] - h_arr[i-1] * z[i-1]) / l[i];
            }
            l[n] = 1; z[n] = 0; c[n] = 0;
            for (let i = n - 1; i >= 0; i--) {
                c[i] = z[i] - u[i] * c[i+1];
                b[i] = (a[i+1] - a[i]) / h_arr[i] - h_arr[i] * (c[i+1] + 2 * c[i]) / 3;
                d[i] = (c[i+1] - c[i]) / (3 * h_arr[i]);
            }

            const lut = new Uint8Array(256);
            let sIdx = 0;
            for (let i = 0; i < 256; i++) {
                while (sIdx < n - 1 && i > x[sIdx+1]) sIdx++;
                const dx = i - x[sIdx];
                let val;
                if (i < x[0]) val = a[0];
                else if (i > x[n]) val = a[n];
                else val = a[sIdx] + b[sIdx] * dx + c[sIdx] * dx * dx + d[sIdx] * dx * dx * dx;
                lut[i] = Math.max(0, Math.min(255, Math.round(val)));
            }
            return lut;
        };

        // Determine params structure (Array = Legacy RGB only, Object = Multi-channel)
        let pRGB, pR, pG, pB, pA;
        if (Array.isArray(params)) {
            pRGB = params; 
        } else {
            pRGB = params.rgb;
            pR = params.r;
            pG = params.g;
            pB = params.b;
            pA = params.a;
        }

        const lutRGB = generateLUT(pRGB);
        const lutR = pR ? generateLUT(pR) : null;
        const lutG = pG ? generateLUT(pG) : null;
        const lutB = pB ? generateLUT(pB) : null;
        const lutA = pA ? generateLUT(pA) : null;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
            
            // Apply Individual Channels
            if (lutR) r = lutR[r];
            if (lutG) g = lutG[g];
            if (lutB) b = lutB[b];
            if (lutA) a = lutA[a];

            // Apply Master RGB to all color channels
            r = lutRGB[r];
            g = lutRGB[g];
            b = lutRGB[b];
            
            data[i] = r;
            data[i+1] = g;
            data[i+2] = b;
            data[i+3] = a;
        }
    }
});
