import { Layer } from '~/layers';

export namespace PatchMatchCImg {
    interface SavedPatch {
        sx: number;
        sy: number;
        dx: number;
        dy: number;
    }

    export function inpaint(
        layer: Layer,
        maskCanvas: HTMLCanvasElement,
        patchSize = 11,
        lookupSize = 22,
        lookupFactor = 1.0,
        lookupIncrement = 1,
        blendSize = 11,
        blendScales = 10,
        isBlendOuter = true,
        softness = 0,
        blendThreshold = 0.0,
        blendDecay = 0.05
    ) {
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;

        const mCtx = maskCanvas.getContext('2d')!;
        const mImgData = mCtx.getImageData(0, 0, w, h);
        const mPixels = mImgData.data;

        // original mask: 1 inside, 0 outside
        const mask = new Uint8Array(w * h);
        let isMaskFound = false;
        let xm0 = w, ym0 = h, xm1 = 0, ym1 = 0;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                if (mPixels[idx * 4 + 3] > 10) {
                    mask[idx] = 1;
                    isMaskFound = true;
                    if (x < xm0) xm0 = x;
                    if (x > xm1) xm1 = x;
                    if (y < ym0) ym0 = y;
                    if (y > ym1) ym1 = y;
                }
            }
        }

        if (!isMaskFound) return;

        // Bounding box dilated by 2
        xm0 = xm0 > 2 ? xm0 - 2 : 0;
        ym0 = ym0 > 2 ? ym0 - 2 : 0;
        xm1 = xm1 < w - 3 ? xm1 + 2 : w - 1;
        ym1 = ym1 < h - 3 ? ym1 + 2 : h - 1;

        const ox = xm0;
        const oy = ym0;
        const dx = xm1 - xm0 + 1;
        const dy = ym1 - ym0 + 1;

        // Construct normalized mask nmask: 1 for known, 0 for unknown
        const nmask = new Uint8Array(dx * dy);
        for (let y = 0; y < dy; y++) {
            for (let x = 0; x < dx; x++) {
                nmask[y * dx + x] = mask[(oy + y) * w + (ox + x)] ? 0 : 1;
            }
        }

        const p2 = Math.floor(patchSize / 2);
        const p1 = patchSize - p2 - 1;

        let _lookup_size = lookupSize;
        let nb_fails = 0;
        let nb_lookups = 0;
        let is_strict_search = true;

        const confidences = new Float32Array(dx * dy);
        for (let i = 0; i < dx * dy; i++) {
            confidences[i] = nmask[i];
        }

        const priorities = new Float32Array(dx * dy * 2).fill(-1);
        const savedPatches: SavedPatch[] = [];
        const isVisited = new Int32Array(w * h);
        let target_index = 0;

        const weights = computeGaussianWeights(patchSize, patchSize / 15.0, true);

        let steps = 0;
        const maxSteps = 100000;

        while (steps < maxSteps) {
            steps++;

            // 1. Target Selection based on priority
            let nb_border_points = 0;
            let target_confidence = -1;
            let target_priority = -1;
            let target_x = -1;
            let target_y = -1;

            for (let y = 0; y < dy; y++) {
                for (let x = 0; x < dx; x++) {
                    const Mcc = nmask[y * dx + x];
                    if (Mcc === 0) { // Unknown pixel
                        const Mpc = x > 0 ? nmask[y * dx + x - 1] : nmask[y * dx + x];
                        const Mnc = x < dx - 1 ? nmask[y * dx + x + 1] : nmask[y * dx + x];
                        const Mcp = y > 0 ? nmask[(y - 1) * dx + x] : nmask[y * dx + x];
                        const Mcn = y < dy - 1 ? nmask[(y + 1) * dx + x] : nmask[y * dx + x];

                        if (Mpc === 1 || Mnc === 1 || Mcp === 1 || Mcn === 1) { // Border pixel
                            nb_border_points++;

                            let confidence_term = priorities[(y * dx + x) * 2];
                            let data_term = priorities[(y * dx + x) * 2 + 1];

                            if (confidence_term < 0) {
                                // Compute smoothed normal vector
                                const getM = (cx: number, cy: number) => {
                                    const rx = Math.max(0, Math.min(dx - 1, cx));
                                    const ry = Math.max(0, Math.min(dy - 1, cy));
                                    return nmask[ry * dx + rx];
                                };

                                const _Mcc = getM(x, y);
                                const _Mpc = getM(x - 1, y);
                                const _Mnc = getM(x + 1, y);
                                const _Mcp = getM(x, y - 1);
                                const _Mcn = getM(x, y + 1);

                                const _Mpp = getM(x - 1, y - 1);
                                const _Mpn = getM(x - 1, y + 1);
                                const _Mnp = getM(x + 1, y - 1);
                                const _Mnn = getM(x + 1, y + 1);

                                const _Mbc = getM(x - 2, y);
                                const _Mac = getM(x + 2, y);
                                const _Mcb = getM(x, y - 2);
                                const _Mca = getM(x, y + 2);

                                const _Mbp = getM(x - 2, y - 1);
                                const _Mbn = getM(x - 2, y + 1);
                                const _Map = getM(x + 2, y - 1);
                                const _Man = getM(x + 2, y + 1);

                                const _Mpb = getM(x - 1, y - 2);
                                const _Mnb = getM(x + 1, y - 2);
                                const _Mpa = getM(x - 1, y + 2);
                                const _Mna = getM(x + 1, y + 2);

                                const Npc = (4.0 * _Mpc + 2.0 * _Mbc + 2.0 * _Mcc + 2.0 * _Mpp + 2.0 * _Mpn + _Mbp + _Mbn + _Mcp + _Mcn) / 16;
                                const Nnc = (4.0 * _Mnc + 2.0 * _Mac + 2.0 * _Mcc + 2.0 * _Mnp + 2.0 * _Mnn + _Map + _Man + _Mcp + _Mcn) / 16;
                                const Ncp = (4.0 * _Mcp + 2.0 * _Mcb + 2.0 * _Mcc + 2.0 * _Mpp + 2.0 * _Mnp + _Mpb + _Mnb + _Mpc + _Mnc) / 16;
                                const Ncn = (4.0 * _Mcn + 2.0 * _Mca + 2.0 * _Mcc + 2.0 * _Mpn + 2.0 * _Mnn + _Mpa + _Mna + _Mpc + _Mnc) / 16;

                                const _nx = 0.5 * (Nnc - Npc);
                                const _ny = 0.5 * (Ncn - Ncp);
                                const nn = Math.sqrt(1e-8 + _nx * _nx + _ny * _ny);
                                const nx = _nx / nn;
                                const ny = _ny / nn;

                                // Compute confidence term
                                let confSum = 0;
                                for (let py_ = -p1; py_ <= p2; py_++) {
                                    for (let px_ = -p1; px_ <= p2; px_++) {
                                        const mx = x + px_;
                                        const my = y + py_;
                                        let cVal = 1.0;
                                        let mVal = 1;
                                        if (mx >= 0 && mx < dx && my >= 0 && my < dy) {
                                            cVal = confidences[my * dx + mx];
                                            mVal = nmask[my * dx + mx];
                                        }
                                        confSum += cVal * mVal;
                                    }
                                }
                                confidence_term = confSum / (patchSize * patchSize);
                                priorities[(y * dx + x) * 2] = confidence_term;

                                // Compute data term
                                const pP = cropPixels(pixels, w, h, ox + x - p1, oy + y - p1, ox + x + p2, oy + y + p2, 2);
                                const pM = cropNMask(nmask, dx, dy, x - p1, y - p1, x + p2, y + p2, 1);

                                let mean_ix2 = 0;
                                let mean_ixiy = 0;
                                let mean_iy2 = 0;

                                const patchArea = patchSize * patchSize;

                                for (let c = 0; c < 4; c++) {
                                    const cOff = c * patchArea;
                                    for (let q = 0; q < patchSize; q++) {
                                        const qp = q > 0 ? q - 1 : 0;
                                        const qn = q < patchSize - 1 ? q + 1 : patchSize - 1;

                                        for (let p = 0; p < patchSize; p++) {
                                            const pp = p > 0 ? p - 1 : 0;
                                            const pn = p < patchSize - 1 ? p + 1 : patchSize - 1;

                                            const _Mcc = pM[q * patchSize + p];
                                            const _Mnc = pM[q * patchSize + pn];
                                            const _Mpc = pM[q * patchSize + pp];
                                            const _Mcn = pM[qn * patchSize + p];
                                            const _Mcp = pM[qp * patchSize + p];

                                            const Icc = pP[cOff + q * patchSize + p];
                                            const Inc = pP[cOff + q * patchSize + pn];
                                            const Ipc = pP[cOff + q * patchSize + pp];
                                            const Icn = pP[cOff + qn * patchSize + p];
                                            const Icp = pP[cOff + qp * patchSize + p];

                                            const ixf = _Mnc * _Mcc * (Inc - Icc);
                                            const iyf = _Mcn * _Mcc * (Icn - Icc);
                                            const ixb = _Mcc * _Mpc * (Icc - Ipc);
                                            const iyb = _Mcc * _Mcp * (Icc - Icp);

                                            const ix = Math.abs(ixf) > Math.abs(ixb) ? ixf : ixb;
                                            const iy = Math.abs(iyf) > Math.abs(iyb) ? iyf : iyb;

                                            const weight = weights[q * patchSize + p];
                                            mean_ix2 += weight * ix * ix;
                                            mean_ixiy += weight * ix * iy;
                                            mean_iy2 += weight * iy * iy;
                                        }
                                    }
                                }

                                const ux = mean_ix2 * (-ny) + mean_ixiy * nx;
                                const uy = mean_ixiy * (-ny) + mean_iy2 * nx;
                                data_term = Math.sqrt(ux * ux + uy * uy);
                                priorities[(y * dx + x) * 2 + 1] = data_term;
                            }

                            const priority = confidence_term * data_term;
                            if (priority > target_priority) {
                                target_priority = priority;
                                target_confidence = confidence_term;
                                target_x = ox + x;
                                target_y = oy + y;
                            }
                        }
                    }
                }
            }

            if (nb_border_points === 0) break;

            // 2. Locate coherent lookup candidates
            const lookupCandidatesX: number[] = [];
            const lookupCandidatesY: number[] = [];

            const x0_neigh = target_x - patchSize;
            const y0_neigh = target_y - patchSize;
            const x1_neigh = target_x + patchSize;
            const y1_neigh = target_y + patchSize;

            for (const item of savedPatches) {
                if (item.dx >= x0_neigh && item.dy >= y0_neigh && item.dx <= x1_neigh && item.dy <= y1_neigh) {
                    const off_x = target_x - item.dx;
                    const off_y = target_y - item.dy;
                    lookupCandidatesX.push(item.sx + off_x);
                    lookupCandidatesY.push(item.sy + off_y);
                }
            }

            lookupCandidatesX.push(target_x);
            lookupCandidatesY.push(target_y);

            const nb_candidates = lookupCandidatesX.length;
            let final_lookup_size = _lookup_size;
            if (nb_candidates > 1) {
                const _final_lookup_size = Math.round((_lookup_size * lookupFactor) / Math.sqrt(nb_candidates));
                final_lookup_size = _final_lookup_size + 1 - (_final_lookup_size % 2);
            }
            if (final_lookup_size < 3) final_lookup_size = 3;

            const l2 = Math.floor(final_lookup_size / 2);
            const l1 = final_lookup_size - l2 - 1;
            const _lookup_increment = Math.max(1, lookupIncrement > 0 ? lookupIncrement : (nb_candidates > 1 ? 1 : -lookupIncrement));

            const pP = cropPixels(pixels, w, h, target_x - p1, target_y - p1, target_x + p2, target_y + p2, 0);
            const pM = cropNMask(nmask, dx, dy, target_x - ox - p1, target_y - oy - p1, target_x - ox + p2, target_y - oy + p2, 0);

            target_index++;

            let best_ssd = Infinity;
            let best_x = -1;
            let best_y = -1;

            for (let C = 0; C < nb_candidates; C++) {
                const xl = lookupCandidatesX[C];
                const yl = lookupCandidatesY[C];
                const x0 = Math.max(p1, xl - l1);
                const y0 = Math.max(p1, yl - l1);
                const x1 = Math.min(w - 1 - p2, xl + l2);
                const y1 = Math.min(h - 1 - p2, yl + l2);

                for (let y = y0; y <= y1; y += _lookup_increment) {
                    for (let x = x0; x <= x1; x += _lookup_increment) {
                        const idx = y * w + x;
                        if (isVisited[idx] !== target_index) {
                            let isValid = false;
                            if (is_strict_search) {
                                const pN = cropMask(mask, w, h, x - p1, y - p1, x + p2, y + p2, 1);
                                let sum = 0;
                                for (let k = 0; k < pN.length; k++) sum += pN[k];
                                if (sum === 0) isValid = true;
                            } else {
                                const pN = cropNMask(nmask, dx, dy, x - ox - p1, y - oy - p1, x - ox + p2, y - oy + p2, 0);
                                let sum = 0;
                                for (let k = 0; k < pN.length; k++) sum += pN[k];
                                if (sum === patchSize * patchSize) isValid = true;
                            }

                            if (isValid) {
                                const pC = cropPixels(pixels, w, h, x - p1, y - p1, x + p2, y + p2, 0);
                                let ssd = 0;
                                let earlyExit = false;
                                const patchArea = patchSize * patchSize;

                                for (let i = 0; i < patchArea; i++) {
                                    if (pM[i] === 1) {
                                        for (let c = 0; c < 4; c++) { // Compare RGBA
                                            const targetVal = pP[c * patchArea + i];
                                            const candVal = pC[c * patchArea + i];
                                            const diff = targetVal - candVal;
                                            ssd += diff * diff;
                                        }
                                        if (ssd >= best_ssd) {
                                            earlyExit = true;
                                            break;
                                        }
                                    }
                                }

                                if (!earlyExit && ssd < best_ssd) {
                                    best_ssd = ssd;
                                    best_x = x;
                                    best_y = y;
                                }
                            }
                            isVisited[idx] = target_index;
                        }
                    }
                }
            }

            if (best_x < 0) {
                // Reduce target priority to retry later
                const pIdx = ((target_y - oy) * dx + (target_x - ox)) * 2;
                priorities[pIdx] /= 10;
                nb_fails++;
                if (nb_fails >= 4) {
                    nb_fails = 0;
                    _lookup_size += Math.floor(_lookup_size / 2);
                    nb_lookups++;
                    if (nb_lookups >= 3) {
                        if (is_strict_search) {
                            is_strict_search = false;
                            _lookup_size = lookupSize;
                            nb_lookups = 0;
                        } else {
                            break; // Pathological case
                        }
                    }
                }
            } else {
                _lookup_size = lookupSize;
                nb_fails = 0;

                // Reconstruct the missing parts on the target patch
                for (let y = -p1; y <= p2; y++) {
                    for (let x = -p1; x <= p2; x++) {
                        const tx = target_x + x;
                        const ty = target_y + y;
                        const bx = best_x + x;
                        const by = best_y + y;

                        if (tx >= 0 && tx < w && ty >= 0 && ty < h && bx >= 0 && bx < w && by >= 0 && by < h) {
                            const mx = tx - ox;
                            const my = ty - oy;
                            if (mx >= 0 && mx < dx && my >= 0 && my < dy) {
                                if (nmask[my * dx + mx] === 0) {
                                    for (let c = 0; c < 4; c++) {
                                        pixels[(ty * w + tx) * 4 + c] = pixels[(by * w + bx) * 4 + c];
                                    }
                                    confidences[my * dx + mx] = target_confidence;
                                    nmask[my * dx + mx] = 1;
                                }
                            }
                        }
                    }
                }

                // Invalidate priorities in a rectangle around the target point
                const rx0 = Math.max(0, target_x - ox - patchSize);
                const ry0 = Math.max(0, target_y - oy - patchSize);
                const rx1 = Math.min(dx - 1, target_x - ox + Math.floor(3 * p2 / 2));
                const ry1 = Math.min(dy - 1, target_y - oy + Math.floor(3 * p2 / 2));
                for (let y = ry0; y <= ry1; y++) {
                    for (let x = rx0; x <= rx1; x++) {
                        priorities[(y * dx + x) * 2] = -1;
                        priorities[(y * dx + x) * 2 + 1] = -1;
                    }
                }

                savedPatches.push({ sx: best_x, sy: best_y, dx: target_x, dy: target_y });
            }
        }

        // 3. Multi-scale Blending
        if (blendSize > 0 && blendScales > 0 && savedPatches.length > 0) {
            let blend_ox = ox;
            let blend_oy = oy;
            let blend_dx = dx;
            let blend_dy = dy;

            if (isBlendOuter) {
                const b2_b = Math.floor(blendSize / 2);
                const b1_b = blendSize - b2_b - 1;
                const xb0 = Math.max(0, ox - b1_b);
                const yb0 = Math.max(0, oy - b1_b);
                const xb1 = Math.min(w - 1, xb0 + dx + b1_b + b2_b);
                const yb1 = Math.min(h - 1, yb0 + dy + b1_b + b2_b);
                blend_ox = xb0;
                blend_oy = yb0;
                blend_dx = xb1 - xb0 + 1;
                blend_dy = yb1 - yb0 + 1;
            }

            const offsetsX = new Int32Array(blend_dx * blend_dy);
            const offsetsY = new Int32Array(blend_dx * blend_dy);

            for (let y = 0; y < blend_dy; y++) {
                for (let x = 0; x < blend_dx; x++) {
                    offsetsX[y * blend_dx + x] = x + blend_ox;
                    offsetsY[y * blend_dx + x] = y + blend_oy;
                }
            }

            // Fill offset mapping backwards
            for (let i = savedPatches.length - 1; i >= 0; i--) {
                const { sx, sy, dx: dX, dy: dY } = savedPatches[i];
                for (let l = -p1; l <= p2; l++) {
                    const ydl = dY + l;
                    if (ydl >= 0 && ydl < h) {
                        for (let k = -p1; k <= p2; k++) {
                            const xdk = dX + k;
                            if (xdk >= 0 && xdk < w) {
                                if (mask[ydl * w + xdk] !== 0) {
                                    const wx = dX - blend_ox + k;
                                    const wy = dY - blend_oy + l;
                                    if (wx >= 0 && wx < blend_dx && wy >= 0 && wy < blend_dy) {
                                        offsetsX[wy * blend_dx + wx] = sx + k;
                                        offsetsY[wy * blend_dx + wx] = sy + l;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Blend map amplitude
            const blendMap = new Float32Array(blend_dx * blend_dy);
            const getOffX = (cx: number, cy: number) => {
                const rx = Math.max(0, Math.min(blend_dx - 1, cx));
                const ry = Math.max(0, Math.min(blend_dy - 1, cy));
                return offsetsX[ry * blend_dx + rx];
            };
            const getOffY = (cx: number, cy: number) => {
                const rx = Math.max(0, Math.min(blend_dx - 1, cx));
                const ry = Math.max(0, Math.min(blend_dy - 1, cy));
                return offsetsY[ry * blend_dx + rx];
            };
            const getPix = (cx: number, cy: number, c: number) => {
                const rx = Math.max(0, Math.min(w - 1, blend_ox + cx));
                const ry = Math.max(0, Math.min(h - 1, blend_oy + cy));
                return pixels[(ry * w + rx) * 4 + c];
            };

            for (let y = 0; y < blend_dy; y++) {
                for (let x = 0; x < blend_dx; x++) {
                    if (mask[(blend_oy + y) * w + (blend_ox + x)] !== 0) {
                        const iox = Math.max(getOffX(x + 1, y) - getOffX(x, y), getOffX(x, y) - getOffX(x - 1, y));
                        const ioy = Math.max(getOffY(x, y + 1) - getOffY(x, y), getOffY(x, y) - getOffY(x, y - 1));
                        const ion = Math.sqrt(iox * iox + ioy * ioy);

                        let iin = 0;
                        for (let c = 0; c < 4; c++) {
                            const Icc = getPix(x, y, c);
                            const Ipc = getPix(x - 1, y, c);
                            const Inc = getPix(x + 1, y, c);
                            const Icp = getPix(x, y - 1, c);
                            const Icn = getPix(x, y + 1, c);

                            const iix = Math.max(Inc - Icc, Icc - Ipc);
                            const iiy = Math.max(Icn - Icc, Icc - Icp);
                            iin += Math.log(1 + iix * iix + iiy * iiy);
                        }
                        iin /= 4;
                        blendMap[y * blend_dx + x] = ion * iin;
                    }
                }
            }

            // Threshold and Distance transform
            let maxVal = 0;
            for (let i = 0; i < blend_dx * blend_dy; i++) {
                if (blendMap[i] > maxVal) maxVal = blendMap[i];
            }
            const threshold = maxVal * blendThreshold;
            const thresholded = new Float32Array(blend_dx * blend_dy);
            for (let i = 0; i < blend_dx * blend_dy; i++) {
                thresholded[i] = blendMap[i] >= threshold ? 1 : 0;
            }

            const distMap = computeDistanceTransform(thresholded, blend_dx, blend_dy);
            for (let i = 0; i < blend_dx * blend_dy; i++) {
                blendMap[i] = 1.0 / (1.0 + blendDecay * distMap[i]);
            }

            let bm = Infinity;
            let bM = -Infinity;
            for (let i = 0; i < blend_dx * blend_dy; i++) {
                if (blendMap[i] < bm) bm = blendMap[i];
                if (blendMap[i] > bM) bM = blendMap[i];
            }

            if (bm === bM) {
                blendMap.fill(blendScales);
            } else {
                for (let i = 0; i < blend_dx * blend_dy; i++) {
                    blendMap[i] = Math.round(((blendMap[i] - bm) / (bM - bm)) * blendScales);
                }
            }

            const result = new Float32Array(blend_dx * blend_dy * 4);
            for (let c = 0; c < 4; c++) {
                for (let y = 0; y < blend_dy; y++) {
                    for (let x = 0; x < blend_dx; x++) {
                        result[(c * blend_dy + y) * blend_dx + x] = pixels[((blend_oy + y) * w + (blend_ox + x)) * 4 + c];
                    }
                }
            }

            for (let blend_iter = 1; blend_iter <= blendScales; blend_iter++) {
                const _blend_width = Math.floor(blend_iter * blendSize / blendScales);
                const blend_width = _blend_width ? (_blend_width + 1 - (_blend_width % 2)) : 0;
                if (blend_width === 0) continue;

                const b2_blend = Math.floor(blend_width / 2);
                const b1_blend = blend_width - b2_blend - 1;

                const blended = new Float32Array(blend_dx * blend_dy * 4);
                for (let c = 0; c < 4; c++) {
                    for (let y = 0; y < blend_dy; y++) {
                        for (let x = 0; x < blend_dx; x++) {
                            blended[(c * blend_dy + y) * blend_dx + x] = pixels[((blend_oy + y) * w + (blend_ox + x)) * 4 + c];
                        }
                    }
                }

                const cumul = new Float32Array(blend_dx * blend_dy);
                for (let y = 0; y < blend_dy; y++) {
                    for (let x = 0; x < blend_dx; x++) {
                        cumul[y * blend_dx + x] = mask[(blend_oy + y) * w + (blend_ox + x)] ? 0.0 : 1.0;
                    }
                }

                for (let c = 0; c < 4; c++) {
                    for (let i = 0; i < blend_dx * blend_dy; i++) {
                        blended[c * blend_dx * blend_dy + i] *= cumul[i];
                    }
                }

                const blendWeights = computeGaussianWeights(blend_width, blend_width / 4.0, false);

                for (const item of savedPatches) {
                    for (let l = -b1_blend; l <= b2_blend; l++) {
                        const srcY = item.sy + l;
                        const destY = item.dy + l;
                        if (srcY >= 0 && srcY < h && destY >= 0 && destY < h) {
                            for (let k = -b1_blend; k <= b2_blend; k++) {
                                const srcX = item.sx + k;
                                const destX = item.dx + k;
                                if (srcX >= 0 && srcX < w && destX >= 0 && destX < w) {
                                    const wx = destX - blend_ox;
                                    const wy = destY - blend_oy;
                                    if (wx >= 0 && wx < blend_dx && wy >= 0 && wy < blend_dy) {
                                        const weight = blendWeights[(l + b1_blend) * blend_width + (k + b1_blend)];
                                        for (let c = 0; c < 4; c++) {
                                            const originalVal = pixels[(srcY * w + srcX) * 4 + c];
                                            blended[(c * blend_dy + wy) * blend_dx + wx] += weight * originalVal;
                                        }
                                        cumul[wy * blend_dx + wx] += weight;
                                    }
                                }
                            }
                        }
                    }
                }

                for (let y = 0; y < blend_dy; y++) {
                    for (let x = 0; x < blend_dx; x++) {
                        const isMatch = isBlendOuter ? 
                            (blendMap[y * blend_dx + x] === blend_iter) : 
                            (mask[(blend_oy + y) * w + (blend_ox + x)] !== 0 && blendMap[y * blend_dx + x] === blend_iter);
                        if (isMatch) {
                            const cum = cumul[y * blend_dx + x];
                            if (cum > 0) {
                                for (let c = 0; c < 4; c++) {
                                    result[(c * blend_dy + y) * blend_dx + x] = blended[(c * blend_dy + y) * blend_dx + x] / cum;
                                }
                            }
                        }
                    }
                }
            }

            for (let y = 0; y < blend_dy; y++) {
                for (let x = 0; x < blend_dx; x++) {
                    const shouldWrite = isBlendOuter ? 
                        true : 
                        (mask[(blend_oy + y) * w + (blend_ox + x)] !== 0);
                    if (shouldWrite) {
                        for (let c = 0; c < 4; c++) {
                            const val = result[(c * blend_dy + y) * blend_dx + x];
                            pixels[((blend_oy + y) * w + (blend_ox + x)) * 4 + c] = Math.max(0, Math.min(255, Math.round(val)));
                        }
                    }
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }

    // Helper functions
    function computeGaussianWeights(size: number, sigma: number, normalizePeak = true): Float32Array {
        const weights = new Float32Array(size * size);
        const p2 = Math.floor(size / 2);
        const p1 = size - p2 - 1;
        const den = normalizePeak ? (size * size) : 1.0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - p1;
                const dy = y - p1;
                const val = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
                weights[y * size + x] = val / den;
            }
        }
        return weights;
    }

    function cropPixels(
        pixels: Uint8ClampedArray,
        w: number,
        h: number,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        boundary: number
    ): Float32Array {
        const pw = x1 - x0 + 1;
        const ph = y1 - y0 + 1;
        const out = new Float32Array(pw * ph * 4);
        for (let c = 0; c < 4; c++) {
            for (let y = 0; y < ph; y++) {
                for (let x = 0; x < pw; x++) {
                    const imgX = x0 + x;
                    const imgY = y0 + y;
                    let val = boundary;
                    if (imgX >= 0 && imgX < w && imgY >= 0 && imgY < h) {
                        val = pixels[(imgY * w + imgX) * 4 + c];
                    } else if (boundary >= 2) {
                        const rx = Math.max(0, Math.min(w - 1, imgX));
                        const ry = Math.max(0, Math.min(h - 1, imgY));
                        val = pixels[(ry * w + rx) * 4 + c];
                    }
                    out[(c * ph + y) * pw + x] = val;
                }
            }
        }
        return out;
    }

    function cropNMask(
        nmask: Uint8Array,
        dx: number,
        dy: number,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        boundary: number
    ): Uint8Array {
        const pw = x1 - x0 + 1;
        const ph = y1 - y0 + 1;
        const out = new Uint8Array(pw * ph);
        for (let y = 0; y < ph; y++) {
            for (let x = 0; x < pw; x++) {
                const imgX = x0 + x;
                const imgY = y0 + y;
                let val = boundary;
                if (imgX >= 0 && imgX < dx && imgY >= 0 && imgY < dy) {
                    val = nmask[imgY * dx + imgX];
                } else if (boundary >= 2) {
                    const rx = Math.max(0, Math.min(dx - 1, imgX));
                    const ry = Math.max(0, Math.min(dy - 1, imgY));
                    val = nmask[ry * dx + rx];
                }
                out[y * pw + x] = val;
            }
        }
        return out;
    }

    function cropMask(
        mask: Uint8Array,
        w: number,
        h: number,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        boundary: number
    ): Uint8Array {
        const pw = x1 - x0 + 1;
        const ph = y1 - y0 + 1;
        const out = new Uint8Array(pw * ph);
        for (let y = 0; y < ph; y++) {
            for (let x = 0; x < pw; x++) {
                const imgX = x0 + x;
                const imgY = y0 + y;
                let val = boundary;
                if (imgX >= 0 && imgX < w && imgY >= 0 && imgY < h) {
                    val = mask[imgY * w + imgX];
                } else if (boundary >= 2) {
                    const rx = Math.max(0, Math.min(w - 1, imgX));
                    const ry = Math.max(0, Math.min(h - 1, imgY));
                    val = mask[ry * w + rx];
                }
                out[y * pw + x] = val;
            }
        }
        return out;
    }

    function computeDistanceTransform(grid: Float32Array, dx: number, dy: number): Float32Array {
        const dist = new Float32Array(dx * dy).fill(1e9);
        const queue: number[] = [];
        for (let i = 0; i < dx * dy; i++) {
            if (grid[i] > 0) {
                dist[i] = 0;
                queue.push(i);
            }
        }
        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            const x = idx % dx;
            const y = Math.floor(idx / dx);
            const d = dist[idx];
            const neighbors = [
                [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
            ];
            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < dx && ny >= 0 && ny < dy) {
                    const nidx = ny * dx + nx;
                    if (dist[nidx] > d + 1) {
                        dist[nidx] = d + 1;
                        queue.push(nidx);
                    }
                }
            }
        }
        return dist;
    }
}
