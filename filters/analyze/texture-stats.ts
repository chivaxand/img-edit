import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { plot, PaletteName } from '~/libs/plot';
import { linalg } from '~/libs/linalg';

Filters.register('texture-stats', {
    name: 'Texture Statistics',
    mode: 'pixel',
    menu: {
        path: 'Analyze',
        label: 'Texture Stats...',
        order: 3
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            method: 'stddev',       // 'mean', 'stddev', 'skewness', 'kurtosis', 'entropy', 'contrast', 'correlation', 'homogeneity'
            kernelSize: 5,          // 3..11
            stride: 1,              // 1..11
            palette: 'ironbow' as PaletteName,
            outputType: 'abs',      // '128shift', 'positive', 'negative', 'abs'
            directXConvention: false,
            useNormalVector: true,
            showAngle360: true
        };

        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint', style: 'white-space: pre-wrap;' }, 
            'Computes local statistical and spatial texture properties inside a sliding window.'
        ));

        let outputMappingRow: HTMLElement;
        let paletteRow: HTMLElement;
        let directXRow: HTMLElement;
        let useNormalRow: HTMLElement;
        let showAngle360Row: HTMLElement;

        // Method Selector
        container.appendChild(UI.createSelectRow({
            label: 'Method',
            options: [
                { value: 'mean', text: 'Mean Intensity' },
                { value: 'stddev', text: 'Standard Deviation' },
                { value: 'skewness', text: 'Skewness' },
                { value: 'kurtosis', text: 'Kurtosis' },
                { value: 'entropy', text: 'Shannon Entropy' },
                { value: 'contrast', text: 'GLCM Contrast' },
                { value: 'correlation', text: 'GLCM Correlation' },
                { value: 'homogeneity', text: 'GLCM Homogeneity' },
                { value: 'coherence', text: 'Structural Coherence' },
                { value: 'structure_tensor', text: 'Structure Tensor Flow' },
                { value: 'hessian_tensor', text: 'Hessian Structure Tensor' },
            ],
            value: state.method,
            onChange: (v: string) => {
                state.method = v;
                if (v === 'skewness' || v === 'kurtosis') {
                    state.outputType = '128shift';
                } else {
                    state.outputType = 'abs';
                }
                outputMappingRow!.querySelector('select')!.value = state.outputType;
                updateVisibility();
                update();
            }
        }));

        // Kernel Size Slider (3..11)
        container.appendChild(UI.createSliderRow({
            label: 'Kernel Size', min: 3, max: 11, step: 1, value: state.kernelSize,
            onInput: (v: string) => { state.kernelSize = parseInt(v); update(); }
        }));

        // Stride Slider (1..11)
        container.appendChild(UI.createSliderRow({
            label: 'Stride', min: 1, max: 11, step: 1, value: state.stride,
            onInput: (v: string) => { state.stride = parseInt(v); update(); }
        }));

        // Output Value Mapping
        outputMappingRow = UI.createSelectRow({
            label: 'Output Mapping',
            options: [
                { value: 'abs', text: 'Absolute Values (|X|)' },
                { value: '128shift', text: '128 Shift (Symmetric Zero)' },
                { value: 'positive', text: 'Only Positive Values (> 0)' },
                { value: 'negative', text: 'Only Negative Values (< 0)' }
            ],
            value: state.outputType,
            onChange: (v: string) => { state.outputType = v; update(); }
        });
        container.appendChild(outputMappingRow);

        // Palette Selection
        paletteRow = UI.createPaletteSelectRow({
            label: 'Color Palette', value: state.palette,
            onChange: (v: PaletteName) => { state.palette = v; update(); }
        });
        container.appendChild(paletteRow);

        // DirectX Convention (for Stroke Direction)
        directXRow = UI.createCheckbox({
            label: 'DirectX convention (+Y down)', value: state.directXConvention,
            onChange: (v: any) => { state.directXConvention = v; update(); }
        });
        container.appendChild(directXRow);

        // Normalized Normal Vector (for Stroke Direction)
        useNormalRow = UI.createCheckbox({
            label: 'Normalized vector', value: state.useNormalVector,
            onChange: (v: any) => { state.useNormalVector = v; update(); }
        });
        container.appendChild(useNormalRow);

        // Show Angle 360 (for Stroke Direction)
        showAngle360Row = UI.createCheckbox({
            label: 'Show angle 360', value: state.showAngle360,
            onChange: (v: any) => { state.showAngle360 = v; update(); }
        });
        container.appendChild(showAngle360Row);

        const updateVisibility = () => {
            const isStroke = state.method === 'structure_tensor' || state.method === 'hessian_tensor';
            outputMappingRow.style.display = isStroke ? 'none' : '';
            paletteRow.style.display = isStroke ? 'none' : '';
            directXRow.style.display = isStroke ? '' : 'none';
            useNormalRow.style.display = isStroke ? '' : 'none';
            showAngle360Row.style.display = isStroke ? '' : 'none';
        };

        updateVisibility();
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { method, kernelSize, stride, palette, outputType, directXConvention, useNormalVector, showAngle360 } = params;
        const K = kernelSize || 7;
        const S = stride || 1;
        const len = w * h;

        // Extract Grayscale Luminance for the entire image buffer (0 - 255)
        const luma = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const idx = i * 4;
            luma[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        }

        const channels = (method === 'structure_tensor' || method === 'hessian_tensor') ? 3 : 1;
        const rawValues = new Float32Array(len * channels);
        
        // Define sliding window offsets supporting both odd and even kernel dimensions
        const rLeft = Math.floor((K - 1) / 2);
        const rRight = K - 1 - rLeft;
        const winSize = K * K;
        const winPixels = new Float32Array(winSize);

        const glcmLevels = 8;
        const glcmBuffer = new Float32Array(glcmLevels * glcmLevels);
        const pGlcmBuffer = new Float32Array(glcmLevels * glcmLevels);

        // Process block-by-block based on the Stride parameter
        for (let y = 0; y < h; y += S) {
            for (let x = 0; x < w; x += S) {
                
                // Extract local window pixels with clamping at image borders
                let count = 0;
                for (let dy = -rLeft; dy <= rRight; dy++) {
                    const py = Math.min(h - 1, Math.max(0, y + dy));
                    const rowOffset = py * w;
                    for (let dx = -rLeft; dx <= rRight; dx++) {
                        const px = Math.min(w - 1, Math.max(0, x + dx));
                        winPixels[count++] = luma[rowOffset + px];
                    }
                }

                if (method === 'structure_tensor' || method === 'hessian_tensor') {
                    // Compute direction vector
                    const res = method === 'structure_tensor'
                        ? computeStrokeDir(winPixels, K, useNormalVector, showAngle360)
                        : computeSteerableHessian(winPixels, K, useNormalVector, showAngle360);
                    const yMax = Math.min(h, y + S);
                    const xMax = Math.min(w, x + S);
                    for (let sy = y; sy < yMax; sy++) {
                        const rowOff = sy * w;
                        for (let sx = x; sx < xMax; sx++) {
                            const idx = (rowOff + sx) * 3;
                            rawValues[idx] = res[0];
                            rawValues[idx + 1] = res[1];
                            rawValues[idx + 2] = res[2];
                        }
                    }
                } else {
                    // Compute metric for current window
                    const val = computeMetric(winPixels, winSize, K, method, glcmBuffer, pGlcmBuffer);

                    // Write the result across the stride block
                    const yMax = Math.min(h, y + S);
                    const xMax = Math.min(w, x + S);
                    for (let sy = y; sy < yMax; sy++) {
                        const rowOff = sy * w;
                        for (let sx = x; sx < xMax; sx++) {
                            rawValues[rowOff + sx] = val;
                        }
                    }
                }
            }
        }

        if (method === 'structure_tensor' || method === 'hessian_tensor') {
            for (let i = 0; i < len; i++) {
                const idx = i * 4;
                const rIdx = i * 3;
                const nx = rawValues[rIdx];
                const ny = rawValues[rIdx + 1] * (directXConvention ? -1 : 1);
                const nz = rawValues[rIdx + 2];
                const r = (nx + 1) * 127.5;
                const g = (ny + 1) * 127.5;
                const b = useNormalVector ? (nz + 1) * 127.5 : nz * 255;
                data[idx]     = r < 0 ? 0 : (r > 255 ? 255 : Math.round(r));
                data[idx + 1] = g < 0 ? 0 : (g > 255 ? 255 : Math.round(g));
                data[idx + 2] = b < 0 ? 0 : (b > 255 ? 255 : Math.round(b));
                data[idx + 3] = 255;
            }
            return;
        }

        // Apply selected Output Mapping to normalize calculated values into the [0, 1] range
        const mappedValues = new Float32Array(len);
        if (outputType === '128shift') {
            let maxAbs = 0;
            for (let i = 0; i < len; i++) {
                const absVal = Math.abs(rawValues[i]);
                if (absVal > maxAbs) maxAbs = absVal;
            }
            const scale = maxAbs > 1e-9 ? 0.5 / maxAbs : 0;
            for (let i = 0; i < len; i++) {
                mappedValues[i] = rawValues[i] * scale + 0.5;
            }
        } 
        else if (outputType === 'positive') {
            let maxVal = 0;
            for (let i = 0; i < len; i++) {
                const val = Math.max(0, rawValues[i]);
                mappedValues[i] = val;
                if (val > maxVal) maxVal = val;
            }
            const scale = maxVal > 1e-9 ? 1.0 / maxVal : 0;
            for (let i = 0; i < len; i++) {
                mappedValues[i] *= scale;
            }
        } 
        else if (outputType === 'negative') {
            let maxVal = 0;
            for (let i = 0; i < len; i++) {
                const val = Math.max(0, -rawValues[i]); // Invert negative to positive
                mappedValues[i] = val;
                if (val > maxVal) maxVal = val;
            }
            const scale = maxVal > 1e-9 ? 1.0 / maxVal : 0;
            for (let i = 0; i < len; i++) {
                mappedValues[i] *= scale;
            }
        } 
        else { // 'abs'
            let maxVal = 0;
            for (let i = 0; i < len; i++) {
                const val = Math.abs(rawValues[i]);
                mappedValues[i] = val;
                if (val > maxVal) maxVal = val;
            }
            const scale = maxVal > 1e-9 ? 1.0 / maxVal : 0;
            for (let i = 0; i < len; i++) {
                mappedValues[i] *= scale;
            }
        }

        // Render mapped values back using colormap palette
        const targetPalette = palette as PaletteName;
        for (let i = 0; i < len; i++) {
            const normVal = mappedValues[i];
            const rgb = plot.getColor(normVal, targetPalette);
            const idx = i * 4;
            data[idx]     = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = 255;
        }
    }
});


