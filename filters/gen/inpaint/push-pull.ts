// HIERARCHICAL PUSH-PULL INTERPOLATION ALGORITHM
export namespace PushPull {
    export function initialize(
        pixels: Uint8ClampedArray,
        w: number,
        h: number,
        mask: Uint8Array,
        maskedIndices: number[]
    ) {
        const levels: Array<{ data: Float32Array; mask: Uint8Array; w: number; h: number }> = [];
        const level0Data = new Float32Array(w * h * 4);
        for (let i = 0; i < w * h * 4; i++) level0Data[i] = pixels[i];
        const level0Mask = new Uint8Array(mask);
        levels.push({ data: level0Data, mask: level0Mask, w, h });

        let curW = w;
        let curH = h;
        while (curW > 4 && curH > 4) {
            const nextW = Math.ceil(curW / 2);
            const nextH = Math.ceil(curH / 2);
            const prevData = levels[levels.length - 1].data;
            const prevMask = levels[levels.length - 1].mask;
            const prevW = curW;
            const prevH = curH;
            const nextData = new Float32Array(nextW * nextH * 4);
            const nextMask = new Uint8Array(nextW * nextH);

            for (let ny = 0; ny < nextH; ny++) {
                for (let nx = 0; nx < nextW; nx++) {
                    const nIdx = ny * nextW + nx;
                    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
                    let knownWeightSum = 0;

                    for (let dy = 0; dy < 2; dy++) {
                        const py = ny * 2 + dy;
                        if (py >= prevH) continue;
                        for (let dx = 0; dx < 2; dx++) {
                            const px = nx * 2 + dx;
                            if (px >= prevW) continue;

                            const pIdx = py * prevW + px;
                            if (prevMask[pIdx] === 0) {
                                rSum += prevData[pIdx * 4];
                                gSum += prevData[pIdx * 4 + 1];
                                bSum += prevData[pIdx * 4 + 2];
                                aSum += prevData[pIdx * 4 + 3];
                                knownWeightSum += 1.0;
                            }
                        }
                    }

                    if (knownWeightSum > 0) {
                        nextData[nIdx * 4] = rSum / knownWeightSum;
                        nextData[nIdx * 4 + 1] = gSum / knownWeightSum;
                        nextData[nIdx * 4 + 2] = bSum / knownWeightSum;
                        nextData[nIdx * 4 + 3] = aSum / knownWeightSum;
                        nextMask[nIdx] = 0;
                    } else {
                        nextMask[nIdx] = 1;
                    }
                }
            }

            levels.push({ data: nextData, mask: nextMask, w: nextW, h: nextH });
            curW = nextW;
            curH = nextH;
        }

        const coarsest = levels[levels.length - 1];
        let avgR = 0, avgG = 0, avgB = 0, avgA = 0;
        let count = 0;
        for (let i = 0; i < coarsest.w * coarsest.h; i++) {
            if (coarsest.mask[i] === 0) {
                avgR += coarsest.data[i * 4];
                avgG += coarsest.data[i * 4 + 1];
                avgB += coarsest.data[i * 4 + 2];
                avgA += coarsest.data[i * 4 + 3];
                count++;
            }
        }
        if (count > 0) {
            avgR /= count; avgG /= count; avgB /= count; avgA /= count;
        }
        for (let i = 0; i < coarsest.w * coarsest.h; i++) {
            if (coarsest.mask[i] === 1) {
                coarsest.data[i * 4] = avgR;
                coarsest.data[i * 4 + 1] = avgG;
                coarsest.data[i * 4 + 2] = avgB;
                coarsest.data[i * 4 + 3] = avgA;
                coarsest.mask[i] = 0;
            }
        }

        for (let L = levels.length - 2; L >= 0; L--) {
            const fine = levels[L];
            const coarse = levels[L + 1];

            for (let fy = 0; fy < fine.h; fy++) {
                const cy = Math.min(coarse.h - 1, fy / 2);
                const cy0 = Math.floor(cy);
                const cy1 = Math.min(coarse.h - 1, cy0 + 1);
                const tY = cy - cy0;

                for (let fx = 0; fx < fine.w; fx++) {
                    const fIdx = fy * fine.w + fx;
                    if (fine.mask[fIdx] === 1) {
                        const cx = Math.min(coarse.w - 1, fx / 2);
                        const cx0 = Math.floor(cx);
                        const cx1 = Math.min(coarse.w - 1, cx0 + 1);
                        const tX = cx - cx0;
                        const i00 = (cy0 * coarse.w + cx0) * 4;
                        const i10 = (cy0 * coarse.w + cx1) * 4;
                        const i01 = (cy1 * coarse.w + cx0) * 4;
                        const i11 = (cy1 * coarse.w + cx1) * 4;

                        for (let c = 0; c < 4; c++) {
                            const val = (1 - tY) * ((1 - tX) * coarse.data[i00 + c] + tX * coarse.data[i10 + c]) +
                                        tY * ((1 - tX) * coarse.data[i01 + c] + tX * coarse.data[i11 + c]);
                            fine.data[fIdx * 4 + c] = val;
                        }
                        fine.mask[fIdx] = 0;
                    }
                }
            }
        }

        const fineData = levels[0].data;
        for (const i of maskedIndices) {
            pixels[i * 4] = Math.max(0, Math.min(255, Math.round(fineData[i * 4])));
            pixels[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(fineData[i * 4 + 1])));
            pixels[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(fineData[i * 4 + 2])));
            pixels[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(fineData[i * 4 + 3])));
        }
    }
}