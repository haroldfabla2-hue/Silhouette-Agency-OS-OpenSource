// =============================================================================
// Nexus Canvas - Type Definitions
// Adapted for Silhouette Architecture
// =============================================================================

// Basic types
export type LayerType = 'raster' | 'text' | 'vector' | 'group' | 'adjustment';
export type BlendMode =
    | 'NORMAL'
    | 'MULTIPLY'
    | 'SCREEN'
    | 'OVERLAY'
    | 'DARKEN'
    | 'LIGHTEN'
    | 'COLOR_DODGE'
    | 'COLOR_BURN'
    | 'HARD_LIGHT'
    | 'SOFT_LIGHT'
    | 'DIFFERENCE'
    | 'EXCLUSION'
    | 'HUE'
    | 'SATURATION'
    | 'COLOR'
    | 'LUMINOSITY';

/** Tool types available in the canvas */
export type CanvasTool =
    | 'move'
    | 'brush'
    | 'eraser'
    | 'selection-rect'
    | 'selection-lasso'
    | 'text'
    | 'shape'
    | 'eyedropper'
    | 'zoom'
    | 'pan';



/** Color representation */
export interface CanvasColor {
    r: number; // 0-255
    g: number;
    b: number;
    a: number; // 0-1
}

/** Transform properties for layers */
export interface LayerTransform {
    x: number;
    y: number;
    rotation: number; // degrees
    scaleX: number;
    scaleY: number;
}

/** Layer mask */
export interface LayerMask {
    id: string;
    imageData: string; // Base64 PNG
    inverted: boolean;
}

/** Text layer properties */
export interface TextLayerData {
    content: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: 400 | 700;
    color: CanvasColor;
    alignment: 'left' | 'center' | 'right';
}

/** A single layer in the document */
export interface CanvasLayer {
    id: string;
    name: string;
    type: LayerType;
    visible: boolean;
    locked: boolean;
    opacity: number; // 0-100
    blendMode: BlendMode;
    transform: LayerTransform;

    // Raster data (base64 PNG when dirty)
    imageData?: string;

    // Text data (if type === 'text')
    textData?: TextLayerData;

    // Mask (optional)
    mask?: LayerMask;

    // Metadata
    aiGenerated?: boolean;
    generationPrompt?: string;

    // Non-destructive Adjustments
    adjustments?: LayerAdjustments;

    // Layer Styles / Effects
    effects?: LayerEffects;

    // Clipping Mask (ID of the layer this layer is clipped to)
    clippingMaskId?: string;

    // Grouping
    parentId?: string; // ID of the group this layer belongs to
    expanded?: boolean; // UI state for groups
    layers?: CanvasLayer[]; // Children layers (if type === 'group')

    // Masks
    vectorMask?: {
        path: { x: number; y: number }[]; // Points definition
        enabled: boolean;
    };

    // Adjustment Layer
    adjustmentType?: 'brightness' | 'hue' | 'levels' | 'curves';
}

/** Non-destructive color adjustments */
export interface LayerAdjustments {
    brightness: number; // -1 to 1 (0 = normal)
    contrast: number;   // -1 to 1 (0 = normal)
    saturation: number; // -1 to 1 (0 = normal)
    hue: number;        // -180 to 180 (0 = normal)
}

/** Layer Effects (Photoshop Styles) */
export interface LayerEffects {
    dropShadow?: {
        enabled: boolean;
        blur: number;
        x: number;
        y: number;
        opacity: number;
        color: string;
    };
}

/** Document dimensions */
export interface CanvasDimensions {
    width: number;
    height: number;
    dpi: number;
}

/** History state for undo/redo */
export interface HistoryState {
    id: string;
    timestamp: number;
    action: string;
    layersSnapshot: CanvasLayer[];
}

/** The complete document model */
export interface NexusDocument {
    id: string;
    name: string;
    dimensions: CanvasDimensions;
    layers: CanvasLayer[];
    history: HistoryState[];
    historyIndex: number;
    createdAt: number;
    updatedAt: number;
}

/** Brush settings */
export interface BrushSettings {
    size: number;      // 1-500 px
    hardness: number;  // 0-100%
    opacity: number;   // 0-100%
    flow: number;      // 0-100%
    color: CanvasColor;
}

/** Selection state */
export interface SelectionState {
    active: boolean;
    path: { x: number; y: number }[];
    bounds?: { x: number; y: number; width: number; height: number };
}

/** Viewport state (pan/zoom) */
export interface ViewportState {
    zoom: number;      // 0.1 - 10 (1 = 100%)
    panX: number;
    panY: number;
}

/** User preferences for the canvas */
export interface CanvasPreferences {
    autosaveEnabled: boolean;
    autosaveInterval: number; // in ms
    autoSyncDrive: boolean; // Sync to Google Drive
    lowVRAMMode: boolean; // Hibernate on idle
}

/** Complete canvas store state */
export interface CanvasState {
    // Document
    document: NexusDocument | null;
    isLoading: boolean;
    isDirty: boolean;

    // Preferences
    prefs: CanvasPreferences;

    // Tools
    activeTool: CanvasTool;
    brushSettings: BrushSettings;
    foregroundColor: CanvasColor;
    backgroundColor: CanvasColor;

    // Selection
    selection: SelectionState;
    selectedLayerId: string | null;

    // Viewport
    viewport: ViewportState;

    // AI
    isGenerating: boolean;
    generationProgress: number;
}

/** Actions for the canvas store */
export interface CanvasActions {
    // Document
    createDocument: (name: string, width: number, height: number) => void;
    loadDocument: (doc: NexusDocument) => void;

    // Layers
    addLayer: (name?: string, type?: LayerType) => string;
    deleteLayer: (id: string) => void;
    selectLayer: (id: string | null) => void;
    updateLayer: (id: string, updates: Partial<CanvasLayer>) => void;
    reorderLayers: (fromIndex: number, toIndex: number) => void;
    addAdjustmentLayer: (adjType: 'brightness' | 'hue' | 'levels' | 'curves') => void;
    addMaskFromSelection: () => void;

    // History
    undo: () => void;
    redo: () => void;
    pushHistory: (action: string) => void;

    // Tools
    setTool: (tool: CanvasTool) => void;
    setBrushSettings: (settings: Partial<BrushSettings>) => void;
    setForegroundColor: (color: CanvasColor) => void;

    // Viewport
    setZoom: (zoom: number) => void;
    pan: (dx: number, dy: number) => void;
    resetViewport: () => void;

    // Selection
    setSelection: (selection: SelectionState) => void;
    clearSelection: () => void;

    // AI Integration
    startGeneration: () => void;
    updateGenerationProgress: (progress: number) => void;
    cancelGeneration: () => void;
    completeGeneration: (resultImageData: string) => void;

    // Preferences Actions
    setPreferences: (prefs: Partial<CanvasPreferences>) => void;
}
