import { image } from '~/libs/image';

// Helper for fast separable O(N) mask feathering
export function computeFeatheredMask(maskCanvas: HTMLCanvasElement, w: number, h: number, softness: number): Float32Array {
    const mCtx = maskCanvas.getContext('2d')!;
    const mImgData = mCtx.getImageData(0, 0, w, h);
    const mPixels = mImgData.data;
    const M = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        M[i] = mPixels[i * 4 + 3] / 255;
    }
    return image.featherMask(M, w, h, softness, 'inner');
}