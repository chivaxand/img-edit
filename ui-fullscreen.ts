import { UI } from './ui';

export interface FullScreenWorkspaceOptions {
    title: string;
    onApply?: () => void;
    onCancel?: () => void;
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
            .fs-workspace-sidebar { width: 320px; background: #1e1e1e; border-right: 1px solid #333333; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box; overflow-y: auto; flex-shrink: 0; gap: 20px; }
            .fs-workspace-content { flex-grow: 1; background: #141414; overflow: hidden; display: flex; position: relative; box-sizing: border-box; }
            .fs-workspace-section-title { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #888; border-bottom: 1px solid #2d2d2d; padding-bottom: 6px; margin-bottom: 10px; letter-spacing: 0.5px; }
        `;
        document.head.appendChild(style);
    }

    /**
     * Appends the workspace to the document tree
     */
    show() {
        document.body.appendChild(this.overlay);
    }

    /**
     * Removes the layout and executes lifecycle callbacks
     */
    close(apply: boolean) {
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