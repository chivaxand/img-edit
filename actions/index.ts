import { App, AppActions } from '~/app';
import { coreActions } from './core';
import { layersActions } from './layer-actions';
import { selectionActions } from './selection-actions';
import { transformActions } from '~/filters/transform/flip-rotate-skew';
import { layerCanvasSizeActions } from '~/filters/transform/layer-canvas-size';
import { layerResizeActions } from '~/filters/transform/layer-resize';
import { scriptActions } from './macro-runner';
import { clipboardActions } from './clipboard-actions';

// Import side-effects for GIF and JPEG export systems
import './gif-export';
import './jpeg-export';

const allActions: AppActions = {
    ...coreActions,
    ...layersActions,
    ...selectionActions,
    ...transformActions,
    ...layerCanvasSizeActions,
    ...layerResizeActions,
    ...scriptActions,
    ...clipboardActions
};

Object.assign(App.actions, allActions);
