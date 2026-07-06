import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('kuwahara', {
    name: 'Anisotropic Kuwahara',
    mode: 'pixel',
    menu: {
        path: 'Filter/Stylize',
        label: 'Kuwahara...',
        order: 5
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            radius: 6,
            sharpness: 6.0,
            eccentricity: 1.0,
            smoothing: 2.0
        };
        
        const update = () => hooks.preview(state);

        container.appendChild(UI.createNode('div', { className: 'popup-hint' }, 
            'Polynomial implementation based on Kyprianidis (2010).'));

        container.appendChild(UI.createSliderRow({
            label: 'Radius', min: 2, max: 14, step: 1, value: state.radius,
            onChange: v => { state.radius = parseInt(v); update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Sharpness', min: 1.0, max: 20.0, step: 0.5, value: state.sharpness,
            onChange: v => { state.sharpness = parseFloat(v); update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Eccentricity', min: 0.1, max: 1.0, step: 0.05, value: state.eccentricity,
            onChange: v => { state.eccentricity = parseFloat(v); update(); }
        }));
        container.appendChild(UI.createSliderRow({
            label: 'Structure Smooth', min: 0.5, max: 10.0, step: 0.1, value: state.smoothing,
            onChange: v => { state.smoothing = parseFloat(v); update(); }
        }));
        
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const { radius, sharpness, eccentricity, smoothing } = params;
        const src = new Uint8ClampedArray(data);
        
        // --- Pass 1: Structure Tensor (SST) ---
        const tensorField = new Float32Array(w * h * 3);
        
        // Weights from df_StructureTensor
        const corner_weight = 0.182;
        const center_weight = 1.0 - 2.0 * corner_weight;

        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            const prevRow = Math.max(0, y - 1) * w;
            const nextRow = Math.min(h - 1, y + 1) * w;

            for (let x = 0; x < w; x++) {
                const left = Math.max(0, x - 1);
                const right = Math.min(w - 1, x + 1);

                // Helper to get luminance/vector value. 
                // Fetch 3x3 neighborhood
                const idx_xm_yp = (nextRow + left) * 4;
                const idx_x_yp  = (nextRow + x) * 4;
                const idx_xp_yp = (nextRow + right) * 4;
                
                const idx_xm_y  = (rowOffset + left) * 4;
                const idx_xp_y  = (rowOffset + right) * 4;
                
                const idx_xm_ym = (prevRow + left) * 4;
                const idx_x_ym  = (prevRow + x) * 4;
                const idx_xp_ym = (prevRow + right) * 4;

                let dxdx = 0, dxdy = 0, dydy = 0;

                // Loop RGB channels (0, 1, 2)
                for (let c = 0; c < 3; c++) {
                    const v_xm_yp = src[idx_xm_yp + c];
                    const v_x_yp  = src[idx_x_yp + c];
                    const v_xp_yp = src[idx_xp_yp + c];
                    
                    const v_xm_y  = src[idx_xm_y + c];
                    const v_xp_y  = src[idx_xp_y + c];
                    
                    const v_xm_ym = src[idx_xm_ym + c];
                    const v_x_ym  = src[idx_x_ym + c];
                    const v_xp_ym = src[idx_xp_ym + c];

                    // X Derivative
                    const dx = (v_xm_yp * -corner_weight) + (v_xm_y * -center_weight) + (v_xm_ym * -corner_weight) +
                               (v_xp_yp *  corner_weight) + (v_xp_y *  center_weight) + (v_xp_ym *  corner_weight);

                    // Y Derivative
                    const dy = (v_xm_yp * corner_weight) + (v_x_yp * center_weight) + (v_xp_yp * corner_weight) +
                               (v_xm_ym * -corner_weight) + (v_x_ym * -center_weight) + (v_xp_ym * -corner_weight);

                    dxdx += dx * dx;
                    dxdy += dx * dy;
                    dydy += dy * dy;
                }

                const ti = (rowOffset + x) * 3;
                tensorField[ti]     = dxdx;
                tensorField[ti + 1] = dxdy;
                tensorField[ti + 2] = dydy;
            }
        }

        // --- Pass 2: Smooth Structure Tensor ---
        // Standard Gaussian smoothing
        const smoothedTensor = new Float32Array(w * h * 3);
        const kSize = Math.ceil(2.0 * smoothing);
        const kernel = new Float32Array(kSize * 2 + 1);
        let kSum = 0;
        for (let i = -kSize; i <= kSize; i++) {
            const val = Math.exp(-(i * i) / (2 * smoothing * smoothing));
            kernel[i + kSize] = val;
            kSum += val;
        }
        for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

        const tempTensor = new Float32Array(w * h * 3);

        // Horizontal
        for (let y = 0; y < h; y++) {
            const rowOff = y * w;
            for (let x = 0; x < w; x++) {
                let e = 0, f = 0, g = 0;
                for (let i = -kSize; i <= kSize; i++) {
                    const sx = Math.min(Math.max(x + i, 0), w - 1);
                    const idx = (rowOff + sx) * 3;
                    const wgt = kernel[i + kSize];
                    e += tensorField[idx] * wgt;
                    f += tensorField[idx + 1] * wgt;
                    g += tensorField[idx + 2] * wgt;
                }
                const idx = (rowOff + x) * 3;
                tempTensor[idx] = e; tempTensor[idx+1] = f; tempTensor[idx+2] = g;
            }
        }
        // Vertical
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                let e = 0, f = 0, g = 0;
                for (let i = -kSize; i <= kSize; i++) {
                    const sy = Math.min(Math.max(y + i, 0), h - 1);
                    const idx = (sy * w + x) * 3;
                    const wgt = kernel[i + kSize];
                    e += tempTensor[idx] * wgt;
                    f += tempTensor[idx + 1] * wgt;
                    g += tempTensor[idx + 2] * wgt;
                }
                const idx = (y * w + x) * 3;
                smoothedTensor[idx] = e; smoothedTensor[idx+1] = f; smoothedTensor[idx+2] = g;
            }
        }

        // --- Pass 3: Anisotropic Kuwahara (Polynomial) ---
        const result = new Uint8ClampedArray(data.length);
        
        // Constants for polynomial calculation
        const number_of_sectors = 8;
        const PI = Math.PI;
        
        // Accumulator arrays
        const m_r = new Float32Array(8);
        const m_g = new Float32Array(8);
        const m_b = new Float32Array(8);
        const s_r = new Float32Array(8);
        const s_g = new Float32Array(8);
        const s_b = new Float32Array(8);
        const w_sum = new Float32Array(8);
        const sector_weights = new Float32Array(8);

        // 1/sqrt(2)
        const M_SQRT1_2 = 0.70710678;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const tIdx = (y * w + x) * 3;
                
                const dxdx = smoothedTensor[tIdx];
                const dxdy = smoothedTensor[tIdx + 1];
                const dydy = smoothedTensor[tIdx + 2];

                // Eigenvalues
                const first_term = (dxdx + dydy) / 2.0;
                const root_term = Math.sqrt((dxdx - dydy) ** 2 + 4.0 * (dxdy ** 2)) / 2.0;
                const lambda1 = first_term + root_term;
                const lambda2 = first_term - root_term;

                // Eigenvector (major direction)
                // v = (lambda1 - dxdx, -dxdy)
                let vx = lambda1 - dxdx;
                let vy = -dxdy;
                let vLen = Math.sqrt(vx*vx + vy*vy);
                if (vLen > 0) {
                    vx /= vLen; vy /= vLen;
                } else {
                    vx = 1; vy = 0;
                }
                
                // Anisotropy
                const sumL = lambda1 + lambda2;
                const diffL = lambda1 - lambda2;
                const anisotropy = sumL > 0 ? diffL / sumL : 0;

                // Ellipse Shape
                const eccentricity_clamp = Math.min(eccentricity, 0.95);
                const eccentric_adj = (1.0 - eccentricity_clamp) * 10.0;
                const width_factor = (eccentric_adj + anisotropy) / eccentric_adj;
                
                const ellipse_width = width_factor * radius;
                const ellipse_height = radius / width_factor;

                const cosine = vx; 
                const sine = vy;

                // Inverse Matrix components (S * R)
                // invMatrix1 = (cos/w, sin/w)
                // invMatrix2 = (-sin/h, cos/h)
                const m11 = cosine / ellipse_width;
                const m12 = sine / ellipse_width;
                const m21 = -sine / ellipse_height;
                const m22 = cosine / ellipse_height;

                // Bounding Box
                const major_x = ellipse_width * vx;
                const major_y = ellipse_width * vy;
                const minor_x = ellipse_height * vy * -1.0;
                const minor_y = ellipse_height * vx;

                const bounds_x = Math.ceil(Math.sqrt(major_x*major_x + minor_x*minor_x));
                const bounds_y = Math.ceil(Math.sqrt(major_y*major_y + minor_y*minor_y));

                // Polynomial Parameters
                const sector_center_overlap = 2.0 / radius;
                const sector_envelope_angle = (1.5 * PI) / number_of_sectors;
                const cross_sector_overlap = (sector_center_overlap + Math.cos(sector_envelope_angle)) / 
                                             (Math.sin(sector_envelope_angle) ** 2);

                // Reset Accumulators
                // Center pixel special handling
                const cIdx = (y * w + x) * 4;
                const cr = src[cIdx], cg = src[cIdx+1], cb = src[cIdx+2];
                const cr2 = cr*cr, cg2 = cg*cg, cb2 = cb*cb;
                const center_w = 1.0 / number_of_sectors;

                for (let k = 0; k < 8; k++) {
                    m_r[k] = cr * center_w;
                    m_g[k] = cg * center_w;
                    m_b[k] = cb * center_w;
                    s_r[k] = cr2 * center_w;
                    s_g[k] = cg2 * center_w;
                    s_b[k] = cb2 * center_w;
                    w_sum[k] = center_w;
                }

                // Loop over Upper Half of Bounding Box (Symmetry Opt)
                for (let j = 0; j <= bounds_y; j++) {
                    const absY = Math.abs(j);
                    // Precompute part of the matrix multiply for Y
                    const my1 = m12 * j;
                    const my2 = m22 * j;

                    const sampleY_up = y + j;
                    const sampleY_down = y - j;
                    
                    // Check bounds Y
                    const up_ok = sampleY_up < h;
                    const down_ok = sampleY_down >= 0;
                    if (!up_ok && !down_ok) continue;

                    for (let i = -bounds_x; i <= bounds_x; i++) {
                        // Skip center (handled) and redundant mirrored X on Y=0 line
                        if (j === 0 && i <= 0) continue;

                        // Map to unit disc
                        const dx = m11 * i + my1;
                        const dy = m21 * i + my2;
                        
                        const r2 = dx*dx + dy*dy;
                        if (r2 > 1.0) continue;

                        // Polynomial Weights Calculation
                        // Base weights (0, 90, 180, 270 deg)
                        const px = sector_center_overlap - cross_sector_overlap * dx*dx;
                        const py = sector_center_overlap - cross_sector_overlap * dy*dy;

                        sector_weights[0] = Math.max(0,  dy + px) ** 2;
                        sector_weights[2] = Math.max(0, -dx + py) ** 2;
                        sector_weights[4] = Math.max(0, -dy + px) ** 2;
                        sector_weights[6] = Math.max(0,  dx + py) ** 2;

                        // Rotated weights (45, 135, 225, 315 deg)
                        // Rotate 45 deg
                        const rdx = M_SQRT1_2 * (dx - dy);
                        const rdy = M_SQRT1_2 * (dx + dy);

                        const rpx = sector_center_overlap - cross_sector_overlap * rdx*rdx;
                        const rpy = sector_center_overlap - cross_sector_overlap * rdy*rdy;

                        sector_weights[1] = Math.max(0,  rdy + rpx) ** 2;
                        sector_weights[3] = Math.max(0, -rdx + rpy) ** 2;
                        sector_weights[5] = Math.max(0, -rdy + rpx) ** 2;
                        sector_weights[7] = Math.max(0,  rdx + rpy) ** 2;

                        // Radial Gaussian
                        let sum_sw = 0;
                        for(let k=0; k<8; k++) sum_sw += sector_weights[k];
                        
                        // Avoid div by zero (though if inside unit disc, usually > 0)
                        if (sum_sw < 1e-6) continue;

                        const rad_w = Math.exp(-PI * r2) / sum_sw;

                        // Sample Pixels (Mirrored)
                        // Upper Pixel (x+i, y+j)
                        if (up_ok) {
                            const sx = x + i;
                            if (sx >= 0 && sx < w) {
                                const off = (sampleY_up * w + sx) * 4;
                                const r = src[off], g = src[off+1], b = src[off+2];
                                const r2v = r*r, g2v = g*g, b2v = b*b;

                                for (let k = 0; k < 8; k++) {
                                    const wgt = sector_weights[k] * rad_w;
                                    m_r[k] += r * wgt;
                                    m_g[k] += g * wgt;
                                    m_b[k] += b * wgt;
                                    s_r[k] += r2v * wgt;
                                    s_g[k] += g2v * wgt;
                                    s_b[k] += b2v * wgt;
                                    w_sum[k] += wgt;
                                }
                            }
                        }

                        // Lower Pixel (x-i, y-j) - Mirrored
                        if (down_ok) {
                            const sx = x - i;
                            if (sx >= 0 && sx < w) {
                                const off = (sampleY_down * w + sx) * 4;
                                const r = src[off], g = src[off+1], b = src[off+2];
                                const r2v = r*r, g2v = g*g, b2v = b*b;

                                for (let k = 0; k < 8; k++) {
                                    const wgt = sector_weights[k] * rad_w;
                                    // Mirror logic: Sector k maps to Sector (k + 4) % 8
                                    const k_mirror = (k + 4) % 8;
                                    
                                    m_r[k_mirror] += r * wgt;
                                    m_g[k_mirror] += g * wgt;
                                    m_b[k_mirror] += b * wgt;
                                    s_r[k_mirror] += r2v * wgt;
                                    s_g[k_mirror] += g2v * wgt;
                                    s_b[k_mirror] += b2v * wgt;
                                    w_sum[k_mirror] += wgt;
                                }
                            }
                        }
                    }
                }

                // Final Combination
                let final_r = 0, final_g = 0, final_b = 0, final_w = 0;
                const normalized_sharpness = sharpness;

                for (let k = 0; k < 8; k++) {
                    const wk = w_sum[k];
                    if (wk <= 0) continue;

                    const mean_r = m_r[k] / wk;
                    const mean_g = m_g[k] / wk;
                    const mean_b = m_b[k] / wk;

                    // Variance = Mean(Square) - Mean^2
                    const mean_r2 = s_r[k] / wk;
                    const mean_g2 = s_g[k] / wk;
                    const mean_b2 = s_b[k] / wk;

                    const var_r = Math.abs(mean_r2 - mean_r * mean_r);
                    const var_g = Math.abs(mean_g2 - mean_g * mean_g);
                    const var_b = Math.abs(mean_b2 - mean_b * mean_b);

                    const std_dev = Math.sqrt(var_r + var_g + var_b);

                    // Weight calculation
                    const std_dev_norm = std_dev / 255.0;
                    const w_k = 1.0 / Math.pow(Math.max(0.02, std_dev_norm), normalized_sharpness);

                    final_r += mean_r * w_k;
                    final_g += mean_g * w_k;
                    final_b += mean_b * w_k;
                    final_w += w_k;
                }

                const outOff = tIdx / 3 * 4;
                result[outOff]   = final_r / final_w;
                result[outOff+1] = final_g / final_w;
                result[outOff+2] = final_b / final_w;
                result[outOff+3] = 255;
            }
        }
        
        data.set(result);
    }
});
