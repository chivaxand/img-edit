export interface MeshPoint {
    x: number;
    y: number;
}

export interface Triangle {
    indices: [number, number, number];
}

export const mesh = {
    drawTriangleSoftware(
        dstData: Uint8ClampedArray,
        w: number, h: number,
        p0: MeshPoint, p1: MeshPoint, p2: MeshPoint,
        q0: MeshPoint, q1: MeshPoint, q2: MeshPoint,
        sampler: (u: number, v: number, c: number) => number
    ) {
        const minX = Math.max(0, Math.floor(Math.min(q0.x, q1.x, q2.x)));
        const maxX = Math.min(w - 1, Math.ceil(Math.max(q0.x, q1.x, q2.x)));
        const minY = Math.max(0, Math.floor(Math.min(q0.y, q1.y, q2.y)));
        const maxY = Math.min(h - 1, Math.ceil(Math.max(q0.y, q1.y, q2.y)));
        const denom = (q1.y - q2.y) * (q0.x - q2.x) + (q2.x - q1.x) * (q0.y - q2.y);
        if (Math.abs(denom) < 1e-8) return;
        const invDenom = 1.0 / denom;

        // Coefficients for the edge equations
        const f01_y = q0.y - q1.y;
        const f01_x = q1.x - q0.x;
        const f01_c = q0.x * q1.y - q1.x * q0.y;

        const f12_y = q1.y - q2.y;
        const f12_x = q2.x - q1.x;
        const f12_c = q1.x * q2.y - q2.x * q1.y;

        const f20_y = q2.y - q0.y;
        const f20_x = q0.x - q2.x;
        const f20_c = q2.x * q0.y - q0.x * q2.y;

        // Standard edge alignment bias
        const bias0 = (f12_y < 0 || (f12_y === 0 && f12_x > 0)) ? 0 : -1e-4;
        const bias1 = (f20_y < 0 || (f20_y === 0 && f20_x > 0)) ? 0 : -1e-4;
        const bias2 = (f01_y < 0 || (f01_y === 0 && f01_x > 0)) ? 0 : -1e-4;

        // Loop over the bounding box
        for (let y = minY; y <= maxY; y++) {
            const rowOffset = y * w;

            // Initial edge values at (minX, y)
            let w0_row = (f12_y * minX + f12_x * y + f12_c) * invDenom;
            let w1_row = (f20_y * minX + f20_x * y + f20_c) * invDenom;
            let w2_row = (f01_y * minX + f01_x * y + f01_c) * invDenom;

            // Step increments along X
            const dw0 = f12_y * invDenom;
            const dw1 = f20_y * invDenom;
            const dw2 = f01_y * invDenom;

            for (let x = minX; x <= maxX; x++) {
                if (w0_row >= bias0 && w1_row >= bias1 && w2_row >= bias2) {
                    const u = w0_row * p0.x + w1_row * p1.x + w2_row * p2.x;
                    const v = w0_row * p0.y + w1_row * p1.y + w2_row * p2.y;
                    const idx = (rowOffset + x) * 4;

                    dstData[idx]     = sampler(u, v, 0);
                    dstData[idx + 1] = sampler(u, v, 1);
                    dstData[idx + 2] = sampler(u, v, 2);
                    dstData[idx + 3] = sampler(u, v, 3);
                }

                // Increment edge weights for next column step
                w0_row += dw0;
                w1_row += dw1;
                w2_row += dw2;
            }
        }
    },

    /**
     * Affine mapping via Canvas rendering context clipping path.
     */
    drawTriangleHardware(
        bCtx: CanvasRenderingContext2D,
        img: HTMLCanvasElement,
        p0: MeshPoint, p1: MeshPoint, p2: MeshPoint,
        q0: MeshPoint, q1: MeshPoint, q2: MeshPoint
    ) {
        bCtx.save();
        bCtx.setTransform(1, 0, 0, 1, 0, 0);

        const cx = (q0.x + q1.x + q2.x) / 3;
        const cy = (q0.y + q1.y + q2.y) / 3;
        const expandX = (x: number) => x + (x - cx === 0 ? 0 : (x - cx > 0 ? 0.4 : -0.4));
        const expandY = (y: number) => y + (y - cy === 0 ? 0 : (y - cy > 0 ? 0.4 : -0.4));

        bCtx.beginPath();
        bCtx.moveTo(expandX(q0.x), expandY(q0.y));
        bCtx.lineTo(expandX(q1.x), expandY(q1.y));
        bCtx.lineTo(expandX(q2.x), expandY(q2.y));
        bCtx.closePath();
        bCtx.clip();

        const dX1 = q1.x - q0.x, dY1 = q1.y - q0.y;
        const dX2 = q2.x - q0.x, dY2 = q2.y - q0.y;
        const dU1 = p1.x - p0.x, dV1 = p1.y - p0.y;
        const dU2 = p2.x - p0.x, dV2 = p2.y - p0.y;
        const det = dU1 * dV2 - dU2 * dV1;
        
        if (Math.abs(det) > 1e-6) {
            const id = 1.0 / det;
            const a = id * (dV2 * dX1 - dV1 * dX2);
            const b = id * (dV2 * dY1 - dV1 * dY2);
            const c = id * (dU1 * dX2 - dU2 * dX1);
            const d = id * (dU1 * dY2 - dU2 * dY1);
            const e = q0.x - a * p0.x - c * p0.y;
            const f = q0.y - b * p0.x - d * p0.y;
            bCtx.setTransform(a, b, c, d, e, f);
            bCtx.drawImage(img, 0, 0);
        }
        bCtx.restore();
    },

    /**
     * Resolves barycentric parameters for a given point relative to a triangle.
     */
    solveBarycentric(
        p0: MeshPoint, p1: MeshPoint, p2: MeshPoint,
        x: number, y: number
    ): [number, number, number] {
        const denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
        if (Math.abs(denom) < 1e-12) return [0, 0, 0];
        const invDenom = 1.0 / denom;
        const w0 = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) * invDenom;
        const w1 = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) * invDenom;
        const w2 = 1.0 - w0 - w1;
        return [w0, w1, w2];
    },

    /**
     * Checks if a point is inside an arbitrary polygon using ray-casting.
     */
    isPointInPolygon(p: MeshPoint, polygon: MeshPoint[]): boolean {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const intersect = ((yi > p.y) !== (yj > p.y))
                && (p.x < (xj - xi) * (p.y - yi) / (yj - yi || 1) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },

    /**
     * Solves the $2 \times 3$ affine transform matrix mapping a source triangle to a destination triangle.
     * Returns an array of matrix values: [a, b, c, d, tx, ty]
     */
    solveAffineTransform(
        p0: MeshPoint, p1: MeshPoint, p2: MeshPoint,
        q0: MeshPoint, q1: MeshPoint, q2: MeshPoint
    ): Float64Array | null {
        const dU1 = p1.x - p0.x, dV1 = p1.y - p0.y;
        const dU2 = p2.x - p0.x, dV2 = p2.y - p0.y;
        const det = dU1 * dV2 - dU2 * dV1;

        if (Math.abs(det) < 1e-12) return null;
        const invDet = 1.0 / det;

        const dX1 = q1.x - q0.x, dY1 = q1.y - q0.y;
        const dX2 = q2.x - q0.x, dY2 = q2.y - q0.y;

        const a = invDet * (dV2 * dX1 - dV1 * dX2);
        const b = invDet * (dV2 * dY1 - dV1 * dY2);
        const c = invDet * (dU1 * dX2 - dU2 * dX1);
        const d = invDet * (dU1 * dY2 - dU2 * dY1);
        const tx = q0.x - a * p0.x - c * p0.y;
        const ty = q0.y - b * p0.x - d * p0.y;

        return new Float64Array([a, b, c, d, tx, ty]);
    },

    /**
     * Bowyer-Watson incremental Delaunay Triangulation algorithm.
     * Takes an arbitrary array of points and builds a non-overlapping triangular mesh topology.
     */
    delaunay(points: MeshPoint[]): Triangle[] {
        if (points.length < 3) return [];

        let minX = points[0].x, maxX = minX;
        let minY = points[0].y, maxY = minY;
        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        const dx = maxX - minX;
        const dy = maxY - minY;
        const deltaMax = Math.max(dx, dy);
        const midX = (minX + maxX) * 0.5;
        const midY = (minY + maxY) * 0.5;

        const st0: MeshPoint = { x: midX - 20 * deltaMax, y: midY - deltaMax };
        const st1: MeshPoint = { x: midX, y: midY + 20 * deltaMax };
        const st2: MeshPoint = { x: midX + 20 * deltaMax, y: midY - deltaMax };

        const pts = [...points, st0, st1, st2];
        const nST0 = points.length;
        const nST1 = points.length + 1;
        const nST2 = points.length + 2;

        interface TempTriangle {
            p0: number;
            p1: number;
            p2: number;
            cx: number;
            cy: number;
            rSq: number;
        }

        const getCircumcircle = (i0: number, i1: number, i2: number): TempTriangle => {
            const v0 = pts[i0], v1 = pts[i1], v2 = pts[i2];
            const d = 2 * (v0.x * (v1.y - v2.y) + v1.x * (v2.y - v0.y) + v2.x * (v0.y - v1.y));
            if (Math.abs(d) < 1e-9) {
                return { p0: i0, p1: i1, p2: i2, cx: 0, cy: 0, rSq: 0 };
            }
            const ux = ((v0.x * v0.x + v0.y * v0.y) * (v1.y - v2.y) + (v1.x * v1.x + v1.y * v1.y) * (v2.y - v0.y) + (v2.x * v2.x + v2.y * v2.y) * (v0.y - v1.y)) / d;
            const uy = ((v0.x * v0.x + v0.y * v0.y) * (v2.x - v1.x) + (v1.x * v1.x + v1.y * v1.y) * (v0.x - v2.x) + (v2.x * v2.x + v2.y * v2.y) * (v1.x - v0.x)) / d;
            const rx = v0.x - ux;
            const ry = v0.y - uy;
            return { p0: i0, p1: i1, p2: i2, cx: ux, cy: uy, rSq: rx * rx + ry * ry };
        };

        let triangles: TempTriangle[] = [getCircumcircle(nST0, nST1, nST2)];

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const polygon: [number, number][] = [];

            triangles = triangles.filter(t => {
                const dx = p.x - t.cx;
                const dy = p.y - t.cy;
                const inside = (dx * dx + dy * dy) < t.rSq;
                if (inside) {
                    polygon.push([t.p0, t.p1], [t.p1, t.p2], [t.p2, t.p0]);
                }
                return !inside;
            });

            const edges: [number, number][] = [];
            for (let j = 0; j < polygon.length; j++) {
                const edge = polygon[j];
                let unique = true;
                for (let k = 0; k < polygon.length; k++) {
                    if (j === k) continue;
                    const test = polygon[k];
                    if ((edge[0] === test[0] && edge[1] === test[1]) || (edge[0] === test[1] && edge[1] === test[0])) {
                        unique = false;
                        break;
                    }
                }
                if (unique) edges.push(edge);
            }

            for (const edge of edges) {
                triangles.push(getCircumcircle(edge[0], edge[1], i));
            }
        }

        const result: Triangle[] = [];
        for (const t of triangles) {
            if (t.p0 < points.length && t.p1 < points.length && t.p2 < points.length) {
                result.push({ indices: [t.p0, t.p1, t.p2] });
            }
        }

        return result;
    },

    /**
     * Piecewise Affine Mesh Warper.
     * Warps input image texture mapping from source points configuration onto target points configuration
     * based on Delaunay triangulation.
     */
    warpMesh(
        dstData: Uint8ClampedArray,
        w: number, h: number,
        sourcePoints: MeshPoint[],
        targetPoints: MeshPoint[],
        sampler: (u: number, v: number, c: number) => number,
        triangles?: Triangle[]
    ): void {
        const tris = triangles || this.delaunay(sourcePoints);

        for (const tri of tris) {
            const [i0, i1, i2] = tri.indices;
            
            const p0 = sourcePoints[i0];
            const p1 = sourcePoints[i1];
            const p2 = sourcePoints[i2];

            const q0 = targetPoints[i0];
            const q1 = targetPoints[i1];
            const q2 = targetPoints[i2];

            this.drawTriangleSoftware(dstData, w, h, p0, p1, p2, q0, q1, q2, sampler);
        }
    },

    /**
     * Procedural Grid Mesh Generator.
     * Generates a uniform set of vertices and connecting triangles spanning a given area.
     */
    createGridMesh(w: number, h: number, subX: number, subY: number): { points: MeshPoint[], triangles: Triangle[] } {
        const points: MeshPoint[] = [];
        const triangles: Triangle[] = [];

        for (let y = 0; y <= subY; y++) {
            const py = (y / subY) * h;
            for (let x = 0; x <= subX; x++) {
                const px = (x / subX) * w;
                points.push({ x: px, y: py });
            }
        }

        const rowPoints = subX + 1;
        for (let y = 0; y < subY; y++) {
            for (let x = 0; x < subX; x++) {
                const p0 = y * rowPoints + x;
                const p1 = p0 + 1;
                const p2 = (y + 1) * rowPoints + x;
                const p3 = p2 + 1;

                triangles.push({ indices: [p0, p1, p2] });
                triangles.push({ indices: [p1, p3, p2] });
            }
        }

        return { points, triangles };
    },

    /**
     * Inverse Bilinear Quadrilateral coordinate solver.
     * Solves the corresponding local $[0, 1] \times [0, 1]$ coordinates $(u, v)$ for a target pixel 
     * $(x, y)$ inside an arbitrary 4-point convex quadrilateral.
     */
    solveBilinearQuad(
        q0: MeshPoint, q1: MeshPoint, q2: MeshPoint, q3: MeshPoint,
        x: number, y: number
    ): { u: number, v: number } | null {
        // Coefficients of the bilinear interpolation system: Q(u, v) = (1-u)(1-v)q0 + u(1-v)q1 + (1-u)v*q3 + u*v*q2
        const ax = q0.x;
        const bx = q1.x - q0.x;
        const cx = q3.x - q0.x;
        const dx = q0.x - q1.x + q2.x - q3.x;

        const ay = q0.y;
        const by = q1.y - q0.y;
        const cy = q3.y - q0.y;
        const dy = q0.y - q1.y + q2.y - q3.y;

        const px = x - ax;
        const py = y - ay;

        // Solve quadratic equation: A * v^2 + B * v + C = 0
        const A = dx * cy - dy * cx;
        const B = dx * py - dy * px + bx * cy - by * cx;
        const C = bx * py - by * px;

        let v = 0;
        if (Math.abs(A) < 1e-9) {
            // Linear simplified case
            if (Math.abs(B) < 1e-9) return null;
            v = -C / B;
        } else {
            const disc = B * B - 4 * A * C;
            if (disc < 0) return null;
            const sqrtDisc = Math.sqrt(disc);
            
            // Choose the solution closest to the valid [0, 1] range
            const v1 = (-B + sqrtDisc) / (2 * A);
            const v2 = (-B - sqrtDisc) / (2 * A);

            const d1 = Math.abs(v1 - 0.5);
            const d2 = Math.abs(v2 - 0.5);
            v = d1 < d2 ? v1 : v2;
        }

        const denom = bx + dx * v;
        if (Math.abs(denom) < 1e-9) {
            // Solve using alternative axis in case of division by zero
            const denomY = by + dy * v;
            if (Math.abs(denomY) < 1e-9) return null;
            const u = (py - cy * v) / denomY;
            return { u, v };
        }

        const u = (px - cx * v) / denom;
        return { u, v };
    }
};

