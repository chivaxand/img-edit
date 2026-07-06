import { UI } from '~/ui';

export interface FullScreenWorkspaceOptions {
    title: string;
    onApply?: () => void;
    onCancel?: () => void;
}

export interface ViewportEvent {
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    button: number;
    buttons: number;
    isRightClick: boolean;
    originalEvent: MouseEvent | TouchEvent;
}

export class InteractiveViewport {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    overlayCanvas!: HTMLCanvasElement;
    overlayCtx!: CanvasRenderingContext2D;
    
    zoom = 1.0;
    panX = 0;
    panY = 0;
    
    allowPanZoom = true;
    
    onDraw?: () => void;
    onDrawOverlay?: (ctx: CanvasRenderingContext2D) => void;
    onMouseDown?: (e: ViewportEvent) => void;
    onMouseMove?: (e: ViewportEvent) => void;
    onMouseUp?: (e: ViewportEvent) => void;
    onHover?: (x: number | null, y: number | null, clientX: number | null, clientY: number | null) => void;
    onMouseLeave?: () => void;

    private isDrawing = false;
    private isPanning = false;
    private startX = 0;
    private startY = 0;
    private dragPanStartX = 0;
    private dragPanStartY = 0;

    private touchCount = 0;
    private touchStartTime = 0;
    private touchStartMidpoint = { x: 0, y: 0 };
    private touchStartDistance = 0;
    private touchStartZoom = 1.0;
    private touchStartPan = { x: 0, y: 0 };
    private touchMoved = false;

    private globalMouseMoveHandler!: (e: MouseEvent) => void;
    private globalMouseUpHandler!: (e: MouseEvent) => void;
    private resizeObserver!: ResizeObserver;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.canvas.style.willChange = 'transform';

        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = '0';
        this.overlayCanvas.style.left = '0';
        this.overlayCanvas.style.width = '100%';
        this.overlayCanvas.style.height = '100%';
        this.overlayCanvas.style.pointerEvents = 'none';
        this.overlayCanvas.style.zIndex = '5';

        if (canvas.parentElement) {
            canvas.parentElement.appendChild(this.overlayCanvas);
        }
        this.overlayCtx = this.overlayCanvas.getContext('2d')!;

        this.resizeObserver = new ResizeObserver(() => {
            this.applyTransform();
            if (this.onDraw) this.onDraw();
        });
        if (canvas.parentElement) {
            this.resizeObserver.observe(canvas.parentElement);
        }

