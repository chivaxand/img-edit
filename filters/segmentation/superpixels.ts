import { Filters } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('superpixels', {
    name: 'Superpixels (Segmentation)',
    mode: 'pixel',
    menu: {
        path: 'Filter/Segmentation',
        label: 'Superpixels...',
        order: 3
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            algorithm: 'slic',
            size: 30,
            compactness: 20,
            iterations: 5,
            fillMode: 'average',
            showBorders: true,
            borderColor: '#000000'
        };

        const update = () => hooks.preview(state);

        const algoSelect = UI.createSelectRow({
            label: 'Algorithm',
            options: [
                { value: 'slic', text: 'SLIC (Adaptive K-Means)' },
                { value: 'felzenszwalb', text: 'Felzenszwalb (Graph-Based)' },
                { value: 'seeds', text: 'SEEDS (Energy-Driven Sampling)' }
            ],
            value: state.algorithm,
            onChange: v => {
                state.algorithm = v;
                updateControls();
                update();
            }
        });

        const sizeSlider = UI.createSliderRow({
            label: 'Region Size (px)', min: 5, max: 150, step: 1, value: state.size,
            onInput: v => { state.size = parseInt(v); update(); }
        });

        const compactnessSlider = UI.createSliderRow({
            label: 'Compactness / k', min: 1, max: 300, step: 1, value: state.compactness,
            onInput: v => { state.compactness = parseInt(v); update(); }
        });

        const iterationsSlider = UI.createSliderRow({
            label: 'Iterations', min: 1, max: 15, step: 1, value: state.iterations,
            onInput: v => { state.iterations = parseInt(v); update(); }
        });

        const fillSelect = UI.createSelectRow({
            label: 'Style',
            options: [
                { value: 'average', text: 'Mean Color (Solid)' },
                { value: 'original', text: 'Original Colors' }
            ],
            value: state.fillMode,
            onChange: v => { state.fillMode = v; update(); }
        });

        const borderCheckbox = UI.createCheckbox({
            label: 'Show Borders', value: state.showBorders,
            onChange: v => {
                state.showBorders = v;
                updateControls();
                update();
            }
        });

        const colorRow = UI.createColorRow({
            label: 'Border Color', value: state.borderColor,
            onChange: v => { state.borderColor = v; update(); }
        });

        const hintLabel = UI.createHint('SLIC creates adaptive, uniform superpixels based on color similarity.');

        const updateControls = () => {
            UI.toggle(compactnessSlider, state.algorithm === 'slic' || state.algorithm === 'felzenszwalb' || state.algorithm === 'seeds', 'flex');
            UI.toggle(iterationsSlider, state.algorithm === 'slic' || state.algorithm === 'seeds', 'flex');
            UI.toggle(colorRow, state.showBorders, 'flex');

            if (state.algorithm === 'slic') {
                hintLabel.textContent = 'SLIC creates regular, boundary-conforming segments via localized spatial-color K-Means clustering.';
            } else if (state.algorithm === 'felzenszwalb') {
                hintLabel.textContent = 'Felzenszwalb forms organic segments based on MST edge-weights. Scale (k) adjusts merging threshold.';
            } else if (state.algorithm === 'seeds') {
                hintLabel.textContent = 'SEEDS refines a regular grid using hill-climbing on color histograms and neighborhood smoothness.';
            }
        };

        container.appendChild(algoSelect);
        container.appendChild(sizeSlider);
        container.appendChild(compactnessSlider);
        container.appendChild(iterationsSlider);
        container.appendChild(fillSelect);
        container.appendChild(borderCheckbox);
        container.appendChild(colorRow);
        container.appendChild(hintLabel);

        updateControls();
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { algorithm, size, compactness, iterations, fillMode, showBorders, borderColor }: any) {
        const S = size;
        const numPixels = w * h;

        if (algorithm === 'slic') {
            interface Center {
                x: number;
                y: number;
                r: number; // L* channel
                g: number; // a* channel
                b: number; // b* channel
            }
            const centers: Center[] = [];

            // Convert image to CIELAB for perceptually uniform segmentation
            const labData = convertRgbToLab(data, w, h);

            // Initialize cluster centers on regular grid
            for (let y = S / 2; y < h; y += S) {
                for (let x = S / 2; x < w; x += S) {
                    const ix = Math.min(w - 1, Math.floor(x));
                    const iy = Math.min(h - 1, Math.floor(y));
                    const labIdx = (iy * w + ix) * 3;
                    centers.push({
                        x: x,
                        y: y,
                        r: labData[labIdx],
                        g: labData[labIdx + 1],
                        b: labData[labIdx + 2]
                    });
                }
            }

            // Move centers to position of lowest gradient in 3x3 neighborhood
            const getGradient = (px: number, py: number) => {
                if (px <= 0 || px >= w - 1 || py <= 0 || py >= h - 1) return 1e9;
                const idx = (py * w + px) * 4;
                const idxR = idx + 4;
                const idxD = idx + w * 4;
                const gx = Math.abs(data[idxR] - data[idx]) + Math.abs(data[idxR + 1] - data[idx + 1]) + Math.abs(data[idxR + 2] - data[idx + 2]);
                const gy = Math.abs(data[idxD] - data[idx]) + Math.abs(data[idxD + 1] - data[idx + 1]) + Math.abs(data[idxD + 2] - data[idx + 2]);
                return gx + gy;
            };

            for (let i = 0; i < centers.length; i++) {
                const c = centers[i];
                let minGrad = getGradient(Math.floor(c.x), Math.floor(c.y));
                let bestX = c.x;
                let bestY = c.y;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = Math.floor(c.x + dx);
                        const ny = Math.floor(c.y + dy);
                        const g = getGradient(nx, ny);
                        if (g < minGrad) {
                            minGrad = g;
                            bestX = nx;
                            bestY = ny;
                        }
                    }
                }
                c.x = bestX;
                c.y = bestY;
                const labIdx = (Math.floor(bestY) * w + Math.floor(bestX)) * 3;
                c.r = labData[labIdx];
                c.g = labData[labIdx + 1];
                c.b = labData[labIdx + 2];
            }

            const label = new Int32Array(numPixels).fill(-1);
            const dist = new Float32Array(numPixels).fill(1e10);

            const m2 = compactness * compactness;
            const S2 = S * S;

            // Iterative K-Means spatial-color clustering
            for (let iter = 0; iter < iterations; iter++) {
                dist.fill(1e10);
                label.fill(-1);

                for (let i = 0; i < centers.length; i++) {
                    const c = centers[i];
                    const rStart = Math.max(0, Math.floor(c.y - S));
                    const rEnd = Math.min(h - 1, Math.floor(c.y + S));
                    const cStart = Math.max(0, Math.floor(c.x - S));
                    const cEnd = Math.min(w - 1, Math.floor(c.x + S));

                    for (let py = rStart; py <= rEnd; py++) {
                        const rowOffset = py * w;
                        for (let px = cStart; px <= cEnd; px++) {
                            const idx = rowOffset + px;
                            const labIdx = idx * 3;
                            const pr = labData[labIdx];
                            const pg = labData[labIdx + 1];
                            const pb = labData[labIdx + 2];

                            const dc2 = (pr - c.r) ** 2 + (pg - c.g) ** 2 + (pb - c.b) ** 2;
                            const ds2 = (px - c.x) ** 2 + (py - c.y) ** 2;
                            const d2 = dc2 + (ds2 / S2) * m2;

                            if (d2 < dist[idx]) {
                                dist[idx] = d2;
                                label[idx] = i;
                            }
                        }
                    }
                }

                // Recalculate coordinates and color averages
                const sumX = new Float32Array(centers.length);
                const sumY = new Float32Array(centers.length);
                const sumR = new Float32Array(centers.length);
                const sumG = new Float32Array(centers.length);
                const sumB = new Float32Array(centers.length);
                const count = new Int32Array(centers.length);

                for (let idx = 0; idx < numPixels; idx++) {
                    const lbl = label[idx];
                    if (lbl >= 0) {
                        sumX[lbl] += idx % w;
                        sumY[lbl] += Math.floor(idx / w);
                        const labIdx = idx * 3;
                        sumR[lbl] += labData[labIdx];
                        sumG[lbl] += labData[labIdx + 1];
                        sumB[lbl] += labData[labIdx + 2];
                        count[lbl]++;
                    }
                }

                for (let i = 0; i < centers.length; i++) {
                    const cnt = count[i];
                    if (cnt > 0) {
                        centers[i].x = sumX[i] / cnt;
                        centers[i].y = sumY[i] / cnt;
                        centers[i].r = sumR[i] / cnt;
                        centers[i].g = sumG[i] / cnt;
                        centers[i].b = sumB[i] / cnt;
                    }
                }
            }

            // Assign remaining labels to prevent gaps
            for (let idx = 0; idx < numPixels; idx++) {
                if (label[idx] === -1) {
                    const px = idx % w;
                    const py = Math.floor(idx / w);
                    let minDist = 1e10;
                    let bestLbl = 0;
                    for (let i = 0; i < centers.length; i++) {
                        const c = centers[i];
                        const d2 = (px - c.x) ** 2 + (py - c.y) ** 2;
                        if (d2 < minDist) {
                            minDist = d2;
                            bestLbl = i;
                        }
                    }
                    label[idx] = bestLbl;
                }
            }

            this.renderSegmentation(data, w, h, label, centers.length, fillMode, showBorders, borderColor);
        }
        else if (algorithm === 'felzenszwalb') {
            const numEdges = (w - 1) * h + w * (h - 1);
            const edgeSrc = new Int32Array(numEdges);
            const edgeDst = new Int32Array(numEdges);
            const edgeWeight = new Float32Array(numEdges);

            // Pre-smooth components horizontally and vertically to suppress micro-gradients
            const smoothed = gaussianSmooth(data, w, h, 0.8);

            let edgeIdx = 0;
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = rowOffset + x;
                    const r1 = smoothed[idx * 3];
                    const g1 = smoothed[idx * 3 + 1];
                    const b1 = smoothed[idx * 3 + 2];

                    if (x < w - 1) {
                        const idxR = idx + 1;
                        const r2 = smoothed[idxR * 3];
                        const g2 = smoothed[idxR * 3 + 1];
                        const b2 = smoothed[idxR * 3 + 2];
                        const wVal = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
                        edgeSrc[edgeIdx] = idx;
                        edgeDst[edgeIdx] = idxR;
                        edgeWeight[edgeIdx] = wVal;
                        edgeIdx++;
                    }
                    if (y < h - 1) {
                        const idxD = idx + w;
                        const r2 = smoothed[idxD * 3];
                        const g2 = smoothed[idxD * 3 + 1];
                        const b2 = smoothed[idxD * 3 + 2];
                        const wVal = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
                        edgeSrc[edgeIdx] = idx;
                        edgeDst[edgeIdx] = idxD;
                        edgeWeight[edgeIdx] = wVal;
                        edgeIdx++;
                    }
                }
            }

            // Perform O(N) bucket sort on edge weights
            const numBuckets = 5000;
            const bucketCount = new Int32Array(numBuckets);
            for (let i = 0; i < numEdges; i++) {
                const bucket = Math.min(numBuckets - 1, Math.floor(edgeWeight[i] * 10));
                bucketCount[bucket]++;
            }

            const bucketOffset = new Int32Array(numBuckets);
            let sum = 0;
            for (let i = 0; i < numBuckets; i++) {
                bucketOffset[i] = sum;
                sum += bucketCount[i];
            }

            const sortedIndices = new Int32Array(numEdges);
            for (let i = 0; i < numEdges; i++) {
                const bucket = Math.min(numBuckets - 1, Math.floor(edgeWeight[i] * 10));
                const pos = bucketOffset[bucket];
                sortedIndices[pos] = i;
                bucketOffset[bucket]++;
            }

            // Setup Disjoint Set Union-Find structure
            const parent = new Int32Array(numPixels);
            const componentSize = new Int32Array(numPixels);
            const maxWeight = new Float32Array(numPixels);

            for (let i = 0; i < numPixels; i++) {
                parent[i] = i;
                componentSize[i] = 1;
                maxWeight[i] = 0;
            }

            const find = (i: number): number => {
                let root = i;
                while (root !== parent[root]) {
                    root = parent[root];
                }
                let curr = i;
                while (curr !== root) {
                    const next = parent[curr];
                    parent[curr] = root;
                    curr = next;
                }
                return root;
            };

            const union = (u: number, v: number, weight: number) => {
                parent[v] = u;
                componentSize[u] += componentSize[v];
                maxWeight[u] = Math.max(Math.max(maxWeight[u], maxWeight[v]), weight);
            };

            // Main Felzenszwalb MST clustering pass
            for (let i = 0; i < numEdges; i++) {
                const edgeIdx = sortedIndices[i];
                const u = edgeSrc[edgeIdx];
                const v = edgeDst[edgeIdx];
                const weight = edgeWeight[edgeIdx];

                const rootU = find(u);
                const rootV = find(v);

                if (rootU !== rootV) {
                    const thresholdU = maxWeight[rootU] + compactness / componentSize[rootU];
                    const thresholdV = maxWeight[rootV] + compactness / componentSize[rootV];
                    const minThreshold = Math.min(thresholdU, thresholdV);

                    if (weight <= minThreshold) {
                        union(rootU, rootV, weight);
                    }
                }
            }

            // Post-processing merge of segments smaller than threshold size
            const minSize = Math.floor((size * size) / 3);
            for (let i = 0; i < numEdges; i++) {
                const edgeIdx = sortedIndices[i];
                const u = edgeSrc[edgeIdx];
                const v = edgeDst[edgeIdx];

                const rootU = find(u);
                const rootV = find(v);

                if (rootU !== rootV) {
                    if (componentSize[rootU] < minSize || componentSize[rootV] < minSize) {
                        union(rootU, rootV, edgeWeight[edgeIdx]);
                    }
                }
            }

            // Reassign and map consecutive labels
            const labels = new Int32Array(numPixels).fill(-1);
            let labelCount = 0;
            for (let i = 0; i < numPixels; i++) {
                const root = find(i);
                if (labels[root] === -1) {
                    labels[root] = labelCount++;
                }
            }

            const finalLabels = new Int32Array(numPixels);
            for (let i = 0; i < numPixels; i++) {
                finalLabels[i] = labels[find(i)];
            }

            this.renderSegmentation(data, w, h, finalLabels, labelCount, fillMode, showBorders, borderColor);
        }
        else if (algorithm === 'seeds') {
            const S_val = Math.max(2, S);
            const gridW = Math.ceil(w / S_val);
            const gridH = Math.ceil(h / S_val);
            const numClusters = gridW * gridH;

            // Convert image to CIELAB for perceptually accurate histogram tracking
            const labData = convertRgbToLab(data, w, h);

            const labels = new Int32Array(numPixels);
            const sizes = new Int32Array(numClusters);
            
            const numBins = 64;
            const hists = new Int32Array(numClusters * numBins);

            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                const gy = Math.min(gridH - 1, Math.floor(y / S_val));
                for (let x = 0; x < w; x++) {
                    const gx = Math.min(gridW - 1, Math.floor(x / S_val));
                    const idx = rowOffset + x;
                    const lbl = gy * gridW + gx;
                    labels[idx] = lbl;
                    sizes[lbl]++;

                    const pidx = idx * 3;
                    const L = labData[pidx];
                    const a = labData[pidx + 1];
                    const b = labData[pidx + 2];

                    const bL = Math.min(3, Math.max(0, Math.floor(L / 25)));
                    const ba = Math.min(3, Math.max(0, Math.floor((a + 128) / 64)));
                    const bb = Math.min(3, Math.max(0, Math.floor((b + 128) / 64)));
                    const bin = bL * 16 + ba * 4 + bb;

                    hists[lbl * numBins + bin]++;
                }
            }

            const beta = compactness / 50;
            const dx = [-1, 1, 0, 0];
            const dy = [0, 0, -1, 1];

            const nx8 = [-1, 0, 1, -1, 1, -1, 0, 1];
            const ny8 = [-1, -1, -1, 0, 0, 1, 1, 1];

            // Perform hill-climbing iterations on discrete CIELAB histogram intersection
            for (let iter = 0; iter < iterations; iter++) {
                for (let y = 1; y < h - 1; y++) {
                    const rowOffset = y * w;
                    for (let x = 1; x < w - 1; x++) {
                        const idx = rowOffset + x;
                        const S_j = labels[idx];
                        let S_k = -1;
                        for (let dir = 0; dir < 4; dir++) {
                            const nlbl = labels[(y + dy[dir]) * w + (x + dx[dir])];
                            if (nlbl !== S_j) {
                                S_k = nlbl;
                                break;
                            }
                        }

                        if (S_k >= 0 && sizes[S_j] > 1) {
                            const pidx = idx * 3;
                            const L = labData[pidx];
                            const a = labData[pidx + 1];
                            const b = labData[pidx + 2];

                            const bL = Math.min(3, Math.max(0, Math.floor(L / 25)));
                            const ba = Math.min(3, Math.max(0, Math.floor((a + 128) / 64)));
                            const bb = Math.min(3, Math.max(0, Math.floor((b + 128) / 64)));
                            const bin = bL * 16 + ba * 4 + bb;

                            let n_j = 0;
                            let n_k = 0;
                            for (let dir8 = 0; dir8 < 8; dir8++) {
                                const nlbl = labels[(y + ny8[dir8]) * w + (x + nx8[dir8])];
                                if (nlbl === S_j) n_j++;
                                else if (nlbl === S_k) n_k++;
                            }

                            const probJ = hists[S_j * numBins + bin] / sizes[S_j];
                            const probK = hists[S_k * numBins + bin] / sizes[S_k];

                            const scoreJ = probJ * (1.0 + beta * n_j);
                            const scoreK = probK * (1.0 + beta * n_k);

                            if (scoreK > scoreJ) {
                                labels[idx] = S_k;
                                sizes[S_j]--;
                                sizes[S_k]++;
                                hists[S_j * numBins + bin]--;
                                hists[S_k * numBins + bin]++;
                            }
                        }
                    }
                }
            }

            const minComponentSize = Math.max(1, Math.floor((S_val * S_val) / 4));
            const finalLabels = this.enforceConnectivity(labels, w, h, numClusters, minComponentSize);

            const labelMap = new Int32Array(numPixels).fill(-1);
            let actualClusters = 0;
            for (let idx = 0; idx < numPixels; idx++) {
                const oldLbl = finalLabels[idx];
                if (labelMap[oldLbl] === -1) {
                    labelMap[oldLbl] = actualClusters++;
                }
                finalLabels[idx] = labelMap[oldLbl];
            }

            this.renderSegmentation(data, w, h, finalLabels, actualClusters, fillMode, showBorders, borderColor);
        }
    },

    renderSegmentation(
        data: Uint8ClampedArray,
        w: number,
        h: number,
        label: Int32Array,
        numClusters: number,
        fillMode: string,
        showBorders: boolean,
        borderColor: string
    ) {
        const numPixels = w * h;
        const avgR = new Float32Array(numClusters);
        const avgG = new Float32Array(numClusters);
        const avgB = new Float32Array(numClusters);
        const avgA = new Float32Array(numClusters);
        const count = new Int32Array(numClusters);

        // Accumulate segment channel colors
        for (let idx = 0; idx < numPixels; idx++) {
            const lbl = label[idx];
            if (lbl >= 0 && lbl < numClusters) {
                const pidx = idx * 4;
                avgR[lbl] += data[pidx];
                avgG[lbl] += data[pidx + 1];
                avgB[lbl] += data[pidx + 2];
                avgA[lbl] += data[pidx + 3];
                count[lbl]++;
            }
        }

        for (let i = 0; i < numClusters; i++) {
            const cnt = count[i];
            if (cnt > 0) {
                avgR[i] /= cnt;
                avgG[i] /= cnt;
                avgB[i] /= cnt;
                avgA[i] /= cnt;
            }
        }

        // Apply average colors if solid fill style is chosen
        if (fillMode === 'average') {
            for (let idx = 0; idx < numPixels; idx++) {
                const lbl = label[idx];
                if (lbl >= 0 && lbl < numClusters) {
                    const pidx = idx * 4;
                    data[pidx]     = avgR[lbl];
                    data[pidx + 1] = avgG[lbl];
                    data[pidx + 2] = avgB[lbl];
                    data[pidx + 3] = avgA[lbl];
                }
            }
        }

        // Trace and draw boundary segments
        if (showBorders) {
            let br = 0, bg = 0, bb = 0;
            if (borderColor.startsWith('#')) {
                br = parseInt(borderColor.slice(1, 3), 16) || 0;
                bg = parseInt(borderColor.slice(3, 5), 16) || 0;
                bb = parseInt(borderColor.slice(5, 7), 16) || 0;
            }

            const isBoundary = new Uint8Array(numPixels);

            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = rowOffset + x;
                    const lbl = label[idx];

                    if (x < w - 1) {
                        if (label[idx + 1] !== lbl) {
                            isBoundary[idx] = 1;
                            isBoundary[idx + 1] = 1;
                        }
                    }
                    if (y < h - 1) {
                        if (label[idx + w] !== lbl) {
                            isBoundary[idx] = 1;
                            isBoundary[idx + w] = 1;
                        }
                    }
                }
            }

            for (let idx = 0; idx < numPixels; idx++) {
                if (isBoundary[idx]) {
                    const pidx = idx * 4;
                    data[pidx]     = br;
                    data[pidx + 1] = bg;
                    data[pidx + 2] = bb;
                    data[pidx + 3] = 255;
                }
            }
        }
    },

    enforceConnectivity(labels: Int32Array, w: number, h: number, numSuperpixels: number, minSize: number): Int32Array {
        const numPixels = w * h;
        const finalLabels = new Int32Array(numPixels).fill(-1);
        const queue = new Int32Array(numPixels);
        let nextNewLabel = 0;
        
        const dx = [-1, 1, 0, 0];
        const dy = [0, 0, -1, 1];
        
        for (let idx = 0; idx < numPixels; idx++) {
            if (finalLabels[idx] >= 0) continue;
            
            const targetLabel = labels[idx];
            let head = 0;
            let tail = 0;
            queue[tail++] = idx;
            finalLabels[idx] = -2; // Temporary marker
            
            while (head < tail) {
                const curr = queue[head++];
                const cx = curr % w;
                const cy = Math.floor(curr / w);
                
                for (let dir = 0; dir < 4; dir++) {
                    const nx = cx + dx[dir];
                    const ny = cy + dy[dir];
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nidx = ny * w + nx;
                        if (labels[nidx] === targetLabel && finalLabels[nidx] === -1) {
                            finalLabels[nidx] = -2;
                            queue[tail++] = nidx;
                        }
                    }
                }
            }
            
            const compSize = tail;
            let resolvedLabel = -1;
            
            if (compSize >= minSize) {
                resolvedLabel = nextNewLabel++;
            } else {
                // Find adjacent labeled neighbor
                for (let i = 0; i < compSize; i++) {
                    const p = queue[i];
                    const px = p % w;
                    const py = Math.floor(p / w);
                    
                    for (let dir = 0; dir < 4; dir++) {
                        const nx = px + dx[dir];
                        const ny = py + dy[dir];
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            const nidx = ny * w + nx;
                            const nl = finalLabels[nidx];
                            if (nl >= 0) {
                                resolvedLabel = nl;
                                break;
                            }
                        }
                    }
                    if (resolvedLabel >= 0) break;
                }
                
                if (resolvedLabel === -1) {
                    resolvedLabel = nextNewLabel++;
                }
            }
            
            for (let i = 0; i < compSize; i++) {
                finalLabels[queue[i]] = resolvedLabel;
            }
        }
        
        return finalLabels;
    }
});

