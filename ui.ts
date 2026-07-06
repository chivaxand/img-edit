import { plot, PaletteName } from '~/libs/plot';

export interface UIProps {
    id?: string;
    className?: string;
    style?: string | Partial<CSSStyleDeclaration>;
    on?: Record<string, EventListenerOrEventListenerObject>;
    classList?: string[];
    dataset?: Record<string, string>;
    textContent?: string;
    innerHTML?: string;
    value?: string | number;
    checked?: boolean;
    type?: string;
    placeholder?: string;
    title?: string;
    disabled?: boolean;
    [key: string]: any; // Fallback for other HTML attributes
}

// Strictly typed options interfaces for optimal compile-time safety and IDE autocompletion
interface UISliderOpts {
    min: number;
    max: number;
    value: number | string;
    step?: number | null;
    onInput?: (val: string) => void;
    onChange?: (val: string) => void;
    formatter?: (val: string | number) => string;
    label?: string | null;
    [k: string]: any;
}

interface UICheckboxOpts {
    label: string;
    value: boolean;
    onChange: (val: boolean) => void;
    props?: UIProps;
    [k: string]: any;
}

interface UISelectOption<T = any> {
    value: T;
    text: string;
}

interface UISelectOpts<T = any> {
    label: string | null;
    options: Array<string | number | UISelectOption<T>>;
    value: T;
    onChange: (val: string) => void;
    [k: string]: any;
}

interface UIPaletteSelectOpts {
    label: string | null;
    value: PaletteName;
    onChange: (val: PaletteName) => void;
    [k: string]: any;
}

interface UIRadioOption<T = any> {
    value: T;
    label?: string;
    text?: string;
}

interface UIRadioOpts<T = any> {
    label: string | null;
    options: Array<string | number | UIRadioOption<T>>;
    value: T;
    name?: string;
    layout?: 'row' | 'column';
    onChange: (val: T) => void;
    [k: string]: any;
}

interface UIColorOpts {
    label: string | null;
    value: string;
    onChange: (val: string) => void;
    [k: string]: any;
}

interface UIButtonOpts {
    label: string;
    onClick: (e: Event) => void;
    className?: string;
    style?: string | Partial<CSSStyleDeclaration>;
    [k: string]: any;
}

interface UICanvasOpts {
    width?: number;
    height?: number;
    source?: HTMLCanvasElement;
    maxW?: number;
    maxH?: number;
    bg?: 'grid' | string;
    on?: Record<string, EventListenerOrEventListenerObject>;
    style?: string | Partial<CSSStyleDeclaration>;
    [k: string]: any;
}

interface UIInterface {
    createNode<K extends keyof HTMLElementTagNameMap>(
        tag: K,
        props?: UIProps,
        ...children: Array<Node | string | number | boolean | null | undefined>
    ): HTMLElementTagNameMap[K];
    createNode(
        tag: string,
        props?: UIProps,
        ...children: Array<Node | string | number | boolean | null | undefined>
    ): HTMLElement;
    createRow(label: string | null, content: HTMLElement): HTMLElement;
    createInput(type: string, props: UIProps, onInput: (target: HTMLInputElement) => void): HTMLInputElement;
    createButton(opts: UIButtonOpts): HTMLButtonElement;
    createSlider(opts: UISliderOpts): { container: HTMLDivElement; input: HTMLInputElement };
    createSliderRow(opts: UISliderOpts): HTMLElement;
    createCheckbox(opts: UICheckboxOpts): HTMLLabelElement;
    createHint(text: string, props?: UIProps): HTMLElement;
    createSelectRow<T = any>(opts: UISelectOpts<T>): HTMLElement;
    createPaletteSelectRow(opts: UIPaletteSelectOpts): HTMLElement;
    createRadioGroup<T = any>(opts: UIRadioOpts<T>): HTMLElement;
    createColorRow(opts: UIColorOpts): HTMLElement;
    createCanvas(opts?: UICanvasOpts): { element: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null };
    toggle(element: HTMLElement, isVisible: boolean, displayMode?: string): void;
    createSection(title: string, ...children: any[]): HTMLElement;
    createSubheading(text: string, color?: string): HTMLElement;
}