        this.setupEvents();
        this.applyTransform();
        this.setSmoothing(true);
    }

    reset() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
        if (this.onDraw) this.onDraw();
    }

    getCoords(clientX: number, clientY: number) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / (rect.width || 1);
        const scaleY = this.canvas.height / (rect.height || 1);
        const x = Math.floor((clientX - rect.left) * scaleX);
        const y = Math.floor((clientY - rect.top) * scaleY);
        return {
            x: Math.max(0, Math.min(this.canvas.width - 1, x)),
            y: Math.max(0, Math.min(this.canvas.height - 1, y))
        };
    }

    applyTransform() {
        this.canvas.style.transformOrigin = '0 0';
        this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
        this.drawOverlay();
    }

    canvasToOverlay(cx: number, cy: number) {
        const rect = this.canvas.getBoundingClientRect();
        const oRect = this.overlayCanvas.getBoundingClientRect();
        const x = rect.left + ((cx + 0.5) / (this.canvas.width || 1)) * rect.width - oRect.left;
        const y = rect.top + ((cy + 0.5) / (this.canvas.height || 1)) * rect.height - oRect.top;
        return { x, y };
    }

    canvasLengthToOverlay(len: number) {
        const rect = this.canvas.getBoundingClientRect();
        return len * (rect.width / (this.canvas.width || 1));
    }

    updateOverlaySize() {
        if (!this.overlayCanvas) return;
        const rect = this.overlayCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);

        if (this.overlayCanvas.width !== Math.round(w * dpr) || this.overlayCanvas.height !== Math.round(h * dpr)) {
            this.overlayCanvas.width = Math.round(w * dpr);
            this.overlayCanvas.height = Math.round(h * dpr);
        }

        this.overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.overlayCtx.scale(dpr, dpr);
        this.overlayCtx.clearRect(0, 0, w, h);
    }

    drawOverlay() {
        if (!this.overlayCanvas) return;
        this.updateOverlaySize();
        if (this.onDrawOverlay) {
            this.onDrawOverlay(this.overlayCtx);
        }
    }

    setSmoothing(enabled: boolean) {
        this.canvas.style.imageRendering = enabled ? 'auto' : 'pixelated';
    }

    private setupEvents() {
        const canvas = this.canvas;

        canvas.addEventListener('wheel', (e) => {
            if (!this.allowPanZoom) return;
            e.preventDefault();
            const zoomFactor = 1.15;
            const rect = canvas.getBoundingClientRect();
            
            const cx = (e.clientX - rect.left) / this.zoom;
            const cy = (e.clientY - rect.top) / this.zoom;

            const oldZoom = this.zoom;
            if (e.deltaY < 0) {
                this.zoom = Math.min(25.0, this.zoom * zoomFactor);
            } else {
                this.zoom = Math.max(0.2, this.zoom / zoomFactor);
            }

            this.panX = this.panX - cx * (this.zoom - oldZoom);
            this.panY = this.panY - cy * (this.zoom - oldZoom);

            this.applyTransform();
            if (this.onDraw) this.onDraw();
        });

        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const isMiddleClick = e.button === 1 || e.button === 4;
            const isRightClick = e.button === 2;

            if (isMiddleClick) {
                this.isPanning = true;
                this.startX = e.clientX;
                this.startY = e.clientY;
                this.dragPanStartX = this.panX;
                this.dragPanStartY = this.panY;
            } else {
                this.isDrawing = true;
                const coords = this.getCoords(e.clientX, e.clientY);
                if (this.onMouseDown) {
                    this.onMouseDown({
                        x: coords.x,
                        y: coords.y,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        button: e.button,
                        buttons: e.buttons,
                        isRightClick: isRightClick,
                        originalEvent: e
                    });
                }
            }
        });

        this.globalMouseMoveHandler = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const inCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                             e.clientY >= rect.top && e.clientY <= rect.bottom;

            if (this.isPanning) {
                const dx = e.clientX - this.startX;
                const dy = e.clientY - this.startY;
                this.panX = this.dragPanStartX + dx;
                this.panY = this.dragPanStartY + dy;
                this.applyTransform();
                if (this.onDraw) this.onDraw();
            } else if (this.isDrawing) {
                const coords = this.getCoords(e.clientX, e.clientY);
                const isRightClick = e.button === 2 || (e.buttons & 2) === 2;
                if (this.onMouseMove) {
                    this.onMouseMove({
                        x: coords.x,
                        y: coords.y,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        button: e.button,
                        buttons: e.buttons,
                        isRightClick: isRightClick,
                        originalEvent: e
                    });
                }
            }

            if (inCanvas) {
                const coords = this.getCoords(e.clientX, e.clientY);
                if (this.onHover) {
                    this.onHover(coords.x, coords.y, e.clientX, e.clientY);
                }
            } else {
                if (this.onHover) this.onHover(null, null, null, null);
            }
        };

        this.globalMouseUpHandler = (e: MouseEvent) => {
            if (this.isPanning || this.isDrawing) {
                const coords = this.getCoords(e.clientX, e.clientY);
                const isRightClick = e.button === 2;
                if (this.onMouseUp) {
                    this.onMouseUp({
                        x: coords.x,
                        y: coords.y,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        button: e.button,
                        buttons: e.buttons,
                        isRightClick: isRightClick,
                        originalEvent: e
                    });
                }
                this.isPanning = false;
                this.isDrawing = false;
                this.applyTransform();
                if (this.onDraw) this.onDraw();
            }
        };

        window.addEventListener('mousemove', this.globalMouseMoveHandler);
        window.addEventListener('mouseup', this.globalMouseUpHandler);

        canvas.addEventListener('mouseleave', () => {
            if (this.onMouseLeave) this.onMouseLeave();
            if (this.onHover) this.onHover(null, null, null, null);
        });

        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Touch support
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.touchCount = e.touches.length;
            this.touchStartTime = Date.now();
            this.touchMoved = false;

            if (this.touchCount === 1) {
                const t = e.touches[0];
                this.isDrawing = true;
                this.isPanning = false;
                const coords = this.getCoords(t.clientX, t.clientY);
                if (this.onMouseDown) {
                    this.onMouseDown({
                        x: coords.x,
                        y: coords.y,
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        buttons: 1,
                        isRightClick: false,
                        originalEvent: e
                    });
                }
            } else if (this.touchCount === 2) {
                this.isDrawing = false;
                this.isPanning = true;
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                
                this.touchStartDistance = Math.sqrt((t1.clientX - t2.clientX) ** 2 + (t1.clientY - t2.clientY) ** 2);
                this.touchStartMidpoint = {
                    x: (t1.clientX + t2.clientX) / 2,
                    y: (t1.clientY + t2.clientY) / 2
                };
                this.touchStartZoom = this.zoom;
                this.touchStartPan = { x: this.panX, y: this.panY };
                
                this.startX = this.touchStartMidpoint.x;
                this.startY = this.touchStartMidpoint.y;
                this.dragPanStartX = this.panX;
                this.dragPanStartY = this.panY;
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.touchMoved = true;

            if (this.touchCount === 1 && this.isDrawing) {
                const t = e.touches[0];
                const coords = this.getCoords(t.clientX, t.clientY);
                if (this.onMouseMove) {
                    this.onMouseMove({
                        x: coords.x,
                        y: coords.y,
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        buttons: 1,
                        isRightClick: false,
                        originalEvent: e
                    });
                }
            } else if (this.touchCount === 2 && this.isPanning) {
                const t1 = e.touches[0];
                const t2 = e.touches[1];

                const currentDistance = Math.sqrt((t1.clientX - t2.clientX) ** 2 + (t1.clientY - t2.clientY) ** 2);
                const currentMidpoint = {
                    x: (t1.clientX + t2.clientX) / 2,
                    y: (t1.clientY + t2.clientY) / 2
                };

                const dx = currentMidpoint.x - this.touchStartMidpoint.x;
                const dy = currentMidpoint.y - this.touchStartMidpoint.y;
                this.panX = this.touchStartPan.x + dx;
                this.panY = this.touchStartPan.y + dy;

                if (this.touchStartDistance > 10) {
                    const factor = currentDistance / this.touchStartDistance;
                    const newZoom = Math.max(0.2, Math.min(25.0, this.touchStartZoom * factor));
                    
                    const rect = canvas.getBoundingClientRect();
                    const cx = (currentMidpoint.x - rect.left) / this.zoom;
                    const cy = (currentMidpoint.y - rect.top) / this.zoom;

                    const oldZoom = this.zoom;
                    this.zoom = newZoom;
                    this.panX = this.panX - cx * (this.zoom - oldZoom);
                    this.panY = this.panY - cy * (this.zoom - oldZoom);
                }

                this.applyTransform();
                if (this.onDraw) this.onDraw();
            }
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - this.touchStartTime;
            
            if (this.touchCount === 2 && !this.touchMoved && touchDuration < 300) {
                const coords = this.getCoords(this.touchStartMidpoint.x, this.touchStartMidpoint.y);
                if (this.onMouseDown) {
                    this.onMouseDown({
                        x: coords.x,
                        y: coords.y,
                        clientX: this.touchStartMidpoint.x,
                        clientY: this.touchStartMidpoint.y,
                        button: 2,
                        buttons: 2,
                        isRightClick: true,
                        originalEvent: e
                    });
                }
                if (this.onMouseUp) {
                    this.onMouseUp({
                        x: coords.x,
                        y: coords.y,
                        clientX: this.touchStartMidpoint.x,
                        clientY: this.touchStartMidpoint.y,
                        button: 2,
                        buttons: 2,
                        isRightClick: true,
                        originalEvent: e
                    });
                }
            } else if (this.isDrawing || this.isPanning) {
                const t = e.changedTouches[0] || { clientX: 0, clientY: 0 };
                const coords = this.getCoords(t.clientX, t.clientY);
                if (this.onMouseUp) {
                    this.onMouseUp({
                        x: coords.x,
                        y: coords.y,
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        buttons: 0,
                        isRightClick: false,
                        originalEvent: e
                    });
                }
            }

            this.isDrawing = false;
            this.isPanning = false;
            this.touchCount = 0;
            this.applyTransform();
            if (this.onDraw) this.onDraw();
        });
    }

    destroy() {
        window.removeEventListener('mousemove', this.globalMouseMoveHandler);
        window.removeEventListener('mouseup', this.globalMouseUpHandler);
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.overlayCanvas && this.overlayCanvas.parentNode) {
            this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
        }
    }
}