export class ThinPlateSpline {
    private ctrl: MeshPoint[];
    private wx: number[] = [];
    private wy: number[] = [];
    private ax = 0; private bx = 0; private cx = 0;
    private ay = 0; private by = 0; private cy = 0;

    constructor(controlPoints: MeshPoint[], targetPoints: MeshPoint[]) {
        this.ctrl = controlPoints;
        this.solve(targetPoints);
    }

    private rbf(r: number): number {
        if (r < 1e-8) return 0;
        return r * r * Math.log(r);
    }

    private solve(targets: MeshPoint[]) {
        const n = this.ctrl.length;
        if (n < 3) return;

        const size = n + 3;
        const A: number[][] = Array.from({ length: size }, () => new Float64Array(size) as any);
        const bx = new Float64Array(size);
        const by = new Float64Array(size);

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const dx = this.ctrl[i].x - this.ctrl[j].x;
                const dy = this.ctrl[i].y - this.ctrl[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                A[i][j] = this.rbf(dist);
            }
        }

        for (let i = 0; i < n; i++) {
            A[i][n]     = 1;
            A[i][n + 1] = this.ctrl[i].x;
            A[i][n + 2] = this.ctrl[i].y;

            A[n][i]     = 1;
            A[n + 1][i] = this.ctrl[i].x;
            A[n + 2][i] = this.ctrl[i].y;
        }

