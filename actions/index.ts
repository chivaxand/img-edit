import { App, AppActions } from '../app';
import { coreActions } from './core';
import { layersActions } from './layers';
import { transformActions } from './transform';
import { layerCanvasSizeActions } from './layer-canvas-size';
import { layerResizeActions } from './layer-resize';

// Import side-effects for GIF and JPEG export systems
import './gif-export';
import './jpeg-export';

const allActions: AppActions = {
    ...coreActions,
    ...layersActions,
    ...transformActions,
    ...layerCanvasSizeActions,
    ...layerResizeActions
};

Object.assign(App.actions, allActions);