export class FullScreenWorkspace {
    overlay: HTMLDivElement;
    header: HTMLDivElement;
    titleNode: HTMLSpanElement;
    body: HTMLDivElement;
    sidebar: HTMLDivElement;
    content: HTMLDivElement;
    
    onApplyCallback?: () => void;
    onCancelCallback?: () => void;
    private escHandler: (e: KeyboardEvent) => void;
    private isClosed = false;

    constructor(options: FullScreenWorkspaceOptions) {
        this.injectStyles();
        
        // Root fullscreen wrapper
        this.overlay = document.createElement('div');
        this.overlay.className = 'fs-workspace-overlay';
        
        // Header Bar
        this.header = document.createElement('div');
        this.header.className = 'fs-workspace-header';
        
        this.titleNode = document.createElement('span');
        this.titleNode.className = 'fs-workspace-title';
        this.titleNode.textContent = options.title;
        this.header.appendChild(this.titleNode);
        
        // Header Actions Container
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'fs-workspace-header-actions';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn cancel-btn';
        cancelBtn.id = 'fs-btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => this.close(false));
        
        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn';
        applyBtn.id = 'fs-btn-apply';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => this.close(true));
        
        actionsContainer.appendChild(cancelBtn);
        actionsContainer.appendChild(applyBtn);
        this.header.appendChild(actionsContainer);
        this.header.addEventListener('mousedown', (e) => e.stopPropagation()); // prevent drag issues
        