export const UI: UIInterface = {
    createNode(tag: string, props: UIProps = {}, ...children: any[]): any {
        const el = document.createElement(tag);
        Object.keys(props || {}).forEach(key => {
            const val = (props as any)[key];
            if (key === 'on') { 
                Object.keys(val || {}).forEach(e => {
                    el.addEventListener(e, val[e]);
                });
            }
            else if (key === 'style') {
                if (typeof val === 'string') el.style.cssText = val;
                else Object.assign(el.style, val);
            }
            else if (key === 'classList') { (val as string[]).forEach(c => el.classList.add(c)); }
            else if (key === 'dataset') { Object.assign(el.dataset, val); }
            else if (key in el) { (el as any)[key] = val;  }
            else { el.setAttribute(key, String(val)); }
        });
        children.forEach(c => c && el.appendChild(c instanceof Node ? c : document.createTextNode(String(c))));
        return el;
    },
    
    createRow(label: string | null, content: HTMLElement): HTMLElement {
        return UI.createNode('div', { className: 'ui-row' }, 
            label ? UI.createNode('label', {}, label) : null, 
            content
        );
    },
    
    createInput(type: string, props: UIProps, onInput: (target: HTMLInputElement) => void): HTMLInputElement {
        const className = type === 'checkbox' ? 'ui-checkbox' : type === 'radio' ? 'ui-radio' : type === 'range' ? 'ui-range' : type === 'color' ? 'ui-color' : 'ui-input';
        const combinedClass = props.className ? `${className} ${props.className}` : className;
        return UI.createNode('input', { type, ...props, className: combinedClass, on: { [type === 'checkbox' || type === 'radio' ? 'change' : 'input']: (e: Event) => onInput(e.target as HTMLInputElement) } });
    },
    
    createButton(opts: UIButtonOpts): HTMLButtonElement {
        const { label, onClick, className = 'btn', style, ...rest } = opts;
        return this.createNode('button', { className, style, on: { click: onClick as EventListener }, ...rest }, label);
    },
    
    createSlider({ min, max, value, step = null, onInput, onChange, formatter }: UISliderOpts): { container: HTMLDivElement; input: HTMLInputElement } {
        const s = step !== null ? step : (Number(max) <= 1 ? 0.01 : 1);
        const formatValue = (v: any) => formatter ? formatter(v) : String(v);
        const disp = UI.createNode('span', { style: { width:'55px', textAlign:'right', fontSize:'10px', fontFamily:'monospace' } }, formatValue(value));
        const inp = UI.createNode('input', { 
            type: 'range', className: 'ui-range', min, max, step: s, value: value, 
            on: { 
                input: (e: Event) => { 
                    const target = e.target as HTMLInputElement;
                    disp.textContent = formatValue(target.value); 
                    if(onInput) onInput(target.value); 
                },
                change: (e: Event) => { 
                    const target = e.target as HTMLInputElement;
                    if(onChange) onChange(target.value); 
                } 
            }
        });
        return { 
            container: UI.createNode('div', { style:{display:'flex', width:'100%', alignItems:'center'} }, inp, disp), 
            input: inp 
        };
    },

    // --- High-Level UI Helpers ---

    createSliderRow(opts: UISliderOpts): HTMLElement {
        return this.createRow(opts.label || null, this.createSlider(opts).container);
    },
    
    createCheckbox({ label, value, onChange, props = {} }: UICheckboxOpts): HTMLLabelElement {
        const input = this.createInput('checkbox', { checked: value, ...props }, t => onChange(t.checked));
        return this.createNode('label', { className: 'ui-checkbox-label' },
            input,
            this.createNode('span', {}, label)
        );
    },

    createHint(text: string, props: UIProps = {}): HTMLElement {
        const defaultStyle: Partial<CSSStyleDeclaration> = { fontSize: '11px', color: '#aaa', marginBottom: '10px', lineHeight: '1.4' };
        const userStyle = props.style;
        const style = typeof userStyle === 'string' ? userStyle : { ...defaultStyle, ...userStyle };
        return this.createNode('div', { className: 'popup-hint', innerHTML: text, ...props, style });
    },
    
    createSelectRow<T = any>({ label, options, value, onChange }: UISelectOpts<T>): HTMLElement {
        const sel = this.createNode('select', { className: 'ui-select', on: { change: (e: Event) => onChange((e.target as HTMLSelectElement).value) } });
        options.forEach((o: any) => {
            const isObj = o && typeof o === 'object';
            const v = isObj ? o.value : o;
            const t = isObj ? o.text : o; 
            sel.appendChild(this.createNode('option', { value: String(v), textContent: String(t), selected: String(v) === String(value) }));
        });
        return this.createRow(label, sel);
    },

    createPaletteSelectRow({ label, value, onChange }: UIPaletteSelectOpts): HTMLElement {
        const sel = this.createNode('select', {
            className: 'ui-select',
            on: { change: (e: Event) => {
                const val = (e.target as HTMLSelectElement).value as PaletteName;
                plot.drawPalettePreview(canvas, val);
                onChange(val);
            }}
        });
        Object.keys(plot.palettes).forEach(p => {
            sel.appendChild(this.createNode('option', { value: p, textContent: p.charAt(0).toUpperCase() + p.slice(1), selected: p === value }));
        });
        const canvas = this.createNode('canvas', {
            width: 80, height: 18,
            style: 'border: 1px solid #555; border-radius: 2px; margin-left: 8px; flex-shrink: 0;'
        });
        plot.drawPalettePreview(canvas, value);
        return this.createRow(label, this.createNode('div', { style: 'display: flex; align-items: center; width: 100%;' }, sel, canvas));
    },
    
    createRadioGroup<T = any>({ label, options, value, name, layout = 'column', onChange }: UIRadioOpts<T>): HTMLElement {
        const uniqueName = name || ('radio_' + Math.random().toString(36).substr(2, 9));
        const groupContainer = UI.createNode('div', {
            style: layout === 'row' ? 'display:flex; gap:10px; flex-wrap:wrap; flex:1;' : 'display:flex; flex-direction:column; gap:5px; flex:1;'
        });
        options.forEach((opt: any) => {
            const isObj = opt && typeof opt === 'object';
            const val = isObj ? opt.value : opt;
            const text = isObj ? (opt.label || opt.text) : opt;
            const radio = UI.createInput('radio', { name: uniqueName, value: String(val), checked: val === value }, (t) => { if(t.checked) onChange(val); });
            const lbl = UI.createNode('span', {}, String(text));
            const wrapper = UI.createNode('label', { className: 'ui-radio-label' }, radio, lbl);
            groupContainer.appendChild(wrapper);
        });
        const row = UI.createRow(label, groupContainer);
        if (layout === 'column') {
            row.style.alignItems = 'flex-start';
        }
        return row;
    },
    
    createColorRow({ label, value, onChange }: UIColorOpts): HTMLElement {
        const swatch = this.createNode('div', { className:'c-swatch', style:`background:${value}; width:100%; height:25px; border:1px solid #555;` });
        const box = this.createNode('div', { className:'color-box', style:'width:100%; margin:0;' }, 
            swatch,
            this.createInput('color', { value: value }, t => {
                swatch.style.background = t.value;
                onChange(t.value);
            })
        );
        return this.createRow(label, box);
    },
    
    createCanvas(opts: UICanvasOpts = {}): { element: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
        const { width, height, source, maxW=300, maxH=200, bg, on, ...props } = opts;
        let w = width, h = height;
        if (source && (!w || !h)) {
            const scale = Math.min(maxW / source.width, maxH / source.height);
            w = Math.round(source.width * scale);
            h = Math.round(source.height * scale);
        }
        const style: Partial<CSSStyleDeclaration> = {};
        if (typeof props.style === 'string') {
            props.style.split(';').forEach((r: string) => {
                const [k,v] = r.split(':');
                if(k&&v) (style as any)[k.trim()] = v.trim();
            });
        } else if (props.style && typeof props.style === 'object') {
            Object.assign(style, props.style);
        }
        if (bg === 'grid') {
            style.backgroundImage = 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)';
            style.backgroundSize = '10px 10px';
        } else if (bg) {
            style.background = bg;
        }
        const cvs = this.createNode('canvas', { className: 'popup-preview', width: w||300, height: h||150, style, ...props });
        if (on) {
            Object.keys(on).forEach(e => {
                cvs.addEventListener(e, (on as any)[e] as EventListener);
            });
        }
        const ctx = cvs.getContext('2d');
        if (source && ctx) ctx.drawImage(source, 0, 0, cvs.width, cvs.height);
        return { element: cvs, ctx };
    },

    toggle(element: HTMLElement, isVisible: boolean, displayMode: string = 'flex'): void {
        element.style.display = isVisible ? displayMode : 'none';
    },

    createSection(title: string, ...children: any[]): HTMLElement {
        return this.createNode('div', { 
            style: { display: 'flex', flexDirection: 'column', gap: '5px', border: '1px solid #444', padding: '10px', borderRadius: '4px', marginBottom: '10px' }
        },
            this.createNode('div', { 
                style: { fontWeight: 'bold', fontSize: '12px', color: '#aaa', marginBottom: '5px' }
            }, title),
            ...children
        );
    },
    
    createSubheading(text: string, color: string = '#aaa'): HTMLElement {
        return this.createNode('div', {
            style: { fontWeight: 'bold', color: color, fontSize: '11px',  marginTop: '5px', marginBottom: '2px' }
        }, text);
    }
};
