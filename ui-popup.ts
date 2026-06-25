
export class Popup {
    closeOnBgTap: boolean;
    overlay: HTMLDivElement;
    window: HTMLDivElement;
    header: HTMLDivElement;
    titleNode: HTMLSpanElement;
    content: HTMLDivElement;
    closeCallback: Function | null;
    overlayEvents: Record<string, EventListener>;
    isDragging: boolean;
    dragOffset: { x: number; y: number };
    keydownHandler: (e: KeyboardEvent) => void;

    constructor() {
        this.injectStyles();
        this.closeOnBgTap = false;
        this.overlay = document.createElement('div');
        this.overlay.className = 'popup-overlay';
        this.window = document.createElement('div');
        this.window.className = 'popup-wnd';
        
        // Header (Title Bar)
        this.header = document.createElement('div');
        this.header.className = 'popup-header';
        this.titleNode = document.createElement('span'); 
        this.header.appendChild(this.titleNode);
        this.window.appendChild(this.header);

        // Content Body
        this.content = document.createElement('div');
        this.content.className = 'popup-body';
        this.window.appendChild(this.content);

        this.closeCallback = null;
        this.overlayEvents = {}; 
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };

        // Esc key binding for safe cancellation
        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.window.parentNode) {
                const cancelBtn = this.getById('btn-cancel');
                if (cancelBtn) {
                    cancelBtn.click();
                } else {
                    this.close();
                }
            }
        };
        document.addEventListener('keydown', this.keydownHandler);

        // Click Event
        this.overlay.addEventListener('click', (e) => {
            if (this.overlayEvents.click && e.target === this.overlay) {
                this.overlayEvents.click(e);
                return;
            }
            if (this.closeOnBgTap && e.target === this.overlay) {
                this.close();
            }
        });

        // Generic Events Proxy
        const proxy = (e: Event) => { if (this.overlayEvents[e.type]) { this.overlayEvents[e.type](e); } };
        ['mousemove', 'mousedown', 'mouseup'].forEach(t => this.overlay.addEventListener(t, proxy));

        // Drag Events
        this.header.addEventListener('mousedown', this.startDrag.bind(this));
        document.addEventListener('mousemove', this.onDrag.bind(this));
        document.addEventListener('mouseup', this.stopDrag.bind(this));
    }

    injectStyles() {
        if (document.getElementById('popup-style')) return;
        const style = document.createElement('style');
        style.id = 'popup-style';
        style.textContent = `
            .popup-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: transparent; z-index: 999; }
            .popup-wnd { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #252526; color: #ccc; padding: 0; border-radius: 4px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); border: 1px solid #3e3e42; z-index: 1000; width: 90%; max-width: 400px; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 13px; flex-direction: column; max-height: 90vh; }
            .popup-header { height: 32px; background: #333; cursor: move; flex-shrink: 0; display: flex; align-items: center; padding: 0 10px; border-bottom: 1px solid #3e3e42; font-weight: 600; color: #fff; user-select: none; }
            .popup-body { padding: 15px; overflow-y: auto; flex: 1; min-height: 0; }
            .popup-wnd h3 { margin: 0 0 15px 0; font-size: 14px; color: #fff; font-weight: 600; border-bottom: 1px solid #3e3e42; padding-bottom: 8px; }
            .popup-wnd label { display: flex; align-items: center; margin: 10px 0 5px; color: #aaa; font-size: 12px; }
            .popup-wnd .row { margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
            .popup-wnd .row label { margin: 0; flex-shrink: 0; min-width: 80px; }
            .popup-wnd .row > input, .popup-wnd .row > select, .popup-wnd .row > div { flex: 1; width: auto !important; min-width: 0; }
            .popup-wnd input, .popup-wnd select, .popup-wnd textarea { width: 100%; padding: 5px; box-sizing: border-box; border: 1px solid #3e3e42; border-radius: 2px; color: #fff; background: #3c3c3c; font-family: inherit; font-size: 12px; }
            .popup-wnd input:focus, .popup-wnd select:focus, .popup-wnd textarea:focus { border-color: #007acc; outline: none; }
            .popup-wnd input[type="range"] { padding: 0; border: none; background: transparent; height: auto; }
            .popup-wnd input[type="checkbox"] { width: auto; margin: 0 5px 0 0; }
            .popup-wnd button { padding: 6px 15px; background: #007acc; color: white; border: none; border-radius: 2px; cursor: pointer; margin: 15px 5px 0 0; font-size: 12px; }
            .popup-wnd button:hover { opacity: 0.9; }
            .popup-wnd button.cancel-btn { background: #3e3e42; }
            .popup-wnd button.cancel-btn:hover { background: #4e4e52; }
            .popup-subtitle { font-size: 12px; font-weight: bold; color: #fff; text-transform: uppercase; margin: 15px 0 10px 0; letter-spacing: 0.5px; }
            .popup-separator { height: 1px; background: #3e3e42; margin: 10px 0; }
            .popup-hint { font-size: 11px; color: #999; margin-bottom: 10px; }
            .popup-preview { background: #1e1e1e; border: 1px solid #3e3e42; display: block; margin: 0 auto 10px; max-width: 100%; cursor: crosshair; }
            .popup-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px; }
        `;
        document.head.appendChild(style);
    }

    startDrag(e: MouseEvent) {
        this.isDragging = true;
        const rect = this.window.getBoundingClientRect();
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
        this.window.style.transform = 'none';
        this.window.style.left = rect.left + 'px';
        this.window.style.top = rect.top + 'px';
    }

    onDrag(e: MouseEvent) {
        if (!this.isDragging) return;
        e.preventDefault();
        let x = e.clientX - this.dragOffset.x;
        let y = e.clientY - this.dragOffset.y;
        
        y = Math.max(0, Math.min(y, window.innerHeight - 30));
        x = Math.max(20 - this.window.offsetWidth, Math.min(x, window.innerWidth - 20));

        this.window.style.left = x + 'px';
        this.window.style.top = y + 'px';
    }

    stopDrag() { this.isDragging = false; }
    
    setHtml(innerHtml: string) {
        // Use first header as title
        const titleMatch = innerHtml.match(/^\s*<(h[1-3])>(.*?)<\/\1>/i);
        if (titleMatch) {
            this.titleNode.textContent = titleMatch[2]; 
            this.content.innerHTML = innerHtml.replace(titleMatch[0], '');
        } else {
            this.titleNode.textContent = 'ImgEdit';
            this.content.innerHTML = innerHtml;
        }
    }
    
    getById(nodeId: string): HTMLElement | null { return this.content.querySelector(`#${nodeId}`); }

    onClick(nodeId: string, callback: EventListener) {
        const element = this.getById(nodeId);
        if (element) {
            element.addEventListener('click', callback);
        } else {
            console.warn(`Element with ID "${nodeId}" not found in popup content`);
        }
    }

    setOverlayEvents(handlers: Record<string, EventListener> | null, cursor?: string) {
        this.overlayEvents = handlers || {};
        this.overlay.style.cursor = cursor || 'default';
    }

    onClose(callback: Function) { this.closeCallback = callback; }

    setWidth(width?: string, maxWidth?: string) {
        if (width) this.window.style.width = width;
        if (maxWidth) this.window.style.maxWidth = maxWidth;
    }

    close(optionalResult: any = null) {
        if (this.overlay.parentNode) { this.overlay.parentNode.removeChild(this.overlay); }
        if (this.window.parentNode) { this.window.parentNode.removeChild(this.window); }
        this.window.style.width = '';
        this.window.style.maxWidth = '';
        this.setOverlayEvents(null); // Reset handlers
        if (this.closeCallback) {
            this.closeCallback(optionalResult);
            this.closeCallback = null;
        }
    }

    show() {
        document.body.appendChild(this.overlay);
        document.body.appendChild(this.window);
        this.window.style.transform = 'translate(-50%, -50%)';
        this.window.style.left = '50%';
        this.window.style.top = '50%';
        this.overlay.style.display = 'block';
        this.window.style.display = 'flex';
        this.setOverlayEvents(null); // Reset previous handlers
    }
}