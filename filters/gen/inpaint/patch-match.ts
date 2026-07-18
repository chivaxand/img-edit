import { Layer } from '~/layers';
import { computeFeatheredMask } from './utils';

// MULTI-SCALE PATCHMATCH + SOR POISSON BLENDING HYBRID SOLVER
export namespace PatchMatch {
    export class PyImage {
        width: number;
        height: number;
        pixels: Float32Array;
        mask: Uint8Array;

        constructor(w: number, h: number, pixels: Float32Array, mask: Uint8Array) {
            this.width = w;
            this.height = h;
            this.pixels = pixels;
            this.mask = mask;
        }

        isMasked(x: number, y: number): boolean {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return true;
            return this.mask[y * this.width + x] === 1;
        }

        mixColors(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = (y * this.width + x) * 4;
            this.pixels[idx] = r;
            this.pixels[idx + 1] = g;
            this.pixels[idx + 2] = b;
            this.pixels[idx + 3] = a;
        }
    }

    export class MaskIntegral {
        width: number;
        height: number;
        sum: Int32Array;

        constructor(width: number, height: number, mask: Uint8Array) {
            this.width = width;
            this.height = height;
            this.sum = new Int32Array((width + 1) * (height + 1));

            for (let y = 0; y < height; y++) {
                const rowOffset = y * width;
                const sumRowOffset = (y + 1) * (width + 1);
                const sumPrevRowOffset = y * (width + 1);
                let rowSum = 0;
                for (let x = 0; x < width; x++) {
                    rowSum += mask[rowOffset + x];
                    this.sum[sumRowOffset + (x + 1)] = this.sum[sumPrevRowOffset + (x + 1)] + rowSum;
                }
            }
        }

        query(x1: number, y1: number, x2: number, y2: number): number {
            x1 = Math.max(0, x1);
            y1 = Math.max(0, y1);
            x2 = Math.min(this.width - 1, x2);
            y2 = Math.min(this.height - 1, y2);
            if (x1 > x2 || y1 > y2) return 0;

            return this.sum[(y2 + 1) * (this.width + 1) + (x2 + 1)] -
                   this.sum[y1 * (this.width + 1) + (x2 + 1)] -
                   this.sum[(y2 + 1) * (this.width + 1) + x1] +
                   this.sum[y1 * (this.width + 1) + x1];
        }
    }

    export class NNF {
        width: number;
        height: number;
        fieldX: Int16Array;
        fieldY: Int16Array;
        distance: Int32Array;

        constructor(w: number, h: number) {
            this.width = w;
            this.height = h;
            this.fieldX = new Int16Array(w * h);
            this.fieldY = new Int16Array(w * h);
            this.distance = new Int32Array(w * h);
        }
    }

