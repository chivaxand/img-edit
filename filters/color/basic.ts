import { Filters } from '~/filters';

Filters.register('grayscale', {
    name: 'Grayscale',
    mode: 'css',
    filter: () => 'grayscale(100%)',
    menu: { path: 'Color', label: 'Grayscale', order: 1 }
});

Filters.register('invert', {
    name: 'Invert',
    mode: 'css',
    filter: () => 'invert(100%)',
    menu: { path: 'Color', label: 'Invert', order: 2 }
});

Filters.register('hue', {
    name: 'Hue Rotate',
    mode: 'css',
    params: [{ id: 'deg', label: 'Degrees', type: 'range', min: 0, max: 360, val: 0 }], 
    filter: (v: any) => `hue-rotate(${v.deg}deg)`,
    menu: { path: 'Color', label: 'Hue Rotate...', order: 103 }
});