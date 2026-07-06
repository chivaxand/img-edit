import { UI } from '~/ui';
import { Popup } from '~/ui-popup';
import { FullScreenWorkspace, InteractiveViewport } from '~/ui-fullscreen';
import { Layers, Layer } from '~/layers';
import { Menu } from '~/menu';
import { Filters } from '~/filters';

export interface AppPointerEvent {
    clientX: number;
    clientY: number;
    button: number;
    buttons: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    target: EventTarget | null;
    preventDefault(): void;
    stopPropagation(): void;
    originalEvent?: MouseEvent | TouchEvent;
}

export type PointerCompatibleEvent = MouseEvent & Partial<AppPointerEvent>;

export interface AppState {
    width: number;
    height: number;
    layers: Layer[];
    activeLayerId: number | null;
    tool: string;
    fg: string;
    bg: string;
    settings: Record<string, any>;
    isDrawing: boolean;
    start: { x: number; y: number };
    dragOffset: { x: number; y: number };
    zoom: number;
    recording: boolean;
    recordedSteps: string[];
    selection: { 
        active: boolean; 
        mask: HTMLCanvasElement | null; 
        ctx: CanvasRenderingContext2D | null; 
        layerId: number | null;
        outline: HTMLCanvasElement | null;
        antOffset: number;
        animating: boolean;
        pattern: HTMLCanvasElement | null;
        antsCanvas: HTMLCanvasElement | null;
        antsCtx: CanvasRenderingContext2D | null;
        showBorder: boolean;
    };
    [key: string]: any;
}

export interface ToolDef {
    id: string;
    icon: string;
    title: string;
    settings?: any;
    finishOnLayerSwitch?: boolean;
    onSelect?: (panel: HTMLElement) => void;
    onDeselect?: () => void;
    onMouseDown?: (e: PointerCompatibleEvent) => void;
    onMouseMove?: (e: PointerCompatibleEvent) => void;
    onMouseUp?: (e: PointerCompatibleEvent) => void;
    onDoubleClick?: (e: PointerCompatibleEvent) => void;
    onKeyDown?: (e: KeyboardEvent) => boolean;
    onContextMenu?: (e: PointerCompatibleEvent) => void;
    drawUI?: () => void;
    [key: string]: any;
}

export interface AppActions {
    saveState(): void;
    undo(): void;
    resizeCanvas(w: string | number | null, h: string | number | null): void;
    fitCanvasToLayers(): void;
    centerActiveLayer(): void;
    createLayer(name: string, img?: HTMLImageElement | HTMLCanvasElement, type?: string): Layer | null;
    addEmptyLayer(): void;
    addLayer(l: Layer): void;
    addTextLayer(x: number, y: number, options?: any): void;
    updateLayer(l: Layer, props: any): void;
    rasterizeLayer(id: number): void;
    deleteLayer(): void;
    setActiveLayer(id: number): void;
    toggleVis(id: number): void;
    setTool(t: string): void;
    setColor(type: string, val: string): void;
    setLayerProp(k: string, v: any): void;
    transformLayer(k: string, v: string): void;
    handleFiles(files: FileList): void;
    download(): void;
    deselect(): void;
    setZoom(level: string | number): void;
    stepZoom(dir: number): void;
    exportBase64(): void;
    deleteSelection(): void;
    inverseSelection(): void;
    updateSelectionOutline(): void;
    saveSelection(mode?: 'content' | 'mask', inverse?: boolean): void;
    loadSelection(layerIndex?: number, mode?: 'alpha' | 'grayscale', inverse?: boolean): void;
    openSaveSelectionDialog(): void;
    openLoadSelectionDialog(): void;
    moveLayer(dir: number): void;
    openResizeDialog(): void;
    openTransformDialog(): void;
    openFlipRotateDialog(): void;
    openLayerCanvasSizeDialog(): void;
    openMacroRunner(): void;
    toggleRecording(): void;
    clearRecording(): void;
    mergeAll(): void;
    duplicateLayer(): void;
    mergeLayerDown(): void;
}