    export function randomizeNNF(nnf: NNF, source: PyImage, target: PyImage, R: number, maskIntegral: MaskIntegral) {
        const w = nnf.width;
        const h = nnf.height;

        let validCount = 0;
        const srcW = source.width;
        const srcH = source.height;
        const srcMask = source.mask;

        for (let i = 0; i < srcMask.length; i++) {
            if (srcMask[i] === 0) {
                validCount++;
            }
        }

        let validX: Int32Array;
        let validY: Int32Array;

        if (validCount === 0) {
            validX = new Int32Array(1);
            validY = new Int32Array(1);
            validX[0] = 0;
            validY[0] = 0;
            validCount = 1;
        } else {
            validX = new Int32Array(validCount);
            validY = new Int32Array(validCount);
            let idx = 0;
            for (let y = 0; y < srcH; y++) {
                const rowOffset = y * srcW;
                for (let x = 0; x < srcW; x++) {
                    if (srcMask[rowOffset + x] === 0) {
                        validX[idx] = x;
                        validY[idx] = y;
                        idx++;
                    }
                }
            }
        }

        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                const idx = rowOffset + x;
                const randIdx = Math.floor(Math.random() * validCount);
                nnf.fieldX[idx] = validX[randIdx];
                nnf.fieldY[idx] = validY[randIdx];
                nnf.distance[idx] = 65535;
            }
        }
    }

    export function upscaleNNF(coarse: NNF, fine: NNF, source: PyImage, target: PyImage) {
        const w = fine.width;
        const h = fine.height;

        for (let y = 0; y < h; y++) {
            const cy = Math.min(coarse.height - 1, Math.floor(y / 2));
            const rowOffset = y * w;
            const coarseRowOffset = cy * coarse.width;

            for (let x = 0; x < w; x++) {
                const cx = Math.min(coarse.width - 1, Math.floor(x / 2));
                const coarseIdx = coarseRowOffset + cx;
                const fineIdx = rowOffset + x;

                const sx = Math.min(source.width - 1, Math.max(0, coarse.fieldX[coarseIdx] * 2 + (x % 2)));
                const sy = Math.min(source.height - 1, Math.max(0, coarse.fieldY[coarseIdx] * 2 + (y % 2)));

                fine.fieldX[fineIdx] = sx;
                fine.fieldY[fineIdx] = sy;
                fine.distance[fineIdx] = 65535;
            }
        }
    }

    export function patchDistance(
        nnf: NNF,
        source: PyImage,
        target: PyImage,
        x: number, y: number,
        xp: number, yp: number,
        R: number,
        currentBest = 65535
    ): number {
        let distance = 0;
        const ssdmax = 4 * 255 * 255;
        const totalIterations = (2 * R + 1) * (2 * R + 1);
        const wsum = totalIterations * ssdmax;
        const threshold = (currentBest * wsum) / 65535;

        for (let dy = -R; dy <= R; dy++) {
            const ty = y + dy;
            const sy = yp + dy;
            const targetOutOfBoundsY = ty < 0 || ty >= target.height;
            const sourceOutOfBoundsY = sy < 0 || sy >= source.height;
            const tyOffset = ty * target.width;
            const syOffset = sy * source.width;

            for (let dx = -R; dx <= R; dx++) {
                const tx = x + dx;
                const sx = xp + dx;
                if (targetOutOfBoundsY || tx < 0 || tx >= target.width) {
                    distance += ssdmax;
                } else if (sourceOutOfBoundsY || sx < 0 || sx >= source.width || source.mask[syOffset + sx] === 1) {
                    distance += ssdmax;
                } else {
                    const tIdx = (tyOffset + tx) * 4;
                    const sIdx = (syOffset + sx) * 4;
                    const dr = target.pixels[tIdx] - source.pixels[sIdx];
                    const dg = target.pixels[tIdx + 1] - source.pixels[sIdx + 1];
                    const db = target.pixels[tIdx + 2] - source.pixels[sIdx + 2];
                    const da = target.pixels[tIdx + 3] - source.pixels[sIdx + 3];
                    distance += dr * dr + dg * dg + db * db + da * da;
                }

                if (distance >= threshold) {
                    return 65535;
                }
            }
        }

        return Math.floor(65535 * (distance / wsum));
    }

    export function computeNNFDistances(nnf: NNF, source: PyImage, target: PyImage, R: number) {
        const w = nnf.width;
        const h = nnf.height;
        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                const idx = rowOffset + x;
                nnf.distance[idx] = patchDistance(nnf, source, target, x, y, nnf.fieldX[idx], nnf.fieldY[idx], R);
            }
        }
    }

    export function minimizeNNF(
        nnf: NNF,
        source: PyImage,
        target: PyImage,
        R: number,
        iterations: number,
        maskIntegral: MaskIntegral
    ) {
        const w = nnf.width;
        const h = nnf.height;
        const evaluate = (x: number, y: number, candX: number, candY: number, idx: number) => {
            if (candX < 0 || candX >= source.width || candY < 0 || candY >= source.height) return;
            // Skip center pixels that are masked in source
            if (source.mask[candY * source.width + candX] === 1) return;

            const d = patchDistance(nnf, source, target, x, y, candX, candY, R, nnf.distance[idx]);
            if (d < nnf.distance[idx]) {
                nnf.fieldX[idx] = candX;
                nnf.fieldY[idx] = candY;
                nnf.distance[idx] = d;
            }
        };

        for (let iter = 0; iter < iterations; iter++) {
            const forward = iter % 2 === 0;

            if (forward) {
                for (let y = 0; y < h; y++) {
                    const rowOffset = y * w;
                    for (let x = 0; x < w; x++) {
                        const idx = rowOffset + x;
                        if (nnf.distance[idx] === 0) continue;
                        if (x > 0) {
                            const prevIdx = idx - 1;
                            evaluate(x, y, nnf.fieldX[prevIdx] + 1, nnf.fieldY[prevIdx], idx);
                        }
                        if (y > 0) {
                            const prevIdx = idx - w;
                            evaluate(x, y, nnf.fieldX[prevIdx], nnf.fieldY[prevIdx] + 1, idx);
                        }

                        let searchWidth = Math.max(source.width, source.height);
                        const bestX = nnf.fieldX[idx];
                        const bestY = nnf.fieldY[idx];

                        while (searchWidth > 0) {
                            const rx = bestX + Math.floor(Math.random() * (2 * searchWidth + 1)) - searchWidth;
                            const ry = bestY + Math.floor(Math.random() * (2 * searchWidth + 1)) - searchWidth;
                            const cx = Math.max(0, Math.min(source.width - 1, rx));
                            const cy = Math.max(0, Math.min(source.height - 1, ry));

                            evaluate(x, y, cx, cy, idx);
                            searchWidth = Math.floor(searchWidth / 2);
                        }
                    }
                }
            } else {
                for (let y = h - 1; y >= 0; y--) {
                    const rowOffset = y * w;
                    for (let x = w - 1; x >= 0; x--) {
                        const idx = rowOffset + x;
                        if (nnf.distance[idx] === 0) continue;
                        if (x < w - 1) {
                            const nextIdx = idx + 1;
                            evaluate(x, y, nnf.fieldX[nextIdx] - 1, nnf.fieldY[nextIdx], idx);
                        }
                        if (y < h - 1) {
                            const nextIdx = idx + w;
                            evaluate(x, y, nnf.fieldX[nextIdx], nnf.fieldY[nextIdx] - 1, idx);
                        }
                        let searchWidth = Math.max(source.width, source.height);
                        const bestX = nnf.fieldX[idx];
                        const bestY = nnf.fieldY[idx];

                        while (searchWidth > 0) {
                            const rx = bestX + Math.floor(Math.random() * (2 * searchWidth + 1)) - searchWidth;
                            const ry = bestY + Math.floor(Math.random() * (2 * searchWidth + 1)) - searchWidth;
                            const cx = Math.max(0, Math.min(source.width - 1, rx));
                            const cy = Math.max(0, Math.min(source.height - 1, ry));

                            evaluate(x, y, cx, cy, idx);
                            searchWidth = Math.floor(searchWidth / 2);
                        }
                    }
                }
            }
        }
    }

    export function expectationStep(
        nnf: NNF,
        source: PyImage,
        target: PyImage,
        R: number,
        similarity: Float32Array,
        sharpness = 0.0
    ) {
        const H_nnf = nnf.height;
        const W_nnf = nnf.width;
        const H_target = target.height;
        const W_target = target.width;
        const H_source = source.height;
        const W_source = source.width;
        const rSum = new Float32Array(W_target * H_target);
        const gSum = new Float32Array(W_target * H_target);
        const bSum = new Float32Array(W_target * H_target);
        const aSum = new Float32Array(W_target * H_target);
        const wSum = new Float32Array(W_target * H_target);

        for (let y = 0; y < H_target; y++) {
            for (let x = 0; x < W_target; x++) {
                const targetIdx = y * W_target + x;

                if (source.mask[targetIdx] === 0) {
                    const srcIdx4 = targetIdx * 4;
                    rSum[targetIdx] = source.pixels[srcIdx4];
                    gSum[targetIdx] = source.pixels[srcIdx4 + 1];
                    bSum[targetIdx] = source.pixels[srcIdx4 + 2];
                    aSum[targetIdx] = source.pixels[srcIdx4 + 3];
                    wSum[targetIdx] = 1.0;
                    continue;
                }

                for (let dy = -R; dy <= R; dy++) {
                    const ypt = y + dy;
                    if (ypt < 0 || ypt >= H_nnf) continue;

                    for (let dx = -R; dx <= R; dx++) {
                        const xpt = x + dx;
                        if (xpt < 0 || xpt >= W_nnf) continue;

                        const nnfIdx = ypt * W_nnf + xpt;
                        const xst = nnf.fieldX[nnfIdx];
                        const yst = nnf.fieldY[nnfIdx];
                        const dist = nnf.distance[nnfIdx];
                        const w = similarity[dist >= 0 && dist < 65536 ? dist : 65535];
                        const xs = xst - dx;
                        const ys = yst - dy;

                        if (xs < 0 || xs >= W_source || ys < 0 || ys >= H_source) continue;
                        if (source.mask[ys * W_source + xs] === 1) continue;

                        const srcIdx = (ys * W_source + xs) * 4;
                        rSum[targetIdx] += source.pixels[srcIdx] * w;
                        gSum[targetIdx] += source.pixels[srcIdx + 1] * w;
                        bSum[targetIdx] += source.pixels[srcIdx + 2] * w;
                        aSum[targetIdx] += source.pixels[srcIdx + 3] * w;
                        wSum[targetIdx] += w;
                    }
                }
            }
        }

        for (let y = 0; y < H_target; y++) {
            const rowOffset = y * W_target;
            for (let x = 0; x < W_target; x++) {
                const idx = rowOffset + x;
                const w = wSum[idx];
                if (w > 1e-5) {
                    let r = rSum[idx] / w;
                    let g = gSum[idx] / w;
                    let b = bSum[idx] / w;
                    let a = aSum[idx] / w;

                    if (sharpness > 0 && source.mask[idx] === 1) {
                        const xst = nnf.fieldX[idx];
                        const yst = nnf.fieldY[idx];
                        if (xst >= 0 && xst < W_source && yst >= 0 && yst < H_source) {
                            const srcIdx4 = (yst * W_source + xst) * 4;
                            r = (1 - sharpness) * r + sharpness * source.pixels[srcIdx4];
                            g = (1 - sharpness) * g + sharpness * source.pixels[srcIdx4 + 1];
                            b = (1 - sharpness) * b + sharpness * source.pixels[srcIdx4 + 2];
                            a = (1 - sharpness) * a + sharpness * source.pixels[srcIdx4 + 3];
                        }
                    }

                    target.mixColors(x, y, r, g, b, a);
                }
            }
        }
    }

    export function inpaint(
        layer: Layer,
        maskCanvas: HTMLCanvasElement,
        radius = 4,
        accuracy = 50,
        sharpness = 0.0,
        softness = 0
    ) {
        const width = layer.canvas.width;
        const height = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, width, height);
        const pixels = imgData.data;
        const originalPixels = new Uint8ClampedArray(pixels);
        const mCtx = maskCanvas.getContext('2d')!;
        const mImgData = mCtx.getImageData(0, 0, width, height);
        const mPixels = mImgData.data;
        let minX = width, maxX = 0, minY = height, maxY = 0;
        let hasMask = false;
        let maskedPixelCount = 0;

        for (let y = 0; y < height; y++) {
            const rowOffset = y * width;
            for (let x = 0; x < width; x++) {
                const idx = rowOffset + x;
                if (mPixels[idx * 4 + 3] > 10) {
                    hasMask = true;
                    maskedPixelCount++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!hasMask) return;

        const paddingFactor = 1.0 + (accuracy / 25);
        const maskW = maxX - minX + 1;
        const maskH = maxY - minY + 1;
        const padX = Math.max(40, Math.round(maskW * paddingFactor));
        const padY = Math.max(40, Math.round(maskH * paddingFactor));
        const cropX = Math.max(0, minX - padX);
        const cropY = Math.max(0, minY - padY);
        const cropW = Math.min(width - cropX, maxX + padX + 1 - cropX);
        const cropH = Math.min(height - cropY, maxY + padY + 1 - cropY);
        const level0Pixels = new Float32Array(cropW * cropH * 4);
        const level0Mask = new Uint8Array(cropW * cropH);

        for (let y = 0; y < cropH; y++) {
            const srcRowOffset = (cropY + y) * width;
            const dstRowOffset = y * cropW;
            for (let x = 0; x < cropW; x++) {
                const srcIdx = srcRowOffset + (cropX + x);
                const dstIdx = dstRowOffset + x;
                const s4 = srcIdx * 4;
                const d4 = dstIdx * 4;

                level0Pixels[d4] = pixels[s4];
                level0Pixels[d4 + 1] = pixels[s4 + 1];
                level0Pixels[d4 + 2] = pixels[s4 + 2];
                level0Pixels[d4 + 3] = pixels[s4 + 3];

                if (mPixels[srcIdx * 4 + 3] > 10) {
                    level0Mask[dstIdx] = 1;
                }
            }
        }

        const similarity = new Float32Array(65536);
        const s_zero = 0.999;
        const t_halfmax = 0.10;
        const x_curve = (s_zero - 0.5) * 2;
        const invtanh = 0.5 * Math.log((1 + x_curve) / (1 - x_curve));
        const coef = invtanh / t_halfmax;
        for (let i = 0; i < 65536; i++) {
            const t = i / 65536;
            similarity[i] = 0.5 - 0.5 * Math.tanh(coef * (t - t_halfmax));
        }

        const pyramid: PyImage[] = [];
        let curW = cropW;
        let curH = cropH;
        let curPixels = level0Pixels;
        let curMask = level0Mask;

        pyramid.push(new PyImage(curW, curH, curPixels, curMask));

        while (curW > radius * 2 && curH > radius * 2) {
            const nextW = Math.floor(curW / 2);
            const nextH = Math.floor(curH / 2);
            if (nextW <= radius * 2 || nextH <= radius * 2) break;

            const nextPixels = new Float32Array(nextW * nextH * 4);
            const nextMask = new Uint8Array(nextW * nextH);

            for (let ny = 0; ny < nextH; ny++) {
                for (let nx = 0; nx < nextW; nx++) {
                    const nIdx = ny * nextW + nx;
                    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
                    let count = 0;
                    let isAnyMasked = false;

                    for (let dy = 0; dy < 2; dy++) {
                        const py = ny * 2 + dy;
                        if (py >= curH) continue;
                        for (let dx = 0; dx < 2; dx++) {
                            const px = nx * 2 + dx;
                            if (px >= curW) continue;

                            const pIdx = py * curW + px;
                            if (curMask[pIdx] === 1) {
                                isAnyMasked = true;
                            } else {
                                const pIdx4 = pIdx * 4;
                                rSum += curPixels[pIdx4];
                                gSum += curPixels[pIdx4 + 1];
                                bSum += curPixels[pIdx4 + 2];
                                aSum += curPixels[pIdx4 + 3];
                                count++;
                            }
                        }
                    }

                    if (isAnyMasked) {
                        nextMask[nIdx] = 1;
                        if (count > 0) {
                            nextPixels[nIdx * 4] = rSum / count;
                            nextPixels[nIdx * 4 + 1] = gSum / count;
                            nextPixels[nIdx * 4 + 2] = bSum / count;
                            nextPixels[nIdx * 4 + 3] = aSum / count;
                        } else {
                            // Average masked pixels if no unmasked sub-pixels exist
                            let rSumAll = 0, gSumAll = 0, bSumAll = 0, aSumAll = 0;
                            let countAll = 0;
                            for (let dy = 0; dy < 2; dy++) {
                                const py = ny * 2 + dy;
                                if (py >= curH) continue;
                                for (let dx = 0; dx < 2; dx++) {
                                    const px = nx * 2 + dx;
                                    if (px >= curW) continue;
                                    const pIdx = py * curW + px;
                                    const pIdx4 = pIdx * 4;
                                    rSumAll += curPixels[pIdx4];
                                    gSumAll += curPixels[pIdx4 + 1];
                                    bSumAll += curPixels[pIdx4 + 2];
                                    aSumAll += curPixels[pIdx4 + 3];
                                    countAll++;
                                }
                            }
                            if (countAll > 0) {
                                nextPixels[nIdx * 4] = rSumAll / countAll;
                                nextPixels[nIdx * 4 + 1] = gSumAll / countAll;
                                nextPixels[nIdx * 4 + 2] = bSumAll / countAll;
                                nextPixels[nIdx * 4 + 3] = aSumAll / countAll;
                            }
                        }
                    } else {
                        nextMask[nIdx] = 0;
                        if (count > 0) {
                            nextPixels[nIdx * 4] = rSum / count;
                            nextPixels[nIdx * 4 + 1] = gSum / count;
                            nextPixels[nIdx * 4 + 2] = bSum / count;
                            nextPixels[nIdx * 4 + 3] = aSum / count;
                        }
                    }
                }
            }

            const nextImage = new PyImage(nextW, nextH, nextPixels, nextMask);
            pyramid.push(nextImage);

            curW = nextW;
            curH = nextH;
            curPixels = nextPixels;
            curMask = nextMask;
        }

        const maxLevel = pyramid.length;
        const coarsestSource = pyramid[maxLevel - 1];
        const coarsestTarget = new PyImage(
            coarsestSource.width,
            coarsestSource.height,
            new Float32Array(coarsestSource.pixels),
            new Uint8Array(coarsestSource.width * coarsestSource.height)
        );

        let nnf = new NNF(coarsestTarget.width, coarsestTarget.height);
        const initialMaskIntegral = new MaskIntegral(coarsestSource.width, coarsestSource.height, coarsestSource.mask);
        randomizeNNF(nnf, coarsestSource, coarsestTarget, radius, initialMaskIntegral);
        computeNNFDistances(nnf, coarsestSource, coarsestTarget, radius);

        let currentTarget = coarsestTarget;

        for (let level = maxLevel - 1; level >= 0; level--) {
            const sourceLevel = pyramid[level];

            if (level < maxLevel - 1) {
                const upscaledTarget = new PyImage(
                    sourceLevel.width,
                    sourceLevel.height,
                    new Float32Array(sourceLevel.width * sourceLevel.height * 4),
                    new Uint8Array(sourceLevel.width * sourceLevel.height)
                );

                const prevW = currentTarget.width;
                const prevH = currentTarget.height;

                for (let y = 0; y < sourceLevel.height; y++) {
                    const cy = Math.min(prevH - 1, Math.floor((y * prevH) / sourceLevel.height));
                    const rowOffset = y * sourceLevel.width;
                    const prevRowOffset = cy * prevW;

                    for (let x = 0; x < sourceLevel.width; x++) {
                        const cx = Math.min(prevW - 1, Math.floor((x * prevW) / sourceLevel.width));
                        const fineIdx = rowOffset + x;
                        const coarseIdx = prevRowOffset + cx;

                        if (sourceLevel.mask[fineIdx] === 0) {
                            const idx4 = fineIdx * 4;
                            upscaledTarget.pixels[idx4] = sourceLevel.pixels[idx4];
                            upscaledTarget.pixels[idx4 + 1] = sourceLevel.pixels[idx4 + 1];
                            upscaledTarget.pixels[idx4 + 2] = sourceLevel.pixels[idx4 + 2];
                            upscaledTarget.pixels[idx4 + 3] = sourceLevel.pixels[idx4 + 3];
                        } else {
                            const idx4 = fineIdx * 4;
                            const coarseIdx4 = coarseIdx * 4;
                            upscaledTarget.pixels[idx4] = currentTarget.pixels[coarseIdx4];
                            upscaledTarget.pixels[idx4 + 1] = currentTarget.pixels[coarseIdx4 + 1];
                            upscaledTarget.pixels[idx4 + 2] = currentTarget.pixels[coarseIdx4 + 2];
                            upscaledTarget.pixels[idx4 + 3] = currentTarget.pixels[coarseIdx4 + 3];
                        }
                    }
                }

                const upscaledNnf = new NNF(sourceLevel.width, sourceLevel.height);
                upscaleNNF(nnf, upscaledNnf, sourceLevel, upscaledTarget);
                computeNNFDistances(upscaledNnf, sourceLevel, upscaledTarget, radius);

                nnf = upscaledNnf;
                currentTarget = upscaledTarget;
            }

            const levelMaskIntegral = new MaskIntegral(sourceLevel.width, sourceLevel.height, sourceLevel.mask);
            const iterEM = Math.min(2 * (level + 1), 4);
            const iterNNF = Math.min(5, 1 + level);

            for (let em = 0; em < iterEM; em++) {
                if (em > 0) {
                    computeNNFDistances(nnf, sourceLevel, currentTarget, radius);
                }
                for (let y = 0; y < currentTarget.height; y++) {
                    const rowOffset = y * currentTarget.width;
                    for (let x = 0; x < currentTarget.width; x++) {
                        if (levelMaskIntegral.query(x - radius, y - radius, x + radius, y + radius) === 0) {
                            const idx = rowOffset + x;
                            nnf.fieldX[idx] = x;
                            nnf.fieldY[idx] = y;
                            nnf.distance[idx] = 0;
                        }
                    }
                }

                minimizeNNF(nnf, sourceLevel, currentTarget, radius, iterNNF, levelMaskIntegral);

                expectationStep(nnf, sourceLevel, currentTarget, radius, similarity, sharpness);
            }
        }

        const finalTarget = currentTarget;
        const blendMask = computeFeatheredMask(maskCanvas, width, height, softness);

        for (let y = 0; y < cropH; y++) {
            const srcRowOffset = (cropY + y) * width;
            const dstRowOffset = y * cropW;
            for (let x = 0; x < cropW; x++) {
                const dstIdx = dstRowOffset + x;
                if (level0Mask[dstIdx] === 1) {
                    const srcIdx = srcRowOffset + (cropX + x);
                    const s4 = srcIdx * 4;
                    const d4 = dstIdx * 4;

                    const outR = Math.max(0, Math.min(255, Math.round(finalTarget.pixels[d4])));
                    const outG = Math.max(0, Math.min(255, Math.round(finalTarget.pixels[d4 + 1])));
                    const outB = Math.max(0, Math.min(255, Math.round(finalTarget.pixels[d4 + 2])));
                    const outA = Math.max(0, Math.min(255, Math.round(finalTarget.pixels[d4 + 3])));

                    const weight = blendMask[srcIdx];

                    pixels[s4]     = Math.max(0, Math.min(255, Math.round(originalPixels[s4]     * (1 - weight) + outR * weight)));
                    pixels[s4 + 1] = Math.max(0, Math.min(255, Math.round(originalPixels[s4 + 1] * (1 - weight) + outG * weight)));
                    pixels[s4 + 2] = Math.max(0, Math.min(255, Math.round(originalPixels[s4 + 2] * (1 - weight) + outB * weight)));
                    pixels[s4 + 3] = Math.max(0, Math.min(255, Math.round(originalPixels[s4 + 3] * (1 - weight) + outA * weight)));
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }
}
