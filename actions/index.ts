import { App, AppActions } from '~/app';
import { coreActions } from './core';
import { layersActions } from './layers';
import { transformActions } from '~/filters/transform/flip-rotate-skew';
import { layerCanvasSizeActions } from '~/filters/transform/layer-canvas-size';
import { layerResizeActions } from '~/filters/transform/layer-resize';
import { scriptActions } from './script';

// Import side-effects for GIF and JPEG export systems
import './gif-export';
import './jpeg-export';

const allActions: AppActions = {
    ...coreActions,
    ...layersActions,
    ...transformActions,
    ...layerCanvasSizeActions,
    ...layerResizeActions,
    ...scriptActions
};

Object.assign(App.actions, allActions);