/**
 * Separable O(N) Gaussian smoothing to remove high-frequency digital noise and digitization artifacts.
 * Essential for graph-based segmentation algorithms to behave correctly on smooth gradients or solid colors.
 */
function gaussianSmooth(data: Uint8ClampedArray, w: number, h: number, sigma: number): Float32Array {
    const size = w * h;
    const r = new Float32Array(size);
    const g = new Float32Array(size);
    const b = new Float32Array(size);

    for (let i = 0; i < size; i++) {
        r[i] = data[i * 4];
        g[i] = data[i * 4 + 1];
        b[i] = data[i * 4 + 2];
    }

    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
        const val = Math.exp(-(i * i) / (2 * sigma * sigma));
        kernel[i + radius] = val;
        sum += val;
    }
    for (let i = 0; i < kernelSize; i++) {
        kernel[i] /= sum;
    }

    const convolveChannel = (src: Float32Array): Float32Array => {
        const temp = new Float32Array(size);
        const dst = new Float32Array(size);

        // Horizontal convolution pass
        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                let s = 0;
                let wSum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const nx = x + k;
                    if (nx >= 0 && nx < w) {
                        const kw = kernel[k + radius];
                        s += src[rowOffset + nx] * kw;
                        wSum += kw;
                    }
                }
                temp[rowOffset + x] = s / wSum;
            }
        }

        // Vertical convolution pass
        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                let s = 0;
                let wSum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const ny = y + k;
                    if (ny >= 0 && ny < h) {
                        const kw = kernel[k + radius];
                        s += temp[ny * w + x] * kw;
                        wSum += kw;
                    }
                }
                dst[rowOffset + x] = s / wSum;
            }
        }

        return dst;
    };

    const blurredR = convolveChannel(r);
    const blurredG = convolveChannel(g);
    const blurredB = convolveChannel(b);

    const result = new Float32Array(size * 3);
    for (let i = 0; i < size; i++) {
        result[i * 3]     = blurredR[i];
        result[i * 3 + 1] = blurredG[i];
        result[i * 3 + 2] = blurredB[i];
    }
    return result;
}

