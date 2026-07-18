import { App } from '~/app';
import { UI } from '~/ui';
import { Layer } from '~/layers';

App.registerTool({
    id: 'lasso',
    icon: '➰',
    title: 'Lasso Select',
    settings: { type: 'free', magneticRadius: 30, searchRadius: 40, threshold: 30, anchorGap: 40, mode: 'new', autoAnchor: true },

    points: [] as any[],
    tempPoint: null as any,
    currentMode: 'new',

    // Interactive segment session state
    seeds: [] as Array<{ x: number; y: number }>,
    segments: [] as Array<Array<{ x: number; y: number }>>,
    tempSegment: [] as Array<{ x: number; y: number }>,
    isClosed: false,
    draggingSeedIndex: null as number | null,
    hoveredSeedIndex: null as number | null,
    hoveredSegmentIndex: null as number | null,
    hoveredSegmentPoint: null as { x: number; y: number } | null,
    currentMouseDisplay: null as { x: number; y: number } | null,

    // Snapping edge cost structures
    gradientMap: null as Float32Array | null,
    gradWidth: 0,
    gradHeight: 0,
    
    // Dijkstra Caching for real-time Live-Wire tracking
    cacheParents: null as Int32Array | null,
    cacheWindow: null as { xmin: number; ymin: number; w: number; h: number } | null,

    // Auto-Anchor / Path Freezing state
    autoAnchorRedrawn: [] as number[],
    autoAnchorTimes: [] as number[],

    onSelect(panel: HTMLElement) {
        panel.appendChild(UI.createSelectRow({
            label: 'Type',
            options: [
                { value: 'free', text: 'Freehand' },
                { value: 'poly', text: 'Polygonal' },
                { value: 'magnetic', text: 'Magnetic' }
            ],
            value: this.settings.type || 'free',
            onChange: (v: string) => {
                this.settings.type = v;
                this.cancelSelection();
                if (magneticOptionsContainer) {
                    UI.toggle(magneticOptionsContainer, v === 'magnetic');
                }
            }
        }));

        const magneticOptionsContainer = UI.createNode('div', { style: 'display: flex; flex-direction: column; gap: 5px;' });

        magneticOptionsContainer.appendChild(UI.createSliderRow({
            label: 'Snapping Radius',
            min: 5,
            max: 40,
            value: this.settings.magneticRadius || 30,
            onInput: (v: string) => {
                this.settings.magneticRadius = parseInt(v);
                App.render();
            }
        }));

        magneticOptionsContainer.appendChild(UI.createSliderRow({
            label: 'Search Radius',
            min: 10,
            max: 200,
            value: this.settings.searchRadius || 40,
            onInput: (v: string) => {
                this.settings.searchRadius = parseInt(v);
                App.render();
            }
        }));

        magneticOptionsContainer.appendChild(UI.createSliderRow({
            label: 'Threshold',
            min: 1,
            max: 100,
            value: this.settings.threshold || 30,
            onInput: (v: string) => {
                this.settings.threshold = parseInt(v);
                App.render();
            }
        }));

        magneticOptionsContainer.appendChild(UI.createSliderRow({
            label: 'Anchor Gap',
            min: 10,
            max: 200,
            value: this.settings.anchorGap || 40,
            onInput: (v: string) => {
                this.settings.anchorGap = parseInt(v);
                App.render();
            }
        }));

        panel.appendChild(magneticOptionsContainer);
        UI.toggle(magneticOptionsContainer, (this.settings.type || 'free') === 'magnetic');

        panel.appendChild(UI.createCheckbox({
            label: 'Auto-Anchor (Path Freezing)',
            value: this.settings.autoAnchor !== false,
            onChange: (v: boolean) => {
                this.settings.autoAnchor = v;
                this.autoAnchorRedrawn = [];
                this.autoAnchorTimes = [];
            }
        }));

        panel.appendChild(UI.createRadioGroup({
            label: 'Mode',
            options: [
                { value: 'new', label: 'New' },
                { value: 'add', label: 'Add (+)' },
                { value: 'sub', label: 'Subtract (-)' }
            ],
            value: this.settings.mode,
            layout: 'row',
            onChange: (v: string) => {
                this.settings.mode = v;
            }
        }));
    },

    computeGradientMap(layer: Layer) {
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        this.gradWidth = w;
        this.gradHeight = h;
        
        const ctx = layer.canvas.getContext('2d')!;
        const imgData = ctx.getImageData(0, 0, w, h).data;
        const grad = new Float32Array(w * h);

        // Convert entire image to CIELAB for perceptually accurate edge detection
        const lab = new Float32Array(w * h * 3);
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            const r = imgData[idx];
            const g = imgData[idx + 1];
            const b = imgData[idx + 2];
            
            // sRGB to CIELAB conversion
            let r_n = r / 255, g_n = g / 255, b_n = b / 255;
            r_n = r_n > 0.04045 ? Math.pow((r_n + 0.055) / 1.055, 2.4) : r_n / 12.92;
            g_n = g_n > 0.04045 ? Math.pow((g_n + 0.055) / 1.055, 2.4) : g_n / 12.92;
            b_n = b_n > 0.04045 ? Math.pow((b_n + 0.055) / 1.055, 2.4) : b_n / 12.92;
            const xVal = r_n * 0.4124564 + g_n * 0.3575761 + b_n * 0.1804375;
            const yVal = r_n * 0.2126729 + g_n * 0.7151522 + b_n * 0.0721750;
            const zVal = r_n * 0.0193339 + g_n * 0.1191920 + b_n * 0.9503041;
            const xr = xVal / 0.95047, yr = yVal / 1.00000, zr = zVal / 1.08883;
            const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
            const fx = f(xr), fy = f(yr), fz = f(zr);
            const L = fy > 0.008856 ? 116 * fy - 16 : 903.3 * yr;
            const a = 500 * (fx - fy);
            const b_val = 200 * (fy - fz);

            lab[i * 3] = L;
            lab[i * 3 + 1] = a;
            lab[i * 3 + 2] = b_val;
        }

        // Apply multi-channel Sobel edge detection using Euclidean distance in Lab space
        for (let y = 0; y < h; y++) {
            const py = Math.max(0, y - 1) * w;
            const cy = y * w;
            const ny = Math.min(h - 1, y + 1) * w;
            for (let x = 0; x < w; x++) {
                const px = Math.max(0, x - 1);
                const cx = x;
                const nx = Math.min(w - 1, x + 1);

                let gx_sum_sq = 0;
                let gy_sum_sq = 0;

                for (let c = 0; c < 3; c++) {
                    const tl = lab[(py + px) * 3 + c];
                    const tc = lab[(py + cx) * 3 + c];
                    const tr = lab[(py + nx) * 3 + c];
                    const cl = lab[(cy + px) * 3 + c];
                    const cr = lab[(cy + nx) * 3 + c];
                    const bl = lab[(ny + px) * 3 + c];
                    const bc = lab[(ny + cx) * 3 + c];
                    const br = lab[(ny + nx) * 3 + c];

                    const gx = -tl + tr - 2 * cl + 2 * cr - bl + br;
                    const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

                    gx_sum_sq += gx * gx;
                    gy_sum_sq += gy * gy;
                }

                grad[cy + cx] = Math.sqrt(gx_sum_sq + gy_sum_sq);
            }
        }

        let maxGrad = 0.001;
        for (let i = 0; i < w * h; i++) {
            if (grad[i] > maxGrad) maxGrad = grad[i];
        }
        for (let i = 0; i < w * h; i++) {
            grad[i] /= maxGrad;
        }
        this.gradientMap = grad;
    },

    getSnappedPoint(mx: number, my: number, radius: number): { x: number; y: number } {
        if (!this.gradientMap) return { x: mx, y: my };
        const w = this.gradWidth;
        const h = this.gradHeight;
        
        let bestX = mx;
        let bestY = my;
        let bestScore = -1;
        
        const r = Math.round(radius);
        const startX = Math.max(0, Math.floor(mx - r));
        const endX = Math.min(w - 1, Math.ceil(mx + r));
        const startY = Math.max(0, Math.floor(my - r));
        const endY = Math.min(h - 1, Math.ceil(my + r));
        
        for (let y = startY; y <= endY; y++) {
            const yOffset = y * w;
            for (let x = startX; x <= endX; x++) {
                const dx = x - mx;
                const dy = y - my;
                const dist = Math.hypot(dx, dy);
                if (dist <= radius) {
                    const g = this.gradientMap[yOffset + x];
                    const score = g * (1.0 - dist / radius);
                    if (score > bestScore) {
                        bestScore = score;
                        bestX = x;
                        bestY = y;
                    }
                }
            }
        }
        return { x: Math.round(bestX), y: Math.round(bestY) };
    },

    getPolySegment(p1: { x: number; y: number }, p2: { x: number; y: number }): Array<{ x: number; y: number }> {
        const points: Array<{ x: number; y: number }> = [];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        if (steps === 0) {
            points.push({ x: p1.x, y: p1.y });
            return points;
        }
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            points.push({
                x: p1.x + dx * t,
                y: p1.y + dy * t
            });
        }
        return points;
    },

    buildLiveWireCache(seed: { x: number; y: number }) {
        if (!this.gradientMap) return;
        const w = this.gradWidth;
        const h = this.gradHeight;
        
        // Strict clamps to prevent memory corruption if point is drawn off-screen
        const sx = Math.max(0, Math.min(w - 1, Math.round(seed.x)));
        const sy = Math.max(0, Math.min(h - 1, Math.round(seed.y)));
        const R = 250; 
        
        const xmin = Math.max(0, sx - R);
        const xmax = Math.min(w - 1, sx + R);
        const ymin = Math.max(0, sy - R);
        const ymax = Math.min(h - 1, sy + R);
        
        const boxW = xmax - xmin + 1;
        const boxH = ymax - ymin + 1;
        const boxSize = boxW * boxH;
        
        const dists = new Float32Array(boxSize).fill(Infinity);
        const parents = new Int32Array(boxSize).fill(-1);
        const visited = new Uint8Array(boxSize);
        
        const startIdx = (sy - ymin) * boxW + (sx - xmin);
        dists[startIdx] = 0;
        
        const heap = new DijkstraHeap(boxSize, dists);
        heap.pushOrDecrease(startIdx);
        
        while (heap.size() > 0) {
            const curr = heap.pop()!;
            visited[curr] = 1;
            
            const curY = Math.floor(curr / boxW);
            const curX = curr % boxW;
            const globalX = curX + xmin;
            const globalY = curY + ymin;
            const curDist = dists[curr];
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = globalX + dx;
                    const ny = globalY + dy;
                    if (nx >= xmin && nx <= xmax && ny >= ymin && ny <= ymax) {
                        const nLocalX = nx - xmin;
                        const nLocalY = ny - ymin;
                        const nidx = nLocalY * boxW + nLocalX;
                        
                        if (visited[nidx]) continue;
                        
                        const edgeWeight = (dx === 0 || dy === 0) ? 1.0 : 1.414;
                        const g1 = this.gradientMap[globalY * w + globalX];
                        const g2 = this.gradientMap[ny * w + nx];
                        const g = (g1 + g2) / 2;
                        const cost = edgeWeight + (1.0 - g);
                        const nextDist = curDist + cost;
                        
                        if (nextDist < dists[nidx]) {
                            dists[nidx] = nextDist;
                            parents[nidx] = curr;
                            heap.pushOrDecrease(nidx);
                        }
                    }
                }
            }
        }
        
        this.cacheParents = parents;
        this.cacheWindow = { xmin, ymin, w: boxW, h: boxH };
    },

    traceLiveWireCache(p2: { x: number; y: number }, seed: { x: number; y: number }): Array<{ x: number; y: number }> {
        if (!this.cacheParents || !this.cacheWindow) {
            return this.findLiveWirePath(seed, p2);
        }
        
        const { xmin, ymin, w: boxW, h: boxH } = this.cacheWindow;
        const clampX = Math.max(0, Math.min(this.gradWidth - 1, Math.round(p2.x)));
        const clampY = Math.max(0, Math.min(this.gradHeight - 1, Math.round(p2.y)));
        
        if (clampX < xmin || clampX >= xmin + boxW || clampY < ymin || clampY >= ymin + boxH) {
            return this.findLiveWirePath(seed, p2);
        }
        
        const destIdx = (clampY - ymin) * boxW + (clampX - xmin);
        
        const seedClampX = Math.max(0, Math.min(this.gradWidth - 1, Math.round(seed.x)));
        const seedClampY = Math.max(0, Math.min(this.gradHeight - 1, Math.round(seed.y)));
        const seedIdx = (seedClampY - ymin) * boxW + (seedClampX - xmin);
        
        if (this.cacheParents[destIdx] === -1 && destIdx !== seedIdx) {
            return this.findLiveWirePath(seed, p2);
        }
        
        const path: Array<{ x: number; y: number }> = [];
        let curr = destIdx;
        while (curr !== -1) {
            const cy = Math.floor(curr / boxW) + ymin;
            const cx = (curr % boxW) + xmin;
            path.push({ x: cx, y: cy });
            curr = this.cacheParents[curr];
        }
        path.reverse();
        
        if (path.length > 0) {
            if (seed.x !== path[0].x || seed.y !== path[0].y) {
                path.unshift({ x: seed.x, y: seed.y });
            }
            if (p2.x !== clampX || p2.y !== clampY) {
                path.push({ x: p2.x, y: p2.y });
            }
        } else {
            return this.getPolySegment(seed, p2);
        }

        return path;
    },

    findLiveWirePath(p1: { x: number; y: number }, p2: { x: number; y: number }): Array<{ x: number; y: number }> {
        if (!this.gradientMap) return [p1, p2];
        const w = this.gradWidth;
        const h = this.gradHeight;
        
        // Strict boundary clamps
        const x1 = Math.max(0, Math.min(w - 1, Math.round(p1.x)));
        const y1 = Math.max(0, Math.min(h - 1, Math.round(p1.y)));
        const x2 = Math.max(0, Math.min(w - 1, Math.round(p2.x)));
        const y2 = Math.max(0, Math.min(h - 1, Math.round(p2.y)));
        
        if (x1 === x2 && y1 === y2) {
            const path = [{ x: x1, y: y1 }];
            if (p1.x !== x1 || p1.y !== y1) path.unshift({ x: p1.x, y: p1.y });
            if (p2.x !== x2 || p2.y !== y2) path.push({ x: p2.x, y: p2.y });
            return path;
        }

        const pad = this.settings.searchRadius || 40;
        const xmin = Math.max(0, Math.min(x1, x2) - pad);
        const ymin = Math.max(0, Math.min(y1, y2) - pad);
        const xmax = Math.min(w - 1, Math.max(x1, x2) + pad);
        const ymax = Math.min(h - 1, Math.max(y1, y2) + pad);
        
        const boxW = xmax - xmin + 1;
        const boxH = ymax - ymin + 1;
        const boxSize = boxW * boxH;
        
        if (boxSize > 250000) {
            return this.getPolySegment(p1, p2);
        }
        
        const dists = new Float32Array(boxSize).fill(Infinity);
        const parents = new Int32Array(boxSize).fill(-1);
        const visited = new Uint8Array(boxSize);
        
        const startIdx = (y1 - ymin) * boxW + (x1 - xmin);
        dists[startIdx] = 0;
        
        const heap = new DijkstraHeap(boxSize, dists);
        heap.pushOrDecrease(startIdx);
        
        const destIdx = (y2 - ymin) * boxW + (x2 - xmin);
        
        while (heap.size() > 0) {
            const curr = heap.pop()!;
            if (curr === destIdx) break;
            visited[curr] = 1;
            
            const curY = Math.floor(curr / boxW);
            const curX = curr % boxW;
            const globalX = curX + xmin;
            const globalY = curY + ymin;
            const curDist = dists[curr];
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = globalX + dx;
                    const ny = globalY + dy;
                    if (nx >= xmin && nx <= xmax && ny >= ymin && ny <= ymax) {
                        const nLocalX = nx - xmin;
                        const nLocalY = ny - ymin;
                        const nidx = nLocalY * boxW + nLocalX;
                        
                        if (visited[nidx]) continue;
                        
                        const edgeWeight = (dx === 0 || dy === 0) ? 1.0 : 1.414;
                        const g1 = this.gradientMap[globalY * w + globalX];
                        const g2 = this.gradientMap[ny * w + nx];
                        const g = (g1 + g2) / 2;
                        const cost = edgeWeight + (1.0 - g);
                        const nextDist = curDist + cost;
                        
                        if (nextDist < dists[nidx]) {
                            dists[nidx] = nextDist;
                            parents[nidx] = curr;
                            heap.pushOrDecrease(nidx);
                        }
                    }
                }
            }
        }
        
        const path: Array<{ x: number; y: number }> = [];
        let curr = destIdx;
        while (curr !== -1) {
            const cy = Math.floor(curr / boxW) + ymin;
            const cx = (curr % boxW) + xmin;
            path.push({ x: cx, y: cy });
            curr = parents[curr];
        }
        path.reverse();
        
        if (path.length > 0) {
            if (p1.x !== path[0].x || p1.y !== path[0].y) {
                path.unshift({ x: p1.x, y: p1.y });
            }
            if (p2.x !== x2 || p2.y !== y2) {
                path.push({ x: p2.x, y: p2.y });
            }
        } else {
            return this.getPolySegment(p1, p2);
        }
        
        return path;
    },

    recalculateSegmentsAround(idx: number) {
        const type = this.settings.type || 'free';
        
        if (idx > 0) {
            this.segments[idx - 1] = type === 'magnetic' 
                ? this.findLiveWirePath(this.seeds[idx - 1], this.seeds[idx]) 
                : this.getPolySegment(this.seeds[idx - 1], this.seeds[idx]);
        }
        if (idx < this.seeds.length - 1) {
            this.segments[idx] = type === 'magnetic' 
                ? this.findLiveWirePath(this.seeds[idx], this.seeds[idx + 1]) 
                : this.getPolySegment(this.seeds[idx], this.seeds[idx + 1]);
        }
        if (this.isClosed && (idx === 0 || idx === this.seeds.length - 1)) {
            this.segments[this.segments.length - 1] = type === 'magnetic' 
                ? this.findLiveWirePath(this.seeds[this.seeds.length - 1], this.seeds[0]) 
                : this.getPolySegment(this.seeds[this.seeds.length - 1], this.seeds[0]);
        }
    },

    rebuildSegments() {
        this.segments = [];
        if (this.seeds.length < 2) return;
        const type = this.settings.type || 'free';
        for (let i = 1; i < this.seeds.length; i++) {
            const prev = this.seeds[i - 1];
            const curr = this.seeds[i];
            this.segments.push(type === 'magnetic' ? this.findLiveWirePath(prev, curr) : this.getPolySegment(prev, curr));
        }
        if (this.isClosed && this.seeds.length >= 3) {
            const p1 = this.seeds[this.seeds.length - 1];
            const p2 = this.seeds[0];
            this.segments.push(type === 'magnetic' ? this.findLiveWirePath(p1, p2) : this.getPolySegment(p1, p2));
        }
    },

    removeSeed(idx: number) {
        if (idx < 0 || idx >= this.seeds.length) return;
        App.actions.saveState();
        this.seeds.splice(idx, 1);
        
        if (this.seeds.length < 3 && this.isClosed) {
            this.isClosed = false;
        }
        
        this.rebuildSegments();
        this.hoveredSeedIndex = null;
        this.draggingSeedIndex = null;

        if (this.settings.type === 'magnetic' && this.seeds.length > 0 && !this.isClosed) {
            this.buildLiveWireCache(this.seeds[this.seeds.length - 1]);
        }

        App.render();
    },

    isPointInPath(mx: number, my: number): boolean {
        if (this.seeds.length < 3) return false;
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.beginPath();
        ctx.moveTo(this.seeds[0].x, this.seeds[0].y);
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            for (let j = 0; j < seg.length; j++) {
                ctx.lineTo(seg[j].x, seg[j].y);
            }
        }
        ctx.closePath();
        return ctx.isPointInPath(mx, my);
    },

    toGlobal(l: Layer, pt: { x: number; y: number }) {
        return {
            x: l.x + pt.x * (l.width / l.canvas.width),
            y: l.y + pt.y * (l.height / l.canvas.height)
        };
    },

    calculateCheckPoints(path: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
        const anchorGap = this.settings.anchorGap || 40;
        const threshold = (this.settings.threshold || 30) / 100;
        const maxFactor = 2;
        
        let totalDistance = 0;
        let minPoint = 0;
        let midPoint = 1;
        let finalPoint = 2;
        
        while (finalPoint < path.length) {
            const d = Math.hypot(path[finalPoint].x - path[finalPoint - 1].x, path[finalPoint].y - path[finalPoint - 1].y);
            totalDistance += d;
            
            if (totalDistance <= anchorGap / 3.0) {
                minPoint = finalPoint;
            }
            if (totalDistance <= anchorGap) {
                midPoint = finalPoint;
            }
            if (totalDistance > maxFactor * anchorGap) {
                break;
            }
            finalPoint++;
        }
        
        if (totalDistance > maxFactor * anchorGap) {
            let foundSomething = false;
            let checkPoint = midPoint;
            
            for (let i = midPoint; i < finalPoint; i++) {
                const pt = path[i];
                const px = Math.max(0, Math.min(this.gradWidth - 1, Math.round(pt.x)));
                const py = Math.max(0, Math.min(this.gradHeight - 1, Math.round(pt.y)));
                const g = this.gradientMap ? this.gradientMap[py * this.gradWidth + px] : 0;
                if (g >= threshold) {
                    checkPoint = i;
                    foundSomething = true;
                    break;
                }
            }
            
            if (!foundSomething) {
                for (let i = midPoint - 1; i >= minPoint; i--) {
                    const pt = path[i];
                    const px = Math.max(0, Math.min(this.gradWidth - 1, Math.round(pt.x)));
                    const py = Math.max(0, Math.min(this.gradHeight - 1, Math.round(pt.y)));
                    const g = this.gradientMap ? this.gradientMap[py * this.gradWidth + px] : 0;
                    if (g >= threshold) {
                        checkPoint = i;
                        foundSomething = true;
                        break;
                    }
                }
            }
            
            if (!foundSomething) {
                checkPoint = midPoint;
            }
            
            const newSeed = path[checkPoint];
            
            App.actions.saveState();
            this.seeds.push(newSeed);
            this.segments.push(path.slice(0, checkPoint + 1));
            
            this.buildLiveWireCache(newSeed);
            
            const remainingSuffix = path.slice(checkPoint);
            return this.calculateCheckPoints(remainingSuffix);
        }
        
        return path;
    },

    updateAutoAnchor(newPath: Array<{ x: number; y: number }>) {
        const size = newPath.length;
        const now = Date.now();
        
        let i = 0;
        while (i < size && i < this.autoAnchorRedrawn.length) {
            const prevPt = this.tempSegment[i];
            const currPt = newPath[i];
            if (prevPt && Math.hypot(prevPt.x - currPt.x, prevPt.y - currPt.y) < 0.5) {
                this.autoAnchorRedrawn[i]++;
            } else {
                this.autoAnchorRedrawn[i] = 0;
                this.autoAnchorTimes[i] = now;
            }
            i++;
        }
        while (this.autoAnchorRedrawn.length < size) {
            this.autoAnchorRedrawn.push(0);
            this.autoAnchorTimes.push(now);
        }
        if (this.autoAnchorRedrawn.length > size) {
            this.autoAnchorRedrawn.length = size;
            this.autoAnchorTimes.length = size;
        }
        
        let freezeIdx = -1;
        const safetyMargin = 25; // Leave the closest 25 pixels to the mouse fully dynamic
        for (let j = 0; j < size - safetyMargin; j++) {
            const age = now - this.autoAnchorTimes[j];
            if (this.autoAnchorRedrawn[j] >= 12 && age > 350) {
                freezeIdx = j;
            }
        }
        
        if (freezeIdx > 12) {
            const freezePt = newPath[freezeIdx];
            const frozenSegment = newPath.slice(0, freezeIdx + 1);
            
            App.actions.saveState();
            this.segments.push(frozenSegment);
            this.seeds.push(freezePt);
            this.buildLiveWireCache(freezePt);
            
            this.autoAnchorRedrawn = [];
            this.autoAnchorTimes = [];
            this.tempSegment = newPath.slice(freezeIdx);
            App.render();
        }
    },

    onMouseDown(e: MouseEvent) {
        if (e.button === 2) {
            if (this.settings.type !== 'free' && this.seeds.length > 0) {
                if (this.hoveredSeedIndex !== null) {
                    this.removeSeed(this.hoveredSeedIndex);
                } else if (!this.isClosed) {
                    this.removeSeed(this.seeds.length - 1);
                }
            }
            return;
        }

        const l = App.utils.getActive();
        if (!l) return;

        const pos = App.utils.getPos(e);
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        if (e.shiftKey) this.currentMode = 'add';
        else if (e.altKey) this.currentMode = 'sub';
        else this.currentMode = this.settings.mode || 'new';

        // Do not clear the selection immediately on mousedown when starting a new selection

        const type = this.settings.type || 'free';

        if (type === 'free') {
            App.state.isDrawing = true;
            this.points = [pos];
        } else {
            if (this.isClosed) {
                if (this.hoveredSeedIndex !== null || this.hoveredSegmentIndex !== null) {
                    // Allow dragging/splitting seed even after path has been closed
                } else {
                    if (this.isPointInPath(lx, ly)) {
                        this.finishSelection();
                    } else {
                        this.cancelSelection();
                    }
                    return;
                }
            }

            App.state.isDrawing = true;
            
            if (this.hoveredSeedIndex !== null) {
                this.draggingSeedIndex = this.hoveredSeedIndex;
                App.actions.saveState();
                return;
            }
            
            if (this.hoveredSegmentIndex !== null && this.hoveredSegmentPoint !== null) {
                const idx = this.hoveredSegmentIndex;
                const splitPt = this.hoveredSegmentPoint;
                
                App.actions.saveState();
                this.seeds.splice(idx + 1, 0, splitPt);
                this.rebuildSegments();
                
                this.draggingSeedIndex = idx + 1;
                this.hoveredSeedIndex = idx + 1;
                this.hoveredSegmentIndex = null;
                this.hoveredSegmentPoint = null;
                
                App.render();
                return;
            }

            if (type === 'magnetic' && !this.gradientMap) {
                this.computeGradientMap(l);
            }

            if (this.seeds.length >= 3 && !this.isClosed) {
                const startSeed = this.seeds[0];
                const distToStart = Math.hypot(lx - startSeed.x, ly - startSeed.y);
                const tolerance = 8 * (l.canvas.width / l.width);
                if (distToStart < tolerance) {
                    this.closeCurve();
                    this.finishSelection();
                    return;
                }
            }

            App.actions.saveState();
            const isForced = e.shiftKey;
            const snapped = (type === 'magnetic' && !isForced) ? this.getSnappedPoint(lx, ly, this.settings.magneticRadius || 30) : { x: lx, y: ly };
            
            this.seeds.push(snapped);
            
            if (this.seeds.length > 1) {
                const prev = this.seeds[this.seeds.length - 2];
                const path = type === 'magnetic' ? this.traceLiveWireCache(snapped, prev) : this.getPolySegment(prev, snapped);
                this.segments.push(path);
            }
            
            if (type === 'magnetic') {
                this.buildLiveWireCache(snapped);
            }
            this.tempSegment = [];
        }
        App.render();
    },

    onMouseMove(e: MouseEvent) {
        if (this.settings.type === 'free') {
            if (!App.state.isDrawing) return;
            const pos = App.utils.getPos(e);
            this.points.push(pos);
            App.render();
            return;
        }

        const l = App.utils.getActive();
        if (!l) return;

        const pos = App.utils.getPos(e);
        this.currentMouseDisplay = pos;
        
        const lx = App.utils.toLocal(l, pos.x, 'x');
        const ly = App.utils.toLocal(l, pos.y, 'y');

        if (this.draggingSeedIndex !== null) {
            const snapped = { x: lx, y: ly }; 
            
            this.seeds[this.draggingSeedIndex] = snapped;
            this.recalculateSegmentsAround(this.draggingSeedIndex);
            App.render();
            return;
        }

        this.hoveredSeedIndex = null;
        this.hoveredSegmentIndex = null;
        this.hoveredSegmentPoint = null;

        if (this.seeds.length > 0) {
            for (let i = 0; i < this.seeds.length; i++) {
                const s = this.seeds[i];
                const dist = Math.hypot(s.x - lx, s.y - ly);
                const tolerance = 6 * (l.canvas.width / l.width);
                if (dist < tolerance) {
                    this.hoveredSeedIndex = i;
                    break;
                }
            }

            if (this.hoveredSeedIndex === null) {
                let bestDist = 5 * (l.canvas.width / l.width);
                for (let i = 0; i < this.segments.length; i++) {
                    const seg = this.segments[i];
                    for (let j = 0; j < seg.length; j++) {
                        const pt = seg[j];
                        const dist = Math.hypot(pt.x - lx, pt.y - ly);
                        if (dist < bestDist) {
                            bestDist = dist;
                            this.hoveredSegmentIndex = i;
                            this.hoveredSegmentPoint = pt;
                        }
                    }
                }
            }
        }

        if (this.seeds.length > 0 && !this.isClosed) {
            const prev = this.seeds[this.seeds.length - 1];
            const isForced = e.shiftKey;
            const snapped = (this.settings.type === 'magnetic' && !isForced) ? this.getSnappedPoint(lx, ly, this.settings.magneticRadius || 30) : { x: lx, y: ly };
            
            let nextPath = this.settings.type === 'magnetic' ? this.traceLiveWireCache(snapped, prev) : this.getPolySegment(prev, snapped);
            
            if (this.settings.type === 'magnetic' && this.settings.autoAnchor !== false) {
                nextPath = this.calculateCheckPoints(nextPath);
            }
            
            this.tempSegment = nextPath;
        }
        App.render();
    },

    onMouseUp(e: MouseEvent) {
        if (this.settings.type === 'free') {
            if (!App.state.isDrawing) return;
            if (this.points.length >= 3) {
                this.finishSelection();
            } else {
                this.cancelSelection();
            }
            return;
        }

        if (this.draggingSeedIndex !== null) {
            if (this.settings.type === 'magnetic' && this.draggingSeedIndex === this.seeds.length - 1 && !this.isClosed) {
                this.buildLiveWireCache(this.seeds[this.seeds.length - 1]);
            }
            this.draggingSeedIndex = null;
            App.render();
        }
    },

    onDoubleClick(e: MouseEvent) {
        if (this.settings.type !== 'free' && this.seeds.length >= 3) {
            this.closeCurve();
            this.finishSelection();
        }
    },

    onContextMenu(e: MouseEvent) {
        if (this.settings.type !== 'free') {
            e.preventDefault();
        }
    },

    onKeyDown(e: KeyboardEvent): boolean {
        if (e.key === 'Enter') {
            if (this.settings.type !== 'free' && this.seeds.length >= 3) {
                if (!this.isClosed) {
                    this.closeCurve();
                }
                this.finishSelection();
                return true;
            }
        }
        if (e.key === 'Escape') {
            if (this.seeds.length > 0 || this.points.length > 0) {
                this.cancelSelection();
                return true;
            }
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
            if (this.settings.type !== 'free' && this.seeds.length > 0) {
                if (this.hoveredSeedIndex !== null) {
                    this.removeSeed(this.hoveredSeedIndex);
                } else if (!this.isClosed) {
                    this.removeSeed(this.seeds.length - 1);
                }
                return true;
            }
        }
        return false;
    },

    closeCurve() {
        if (this.isClosed || this.seeds.length < 3) return;
        
        const type = this.settings.type || 'free';
        const p1 = this.seeds[this.seeds.length - 1];
        const p2 = this.seeds[0];
        
        const path = type === 'magnetic' ? this.traceLiveWireCache(p2, p1) : this.getPolySegment(p1, p2);
        this.segments.push(path);
        
        this.isClosed = true;
        this.tempSegment = [];
        App.render();
    },

    drawUI() {
        const ctx = App.els.ctx;
        ctx.save();

        if (this.settings.type === 'free') {
            if (this.points.length === 0) {
                ctx.restore();
                return;
            }
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);

            ctx.beginPath();
            ctx.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                ctx.lineTo(this.points[i].x, this.points[i].y);
            }
            ctx.stroke();

            ctx.strokeStyle = '#000000';
            ctx.lineDashOffset = 4;
            ctx.stroke();
            ctx.restore();
            return;
        }

        if (this.settings.type === 'magnetic' && this.currentMouseDisplay && this.draggingSeedIndex === null) {
            ctx.beginPath();
            const l = App.utils.getActive();
            const displayRadius = l ? (this.settings.magneticRadius || 30) * (l.width / l.canvas.width) : (this.settings.magneticRadius || 30);
            ctx.arc(this.currentMouseDisplay.x, this.currentMouseDisplay.y, displayRadius, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(0, 122, 204, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 122, 204, 0.05)';
            ctx.fill();
        }

        const activeL = App.utils.getActive();
        if (!activeL) {
            ctx.restore();
            return;
        }

        ctx.beginPath();
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            if (seg.length > 0) {
                const p0 = this.toGlobal(activeL, seg[0]);
                ctx.moveTo(p0.x, p0.y);
                for (let j = 1; j < seg.length; j++) {
                    const p = this.toGlobal(activeL, seg[j]);
                    ctx.lineTo(p.x, p.y);
                }
            }
        }
        ctx.strokeStyle = '#007acc';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        if (this.seeds.length > 0 && !this.isClosed && this.tempSegment && this.tempSegment.length > 0) {
            ctx.beginPath();
            const p0 = this.toGlobal(activeL, this.tempSegment[0]);
            ctx.moveTo(p0.x, p0.y);
            for (let j = 1; j < this.tempSegment.length; j++) {
                const p = this.toGlobal(activeL, this.tempSegment[j]);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = '#e91e63';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([2, 2]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        for (let i = 0; i < this.seeds.length; i++) {
            const gp = this.toGlobal(activeL, this.seeds[i]);
            if (i === 0) {
                ctx.fillStyle = 'rgba(40, 167, 69, 0.8)';
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            } else if (this.hoveredSeedIndex === i) {
                ctx.fillStyle = 'rgba(255, 193, 7, 0.8)';
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = 1.5;
            } else {
                ctx.fillStyle = 'rgba(0, 122, 204, 0.7)';
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.lineWidth = 1;
            }
            ctx.beginPath();
            ctx.arc(gp.x, gp.y, i === 0 ? 5.0 : 3.5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }

        if (this.hoveredSegmentPoint && this.hoveredSegmentIndex !== null) {
            const gp = this.toGlobal(activeL, this.hoveredSegmentPoint);
            ctx.fillStyle = 'rgba(233, 30, 99, 0.5)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(gp.x, gp.y, 3.5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    },

    finishSelection() {
        const l = App.utils.getActive();
        if (!l) return;

        App.actions.saveState();

        if (!App.state.selection.mask || App.state.selection.layerId !== l.id) {
            App.state.selection.layerId = l.id;
            App.state.selection.mask = document.createElement('canvas');
            App.state.selection.mask.width = l.canvas.width;
            App.state.selection.mask.height = l.canvas.height;
            App.state.selection.ctx = App.state.selection.mask.getContext('2d');
            App.state.selection.outline = null;
        }

        const ctx = App.state.selection.ctx!;
        ctx.save();

        const mode = this.currentMode || this.settings.mode;

        if (mode === 'new') {
            ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
            ctx.fillStyle = '#ffffff';
            App.state.selection.active = true;
        } else if (mode === 'add') {
            ctx.fillStyle = '#ffffff';
            App.state.selection.active = true;
        } else if (mode === 'sub') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#ffffff';
        }

        ctx.beginPath();

        if (this.settings.type === 'free') {
            const localPoints = this.points.map((p: any) => ({
                x: App.utils.toLocal(l, p.x, 'x'),
                y: App.utils.toLocal(l, p.y, 'y')
            }));
            if (localPoints.length > 0) {
                ctx.moveTo(localPoints[0].x, localPoints[0].y);
                for (let i = 1; i < localPoints.length; i++) {
                    ctx.lineTo(localPoints[i].x, localPoints[i].y);
                }
                ctx.closePath();
                ctx.fill();
            }
            App.recordAction(`api.lassoSelect(${JSON.stringify(localPoints)}, '${mode}');`);
        } else {
            if (this.seeds.length > 0) {
                ctx.moveTo(this.seeds[0].x, this.seeds[0].y);
                for (let i = 0; i < this.segments.length; i++) {
                    const seg = this.segments[i];
                    for (let j = 0; j < seg.length; j++) {
                        ctx.lineTo(seg[j].x, seg[j].y);
                    }
                }
                ctx.closePath();
                ctx.fill();
            }
            App.recordAction(`api.liveWireSelect(${JSON.stringify(this.seeds)}, '${mode}');`);
        }
        ctx.restore();

        App.state.selection.outline = null;
        this.clearSession();
        App.state.isDrawing = false;
        App.render();
    },

    cancelSelection() {
        this.clearSession();
        App.state.isDrawing = false;
        App.render();
    },

    clearSession() {
        this.points = [];
        this.seeds = [];
        this.segments = [];
        this.tempSegment = [];
        this.isClosed = false;
        this.tempPoint = null;
        this.gradientMap = null;
        this.draggingSeedIndex = null;
        this.hoveredSeedIndex = null;
        this.hoveredSegmentIndex = null;
        this.hoveredSegmentPoint = null;
        this.currentMouseDisplay = null;
        this.cacheParents = null;
        this.cacheWindow = null;
        this.autoAnchorRedrawn = [];
        this.autoAnchorTimes = [];
    }
});

class DijkstraHeap {
    private heap: number[] = [];
    private pos: Int32Array;
    private keys: Float32Array;

    constructor(size: number, keys: Float32Array) {
        this.pos = new Int32Array(size).fill(-1);
        this.keys = keys;
    }

    pushOrDecrease(idx: number) {
        let p = this.pos[idx];
        if (p === -1) {
            this.heap.push(idx);
            this.pos[idx] = this.heap.length - 1;
            this.up(this.heap.length - 1);
        } else {
            this.up(p);
        }
    }

    pop(): number | null {
        if (this.heap.length === 0) return null;
        const top = this.heap[0];
        this.pos[top] = -1;
        const bottom = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this.pos[bottom] = 0;
            this.down(0);
        }
        return top;
    }

    private up(i: number) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.keys[this.heap[p]] <= this.keys[this.heap[i]]) break;
            this.swap(p, i);
            i = p;
        }
    }

    private down(i: number) {
        const len = this.heap.length;
        while ((i << 1) + 1 < len) {
            const left = (i << 1) + 1;
            const right = left + 1;
            let best = i;
            if (this.keys[this.heap[left]] < this.keys[this.heap[best]]) best = left;
            if (right < len && this.keys[this.heap[right]] < this.keys[this.heap[best]]) best = right;
            if (best === i) break;
            this.swap(i, best);
            i = best;
        }
    }

    private swap(i: number, j: number) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
        this.pos[this.heap[i]] = i;
        this.pos[this.heap[j]] = j;
    }

    size() {
        return this.heap.length;
    }
}