function computeMetric(
    win: Float32Array, 
    N: number, 
    K: number, 
    method: string,
    glcmBuffer: Float32Array,   // Reusable flat buffer (size 64) to avoid GC thrashing
    pGlcmBuffer: Float32Array   // Reusable flat buffer (size 64) to avoid GC thrashing
): number {
    // Compute base statistical attributes
    let sum = 0;
    for (let i = 0; i < N; i++) sum += win[i];
    const mean = sum / N;

    if (method === 'mean') return mean;

    let varSum = 0;
    for (let i = 0; i < N; i++) {
        varSum += Math.pow(win[i] - mean, 2);
    }
    const stdDev = Math.sqrt(varSum / N);

    if (method === 'stddev') return stdDev;

    if (method === 'skewness') {
        if (stdDev < 1e-9) return 0;
        let skewSum = 0;
        for (let i = 0; i < N; i++) {
            skewSum += Math.pow(win[i] - mean, 3);
        }
        return skewSum / (N * Math.pow(stdDev, 3));
    }

    if (method === 'kurtosis') {
        if (stdDev < 1e-9) return 0;
        let kurtSum = 0;
        for (let i = 0; i < N; i++) {
            kurtSum += Math.pow(win[i] - mean, 4);
        }
        return (kurtSum / (N * Math.pow(stdDev, 4))) - 3;
    }

    if (method === 'entropy') {
        // Shannon Entropy with 16 quantization levels
        const bins = 16;
        const hist = new Uint32Array(bins); // Fast, non-allocating typed array
        for (let i = 0; i < N; i++) {
            const b = Math.min(bins - 1, Math.max(0, Math.floor((win[i] / 256) * bins)));
            hist[b]++;
        }
        let entropy = 0;
        for (let i = 0; i < bins; i++) {
            if (hist[i] > 0) {
                const p = hist[i] / N;
                entropy -= p * Math.log2(p);
            }
        }
        return entropy;
    }

    if (method === 'coherence') {
        let jxx = 0;
        let jyy = 0;
        let jxy = 0;
        for (let r = 0; r < K; r++) {
            const rowOff = r * K;
            for (let c = 0; c < K; c++) {
                const rightIdx = rowOff + Math.min(K - 1, c + 1);
                const leftIdx = rowOff + Math.max(0, c - 1);
                const botIdx = Math.min(K - 1, r + 1) * K + c;
                const topIdx = Math.max(0, r - 1) * K + c;
                const ix = (win[rightIdx] - win[leftIdx]) / 2;
                const iy = (win[botIdx] - win[topIdx]) / 2;
                jxx += ix * ix;
                jyy += iy * iy;
                jxy += ix * iy;
            }
        }
        const denom = Math.pow(jxx + jyy, 2);
        if (denom < 1e-9) return 0;
        return (Math.pow(jxx - jyy, 2) + 4 * jxy * jxy) / denom;
    }
    // --- Gray-Level Co-occurrence Matrix (GLCM) ---
    const glcmLevels = 8;
    
    // Clear reusable flat buffers instead of allocating new arrays
    glcmBuffer.fill(0);
    pGlcmBuffer.fill(0);
    
    let pairCount = 0;

    for (let r = 0; r < K; r++) {
        const rowOff = r * K;
        for (let c = 0; c < K - 1; c++) {
            const val1 = win[rowOff + c];
            const val2 = win[rowOff + c + 1];
            const i = Math.min(glcmLevels - 1, Math.max(0, Math.floor((val1 / 256) * glcmLevels)));
            const j = Math.min(glcmLevels - 1, Math.max(0, Math.floor((val2 / 256) * glcmLevels)));
            glcmBuffer[i * glcmLevels + j]++;
            pairCount++;
        }
    }

    // Normalize matrix to form probability densities
    if (pairCount > 0) {
        for (let idx = 0; idx < 64; idx++) {
            pGlcmBuffer[idx] = glcmBuffer[idx] / pairCount;
        }
    }

    if (method === 'contrast') {
        let contrast = 0;
        for (let i = 0; i < glcmLevels; i++) {
            const rowOff = i * glcmLevels;
            for (let j = 0; j < glcmLevels; j++) {
                contrast += Math.pow(i - j, 2) * pGlcmBuffer[rowOff + j];
            }
        }
        return contrast;
    }

    if (method === 'homogeneity') {
        let homogeneity = 0;
        for (let i = 0; i < glcmLevels; i++) {
            const rowOff = i * glcmLevels;
            for (let j = 0; j < glcmLevels; j++) {
                homogeneity += pGlcmBuffer[rowOff + j] / (1 + Math.abs(i - j));
            }
        }
        return homogeneity;
    }

    if (method === 'correlation') {
        let muX = 0;
        let muY = 0;
        for (let i = 0; i < glcmLevels; i++) {
            const rowOff = i * glcmLevels;
            for (let j = 0; j < glcmLevels; j++) {
                const p = pGlcmBuffer[rowOff + j];
                muX += i * p;
                muY += j * p;
            }
        }

        let varX = 0;
        let varY = 0;
        for (let i = 0; i < glcmLevels; i++) {
            const rowOff = i * glcmLevels;
            for (let j = 0; j < glcmLevels; j++) {
                const p = pGlcmBuffer[rowOff + j];
                varX += Math.pow(i - muX, 2) * p;
                varY += Math.pow(j - muY, 2) * p;
            }
        }

        const sigmaX = Math.sqrt(varX);
        const sigmaY = Math.sqrt(varY);

        if (sigmaX > 1e-9 && sigmaY > 1e-9) {
            let corrSum = 0;
            for (let i = 0; i < glcmLevels; i++) {
                const rowOff = i * glcmLevels;
                for (let j = 0; j < glcmLevels; j++) {
                    corrSum += (i - muX) * (j - muY) * pGlcmBuffer[rowOff + j];
                }
            }
            return corrSum / (sigmaX * sigmaY);
        }
        return 1.0; // Assume complete linear alignment for flat regions
    }

    return 0;
}

