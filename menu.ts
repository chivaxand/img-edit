import { App } from './app';
import { Filters } from './filters';
import { JpegExport } from './actions/jpeg-export';
import { GifExport } from './actions/gif-export';

export interface MenuItemDef {
    label?: string;
    type?: string;
    disabled?: boolean;
    action?: () => void;
    items?: MenuItemDef[];
    submenu?: MenuItemDef[];
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
                { label: 'Delete Selection (Del)', action: () => App.actions.deleteSelection() }
            ]
        },
        {
            label: 'Transform',
            items: [
                { label: 'Resize...', action: () => App.actions.openResizeDialog() },
                { label: 'Skew / Rotate...', action: () => App.actions.openTransformDialog() },
                { label: 'Flip / Rotate...', action: () => App.actions.openFlipRotateDialog() }
            ]
        },
        {
            label: 'Generate',
            items: [
                { label: 'Noise (White)...', action: () => Filters.run('noise') },
                { label: 'Blue Noise...', action: () => Filters.run('blue-noise') },
                { label: 'Perlin Noise...', action: () => Filters.run('perlin-noise') }
            ]
        },
        {
            label: 'Analyze',
            items: [
                { label: 'Forensic...', action: () => Filters.run('forensic') },
                { label: 'Spectral Analysis...', action: () => Filters.run('spectral') },
                { label: 'DCT Histograms...', action: () => Filters.run('dct') },
                { label: 'Wavelet Decomposition...', action: () => Filters.run('wavelet') },
                { label: 'RGB Cube...', action: () => Filters.run('rgb-cube') },
                { label: 'Focus Map...', action: () => Filters.run('focusmap') },
                { label: 'Normal Map...', action: () => Filters.run('normalmap') },
            ]
        },
        {
            label: 'Filter',
            items: [
                { label: 'Blur', submenu: [
                    { label: 'Gaussian Blur...', action: () => Filters.run('blur') },
                    { label: 'Bilateral Blur...', action: () => Filters.run('bilateral') }
                ]},
                { label: 'Denoise', submenu: [
                    { label: 'Median...', action: () => Filters.run('median') },
                    { label: 'Total Variation...', action: () => Filters.run('tv') },
                    { label: 'Non-Local Means...', action: () => Filters.run('nlm') },
                    { label: 'BM3D (very slow)...', action: () => Filters.run('bm3d') }
                ]},
                { label: 'Enhance', submenu: [
                    { label: 'Unblur (Wiener)...', action: () => Filters.run('unblur') },
                    { label: 'Unsharp Mask...', action: () => Filters.run('unsharp-mask') },
                    { label: 'Smart Sharpen...', action: () => Filters.run('smart-sharpen') },
                    { label: 'Document Scan...', action: () => Filters.run('document-scan') },
                ]},
                { label: 'Edge Detection', submenu: [
                    { label: 'Canny...', action: () => Filters.run('canny') },
                    { label: 'Convolution Matrix...', action: () => Filters.run('convolution') },
                    { label: 'Difference of Gaussians...', action: () => Filters.run('diff-of-gauss') },
                ]},
                { label: 'Segmentation', submenu: [
                    { label: 'Hybrid GrabCut...', action: () => (window as any).GrabCutFilter.open() },
                    { label: 'Watershed...', action: () => (window as any).WatershedFilter.open() },
                    { label: 'Superpixels...', action: () => Filters.run('superpixels') },
                ]},
                { label: 'Photo', submenu: [
                    { label: 'Vignette...', action: () => Filters.run('vignette') }
                ]},
                { label: 'Stylize', submenu: [
                    { label: 'Pixelate / Mosaic...', action: () => Filters.run('pixelate') },
                    { label: 'Dithering...', action: () => Filters.run('dither') },
                    { label: 'Palette / Quantize...', action: () => Filters.run('palette') },
                    { label: 'Kuwahara...', action: () => Filters.run('kuwahara') }
                ]},
                { label: 'Distort', submenu: [
                    { label: 'Lens Correction...', action: () => Filters.run('distort-lens-correction') },
                    { label: 'Twirl...', action: () => Filters.run('distort-twirl') },
                    { label: 'Ripple...', action: () => Filters.run('distort-ripple') },
                    { label: 'Water ripple...', action: () => Filters.run('distort-water') },
                    { label: 'Spherize / Pinch...', action: () => Filters.run('distort-spherize') }
                ]}
            ]
        },
        {
            label: 'Color',
            items: [
                { label: 'Grayscale', action: () => Filters.run('grayscale') },
                { label: 'Invert', action: () => Filters.run('invert') },
                { label: 'Sepia', action: () => Filters.run('sepia') },
                { type: 'separator' },
                { label: 'White Balance...', action: () => Filters.run('whitebalance') },
                { label: 'Levels...', action: () => Filters.run('levels') },
                { label: 'Curves...', action: () => Filters.run('curves') },
                { label: 'Threshold...', action: () => Filters.run('threshold') },
                { label: 'Exposure...', action: () => Filters.run('exposure') },
                { label: 'Shadows & Highlights...', action: () => Filters.run('tone') },
                { label: 'Brightness...', action: () => Filters.run('brightness') },
                { label: 'Contrast...', action: () => Filters.run('contrast') },
                { label: 'Saturation...', action: () => Filters.run('saturate') },
                { label: 'Hue Rotate...', action: () => Filters.run('hue') },
                { type: 'separator' },
                { label: 'Chroma Key...', action: () => Filters.run('chromakey') },
            ]
        },
        {
            label: 'Layer',
            items: [
                { label: 'New Empty Layer', action: () => App.actions.addEmptyLayer() },
                { label: 'Duplicate Layer', action: () => App.actions.duplicateLayer() },
                { label: 'Layer Size...', action: () => App.actions.openLayerCanvasSizeDialog() },
                { label: 'Merge All Layers', action: () => App.actions.mergeAll() }
            ]
        }
    ] as MenuItemDef[],

    activeRoot: null as HTMLElement | null,

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
            .menu-dropdown { display: none; position: absolute; top: 100%; left: 0; background: #252526; border: 1px solid #3e3e42; min-width: 160px; z-index: 2000; box-shadow: 0 4px 6px rgba(0,0,0,0.3); padding: 4px 0; }
            
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
