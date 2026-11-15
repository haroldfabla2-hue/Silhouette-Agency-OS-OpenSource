// =============================================================================
// Nexus Canvas - Zustand Store
// State management for the canvas editor
// =============================================================================

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { immer } from 'zustand/middleware/immer';
import { devtools, persist } from 'zustand/middleware';
import {
    CanvasState,
    CanvasActions,
    NexusDocument,
    CanvasLayer,
    CanvasTool,
    BrushSettings,
    CanvasColor,
    SelectionState,
    LayerType,
    CanvasPreferences
} from '../../../types/canvas';

// Default colors
const DEFAULT_FOREGROUND: CanvasColor = { r: 0, g: 0, b: 0, a: 1 };
const DEFAULT_BACKGROUND: CanvasColor = { r: 255, g: 255, b: 255, a: 1 };

// Default prefs
const DEFAULT_PREFS: CanvasPreferences = {
    autosaveEnabled: false, // Default to OFF as requested to be manual first
    autosaveInterval: 5000,
    autoSyncDrive: false,
    lowVRAMMode: false
};

// Default brush
const DEFAULT_BRUSH: BrushSettings = {
    size: 20,
    hardness: 75,
    opacity: 100,
    flow: 100,
    color: DEFAULT_FOREGROUND
};

// Generate unique IDs
const generateId = () => crypto.randomUUID();

const createLayer = (name: string, type: LayerType = 'raster'): CanvasLayer => ({
    id: generateId(),
    name,
    type,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'NORMAL',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    layers: type === 'group' ? [] : undefined,
    expanded: type === 'group' ? true : undefined
});