function computeStrokeDir(win: Float32Array, K: number, useNormalVector: boolean, showAngle360: boolean): [number, number, number] {
    let jxx = 0;
    let jyy = 0;
    let jxy = 0;
    let sumIx = 0;
    let sumIy = 0;
    for (let r = 0; r < K; r++) {
        const rowOff = r * K;
        for (let c = 0; c < K; c++) {
            const rightIdx = rowOff + Math.min(K - 1, c + 1);
            const leftIdx = rowOff + Math.max(0, c - 1);
            const botIdx = Math.min(K - 1, r + 1) * K + c;
            const topIdx = Math.max(0, r - 1) * K + c;
            const ix = (win[rightIdx] - win[leftIdx]) / 2;
            const iy = (win[botIdx] - win[topIdx]) / 2;
            jxx += ix * ix;
            jyy += iy * iy;
            jxy += ix * iy;
            if (showAngle360) {
                sumIx += ix;
                sumIy += iy;
            }
        }
    }
    
    // Classic Structure Tensor (Algorithm 1)
    const D = Math.sqrt(Math.pow(jxx - jyy, 2) + 4 * jxy * jxy);
    const trace = jxx + jyy;
    
    // Stroke direction angle (gradient direction + pi/2)
    let theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI / 2;
    
    if (showAngle360) {
        const refAngle = Math.atan2(sumIy, sumIx) + Math.PI / 2;
        const cosDiff = Math.cos(theta) * Math.cos(refAngle) + Math.sin(theta) * Math.sin(refAngle);
        if (cosDiff < 0) {
            theta += Math.PI;
        }
    }
    
    // Stroke direction vector components
    const sx = Math.cos(theta);
    const sy = Math.sin(theta);
    
    // Coherence / Amplitude (0 to 1)
    const coherence = trace > 1e-9 ? D / (trace + 1e-5) : 0;
    
    if (useNormalVector) {
        // Convert to a 3D hemisphere normal vector using coherence-scaled direction
        const dx = sx * coherence;
        const dy = sy * coherence;
        const vecMag = Math.sqrt(dx * dx + dy * dy + 1);
        const nx = dx / vecMag;
        const ny = dy / vecMag;
        const nz = 1 / vecMag;
        return [nx, ny, nz];
    } else {
        // Return coherence-scaled direction vector + raw coherence magnitude as third component
        const nx = sx * coherence;
        const ny = sy * coherence;
        const nz = coherence;
        return [nx, ny, nz];
    }
}

