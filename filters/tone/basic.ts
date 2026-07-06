import { Filters, FilterContext } from '~/filters';

Filters.register('brightness', {
    name: 'Brightness',
    mode: 'css',
    params: [{ id: 'level', label: 'Level (%)', type: 'range', min: 0, max: 200, val: 100 }], 
    filter: (v: any) => `brightness(${v.level}%)`,
    menu: { path: 'Tone', label: 'Brightness...', order: 1 }
});

Filters.register('contrast', {
    name: 'Contrast',
    mode: 'css',
    params: [{ id: 'level', label: 'Level (%)', type: 'range', min: 0, max: 200, val: 100 }], 
    filter: (v: any) => `contrast(${v.level}%)`,
    menu: { path: 'Tone', label: 'Contrast...', order: 2 }
});