const createDocument = (name: string, width: number, height: number): NexusDocument => {
    const bgLayer = createLayer('Background', 'raster');
    bgLayer.locked = true;

    return {
        id: generateId(),
        name,
        dimensions: { width, height, dpi: 300 },
        layers: [bgLayer],
        history: [],
        historyIndex: -1,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
};

// Helper to find parent array or layer
const findParentRecursive = (layers: CanvasLayer[], childId: string): { parent: CanvasLayer | null, array: CanvasLayer[] } | null => {
    // Check root level first
    if (layers.some(l => l.id === childId)) return { parent: null, array: layers };

    for (const layer of layers) {
        if (layer.layers) {
            // Is it a direct child?
            if (layer.layers.some(l => l.id === childId)) return { parent: layer, array: layer.layers };
            // Recurse
            const found = findParentRecursive(layer.layers, childId);
            if (found) return found;
        }
    }
    return null;
};

// RECURSIVE HELPERS
const findLayerRecursive = (layers: CanvasLayer[], id: string): CanvasLayer | undefined => {
    for (const layer of layers) {
        if (layer.id === id) return layer;
        if (layer.layers && layer.layers.length > 0) {
            const found = findLayerRecursive(layer.layers, id);
            if (found) return found;
        }
    }
    return undefined;
};

const deleteLayerRecursive = (layers: CanvasLayer[], id: string): boolean => {
    const idx = layers.findIndex(l => l.id === id);
    if (idx !== -1) {
        layers.splice(idx, 1);
        return true;
    }
    for (const layer of layers) {
        if (layer.layers && deleteLayerRecursive(layer.layers, id)) return true;
    }
    return false;
};

// Combined state + actions type
type CanvasStore = CanvasState & CanvasActions;

export const useCanvasStore = create<CanvasStore>()(
    persist(
        devtools(
            immer((set, get) => ({
                // ===================== INITIAL STATE =====================
                document: null,
                isLoading: false,
                isDirty: false,
                prefs: DEFAULT_PREFS,

                activeTool: 'move' as CanvasTool,
                brushSettings: DEFAULT_BRUSH,
                foregroundColor: DEFAULT_FOREGROUND,
                backgroundColor: DEFAULT_BACKGROUND,

                selection: { active: false, path: [] },
                selectedLayerId: null,

                viewport: { zoom: 1, panX: 0, panY: 0 },

                isGenerating: false,
                generationProgress: 0,

                // ===================== PREFERENCES ACTIONS =====================
                setPreferences: (newPrefs) => {
                    set((state) => {
                        Object.assign(state.prefs, newPrefs);
                    });
                },

                // ===================== DOCUMENT ACTIONS =====================
                createDocument: (name, width, height) => {
                    set((state) => {
                        state.document = createDocument(name, width, height);
                        state.selectedLayerId = state.document.layers[0]?.id || null;
                        state.isDirty = false;
                        state.viewport = { zoom: 1, panX: 0, panY: 0 };
                    });
                },

                loadDocument: (doc) => {
                    set((state) => {
                        state.document = doc;
                        state.selectedLayerId = doc.layers[0]?.id || null;
                        state.isDirty = false;
                    });
                },

                // ===================== LAYER ACTIONS =====================
                addLayer: (name, type = 'raster') => {
                    const doc = get().document;
                    const newLayer = createLayer(name || `Layer ${doc ? (doc.layers.length + 1) : 0}`, type);

                    // Group Init
                    if (type === 'group') {
                        newLayer.layers = [];
                        newLayer.expanded = true;
                    }

                    set((state) => {
                        if (!state.document) return;

                        const selectedId = state.selectedLayerId;
                        if (selectedId) {
                            // Strategy:
                            // 1. If active layer is GROUP -> Add inside (at top)
                            // 2. If active layer is ITEM -> Add above it (same parent)

                            const selectedLayer = findLayerRecursive(state.document.layers, selectedId);

                            if (selectedLayer && selectedLayer.type === 'group') {
                                if (!selectedLayer.layers) selectedLayer.layers = [];
                                selectedLayer.layers.push(newLayer);
                                selectedLayer.expanded = true;
                            } else {
                                // Find parent array
                                const result = findParentRecursive(state.document.layers, selectedId);
                                if (result) {
                                    const idx = result.array.findIndex(l => l.id === selectedId);
                                    // Insert after (on top of) selected
                                    result.array.splice(idx + 1, 0, newLayer);
                                } else {
                                    // Fallback to root
                                    state.document.layers.push(newLayer);
                                }
                            }
                        } else {
                            // No selection -> Root Top
                            state.document.layers.push(newLayer);
                        }

                        state.selectedLayerId = newLayer.id;
                        state.isDirty = true;
                    });

                    get().pushHistory('Add Layer');
                    return newLayer.id;
                },

                deleteLayer: (id) => {
                    set((state) => {
                        if (!state.document) return;

                        const deleted = deleteLayerRecursive(state.document.layers, id);
                        if (!deleted) return;

                        // Update selection if we deleted the selected layer
                        if (state.selectedLayerId === id) {
                            state.selectedLayerId = state.document.layers[0]?.id || null;
                        }
                        state.isDirty = true;
                    });

                    get().pushHistory('Delete Layer');
                },

                selectLayer: (id) => {
                    set((state) => {
                        state.selectedLayerId = id;
                    });
                },

                updateLayer: (id, updates) => {
                    set((state) => {
                        if (!state.document) return;
                        const layer = findLayerRecursive(state.document.layers, id);
                        if (layer) {
                            Object.assign(layer, updates);
                            state.isDirty = true;
                        }
                    });
                },

                reorderLayers: (fromIndex, toIndex) => {
                    // Reorder only works at ROOT level for now. 
                    // Enhanced Drag-Drop TBD.
                    set((state) => {
                        if (!state.document) return;
                        const [removed] = state.document.layers.splice(fromIndex, 1);
                        state.document.layers.splice(toIndex, 0, removed);
                        state.isDirty = true;
                    });

                    get().pushHistory('Reorder Layers');
                },

                addAdjustmentLayer: (adjType) => {
                    // Reuse addLayer for consistent placement (inside groups etc.)
                    const id = get().addLayer(adjType.charAt(0).toUpperCase() + adjType.slice(1), 'adjustment');

                    // Initialize/Tag
                    get().updateLayer(id, { adjustmentType: adjType });

                    // Optional: Initialize default values if needed different from 0
                    // e.g. Levels might need different struct but LayerAdjustments is simple for now.
                },

                addMaskFromSelection: () => {
                    set((state) => {
                        if (!state.document || !state.selectedLayerId) return;
                        if (!state.selection.active || state.selection.path.length < 3) return;

                        const layer = findLayerRecursive(state.document.layers, state.selectedLayerId);
                        if (layer) {
                            layer.vectorMask = {
                                path: [...state.selection.path],
                                enabled: true
                            };
                            // Clear selection to avoid confusion (mask is created)
                            state.selection = { active: false, path: [] };
                            state.isDirty = true;
                        }
                    });
                    get().pushHistory('Add Vector Mask');
                },

                // ===================== HISTORY ACTIONS =====================
                undo: () => {
                    set((state) => {
                        if (!state.document || state.document.historyIndex <= 0) return;
                        state.document.historyIndex--;
                        const snapshot = state.document.history[state.document.historyIndex];
                        if (snapshot) {
                            state.document.layers = JSON.parse(JSON.stringify(snapshot.layersSnapshot));
                        }
                    });
                },

                redo: () => {
                    set((state) => {
                        if (!state.document) return;
                        if (state.document.historyIndex >= state.document.history.length - 1) return;
                        state.document.historyIndex++;
                        const snapshot = state.document.history[state.document.historyIndex];
                        if (snapshot) {
                            state.document.layers = JSON.parse(JSON.stringify(snapshot.layersSnapshot));
                        }
                    });
                },

                pushHistory: (action) => {
                    set((state) => {
                        if (!state.document) return;

                        // Truncate forward history if we're not at the end
                        if (state.document.historyIndex < state.document.history.length - 1) {
                            state.document.history = state.document.history.slice(0, state.document.historyIndex + 1);
                        }

                        // Push new state
                        state.document.history.push({
                            id: generateId(),
                            timestamp: Date.now(),
                            action,
                            layersSnapshot: JSON.parse(JSON.stringify(state.document.layers))
                        });

                        state.document.historyIndex = state.document.history.length - 1;

                        // Limit history size (100 states max)
                        if (state.document.history.length > 100) {
                            state.document.history.shift();
                            state.document.historyIndex--;
                        }
                    });
                },

                // ===================== TOOL ACTIONS =====================
                setTool: (tool) => {
                    set((state) => {
                        state.activeTool = tool;
                    });
                },

                setBrushSettings: (settings) => {
                    set((state) => {
                        Object.assign(state.brushSettings, settings);
                    });
                },

                setForegroundColor: (color) => {
                    set((state) => {
                        state.foregroundColor = color;
                        state.brushSettings.color = color;
                    });
                },

                // ===================== VIEWPORT ACTIONS =====================
                setZoom: (zoom) => {
                    set((state) => {
                        state.viewport.zoom = Math.max(0.1, Math.min(10, zoom));
                    });
                },

                pan: (dx, dy) => {
                    set((state) => {
                        state.viewport.panX += dx;
                        state.viewport.panY += dy;
                    });
                },

                resetViewport: () => {
                    set((state) => {
                        state.viewport = { zoom: 1, panX: 0, panY: 0 };
                    });
                },

                // ===================== SELECTION ACTIONS =====================
                setSelection: (selection) => {
                    set((state) => {
                        state.selection = selection;
                    });
                },

                clearSelection: () => {
                    set((state) => {
                        state.selection = { active: false, path: [] };
                    });
                },

                // ===================== AI INTEGRATION =====================
                startGeneration: () => {
                    set((state) => {
                        state.isGenerating = true;
                        state.generationProgress = 0;
                    });
                },

                updateGenerationProgress: (progress) => {
                    set((state) => {
                        state.generationProgress = progress;
                    });
                },

                cancelGeneration: () => {
                    set((state) => {
                        state.isGenerating = false;
                        state.generationProgress = 0;
                    });
                },

                completeGeneration: (resultImageData) => {
                    const newLayerId = get().addLayer('AI Generated', 'raster');

                    set((state) => {
                        if (!state.document) return;
                        const layer = findLayerRecursive(state.document.layers, newLayerId);
                        if (layer) {
                            layer.imageData = resultImageData;
                            layer.aiGenerated = true;
                        }
                        state.isGenerating = false;
                        state.generationProgress = 0;
                    });
                }
            })),
            { name: 'nexus-canvas' }
        ),
        {
            name: 'nexus-canvas-storage',
            partialize: (state) => ({
                prefs: state.prefs,
                brushSettings: state.brushSettings,
                activeTool: state.activeTool,
                foregroundColor: state.foregroundColor,
                backgroundColor: state.backgroundColor,
            }),
        }
    )
);

// Selector hooks for performance
// CRITICAL: Use stable empty references to prevent infinite re-renders

// Stable empty references (never recreated)
const EMPTY_LAYERS: CanvasLayer[] = [];
const EMPTY_SELECTION: SelectionState = { active: false, path: [] };

export const useSelectedLayer = () => useCanvasStore((s) => {
    if (!s.document || !s.selectedLayerId) return null;
    return findLayerRecursive(s.document.layers, s.selectedLayerId) || null;
});

// Use stable empty array reference to prevent "getSnapshot should be cached" error
// useShallow wraps the selector to use shallow comparison
export const useLayers = () => useCanvasStore(
    useShallow((s) => s.document?.layers ?? EMPTY_LAYERS)
);

export const useActiveTool = () => useCanvasStore((s) => s.activeTool);

export const useViewport = () => useCanvasStore(
    useShallow((s) => s.viewport)
);

export const useIsGenerating = () => useCanvasStore((s) => s.isGenerating);

// Use stable empty selection reference
export const useSelection = () => useCanvasStore(
    useShallow((s) => s.selection ?? EMPTY_SELECTION)
);