        for (let i = 0; i < n; i++) {
            bx[i] = targets[i].x;
            by[i] = targets[i].y;
        }

        const solveSystem = (mat: number[][], vec: Float64Array): Float64Array | null => {
            const len = vec.length;
            const cpMat = mat.map(row => Array.from(row));
            const cpVec = Array.from(vec);

            for (let i = 0; i < len; i++) {
                let maxRow = i;
                for (let k = i + 1; k < len; k++) {
                    if (Math.abs(cpMat[k][i]) > Math.abs(cpMat[maxRow][i])) maxRow = k;
                }
                const tempRow = cpMat[i]; cpMat[i] = cpMat[maxRow]; cpMat[maxRow] = tempRow;
                const tempV = cpVec[i]; cpVec[i] = cpVec[maxRow]; cpVec[maxRow] = tempV;

                if (Math.abs(cpMat[i][i]) < 1e-12) return null;

                for (let k = i + 1; k < len; k++) {
                    const factor = cpMat[k][i] / cpMat[i][i];
                    for (let j = i; j < len; j++) cpMat[k][j] -= factor * cpMat[i][j];
                    cpVec[k] -= factor * cpVec[i];
                }
            }

            const res = new Float64Array(len);
            for (let i = len - 1; i >= 0; i--) {
                let sum = 0;
                for (let j = i + 1; j < len; j++) sum += cpMat[i][j] * res[j];
                res[i] = (cpVec[i] - sum) / cpMat[i][i];
            }
            return res;
        };

        const solX = solveSystem(A, bx);
        const solY = solveSystem(A, by);

        if (solX && solY) {
            this.wx = Array.from(solX.subarray(0, n));
            this.ax = solX[n];
            this.bx = solX[n + 1];
            this.cx = solX[n + 2];

            this.wy = Array.from(solY.subarray(0, n));
            this.ay = solY[n];
            this.by = solY[n + 1];
            this.cy = solY[n + 2];
        }
    }

    interpolate(x: number, y: number): MeshPoint {
        const n = this.ctrl.length;
        if (n < 3) return { x, y };

        let valX = this.ax + this.bx * x + this.cx * y;
        let valY = this.ay + this.by * x + this.cy * y;

        for (let i = 0; i < n; i++) {
            const dx = x - this.ctrl[i].x;
            const dy = y - this.ctrl[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const rbfVal = this.rbf(dist);

            valX += this.wx[i] * rbfVal;
            valY += this.wy[i] * rbfVal;
        }

        return { x: valX, y: valY };
    }
}