        this.overlay.appendChild(this.header);
        
        // Main split-pane container
        this.body = document.createElement('div');
        this.body.className = 'fs-workspace-body';
        
        // Sidebar for parameters and controls
        this.sidebar = document.createElement('div');
        this.sidebar.className = 'fs-workspace-sidebar';
        this.body.appendChild(this.sidebar);
        
        // Dynamic viewport container for canvases
        this.content = document.createElement('div');
        this.content.className = 'fs-workspace-content';
        this.body.appendChild(this.content);
        
        this.overlay.appendChild(this.body);
        
        this.onApplyCallback = options.onApply;
        this.onCancelCallback = options.onCancel;
        
        // Register key cancel helper
        this.escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.overlay.parentNode) {
                this.close(false);
            }
        };
        document.addEventListener('keydown', this.escHandler);
    }

    private injectStyles() {
        if (document.getElementById('fs-workspace-style')) return;
        const style = document.createElement('style');
        style.id = 'fs-workspace-style';
        style.textContent = `
            .fs-workspace-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; background: #121212; z-index: 9999; display: flex; flex-direction: column; color: #e0e0e0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 13px; box-sizing: border-box; }
            .fs-workspace-header { height: 48px; background: #1e1e1e; border-bottom: 1px solid #333333; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; box-sizing: border-box; flex-shrink: 0; }
            .fs-workspace-title { font-size: 15px; font-weight: 600; letter-spacing: 0.5px; color: #007acc; text-transform: uppercase; }
            .fs-workspace-header-actions { display: flex; gap: 10px; }
            .fs-workspace-body { flex-grow: 1; display: flex; overflow: hidden; }
            .fs-workspace-sidebar { width: 340px; background: #1e1e1e; border-right: 1px solid #333333; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box; overflow-y: auto; flex-shrink: 0; gap: 10px; }
            .fs-workspace-content { flex-grow: 1; background: #141414; overflow: hidden; display: flex; position: relative; box-sizing: border-box; }
            .fs-workspace-section-title { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #888; border-bottom: 1px solid #2d2d2d; padding-bottom: 6px; margin-bottom: 5px; margin-top: 10px; letter-spacing: 0.5px; }
            
            .fs-panels-container { display: flex; width: 100%; height: 100%; gap: 15px; padding: 15px; box-sizing: border-box; background: #141414; }
            .fs-split-panel { flex: 1; display: flex; flex-direction: column; background: #1e1e1e; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
            .fs-split-panel-header { display: flex; justify-content: space-between; align-items: center; background: #252526; padding: 8px 12px; border-bottom: 1px solid #333; font-weight: bold; font-size: 11px; color: #aaa; text-transform: uppercase; }
            .fs-split-canvas-wrapper { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 10px; background-image: linear-gradient(45deg, #181818 25%, transparent 25%), linear-gradient(-45deg, #181818 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181818 75%), linear-gradient(-45deg, transparent 75%, #181818 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px; position: relative; }
            .fs-split-canvas { box-shadow: 0 4px 12px rgba(0,0,0,0.5); object-fit: contain; image-rendering: pixelated; background: transparent; cursor: crosshair; max-width: 100%; max-height: 100%; }
            .fs-tool-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
            .fs-tool-group.tri { grid-template-columns: 1fr 1fr 1fr; }
            .fs-tool-btn { background-color: #121212; border: 1px solid #333; color: #ccc; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background-color 0.2s, border-color 0.2s; font-weight: bold; }
            .fs-tool-btn:hover { background-color: #2a2a2a; border-color: #007acc; }
            .fs-tool-btn.active { border-color: #007acc; background-color: rgba(0, 122, 204, 0.15); color: #fff; }
        `;
        document.head.appendChild(style);
    }

    /**
     * Appends the workspace to the document tree
     */
    show() {
        document.body.appendChild(this.overlay);
    }

    createPanel(options: { title: string; status?: string; id?: string }) {
        const panelId = options.id || 'fs-panel-' + Math.random().toString(36).substr(2, 9);
        const panel = UI.createNode('div', { className: 'fs-split-panel', id: panelId },
            UI.createNode('div', { className: 'fs-split-panel-header' },
                UI.createNode('span', {}, options.title),
                UI.createNode('span', { className: 'fs-panel-status' }, options.status || '')
            ),
            UI.createNode('div', { className: 'fs-split-canvas-wrapper' },
                UI.createNode('canvas', { className: 'fs-split-canvas' })
            )
        );

        let container = this.content.querySelector('.fs-panels-container') as HTMLDivElement;
        if (!container) {
            container = UI.createNode('div', { className: 'fs-panels-container' });
            this.content.appendChild(container);
        }
        container.appendChild(panel);

        const canvas = panel.querySelector('.fs-split-canvas') as HTMLCanvasElement;
        const statusEl = panel.querySelector('.fs-panel-status') as HTMLElement;

        const count = container.children.length;
        if (count === 1) {
            container.style.display = 'flex';
            container.style.flexDirection = 'row';
        } else if (count === 2) {
            container.style.display = 'flex';
            container.style.flexDirection = 'row';
        } else {
            container.style.display = 'grid';
            container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
            container.style.gridAutoRows = '1fr';
        }

        return {
            panel,
            canvas,
            statusEl
        };
    }

    /**
     * Removes the layout and executes lifecycle callbacks
     */
    close(apply: boolean) {
        if (this.isClosed) return;
        this.isClosed = true;

        if (this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        document.removeEventListener('keydown', this.escHandler);
        
        if (apply && this.onApplyCallback) {
            this.onApplyCallback();
        } else if (!apply && this.onCancelCallback) {
            this.onCancelCallback();
        }
    }
}
