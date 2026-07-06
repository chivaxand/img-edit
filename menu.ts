import { App } from '~/app';
import { Filters } from '~/filters';
import { JpegExport } from '~/actions/jpeg-export';
import { GifExport } from '~/actions/gif-export';

export interface MenuItemDef {
    label?: string;
    type?: string;
    disabled?: boolean;
    action?: () => void;
    items?: MenuItemDef[];
    submenu?: MenuItemDef[];
    order?: number;
}

export const Menu = {
    structure: [
        {
            label: 'File',
            items: [
                { label: 'Open...', action: () => document.getElementById('file-upload')!.click() },
                { label: 'Export PNG', action: () => App.actions.download() },
                { label: 'Export JPEG...', action: () => JpegExport.open() },
                { label: 'Export Base64', action: () => App.actions.exportBase64() },
                { label: 'Export GIF...', action: () => GifExport.open() }
            ]
        },
        {
            label: 'Select',
            items: [
                { label: 'Deselect (Ctrl+A)', action: () => App.actions.deselect() },
                { label: 'Inverse Selection', action: () => App.actions.inverseSelection() },
                { label: 'Delete Selection (Del)', action: () => App.actions.deleteSelection() },
                { label: 'Save Selection...', action: () => App.actions.openSaveSelectionDialog() },
                { label: 'Load Selection...', action: () => App.actions.openLoadSelectionDialog() }
            ]
        },
        { label: 'Transform', items: [] },
        { label: 'Generate', items: [] },
        { label: 'Analyze', items: [] },
        {
            label: 'Filter',
            items: [
                { label: 'Blur', submenu: []},
                { label: 'Denoise', submenu: []},
                { label: 'Enhance', submenu: []},
                { label: 'Edge Detection', submenu: []},
                { label: 'Segmentation', submenu: []},
                { label: 'Photo', submenu: []},
                { label: 'Stylize', submenu: []},
                { label: 'Distort', submenu: []}
            ]
        },
        {
            label: 'Tone',
            items: [
                { type: 'separator', order: 3 },
                { type: 'separator', order: 10 }
            ]
        },
        {
            label: 'Color',
            items: [
                { type: 'separator', order: 100 }
            ]
        },
        {
            label: 'Layer',
            items: [
                { label: 'New Empty Layer', action: () => App.actions.addEmptyLayer() },
                { label: 'Duplicate Layer', action: () => App.actions.duplicateLayer() },
                { label: 'Merge Layer Down', action: () => App.actions.mergeLayerDown() },
                { label: 'Merge All Layers', action: () => App.actions.mergeAll() }
            ]
        },
        {
            label: 'Script',
            items: [
                { label: 'Macro Runner...', action: () => App.actions.openMacroRunner() },
                { label: 'Start/Stop Recording', action: () => App.actions.toggleRecording() },
                { label: 'Clear Recording', action: () => App.actions.clearRecording() }
            ]
        }
    ] as MenuItemDef[],

    activeRoot: null as HTMLElement | null,

    registerDynamicItem(path: string, item: MenuItemDef, order = 100) {
        const parts = path.split('/');
        let currentList = this.structure;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            let found = currentList.find(x => x.label === part);
            if (!found) {
                found = { label: part, items: [] };
                currentList.push(found);
            }
            
            if (i === parts.length - 1) {
                if (!found.items && !found.submenu) {
                    found.items = [];
                }
                const list = found.items || found.submenu;
                (item as any).order = order;
                list!.push(item);
                
                list!.sort((a, b) => {
                    const orderA = (a as any).order !== undefined ? (a as any).order : 1000;
                    const orderB = (b as any).order !== undefined ? (b as any).order : 1000;
                    if (orderA !== orderB) return orderA - orderB;
                    return (a.label || '').localeCompare(b.label || '');
                });
            } else {
                if (!found.items && !found.submenu) {
                    found.submenu = [];
                }
                currentList = found.items || found.submenu!;
            }
        }
    },

    init() {
        this.injectCSS();
        const container = document.getElementById('app-header')!;
        const menuBar = document.createElement('div');
        menuBar.className = 'menu-bar';
        
        document.addEventListener('click', e => {
            if (!menuBar.contains(e.target as Node)) this.closeAll();
        });

        this.structure.forEach(root => {
            const rootEl = this.createItem(root, true);
            menuBar.appendChild(rootEl);
        });
        
        container.insertBefore(menuBar, container.children[1]);
        
        // Expose globally for console debugging
        (window as any).Menu = Menu;
    },

    print() {
        console.log(JSON.stringify(this.structure, null, 2))
    },

    createItem(def: MenuItemDef, isRoot = false): HTMLElement {
        const el = document.createElement('div');
        el.className = def.type === 'separator' ? 'menu-separator' : 'menu-item';
        if (def.type === 'separator') return el;

        el.textContent = def.label || '';
        if (def.disabled) el.classList.add('disabled');
        
        if (def.action) {
            el.onclick = (e) => { 
                e.stopPropagation();
                if(!def.disabled) {
                    def.action!(); 
                    this.closeAll(); 
                }
            };
        }

        if (def.items || def.submenu) {
            el.classList.add('has-submenu');
            const drop = document.createElement('div');
            drop.className = 'menu-dropdown';
            (def.items || def.submenu)!.forEach(sub => drop.appendChild(this.createItem(sub, false)));
            el.appendChild(drop);

            if (isRoot) {
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (this.activeRoot === el) this.closeAll();
                    else this.openRoot(el);
                };
                el.onmouseenter = () => {
                    if (this.activeRoot && this.activeRoot !== el) this.openRoot(el);
                };
            }
        }
        return el;
    },

    openRoot(el: HTMLElement) {
        this.closeAll();
        this.activeRoot = el;
        el.classList.add('open');
    },

    closeAll() {
        if (this.activeRoot) {
            this.activeRoot.classList.remove('open');
            this.activeRoot = null;
        }
    },

    injectCSS() {
        const style = document.createElement('style');
        style.textContent = `
            .menu-bar { display: flex; height: 100%; align-items: center; margin-left: 10px; }
            .menu-item { position: relative; padding: 0 10px; height: 30px; display: flex; align-items: center; cursor: pointer; color: #ccc; font-size: 13px; }
            .menu-item:hover { background: #333; color: #fff; }
            .menu-item.open { background: #333; color: #fff; }
            .menu-item.disabled { color: #666; pointer-events: none; }
            .menu-separator { height: 1px; background: #444; margin: 4px 0; }
            .menu-dropdown { display: none; position: absolute; top: 100%; left: 0; background: #252526; border: 1px solid #3e3e42; min-width: 190px; z-index: 2000; box-shadow: 0 4px 6px rgba(0,0,0,0.3); padding: 4px 0; }
            
            /* Root Menu Logic */
            .menu-item.open > .menu-dropdown { display: block; }

            /* Nested Submenus Hover Logic */
            .menu-dropdown .menu-item { padding: 6px 15px; height: auto; display: block; }
            .menu-dropdown .menu-item.has-submenu:after { content: '▸'; float: right; margin-left: 10px; color: #888; }
            .menu-dropdown .menu-item > .menu-dropdown { top: 0; left: 100%; margin-left: -1px; }
            .menu-dropdown .menu-item:hover > .menu-dropdown { display: block; }
        `;
        document.head.appendChild(style);
    }
};
