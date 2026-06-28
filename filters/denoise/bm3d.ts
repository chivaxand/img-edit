import { Filters } from '../../filters';
import { UI } from '../../ui';
import { Layer } from '../../layers';
import { Lib } from '../../libs/index';

Filters.register('bm3d', {
    name: 'BM3D Denoising',
    mode: 'pixel',
    menu: {
        path: 'Filter/Denoise',
        label: 'BM3D (very slow)...',
        order: 4
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            sigma: 10.0,
            step: 6,        // Sliding step (speed optimization)
            searchWin: 8    // Search window size
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'State-of-the-art classic algorithm. Warning: Computationally intensive. Increase "Step Delta" for speed.'));

        container.appendChild(UI.createSliderRow({
            label: 'Sigma', min: 1, max: 100, step: 1, value: state.sigma,
            onChange: (v: string) => { state.sigma = parseFloat(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Step Delta', min: 1, max: 8, step: 1, value: state.step,
            onChange: (v: string) => { state.step = parseInt(v); update(); }
        }));

        container.appendChild(UI.createSliderRow({
            label: 'Search Window', min: 4, max: 32, step: 2, value: state.searchWin,
            onChange: (v: string) => { state.searchWin = parseInt(v); update(); }
        }));

        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, { sigma, step, searchWin }: any) {
        // Constants
        const patchSize = 8;
        const nHard = 16;
        const nWien = 32;
        
        // Precompute math tables (DCT, Hadamard, Kaiser)
        const math = this.initMath(patchSize, nHard, nWien);

        // Process each channel independently
        [0, 1, 2].forEach(ch => {
            // Extract returns Float32Array (0-255)
            const channelData = Lib.image.extractChannel(data, w, h, ch);
            
            // 1. Hard Thresholding
            const basicEstimate = this.runStage(
                channelData, w, h, sigma, 
                patchSize, step, searchWin, nHard, 
                math, 'hard'
            );

            // 2. Wiener Filtering
            const finalEstimate = this.runStage(
                channelData, w, h, sigma, 
                patchSize, step, searchWin, nWien, 
                math, 'wiener', basicEstimate
            );

            // Write back (Clamp 0-255)
            for (let i = 0; i < w * h; i++) {
                let val = finalEstimate[i];
                val = val < 0 ? 0 : (val > 255 ? 255 : val);
                data[i * 4 + ch] = val;
            }
        });
    },

    // --- Core Pipeline ---

    runStage(imgData: Float32Array, w: number, h: number, sigma: number, patchSize: number, step: number, searchWin: number, nGroup: number, math: any, mode: 'hard' | 'wiener', basicImgData: Float32Array | null = null): Float32Array {
        const pad = searchWin; 
        const pW = w + 2 * pad;
        const pH = h + 2 * pad;

        // Prepare Flat Padded Images
        const paddedRows = Lib.image.padTo2D(imgData, w, h, pW, pH, 'symmetric'); // Array<Float32Array>
        const paddedImg = new Float32Array(pW * pH);
        for(let y=0; y<pH; y++) paddedImg.set(paddedRows[y], y * pW);
        
        let paddedBasic: Float32Array | null = null;
        if (mode === 'wiener' && basicImgData) {
            const basicRows = Lib.image.padTo2D(basicImgData, w, h, pW, pH, 'symmetric');
            paddedBasic = new Float32Array(pW * pH);
            for(let y=0; y<pH; y++) paddedBasic.set(basicRows[y], y * pW);
        }

        // Buffers for aggregation
        const numerator = new Float32Array(pW * pH);
        const denominator = new Float32Array(pW * pH);

        // Reusable Loop Buffers (Reduce GC pressure)
        const groupStack = new Float32Array(nGroup * patchSize * patchSize);
        const basicStack = (mode === 'wiener') ? new Float32Array(nGroup * patchSize * patchSize) : null;
        const tempDCT = new Float32Array(patchSize * patchSize);
        const tempHad = new Float32Array(nGroup);
        
        // Search & Threshold parameters
        const rMax = pH - patchSize;
        const cMax = pW - patchSize;
        const lambdaHard = 2.7 * sigma;
        const thresh = lambdaHard * Math.sqrt(nGroup);
        const sigma2 = sigma * sigma;

        // Reusable match candidates
        const maxCandidates = (2 * searchWin + 1) ** 2;
        const candDist = new Float32Array(maxCandidates);
        const candY = new Int32Array(maxCandidates);
        const candX = new Int32Array(maxCandidates);
        const candIndices = new Int32Array(maxCandidates);

        // Main Block Matching Loop
        for (let r = 0; r <= rMax; r += step) {
            for (let c = 0; c <= cMax; c += step) {

                // 1. Block Matching
                // Hard mode: match on noisy image. Wiener mode: match on basic estimate.
                const matchImg = (mode === 'wiener' && paddedBasic) ? paddedBasic : paddedImg;
                
                // Populates candIndices with sorted best matches
                const count = this.blockMatching(
                    matchImg, pW, pH, r, c, patchSize, searchWin, nGroup,
                    candDist, candY, candX, candIndices
                );
                
                // 2. Build 3D Groups
                // We always extract 'extractImg' (noisy) for the stack we want to estimate
                for (let k = 0; k < nGroup; k++) {
                    // If we found fewer matches than nGroup, reuse the last valid match (clamping)
                    // (Though normally we fill up with worst matches, here we just clamp index)
                    const validK = k < count ? k : count - 1;
                    const idx = candIndices[validK];
                    const y = candY[idx];
                    const x = candX[idx];
                    
                    this.copyPatch(paddedImg, pW, y, x, patchSize, groupStack, k);
                    if (mode === 'wiener' && paddedBasic && basicStack) {
                        this.copyPatch(paddedBasic, pW, y, x, patchSize, basicStack, k);
                    }
                }

                // 3. 3D Transform
                // A. 2D DCT on patches
                this.apply2DDCT(groupStack, nGroup, patchSize, math.dct, tempDCT);
                if (mode === 'wiener' && basicStack) this.apply2DDCT(basicStack, nGroup, patchSize, math.dct, tempDCT);

                // B. 1D Hadamard along temporal axis
                const hadMat = (mode === 'hard') ? math.hadHard : math.hadWien;
                this.applyHadamard(groupStack, nGroup, patchSize, hadMat, tempHad);
                if (mode === 'wiener' && basicStack) this.applyHadamard(basicStack, nGroup, patchSize, hadMat, tempHad);

                // 4. Filtering
                let weight = 1.0;

                if (mode === 'hard') {
                    // Hard Thresholding
                    let nonZero = 0;
                    for (let i = 0; i < groupStack.length; i++) {
                        if (Math.abs(groupStack[i]) < thresh) {
                            groupStack[i] = 0;
                        } else {
                            nonZero++;
                        }
                    }
                    weight = nonZero > 0 ? 1.0 / (sigma2 * nonZero + 1e-12) : 1.0;
                } else if (basicStack) {
                    // Wiener Filtering
                    let wNorm = 0;
                    for (let i = 0; i < groupStack.length; i++) {
                        const valBasic = basicStack[i];
                        const energy = valBasic * valBasic;
                        const factor = energy / (energy + sigma2 * nGroup + 1e-12);
                        groupStack[i] *= factor;
                        wNorm += factor * factor;
                    }
                    weight = wNorm > 0 ? 1.0 / (sigma2 * wNorm + 1e-12) : 1.0;
                }

                // 5. Inverse 3D Transform
                // A. Inverse Hadamard
                this.applyHadamard(groupStack, nGroup, patchSize, hadMat, tempHad);
                // Normalize Hadamard (inv = mat / N)
                const normScale = 1.0 / nGroup;
                for(let i=0; i<groupStack.length; i++) groupStack[i] *= normScale;

                // B. Inverse DCT
                this.apply2DIDCT(groupStack, nGroup, patchSize, math.idct, tempDCT);

                // 6. Aggregation
                for (let k = 0; k < nGroup; k++) {
                    const validK = k < count ? k : count - 1;
                    const idx = candIndices[validK];
                    const y = candY[idx];
                    const x = candX[idx];
                    this.accumulatePatch(numerator, denominator, pW, y, x, patchSize, groupStack, k, weight, math.kaiser);
                }
            }
        }

        // Final division and crop to original size
        const result = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            const py = y + pad;
            const rowOffset = py * pW;
            const resOffset = y * w;
            for (let x = 0; x < w; x++) {
                const px = x + pad;
                const pIdx = rowOffset + px;
                const div = denominator[pIdx] + 1e-12;
                result[resOffset + x] = numerator[pIdx] / div;
            }
        }

        return result;
    },

    // --- Helpers ---

    initMath(patchSize: number, nHard: number, nWien: number) {
        // DCT Matrix (Orthonormal)
        const dct = new Float32Array(patchSize * patchSize);
        const alpha0 = 1 / Math.sqrt(patchSize);
        const alphaK = Math.sqrt(2 / patchSize);

        for (let u = 0; u < patchSize; u++) {
            const alpha = u === 0 ? alpha0 : alphaK;
            for (let x = 0; x < patchSize; x++) {
                dct[u * patchSize + x] = alpha * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * patchSize));
            }
        }

        // Transpose for IDCT
        const idct = new Float32Array(patchSize * patchSize);
        for(let r=0; r<patchSize; r++) {
            for(let c=0; c<patchSize; c++) {
                idct[c * patchSize + r] = dct[r * patchSize + c];
            }
        }

        // Hadamard Matrix Generator
        const getHadamard = (n: number) => {
            if (n === 1) return new Float32Array([1]);
            let h = new Float32Array([1]);
            let currentN = 1;
            while (currentN < n) {
                const nextN = currentN * 2;
                const nextH = new Float32Array(nextN * nextN);
                for(let i=0; i<currentN; i++) {
                    for(let j=0; j<currentN; j++) {
                        const val = h[i*currentN + j];
                        nextH[i*nextN + j] = val;
                        nextH[i*nextN + (j+currentN)] = val;
                        nextH[(i+currentN)*nextN + j] = val;
                        nextH[(i+currentN)*nextN + (j+currentN)] = -val;
                    }
                }
                h = nextH;
                currentN = nextN;
            }
            return h;
        };

        // Kaiser Window (8x8 from 4x4 quadrant)
        const kQuad = [
            0.1924, 0.2989, 0.3846, 0.4325,
            0.2989, 0.4642, 0.5974, 0.6717,
            0.3846, 0.5974, 0.7688, 0.8644,
            0.4325, 0.6717, 0.8644, 0.9718
        ];
        const kaiser = new Float32Array(64);
        for(let r=0; r<8; r++) {
            for(let c=0; c<8; c++) {
                const qr = r < 4 ? r : 7 - r;
                const qc = c < 4 ? c : 7 - c;
                kaiser[r*8 + c] = kQuad[qr*4 + qc];
            }
        }

        return { dct, idct, hadHard: getHadamard(nHard), hadWien: getHadamard(nWien), kaiser };
    },

    blockMatching(img: Float32Array, w: number, h: number, refY: number, refX: number, patchSize: number, searchWin: number, nGroup: number, 
                  candDist: Float32Array, candY: Int32Array, candX: Int32Array, candIndices: Int32Array) {
        
        let count = 0;
        const minY = Math.max(0, refY - searchWin);
        const maxY = Math.min(h - patchSize, refY + searchWin);
        const minX = Math.max(0, refX - searchWin);
        const maxX = Math.min(w - patchSize, refX + searchWin);

        const refOffset = refY * w + refX;

        // Search Loop
        for (let y = minY; y <= maxY; y++) {
            const rowOffset = y * w;
            for (let x = minX; x <= maxX; x++) {
                let dist = 0;
                // Compute SSD for this patch
                for (let r = 0; r < patchSize; r++) {
                    const rOff = r * w;
                    const refOff = refOffset + rOff;
                    const rowOff = rowOffset + rOff;
                    for (let c = 0; c < patchSize; c++) {
                        const diff = img[rowOff + x + c] - img[refOff + c];
                        dist += diff * diff;
                    }
                }
                
                candDist[count] = dist;
                candY[count] = y;
                candX[count] = x;
                candIndices[count] = count;
                count++;
            }
        }

        // Sort indices based on distance
        const subarray = candIndices.subarray(0, count);
        subarray.sort((a, b) => candDist[a] - candDist[b]);
        
        return count;
    },

    copyPatch(srcImg: Float32Array, w: number, y: number, x: number, size: number, destBuffer: Float32Array, groupIdx: number) {
        const destOffset = groupIdx * size * size;
        const srcOffset = y * w + x;
        let ptr = 0;
        for (let r = 0; r < size; r++) {
            const rOff = r * w;
            for (let c = 0; c < size; c++) {
                destBuffer[destOffset + ptr++] = srcImg[srcOffset + rOff + c];
            }
        }
    },

    apply2DDCT(stack: Float32Array, nGroup: number, size: number, dctMat: Float32Array, temp: Float32Array) {
        const pSize = size * size;

        for (let k = 0; k < nGroup; k++) {
            const offset = k * pSize;
            
            // 1. Temp = DCT * Patch (Columns)
            for (let i = 0; i < size; i++) {
                for (let j = 0; j < size; j++) {
                    let sum = 0;
                    for (let p = 0; p < size; p++) {
                        sum += dctMat[i * size + p] * stack[offset + p * size + j];
                    }
                    temp[i * size + j] = sum;
                }
            }

            // 2. Result = Temp * DCT_Transpose
            for (let i = 0; i < size; i++) {
                for (let j = 0; j < size; j++) {
                    let sum = 0;
                    for (let p = 0; p < size; p++) {
                        sum += temp[i * size + p] * dctMat[j * size + p]; // Transpose access
                    }
                    stack[offset + i * size + j] = sum;
                }
            }
        }
    },

    apply2DIDCT(stack: Float32Array, nGroup: number, size: number, idctMat: Float32Array, temp: Float32Array) {
        // IDCT uses the same matrix multiplication logic, just with the Transposed DCT matrix (IDCT)
        // passed in as idctMat.
        this.apply2DDCT(stack, nGroup, size, idctMat, temp);
    },

    applyHadamard(stack: Float32Array, nGroup: number, size: number, hadMat: Float32Array, tempCol: Float32Array) {
        const pSize = size * size;

        // For every pixel in the patch (64 pixels)
        for (let i = 0; i < pSize; i++) {
            // Extract the temporal column across the group
            for (let k = 0; k < nGroup; k++) {
                tempCol[k] = stack[k * pSize + i];
            }
            
            // Matrix multiply: Res = H * Col
            for (let k = 0; k < nGroup; k++) {
                let sum = 0;
                for (let p = 0; p < nGroup; p++) {
                    sum += hadMat[k * nGroup + p] * tempCol[p];
                }
                stack[k * pSize + i] = sum;
            }
        }
    },

    accumulatePatch(numBuf: Float32Array, denBuf: Float32Array, w: number, y: number, x: number, size: number, stack: Float32Array, groupIdx: number, weight: number, kaiser: Float32Array) {
        const offset = groupIdx * size * size;
        const tIdxBase = y * w + x;
        
        let ptr = 0;
        for (let r = 0; r < size; r++) {
            const rowOff = r * w;
            for (let c = 0; c < size; c++) {
                const kVal = kaiser[ptr];
                const val = stack[offset + ptr];
                const wTotal = weight * kVal;
                
                const idx = tIdxBase + rowOff + c;
                numBuf[idx] += val * wTotal;
                denBuf[idx] += wTotal;
                
                ptr++;
            }
        }
    }
});