export const App = {
    state: {
        width: 800, height: 600,
        layers: [],
        activeLayerId: null,
        tool: 'move',
        fg: '#000000', bg: '#ffffff',
        settings: {}, 
        isDrawing: false, start: {x:0, y:0}, dragOffset: {x:0, y:0},
        zoom: 1,
        recording: false,
        recordedSteps: [],
        selection: { 
            active: false, 
            mask: null, 
            ctx: null, 
            layerId: null,
            outline: null,
            antOffset: 0,
            animating: false,
            pattern: null,
            antsCanvas: null,
            antsCtx: null,
            showBorder: true
        }
    } as AppState,
    els: {} as Record<string, any>,
    tools: [] as ToolDef[],
    listeners: {} as Record<string, Function[]>,
    popup: null as Popup | null,
    FullScreenWorkspace: FullScreenWorkspace,
    InteractiveViewport: InteractiveViewport,

    keybinds: {
        bindings: {} as Record<string, Function>,
        register(keys: string, action: Function) {
            keys.split(',').forEach(k => this.bindings[k.trim().toLowerCase()] = action);
        },
        handle(e: KeyboardEvent) {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return false;
            const parts = [];
            if (e.ctrlKey || e.metaKey) parts.push('ctrl');
            if (e.altKey) parts.push('alt');
            if (e.shiftKey) parts.push('shift');
            if (!['Control','Shift','Alt','Meta'].includes(e.key)) parts.push(e.key.toLowerCase());
            const combo = parts.join('+');
            const action = this.bindings[combo] || this.bindings[e.key.toLowerCase()];
            if (action) {
                e.preventDefault();
                action(e);
                return true;
            }
            return false;
        }
    },

    history: {
        stack: [] as any[],
        limit: 20,
        push(state: AppState) {
            if (this.stack.length >= this.limit) this.stack.shift();
            const copy = state.layers.map(l => {
                const c = document.createElement('canvas'); 
                c.width = l.canvas.width; c.height = l.canvas.height;
                c.getContext('2d')!.drawImage(l.canvas, 0, 0);
                return { ...l, canvas: c, ctx: c.getContext('2d')! };
            });
            this.stack.push({ w: state.width, h: state.height, layers: copy });
        },
        pop() { return this.stack.pop(); }
    },

    // Event Bus
    on(event: string, fn: Function) { (this.listeners[event] = this.listeners[event] || []).push(fn); },
    emit(event: string, data?: any) { (this.listeners[event] || []).forEach(fn => fn(data)); },

    recordAction(code: string) {
        if (this.state.recording) {
            this.state.recordedSteps.push(code);
            this.emit('record:update');
        }
    },

    registerTool(toolDef: ToolDef) { this.tools.push(toolDef); },
    getTool() { return this.tools.find(t => t.id === this.state.tool); },

    init() {
        this.els.canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
        this.els.ctx = this.els.canvas.getContext('2d')!;
        
        // Init Overlay
        this.els.overlay = document.createElement('canvas');
        this.els.overlay.width = this.state.width;
        this.els.overlay.height = this.state.height;
        
        this.popup = new Popup();
        Menu.init();

        this.buildUI();
        this.bindEvents();
        this.actions.resizeCanvas(800, 600);
        this.actions.addEmptyLayer();
        
        // Register Global Keybinds
        this.keybinds.register('ctrl+z', () => this.actions.undo());
        this.keybinds.register('ctrl+a', () => this.actions.deselect());
        this.keybinds.register('=, +', () => this.actions.stepZoom(1));
        this.keybinds.register('-', () => this.actions.stepZoom(-1));
        this.keybinds.register('0, *', () => this.actions.setZoom(1));
        this.keybinds.register('delete, backspace', () => { if(App.state.selection.active) this.actions.deleteSelection(); });
        this.keybinds.register('escape', () => { this.actions.deselect(); this.actions.setTool('move'); });

        window.addEventListener('keydown', (e: KeyboardEvent) => {
            const tool = this.getTool();
            if (tool && tool.onKeyDown && tool.onKeyDown(e)) { e.preventDefault(); return; }
            // Global Keybinds
            this.keybinds.handle(e);
        });

        this.els.canvas.addEventListener('mousedown', this.events.onMouseDown);
        window.addEventListener('mousemove', this.events.onMouseMove);
        window.addEventListener('mouseup', this.events.onMouseUp);
        this.els.canvas.addEventListener('dblclick', this.events.onDoubleClick);
        this.els.canvas.addEventListener('contextmenu', this.events.onContextMenu);

        // Touch event bindings for touch/mobile devices
        this.els.canvas.addEventListener('touchstart', this.events.onTouchStart.bind(this.events), { passive: false });
        window.addEventListener('touchmove', this.events.onTouchMove.bind(this.events), { passive: false });
        window.addEventListener('touchend', this.events.onTouchEnd.bind(this.events), { passive: false });
        window.addEventListener('touchcancel', this.events.onTouchEnd.bind(this.events), { passive: false });
        
        // Drag & Drop
        document.body.addEventListener('dragover', e => e.preventDefault());
        document.body.addEventListener('drop', e => { e.preventDefault(); this.actions.handleFiles(e.dataTransfer!.files); });
        
        // Select default tool
        this.actions.setTool('move');
    },

    bindEvents() {
        this.on('render', () => this.render());
        
        const updateStatus = () => {
            const z = this.state.zoom;
            const l = this.utils.getActive();
            let text = `${this.state.width} x ${this.state.height}`;
            if (l) text += ` [Layer: ${l.width} x ${l.height}]`;
            text += ` @ ${Math.round(z*100)}%`;
            if (this.state.recording) text += ` [RECORDING...]`;
            const sb = document.getElementById('status-bar');
            if(sb) sb.textContent = text;
        };

        this.on('tool:change', () => {
            document.querySelectorAll('.icon-btn').forEach(b => (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.tool === this.state.tool));
            this.ui.updateToolSettings();
            this.render();
        });
        this.on('zoom:change', () => {
            const z = this.state.zoom;
            this.els.canvas.style.width = `${this.state.width * z}px`;
            this.els.canvas.style.height = `${this.state.height * z}px`;
            updateStatus();
            if (this.state.tool === 'zoom') this.ui.updateToolSettings();
        });
        // Layer Structure Changed (Add/Remove/Reorder)
        this.on('layers:structure', () => {
            this.ui.refreshLayers();
            this.ui.updateProps();
            this.ui.updateToolSettings(); 
            updateStatus();
            this.render();
        });
        // Layer Properties Changed (Opacity/Blend/Transform)
        this.on('layer:props', () => {
            this.ui.updateProps();
            updateStatus();
            this.render();
        });
        // Layer Content Changed (Draw/Filter)
        this.on('layer:content', () => {
            this.ui.refreshLayers(); // Updates thumbnail
            this.render();
        });
        this.on('canvas:resize', () => {
            if(this.els.cvW) this.els.cvW.value = this.state.width;
            if(this.els.cvH) this.els.cvH.value = this.state.height;
            this.emit('zoom:change');
            this.render();
        });
        this.on('record:update', () => {
            const headerEl = document.getElementById('app-header') || document.getElementById('header-controls') || document.querySelector('.header');
            if (headerEl) {
                (headerEl as HTMLElement).style.backgroundColor = this.state.recording ? '#4c1d1d' : '';
            }
            updateStatus();
        });
    },

    buildUI() {
        // Header
        const h = document.getElementById('header-controls')!;
        h.appendChild(UI.createNode('button', { className: 'btn', textContent: 'Undo (Ctrl+Z)', on: { click: () => this.actions.undo() } }));

        // Toolbar
        const tb = document.getElementById('toolbar')!;
        this.tools.forEach(t => {
            const btn = UI.createNode('button', { 
                className: `icon-btn ${t.id===this.state.tool?'active':''}`, 
                title: t.title, innerHTML: t.icon, dataset: { tool: t.id },
                on: { click: () => this.actions.setTool(t.id) }
            });
            tb.appendChild(btn);
        });

        // Colors
        const swap = () => { const t=this.state.fg; this.actions.setColor('fg',this.state.bg); this.actions.setColor('bg',t); };
        const cBox = UI.createNode('div', { className: 'color-box' },
            UI.createNode('button', { className: 'btn', style:{position:'absolute', top:'-15px', right:'-5px', fontSize:'10px', padding:'0'}, textContent:'⇄', on:{click:swap} }),
            UI.createNode('div', { id:'bg-wrap', className:'c-swatch', style:{bottom:'0', right:'0', background:'#fff'} }, 
                UI.createInput('color', { value:'#ffffff' }, (t: HTMLInputElement) => this.actions.setColor('bg', t.value))),
            UI.createNode('div', { id:'fg-wrap', className:'c-swatch', style:{top:'0', left:'0', background:'#000'} }, 
                UI.createInput('color', { value:'#000000' }, (t: HTMLInputElement) => this.actions.setColor('fg', t.value)))
        );
        tb.appendChild(cBox);

        // Sidebar: Canvas Props
        const cp = document.getElementById('canvas-props')!;
        cp.appendChild(UI.createNode('div', { className:'panel-header' }, 'Canvas Size'));
        const wInp = UI.createInput('number', { value: 800 }, (t: HTMLInputElement) => this.actions.resizeCanvas(t.value, null));
        const hInp = UI.createInput('number', { value: 600 }, (t: HTMLInputElement) => this.actions.resizeCanvas(null, t.value));
        this.els.cvW = wInp; this.els.cvH = hInp;
        cp.appendChild(UI.createRow(null, UI.createNode('div', {style:{display:'flex', gap:'5px'}}, wInp, UI.createNode('span',{},'x'), hInp)));
        
        // Fit Canvas Button
        cp.appendChild(UI.createNode('button', { 
            className: 'btn', 
            style: 'width:100%; margin-top:5px;', 
            textContent: 'Fit to Layers',
            title: 'Resize canvas to fit all layers',
            on: { click: () => this.actions.fitCanvasToLayers() }
        }));

        // Sidebar Buttons (Layer Actions)
        document.getElementById('btn-layer-up')!.onclick = () => this.actions.moveLayer(-1);
        document.getElementById('btn-layer-down')!.onclick = () => this.actions.moveLayer(1);
        document.getElementById('btn-merge-down')!.onclick = () => this.actions.mergeLayerDown();
        document.getElementById('btn-add-layer')!.onclick = () => this.actions.addEmptyLayer();
        document.getElementById('btn-dup-layer')!.onclick = () => this.actions.duplicateLayer();
        document.getElementById('btn-del-layer')!.onclick = () => this.actions.deleteLayer();
        document.getElementById('btn-open')!.onclick = () => document.getElementById('file-upload')!.click();
        document.getElementById('file-upload')!.onchange = (e: Event) => this.actions.handleFiles((e.target as HTMLInputElement).files!);
    },

    ui: {
        refreshLayers() {
            const list = document.getElementById('layer-list')!;
            list.innerHTML = '';
            [...App.state.layers].forEach(l => {
                const item = UI.createNode('div', { className: `layer-item ${l.id===App.state.activeLayerId?'active':''}`, on: { click: () => App.actions.setActiveLayer(l.id) } },
                    UI.createNode('div', { className:`layer-vis ${l.visible?'visible':''}`, textContent: l.visible?'👁':'○', 
                        on: { click: (e: Event) => { e.stopPropagation(); App.actions.toggleVis(l.id); } } }),
                    UI.createNode('span', { className: 'layer-type-icon', textContent: l.type==='text'?'T':'' }),
                    UI.createNode('img', { className:'layer-thumb', src: l.canvas.toDataURL() }),
                    UI.createNode('div', { style:{flex:'1', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}, textContent: l.name })
                );
                list.appendChild(item);
            });
        },
        updateProps() {
            const lp = document.getElementById('layer-props')!;
            lp.innerHTML = '';
            lp.appendChild(UI.createNode('div', { className:'panel-header' }, 'Layer Properties'));

            const l = App.utils.getActive();
            if(!l) return;

            lp.appendChild(UI.createSliderRow({
                label: 'Opacity',
                min: 0, max: 1, 
                value: l.opacity,
                onInput: (v: string) => App.actions.setLayerProp('opacity', parseFloat(v)),
                onChange: () => App.actions.saveState()
            }));

            lp.appendChild(UI.createSelectRow({
                label: 'Blend',
                options: [
                    'source-over', 
                    'multiply', 'screen', 'overlay', 
                    'darken', 'lighten', 
                    'color-dodge', 'color-burn', 
                    'hard-light', 'soft-light', 
                    'difference', 'exclusion', 
                    'hue', 'saturation', 'color', 'luminosity'
                ],
                value: l.blend,
                onChange: (v: string) => App.actions.setLayerProp('blend', v)
            }));

            const lx = UI.createInput('number', {placeholder:'X', value:Math.round(l.x)}, (t: HTMLInputElement) => App.actions.transformLayer('x',t.value));
            const ly = UI.createInput('number', {placeholder:'Y', value:Math.round(l.y)}, (t: HTMLInputElement) => App.actions.transformLayer('y',t.value));
            lp.appendChild(UI.createRow('Pos', UI.createNode('div', {style:{display:'flex', gap:'5px'}}, lx, ly)));

            // Center Layer Button
            lp.appendChild(UI.createNode('button', {
                className: 'btn',
                style: 'width:100%; margin-top:5px;',
                textContent: 'Center Layer',
                on: { click: () => App.actions.centerActiveLayer() }
            }));

            // Show Selection Border Checkbox
            lp.appendChild(UI.createCheckbox({
                label: 'Show Selection Border',
                value: App.state.selection.showBorder !== false,
                onChange: (v: boolean) => {
                    App.state.selection.showBorder = v;
                    App.render();
                }
            }));
        },
        updateToolSettings() {
            const p = document.getElementById('tool-settings')!;
            p.innerHTML = '';
            p.appendChild(UI.createNode('div', { className:'panel-header' }, 'Tool Settings'));
            const l = App.utils.getActive();
            const lDef = l ? Layers.get(l.type) : null;
            if (lDef && lDef.renderSettings) { lDef.renderSettings(p, l!, App.actions); return; }
            const tool = App.getTool();
            if (tool && tool.onSelect) { tool.onSelect(p); } 
            else { p.appendChild(UI.createNode('div', {style:{padding:'5px', color:'#666'}}, 'No settings')); }
        }
    },

    actions: {} as AppActions,

    events: {
        onMouseDown(e: PointerCompatibleEvent) { const t = App.getTool(); if (t && t.onMouseDown) t.onMouseDown(e); },
        onMouseMove(e: PointerCompatibleEvent) { const t = App.getTool(); if (t && t.onMouseMove) t.onMouseMove(e); },
        onMouseUp(e: PointerCompatibleEvent) { 
            const t = App.getTool(); 
            if (t && t.onMouseUp) t.onMouseUp(e);
            if (App.state.selection.active) {
                App.state.selection.outline = null;
            }
        },
        onDoubleClick(e: MouseEvent) { const t = App.getTool(); if (t && t.onDoubleClick) t.onDoubleClick(e as any); },
        onContextMenu(e: MouseEvent) { const t = App.getTool(); if (t && t.onContextMenu) t.onContextMenu(e as any); },

        onTouchStart(e: TouchEvent) {
            if (e.touches.length > 0) {
                const norm = App.utils.normalizeTouch(e, 'down');
                App.events.onMouseDown(norm as any);
            }
        },
        onTouchMove(e: TouchEvent) {
            if (e.touches.length > 0) {
                if (App.state.isDrawing) {
                    e.preventDefault();
                }
                const norm = App.utils.normalizeTouch(e, 'move');
                App.events.onMouseMove(norm as any);
            }
        },
        onTouchEnd(e: TouchEvent) {
            const norm = App.utils.normalizeTouch(e, 'up');
            App.events.onMouseUp(norm as any);
        }
    },

    utils: {
        getActive: () => App.state.layers.find(l => l.id === App.state.activeLayerId),
        layerIs: (l: Layer, trait: string) => {
            if (!l) return false;
            const def = Layers.get(l.type);
            return def && def.traits && def.traits[trait];
        },
        getPos: (e: MouseEvent | TouchEvent | AppPointerEvent) => {
            const r = App.els.canvas.getBoundingClientRect();
            let clientX = 0;
            let clientY = 0;
            if ('touches' in e && e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            } else {
                clientX = (e as MouseEvent | AppPointerEvent).clientX;
                clientY = (e as MouseEvent | AppPointerEvent).clientY;
            }
            return { x: (clientX - r.left) * (App.els.canvas.width / r.width), y: (clientY - r.top) * (App.els.canvas.height / r.height) };
        },
        normalizeTouch: (e: TouchEvent, phase: 'down' | 'move' | 'up'): AppPointerEvent => {
            const touch = (phase === 'up' ? e.changedTouches[0] : e.touches[0]) || { clientX: 0, clientY: 0 };
            return {
                clientX: touch.clientX,
                clientY: touch.clientY,
                button: 0,
                buttons: phase === 'up' ? 0 : 1,
                altKey: e.altKey,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
                preventDefault: () => e.preventDefault(),
                stopPropagation: () => e.stopPropagation(),
                originalEvent: e,
                target: e.target
            };
        },
        toLocal: (l: Layer, val: number, axis: 'x' | 'y') => (val - (axis==='x'?l.x:l.y)) * (l.canvas[axis==='x'?'width':'height'] / l[axis==='x'?'width':'height']),
        isEmpty: (c: HTMLCanvasElement) => { const b = document.createElement('canvas'); b.width=c.width; b.height=c.height; return c.toDataURL()===b.toDataURL(); },
        prepCtx: (ctx: CanvasRenderingContext2D, settings: any = {}) => {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = App.state.fg; ctx.strokeStyle = App.state.fg;
            ctx.lineWidth = settings.stroke || 2;
            if (settings.fontSize && settings.font) {
                ctx.font = `${settings.fontSize}px ${settings.font}`;
            }
        },
        hexToRgb: (hex: string) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
        },
        rgbToHex: (r: number, g: number, b: number) => "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1),
        colorsMatch: (r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number, tol: number) => {
            return Math.abs(r1 - r2) <= tol && Math.abs(g1 - g2) <= tol && Math.abs(b1 - b2) <= tol && Math.abs(a1 - a2) <= tol;
        }
    },

    render(options: any = {}) {
        const ctx = App.els.ctx;
        ctx.clearRect(0, 0, App.state.width, App.state.height);
        for (let i = App.state.layers.length - 1; i >= 0; i--) {
            const l = App.state.layers[i];
            if (!l.visible) continue;
            ctx.save();
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = l.blend as GlobalCompositeOperation;
            Layers.render(ctx, l);
            ctx.restore();
        }
        if (!options.forExport) {
            const l = App.utils.getActive();
            if (l && l.visible) {
                 ctx.save();
                 ctx.strokeStyle = '#007acc'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
                 ctx.strokeRect(l.x, l.y, l.width, l.height);
                 ctx.restore();
            }
            
            // Render Selection Overlay
            const sel = App.state.selection;
            if (sel.active && sel.mask) {
                const selLayer = App.state.layers.find(x => x.id === sel.layerId);
                if (selLayer && selLayer.visible) {
                    const ov = App.els.overlay;
                    const oCtx = ov.getContext('2d')!;
                    oCtx.clearRect(0, 0, ov.width, ov.height);
                    oCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                    oCtx.fillRect(0, 0, ov.width, ov.height);
                    oCtx.globalCompositeOperation = 'destination-out';
                    oCtx.drawImage(sel.mask, selLayer.x, selLayer.y, selLayer.width, selLayer.height);
                    oCtx.globalCompositeOperation = 'source-over';
                    ctx.drawImage(ov, 0, 0);

                    // Rebuild edge outline when cache is empty and border visibility is enabled
                    if (sel.showBorder !== false) {
                        if (!sel.outline) {
                            App.actions.updateSelectionOutline();
                        }
                        const outline = sel.outline;
                        if (outline) {
                            if (!sel.antsCanvas) {
                                sel.antsCanvas = document.createElement('canvas');
                            }
                            if (sel.antsCanvas.width !== App.state.width || sel.antsCanvas.height !== App.state.height) {
                                sel.antsCanvas.width = App.state.width;
                                sel.antsCanvas.height = App.state.height;
                            }
                            const tCtx = sel.antsCanvas.getContext('2d')!;
                            tCtx.save();
                            tCtx.clearRect(0, 0, App.state.width, App.state.height);
                            tCtx.globalCompositeOperation = 'source-over';
                            tCtx.drawImage(outline, selLayer.x, selLayer.y, selLayer.width, selLayer.height);
                            tCtx.globalCompositeOperation = 'source-in';

                            if (!sel.pattern) {
                                const pCvs = document.createElement('canvas');
                                pCvs.width = 8; pCvs.height = 8;
                                const pCtx = pCvs.getContext('2d')!;
                                pCtx.fillStyle = '#ffffff';
                                pCtx.fillRect(0, 0, 8, 8);
                                pCtx.fillStyle = '#000000';
                                pCtx.beginPath();
                                pCtx.moveTo(0, 4); pCtx.lineTo(4, 0); pCtx.lineTo(8, 0); pCtx.lineTo(0, 8);
                                pCtx.closePath(); pCtx.fill();
                                pCtx.beginPath();
                                pCtx.moveTo(4, 8); pCtx.lineTo(8, 4); pCtx.lineTo(8, 8);
                                pCtx.closePath(); pCtx.fill();
                                sel.pattern = pCvs;
                            }

                            const pattern = tCtx.createPattern(sel.pattern!, 'repeat')!;
                            const offset = sel.antOffset || 0;
                            tCtx.translate(offset, offset);
                            tCtx.fillStyle = pattern;
                            tCtx.fillRect(-offset, -offset, App.state.width + offset, App.state.height + offset);
                            tCtx.restore();

                            ctx.drawImage(sel.antsCanvas, 0, 0);
                        }

                        // Start animators if inactive
                        if (!sel.animating) {
                            sel.animating = true;
                            const animate = (time: number) => {
                                if (!sel.active || sel.showBorder === false) {
                                    sel.animating = false;
                                    return;
                                }
                                sel.antOffset = (sel.antOffset + 1) % 8;
                                App.render();
                                setTimeout(() => {
                                    requestAnimationFrame(animate);
                                }, 60);
                            };
                            requestAnimationFrame(animate);
                        }
                    }
                }
            }

            // Render active tool overlay (e.g. transform handles)
            const t = App.getTool();
            if (t && t.drawUI) t.drawUI();
        }
    }
};
