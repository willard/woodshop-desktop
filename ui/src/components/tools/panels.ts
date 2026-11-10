/** Calculator id → panel component. Lazy, so the tools hub loads one panel at a time. */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export const CALC_PANELS: Readonly<Record<string, LazyExoticComponent<ComponentType>>> = {
    'board-feet': lazy(() => import('./BoardFeetPanel')),
    'stock-estimator': lazy(() => import('./StockPanel')),
    'unit-converter': lazy(() => import('./ConvertPanel')),
    'shelf-sag': lazy(() => import('./ShelfSagPanel')),
    'wood-movement': lazy(() => import('./MovementPanel')),
    'mortise-tenon': lazy(() => import('./MortiseTenonPanel')),
    'dowel-layout': lazy(() => import('./DowelPanel')),
    'pilot-holes': lazy(() => import('./PilotHolePanel')),
    'miter-angles': lazy(() => import('./AnglesPanel')),
    'arc-radius': lazy(() => import('./ArcPanel')),
    'segmented-ring': lazy(() => import('./SegmentedRingPanel')),
    'leg-taper': lazy(() => import('./TaperPanel')),
    'leg-splay': lazy(() => import('./SplayPanel')),
    proportions: lazy(() => import('./ProportionPanel')),
};
