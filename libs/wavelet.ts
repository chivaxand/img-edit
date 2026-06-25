export const wavelet = {
    // Performs Multilevel 2D Haar Transform.
    // Returns: [ {data, w, h} (LL_final), {LH, HL, HH, nw, nh} (Level N), ..., {LH...} (Level 1) ]
    wavedec2(data: Float32Array | number[], w: number, h: number, maxLevels: number): any[] {
        const coeffs: any[] = [];
        let currentLL = data;
        let cw = w, ch = h;
        let level = 0;

        while (level < maxLevels && cw >= 2 && ch >= 2) {
            const res = this.dwtStep(currentLL, cw, ch);
            coeffs.push({ 
                LH: res.LH, HL: res.HL, HH: res.HH, 
                nw: res.nw, nh: res.nh 
            });
            currentLL = res.LL;
            cw = res.nw;
            ch = res.nh;
            level++;
        }

        const result = [ { data: currentLL, w: cw, h: ch } ];
        
        // Reverse coeffs so index 1 is Deepest Level (Coarse)
        for (let i = coeffs.length - 1; i >= 0; i--) {
            result.push(coeffs[i]);
        }

        return result;
    },

    // Single Level DWT (Haar) with Symmetric Padding
    dwtStep(src: Float32Array | number[], w: number, h: number) {
        const nw = Math.ceil(w / 2);
        const nh = Math.ceil(h / 2);
        const size = nw * nh;
        
        const LL = new Float32Array(size); // Low-Pass
        const HL = new Float32Array(size); // Horizontal Detail (Vertical Edges)
        const LH = new Float32Array(size); // Vertical Detail (Horizontal Edges)
        const HH = new Float32Array(size); // Diagonal Detail

        const s = 0.70710678; // 1/sqrt(2) for Orthonormal Transform

        for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) {
                // Source indices with Mirror Padding
                const sx0 = x * 2;
                const sx1 = Math.min(sx0 + 1, w - 1);
                const sy0 = y * 2;
                const sy1 = Math.min(sy0 + 1, h - 1);
                const r0 = sy0 * w;
                const r1 = sy1 * w;
                const p00 = src[r0 + sx0];
                const p01 = src[r0 + sx1];
                const p10 = src[r1 + sx0];
                const p11 = src[r1 + sx1];

                // Haar Transform
                // Rows
                const l0 = (p00 + p01) * s;
                const h0 = (p00 - p01) * s;
                const l1 = (p10 + p11) * s;
                const h1 = (p10 - p11) * s;

                // Cols (Vertical)
                const idx = y * nw + x;
                LL[idx] = (l0 + l1) * s;
                LH[idx] = (l0 - l1) * s;
                HL[idx] = (h0 + h1) * s;
                HH[idx] = (h0 - h1) * s;
            }
        }
        return { LL, LH, HL, HH, nw, nh };
    }
};