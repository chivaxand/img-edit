import { Filters, FilterContext } from '~/filters';
import { UI } from '~/ui';
import { Layer } from '~/layers';
import { Lib } from '~/libs/index';

Filters.register('motion-radial', {
    name: 'Motion & Radial Blur',
    mode: 'pixel',
    menu: {
        path: 'Filter/Blur',
        label: 'Motion & Radial Blur...',
        order: 2
    },

    renderUI(container: HTMLElement, layer: Layer, hooks: any) {
        const state = {
            type: 'linear', // linear, radial, zoom
            length: 20.0,   // Linear motion length or Zoom strength
            angle: 45.0,    // Linear motion angle
            radialAngle: 10.0, // Radial spin angle
            zoomDirection: 'bidirectional', // inward, outward, bidirectional
            centerX: 50.0,  // center percentage x
            centerY: 50.0   // center percentage y
        };

        const update = () => hooks.preview(state);

        // Type Selector
        container.appendChild(UI.createSelectRow({
            label: 'Type',
            options: [
                { value: 'linear', text: 'Linear Motion' },
                { value: 'radial', text: 'Radial (Spin)' },
                { value: 'zoom', text: 'Zoom Blur' }
            ],
            value: state.type,
            onChange: (v: string) => {
                state.type = v;
                updateControls();
                update();
            }
        }));

        // Length (Linear Motion) / Strength (Zoom Blur)
        const lengthControl = UI.createSliderRow({
            label: 'Length', min: 1, max: 150, step: 1, value: state.length,
            onInput: (v: string) => { state.length = parseFloat(v); update(); }
        });
        container.appendChild(lengthControl);

        // Angle (Linear Motion)
        const angleControl = UI.createSliderRow({
            label: 'Angle (°)', min: 0, max: 360, step: 1, value: state.angle,
            onInput: (v: string) => { state.angle = parseFloat(v); update(); }
        });
        container.appendChild(angleControl);

        // Radial Angle / Spin Angle (Radial Blur)
        const radialAngleControl = UI.createSliderRow({
            label: 'Spin Angle (°)', min: 0.5, max: 60, step: 0.5, value: state.radialAngle,
            onInput: (v: string) => { state.radialAngle = parseFloat(v); update(); }
        });
        container.appendChild(radialAngleControl);

        // Zoom Direction (Zoom Blur)
        const zoomDirControl = UI.createSelectRow({
            label: 'Zoom Dir',
            options: [
                { value: 'bidirectional', text: 'Bidirectional' },
                { value: 'inward', text: 'Inward' },
                { value: 'outward', text: 'Outward' }
            ],
            value: state.zoomDirection,
            onChange: (v: string) => {
                state.zoomDirection = v;
                update();
            }
        });
        container.appendChild(zoomDirControl);

        // Center X Control
        const centerXControl = UI.createSliderRow({
            label: 'Center X (%)', min: 0, max: 100, step: 1, value: state.centerX,
            onInput: (v: string) => { state.centerX = parseFloat(v); update(); }
        });
        container.appendChild(centerXControl);

        // Center Y Control
        const centerYControl = UI.createSliderRow({
            label: 'Center Y (%)', min: 0, max: 100, step: 1, value: state.centerY,
            onInput: (v: string) => { state.centerY = parseFloat(v); update(); }
        });
        container.appendChild(centerYControl);

        const updateControls = () => {
            const t = state.type;
            const isLinear = t === 'linear';
            const isRadial = t === 'radial';
            const isZoom = t === 'zoom';

            lengthControl.style.display = (isLinear || isZoom) ? 'flex' : 'none';
            angleControl.style.display = isLinear ? 'flex' : 'none';
            radialAngleControl.style.display = isRadial ? 'flex' : 'none';
            zoomDirControl.style.display = isZoom ? 'flex' : 'none';
            
            centerXControl.style.display = (isRadial || isZoom) ? 'flex' : 'none';
            centerYControl.style.display = (isRadial || isZoom) ? 'flex' : 'none';
        };

        updateControls();
        update();
    },

    process(data: Uint8ClampedArray, w: number, h: number, params: any) {
        const type = params.type;
        const length = params.length;
        const angle = params.angle;
        const radialAngle = params.radialAngle;
        const zoomDirection = params.zoomDirection;
        const centerX = params.centerX;
        const centerY = params.centerY;

        if (type === 'linear') {
            if (length <= 0) return;
            const angleRad = angle * Math.PI / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            const steps = Math.max(3, Math.ceil(length));
            
            const src = new Uint8ClampedArray(data);
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = (rowOffset + x) * 4;
                    
                    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
                    let count = 0;
                    
                    for (let i = 0; i < steps; i++) {
                        const t = steps > 1 ? (i / (steps - 1) - 0.5) * length : 0;
                        const px = Math.round(x + t * cos);
                        const py = Math.round(y + t * sin);
                        
                        if (px >= 0 && px < w && py >= 0 && py < h) {
                            const nIdx = (py * w + px) * 4;
                            sumR += src[nIdx];
                            sumG += src[nIdx+1];
                            sumB += src[nIdx+2];
                            sumA += src[nIdx+3];
                            count++;
                        }
                    }
                    
                    if (count > 0) {
                        data[idx]   = sumR / count;
                        data[idx+1] = sumG / count;
                        data[idx+2] = sumB / count;
                        data[idx+3] = sumA / count;
                    }
                }
            }
        } 
        else if (type === 'radial') {
            if (radialAngle <= 0) return;
            const cx = w * (centerX / 100);
            const cy = h * (centerY / 100);
            const angleRad = radialAngle * Math.PI / 180;

            const src = new Uint8ClampedArray(data);
            const pixelBuf = new Float32Array(4);
            
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = (rowOffset + x) * 4;
                    
                    const dx = x - cx;
                    const dy = y - cy;
                    const r = Math.sqrt(dx * dx + dy * dy);
                    if (r < 1e-5) continue;
                    
                    const theta = Math.atan2(dy, dx);
                    const steps = Math.max(3, Math.min(50, Math.ceil(r * Math.abs(angleRad))));
                    
                    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
                    let count = 0;
                    
                    for (let i = 0; i < steps; i++) {
                        const t = steps > 1 ? (i / (steps - 1) - 0.5) * angleRad : 0;
                        const sampleTheta = theta + t;
                        const px = cx + r * Math.cos(sampleTheta);
                        const py = cy + r * Math.sin(sampleTheta);
                        
                        if (px >= 0 && px < w - 1 && py >= 0 && py < h - 1) {
                            this.getPixelBilinear(src, w, h, px, py, pixelBuf);
                            sumR += pixelBuf[0];
                            sumG += pixelBuf[1];
                            sumB += pixelBuf[2];
                            sumA += pixelBuf[3];
                            count++;
                        }
                    }
                    
                    if (count > 0) {
                        data[idx]   = sumR / count;
                        data[idx+1] = sumG / count;
                        data[idx+2] = sumB / count;
                        data[idx+3] = sumA / count;
                    }
                }
            }
        } 
        else if (type === 'zoom') {
            if (length <= 0) return;
            const cx = w * (centerX / 100);
            const cy = h * (centerY / 100);
            const strengthFactor = length / 100;

            const src = new Uint8ClampedArray(data);
            const pixelBuf = new Float32Array(4);
            
            for (let y = 0; y < h; y++) {
                const rowOffset = y * w;
                for (let x = 0; x < w; x++) {
                    const idx = (rowOffset + x) * 4;
                    
                    const dx = x - cx;
                    const dy = y - cy;
                    
                    let startScale = 1.0;
                    let endScale = 1.0;
                    
                    if (zoomDirection === 'inward') {
                        startScale = 1.0 - strengthFactor;
                        endScale = 1.0;
                    } else if (zoomDirection === 'outward') {
                        startScale = 1.0;
                        endScale = 1.0 + strengthFactor;
                    } else { // bidirectional
                        startScale = 1.0 - strengthFactor / 2;
                        endScale = 1.0 + strengthFactor / 2;
                    }
                    
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const steps = Math.max(3, Math.min(50, Math.ceil(dist * strengthFactor)));
                    
                    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
                    let count = 0;
                    
                    for (let i = 0; i < steps; i++) {
                        const t = steps > 1 ? i / (steps - 1) : 0;
                        const scale = startScale + t * (endScale - startScale);
                        const px = cx + dx * scale;
                        const py = cy + dy * scale;
                        
                        if (px >= 0 && px < w - 1 && py >= 0 && py < h - 1) {
                            this.getPixelBilinear(src, w, h, px, py, pixelBuf);
                            sumR += pixelBuf[0];
                            sumG += pixelBuf[1];
                            sumB += pixelBuf[2];
                            sumA += pixelBuf[3];
                            count++;
                        }
                    }
                    
                    if (count > 0) {
                        data[idx]   = sumR / count;
                        data[idx+1] = sumG / count;
                        data[idx+2] = sumB / count;
                        data[idx+3] = sumA / count;
                    }
                }
            }
        }
    },

    getPixelBilinear(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Float32Array) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(w - 1, x0 + 1);
        const y1 = Math.min(h - 1, y0 + 1);
        
        const dx = x - x0;
        const dy = y - y0;
        
        const idx00 = (y0 * w + x0) * 4;
        const idx10 = (y0 * w + x1) * 4;
        const idx01 = (y1 * w + x0) * 4;
        const idx11 = (y1 * w + x1) * 4;
        
        for (let c = 0; c < 4; c++) {
            const val00 = src[idx00 + c];
            const val10 = src[idx10 + c];
            const val01 = src[idx01 + c];
            const val11 = src[idx11 + c];
            
            const top = val00 * (1 - dx) + val10 * dx;
            const bottom = val01 * (1 - dx) + val11 * dx;
            out[c] = top * (1 - dy) + bottom * dy;
        }
    }
});