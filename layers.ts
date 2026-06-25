import { UI } from './ui';

// --- Global Interfaces ---
export interface Layer {
    id: number;
    type: string;
    name: string;
    visible: boolean;
    opacity: number;
    blend: string;
    x: number;
    y: number;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    [key: string]: any; // For text, font, color, etc.
}

export interface LayerDef {
    traits?: Record<string, boolean>;
    fonts?: string[];
    init?: (l: any, params: any) => void;
    update?: (l: Layer, props?: any) => void;
    draw?: (ctx: CanvasRenderingContext2D, l: Layer) => void;
    buildUI?: (container: HTMLElement, state: any, onChange: (k: string, v: any) => void) => void;
    renderSettings?: (panel: HTMLElement, l: Layer, actions: any) => void;
}

export const Layers = {
    registry: {} as Record<string, LayerDef>,
    register(id: string, def: LayerDef) { this.registry[id] = def; },
    get(id: string) { return this.registry[id]; },

    create(type: string, params: any): Layer | null {
        const def = this.get(type);
        if(!def) return null;
        const l: any = { 
            id: Date.now() + Math.random(), type, 
            visible: true, opacity: 1, blend: 'source-over', 
            x:0, y:0, width:0, height:0 
        };
        if(def.init) def.init(l, params);
        return l as Layer;
    },

    render(ctx: CanvasRenderingContext2D, l: Layer) {
        const def = this.get(l.type);
        if(def && def.draw) def.draw(ctx, l);
        else if(l.canvas) ctx.drawImage(l.canvas, l.x, l.y, l.width, l.height);
    }
};

Layers.register('raster', {
    traits: { editable: true, filterable: true, transformable: true },
    
    init(l: any, { name, img, width, height }: any) {
        l.name = name || 'Layer';
        l.canvas = document.createElement('canvas');
        l.canvas.width = img ? img.width : width;
        l.canvas.height = img ? img.height : height;
        l.width = l.canvas.width;
        l.height = l.canvas.height;
        l.ctx = l.canvas.getContext('2d', { willReadFrequently: true });
        if(img) l.ctx.drawImage(img, 0, 0);
    }
});

Layers.register('text', {
    traits: { editable: false, filterable: false, transformable: true },
    fonts: ['Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact',
            'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Tahoma',
            'Times New Roman', 'Trebuchet MS', 'Verdana', 'Geneva', 'Helvetica',
            'serif', 'sans-serif', 'monospace'],

    init(l: any, { text, font, fontSize, color, x, y }: any) {
        l.name = 'Text Layer';
        l.text = text || 'Text';
        l.font = font || 'Arial';
        l.fontSize = fontSize || 24;
        l.color = color || '#000000';
        l.x = x || 0; l.y = y || 0;
        this.update!(l);
    },
    update(l: Layer, props?: any) {
        if(props) Object.assign(l, props);
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `${l.fontSize}px ${l.font}`;
        const m = ctx.measureText(l.text);
        l.width = Math.ceil(m.width);
        l.height = Math.ceil(l.fontSize * 1.2);
        
        l.canvas = document.createElement('canvas');
        l.canvas.width = l.width || 1;
        l.canvas.height = l.height || 1;
        l.ctx = l.canvas.getContext('2d')!;
        
        l.ctx.font = `${l.fontSize}px ${l.font}`;
        l.ctx.fillStyle = l.color;
        l.ctx.textBaseline = 'top';
        l.ctx.fillText(l.text, 0, 0);
    },
    buildUI(container: HTMLElement, state: any, onChange: (k: string, v: any) => void) {
        container.appendChild(UI.createRow('Text', UI.createInput('text', {value:state.text}, v => onChange('text', v.value))));
        
        container.appendChild(UI.createSelectRow({
            label: 'Font',
            options: this.fonts || [],
            value: state.font,
            onChange: (v: string) => onChange('font', v)
        }));

        container.appendChild(UI.createRow('Size', UI.createInput('number', {value:state.fontSize}, v => onChange('fontSize', parseInt(v.value)))));

        if (state.color !== undefined) {
            container.appendChild(UI.createColorRow({
                label: 'Color',
                value: state.color,
                onChange: (v: string) => onChange('color', v)
            }));
        }
    },
    renderSettings(panel: HTMLElement, l: Layer, actions: any) {
        this.buildUI!(panel, l, (k: string, v: any) => actions.updateLayer(l, {[k]: v}));
        panel.appendChild(UI.createNode('button', { className:'btn', style:'width:100%; margin-top:5px;', textContent:'Rasterize', on:{click:() => actions.rasterizeLayer(l.id)} }));
    }
});