function computeSteerableHessian(win: Float32Array, K: number, useNormalVector: boolean, showAngle360: boolean): [number, number, number] {
    let hxx = 0;
    let hyy = 0;
    let hxy = 0;
    let sumIx = 0;
    let sumIy = 0;

    // Apply binomial pre-blur to smooth out digital grid noise
    const tempBlur = new Float32Array(K * K);
    for (let r = 0; r < K; r++) {
        const rowOff = r * K;
        for (let c = 0; c < K; c++) {
            const left = win[rowOff + Math.max(0, c - 1)];
            const mid  = win[rowOff + c];
            const right = win[rowOff + Math.min(K - 1, c + 1)];
            tempBlur[rowOff + c] = (left + 2 * mid + right) / 4;
        }
    }

    const blurred = new Float32Array(K * K);
    for (let c = 0; c < K; c++) {
        for (let r = 0; r < K; r++) {
            const top = tempBlur[Math.max(0, r - 1) * K + c];
            const mid = tempBlur[r * K + c];
            const bot = tempBlur[Math.min(K - 1, r + 1) * K + c];
            blurred[r * K + c] = (top + 2 * mid + bot) / 4;
        }
    }

    // Compute Sobel 2nd derivatives on the smoothed window
    for (let r = 0; r < K; r++) {
        const rTop = Math.max(0, r - 1) * K;
        const rMid = r * K;
        const rBot = Math.min(K - 1, r + 1) * K;

        for (let c = 0; c < K; c++) {
            const cLeft = Math.max(0, c - 1);
            const cMid = c;
            const cRight = Math.min(K - 1, c + 1);
            const p00 = blurred[rTop + cLeft];
            const p01 = blurred[rTop + cMid];
            const p02 = blurred[rTop + cRight];
            const p10 = blurred[rMid + cLeft];
            const p11 = blurred[rMid + cMid];
            const p12 = blurred[rMid + cRight];
            const p20 = blurred[rBot + cLeft];
            const p21 = blurred[rBot + cMid];
            const p22 = blurred[rBot + cRight];

            // 1st derivatives for 360-degree angle resolution
            const ix = (p12 - p10) / 2;
            const iy = (p21 - p01) / 2;

            if (showAngle360) {
                sumIx += ix;
                sumIy += iy;
            }

            // 3x3 Sobel 2nd derivatives (rotational symmetry factor of 2 on ixy)
            const ixx = (p00 - 2 * p01 + p02) + 2 * (p10 - 2 * p11 + p12) + (p20 - 2 * p21 + p22);
            const iyy = (p00 + 2 * p01 + p02) - 2 * (p10 + 2 * p11 + p12) + (p20 + 2 * p21 + p22);
            const ixy = 2 * ((p00 - p02) - (p20 - p22));

            // Accumulate using squared tensor components to prevent sign cancellation and telescoping
            hxx += ixx * ixx + ixy * ixy;
            hyy += iyy * iyy + ixy * ixy;
            hxy += ixy * (ixx + iyy);
        }
    }

    // Solve for dominant orientation of the second-order structure tensor
    const D = Math.sqrt(Math.pow(hxx - hyy, 2) + 4 * hxy * hxy);
    let theta = 0.5 * Math.atan2(2 * hxy, hxx - hyy) + Math.PI / 2;

    if (showAngle360) {
        const refAngle = Math.atan2(sumIy, sumIx) + Math.PI / 2;
        const cosDiff = Math.cos(theta) * Math.cos(refAngle) + Math.sin(theta) * Math.sin(refAngle);
        if (cosDiff < 0) {
            theta += Math.PI;
        }
    }

    const sx = Math.cos(theta);
    const sy = Math.sin(theta);
    const trace = hxx + hyy;
    const coherence = trace > 1e-9 ? Math.min(1, D / (trace + 1e-5)) : 0;

    if (useNormalVector) {
        const dx = sx * coherence;
        const dy = sy * coherence;
        const vecMag = Math.sqrt(dx * dx + dy * dy + 1);
        const nx = dx / vecMag;
        const ny = dy / vecMag;
        const nz = 1 / vecMag;
        return [nx, ny, nz];
    } else {
        const nx = sx * coherence;
        const ny = sy * coherence;
        const nz = coherence;
        return [nx, ny, nz];
    }
}