// Standard, robust sRGB-to-CIELAB color space transformation.
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
    let r_n = r / 255;
    let g_n = g / 255;
    let b_n = b / 255;

    r_n = r_n > 0.04045 ? Math.pow((r_n + 0.055) / 1.055, 2.4) : r_n / 12.92;
    g_n = g_n > 0.04045 ? Math.pow((g_n + 0.055) / 1.055, 2.4) : g_n / 12.92;
    b_n = b_n > 0.04045 ? Math.pow((b_n + 0.055) / 1.055, 2.4) : b_n / 12.92;

    const x = r_n * 0.4124564 + g_n * 0.3575761 + b_n * 0.1804375;
    const y = r_n * 0.2126729 + g_n * 0.7151522 + b_n * 0.0721750;
    const z = r_n * 0.0193339 + g_n * 0.1191920 + b_n * 0.9503041;

    const xr = x / 0.95047;
    const yr = y / 1.00000;
    const zr = z / 1.08883;

    const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;

    const fx = f(xr);
    const fy = f(yr);
    const fz = f(zr);

    const L = fy > 0.008856 ? 116 * fy - 16 : 903.3 * yr;
    const a = 500 * (fx - fy);
    const b_val = 200 * (fy - fz);

    return [L, a, b_val];
}

// Utility function to convert packed Uint8ClampedArray image to uniform CIELAB Float32Array
function convertRgbToLab(data: Uint8ClampedArray, w: number, h: number): Float32Array {
    const size = w * h;
    const lab = new Float32Array(size * 3);
    for (let i = 0; i < size; i++) {
        const idx = i * 4;
        const [L, a, b] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
        lab[i * 3]     = L;
        lab[i * 3 + 1] = a;
        lab[i * 3 + 2] = b;
    }
    return lab;
}