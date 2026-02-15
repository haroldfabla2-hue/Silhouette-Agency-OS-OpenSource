// =============================================================================
// Nexus Canvas - Autosave Hook
// Smart autosave with debounce and resource awareness
// =============================================================================

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '../store/useCanvasStore';
import { saveDocument } from '../api/canvasApi';
import { systemBus } from '../../../services/systemBus';
import { SystemProtocol } from '../../../types';

const AUTOSAVE_DEBOUNCE_MS = 10000; // 10 seconds debounce

export const useAutosave = () => {
    const debounceRef = useRef<NodeJS.Timeout | null>(null);
    const lastSaveRef = useRef<number>(0);

    const { document, isDirty, prefs } = useCanvasStore();

    useEffect(() => {
        // Skip if autosave is disabled or document is clean
        if (!prefs.autosaveEnabled || !isDirty || !document) {
            return;
        }

        // Clear existing debounce
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        // Set new debounce
        debounceRef.current = setTimeout(async () => {
            try {
                console.log('[Autosave] 💾 Saving document...');

                // Serialize document
                const docJson = JSON.stringify(document);

                // Save to local storage/API
                await saveDocument(document.name, docJson, undefined, document.id);

                // Mark as clean
                useCanvasStore.setState({ isDirty: false });

                lastSaveRef.current = Date.now();

                // Emit event for Introspection (Level 3)
                systemBus.emit(SystemProtocol.VISUAL_SNAPSHOT as any, {
                    docId: document.id,
                    docName: document.name,
                    layerCount: document.layers.length,
                    timestamp: lastSaveRef.current
                }, 'CANVAS_AUTOSAVE');

                console.log('[Autosave] ✅ Document saved');
            } catch (error) {
                console.error('[Autosave] ❌ Failed to save:', error);
            }
        }, AUTOSAVE_DEBOUNCE_MS);

        // Cleanup
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [document, isDirty, prefs.autosaveEnabled]);

    return {
        lastSave: lastSaveRef.current,
        isAutosaveEnabled: prefs.autosaveEnabled
    };
};
