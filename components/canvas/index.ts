// =============================================================================
// Nexus Canvas - Module Index
// Export all canvas components and utilities
// =============================================================================

// Main component
export { NexusCanvas, default } from './NexusCanvas';

// Store
export {
    useCanvasStore,
    useLayers,
    useSelectedLayer,
    useActiveTool,
    useViewport,
    useIsGenerating
} from './store/useCanvasStore';

// Engine
export { CanvasEngine, canvasEngine } from './engine/CanvasEngine';

// Panels
export { LayerPanel } from './panels/LayerPanel';
export { ToolbarPanel } from './panels/ToolbarPanel';
export { AssetBrowserPanel } from './panels/AssetBrowserPanel';
export { GenerativeFillPanel } from './panels/GenerativeFillPanel';
export { TextPropertiesPanel } from './panels/TextPropertiesPanel';

// Tools
export { BrushTool, brushTool } from './tools/BrushTool';
export { SelectionTool, selectionTool } from './tools/SelectionTool';
export { textTool, AVAILABLE_FONTS } from './tools/TextTool';

// Hooks
export { useAutosave } from './hooks/useAutosave';
export { useDriveSync } from './hooks/useDriveSync';
export { useResourceAwareCanvas } from './hooks/useResourceAwareCanvas';

// API
export * from './api';

// Types (re-export for convenience)
export type {
    NexusDocument,
    CanvasLayer,
    CanvasTool,
    BlendMode,
    BrushSettings,
    CanvasColor,
    SelectionState,
    ViewportState,
    CanvasState,
    CanvasActions
} from '../../types/canvas';
