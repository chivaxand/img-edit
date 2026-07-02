export const kernel = {
    // Creates a Gaussian Blur Kernel
    gaussian(size: number, sigma: number): number[][] {
        sigma = Math.max(0.001, sigma);
        const kernel: number[][] = [];
        const center = Math.floor(size / 2);
        let sum = 0;
        for (let y = 0; y < size; y++) {
            const row: number[] = [];
            for (let x = 0; x < size; x++) {
                const distSq = (x - center) ** 2 + (y - center) ** 2;
                const val = Math.exp(-distSq / (2 * sigma * sigma));
                row.push(val);
                sum += val;
            }
            kernel.push(row);
        }
        return kernel.map(r => r.map(v => v / sum));
    },

    // Creates a Motion Blur Kernel (Line)
    motion(size: number, angleDeg: number, length?: number): number[][] {
        const kernel: number[][] = [];
        const center = Math.floor(size / 2);
        const len = length !== undefined ? length / 2 : (size - 1) / 2;
        const rad = angleDeg * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const x1 = center - len * cos;
        const y1 = center - len * sin;
        const x2 = center + len * cos;
        const y2 = center + len * sin;
        let sum = 0;
        for (let y = 0; y < size; y++) {
            const row: number[] = [];
            for (let x = 0; x < size; x++) {
                const dist = this.pointLineDist(x, y, x1, y1, x2, y2);
                const val = Math.max(0, 1.0 - dist); // Anti-aliased line
                row.push(val);
                sum += val;
            }
            kernel.push(row);
        }
        if (sum === 0) { kernel[center][center] = 1; sum = 1; }
        return kernel.map(r => r.map(v => v / sum));
    },

    nextPowerOf2(n: number): number { return Math.pow(2, Math.ceil(Math.log2(n))); },

    distance(x1: number, y1: number, x2: number, y2: number): number { return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)); },
    
    pointLineDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
        const C = x2 - x1, D = y2 - y1;
        const lenSq = C * C + D * D;
        if (lenSq === 0) return this.distance(px, py, x1, y1); 
        let t = ((px - x1) * C + (py - y1) * D) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const xx = x1 + t * C;
        const yy = y1 + t * D;
        return this.distance(px, py, xx, yy);
    },

    // Creates a Defocus Kernel (Disk)
    disk(size: number, radius: number = size / 2): number[][] {
        const kernel: number[][] = [];
        const center = size / 2 - 0.5;
        let sum = 0;
        for (let y = 0; y < size; y++) {
            const row: number[] = [];
            for (let x = 0; x < size; x++) {
                const dx = x - center, dy = y - center;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const val = Math.max(0, Math.min(1, 0.5 - (dist - radius)));
                row.push(val);
                sum += val;
            }
            kernel.push(row);
        }
        const cInt = Math.floor(center + 0.5);
        if (!sum) kernel[cInt][cInt] = sum = 1;
        return kernel.map(r => r.map(v => v / sum));
    }
};