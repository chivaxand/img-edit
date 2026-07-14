import { Layer } from '~/layers';
import { computeFeatheredMask } from './utils';

// SOLID COLOR FILL ALGORITHM
export namespace SolidColor {
    export function inpaint(layer: Layer, maskCanvas: HTMLCanvasElement, hexColor: string, softness = 0) {
        const w = layer.canvas.width;
        const h = layer.canvas.height;
        const ctx = layer.ctx;
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;
        const parseHex = (hex: string) => {
            const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : [255, 255, 255];
        };
        const color = parseHex(hexColor);

        const blendMask = computeFeatheredMask(maskCanvas, w, h, softness);

        for (let i = 0; i < w * h; i++) {
            const weight = blendMask[i];
            if (weight > 0) {
                pixels[i * 4]     = Math.max(0, Math.min(255, Math.round(pixels[i * 4]     * (1 - weight) + color[0] * weight)));
                pixels[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(pixels[i * 4 + 1] * (1 - weight) + color[1] * weight)));
                pixels[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(pixels[i * 4 + 2] * (1 - weight) + color[2] * weight)));
                pixels[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(pixels[i * 4 + 3] * (1 - weight) + 255 * weight)));
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }
}