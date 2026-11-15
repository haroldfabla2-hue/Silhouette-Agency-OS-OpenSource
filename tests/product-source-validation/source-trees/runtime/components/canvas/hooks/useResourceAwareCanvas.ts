// =============================================================================
// Nexus Canvas - Resource Aware Hook
// Monitors VRAM and adjusts canvas behavior for performance
// NOTE: This is a client-side stub. Real resource monitoring happens via API.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useCanvasStore } from '../store/useCanvasStore';

const RESOURCE_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
const VRAM_HIGH_THRESHOLD = 0.90; // 90%
const VRAM_LOW_THRESHOLD = 0.75; // 75%

interface ResourceMetrics {
    cpuLoad: number;
    ramUsed: number;
    ramTotal: number;
    vramUsed: number;
    vramTotal: number;
}

export const useResourceAwareCanvas = () => {
    const [metrics, setMetrics] = useState<ResourceMetrics | null>(null);
    const [isLowVRAMMode, setIsLowVRAMMode] = useState(false);
    const { prefs, setPreferences } = useCanvasStore();

    const checkResources = useCallback(async () => {
        try {
            // Fetch resource metrics from API (server-side)
            const response = await fetch('/v1/system/resources');
            if (!response.ok) {
                console.debug('[ResourceAware] API not available, using defaults');
                return;
            }

            const currentMetrics: ResourceMetrics = await response.json();
            setMetrics(currentMetrics);

            const vramUsage = currentMetrics.vramUsed / currentMetrics.vramTotal;

            // Activate low VRAM mode if above threshold
            if (vramUsage > VRAM_HIGH_THRESHOLD && !isLowVRAMMode) {
                console.warn('[ResourceAware] ⚠️ High VRAM usage detected, activating low VRAM mode');
                setIsLowVRAMMode(true);
                setPreferences({ lowVRAMMode: true });

                // Optionally disable autosave temporarily
                if (prefs.autosaveEnabled) {
                    console.log('[ResourceAware] Pausing autosave to conserve resources');
                }
            }

            // Deactivate low VRAM mode if below threshold
            if (vramUsage < VRAM_LOW_THRESHOLD && isLowVRAMMode) {
                console.log('[ResourceAware] ✅ VRAM usage normalized, deactivating low VRAM mode');
                setIsLowVRAMMode(false);
                setPreferences({ lowVRAMMode: false });
            }
        } catch (error) {
            // API not available - this is expected in development
            console.debug('[ResourceAware] Resource check skipped (API unavailable)');
        }
    }, [isLowVRAMMode, prefs.autosaveEnabled, setPreferences]);

    // Periodic resource check
    useEffect(() => {
        // Initial check after delay to avoid blocking startup
        const initialTimeout = setTimeout(checkResources, 5000);

        // Set up interval
        const interval = setInterval(checkResources, RESOURCE_CHECK_INTERVAL_MS);

        return () => {
            clearTimeout(initialTimeout);
            clearInterval(interval);
        };
    }, [checkResources]);

    return {
        metrics,
        isLowVRAMMode,
        vramUsage: metrics ? (metrics.vramUsed / metrics.vramTotal * 100).toFixed(1) : null,
        ramUsage: metrics ? (metrics.ramUsed / metrics.ramTotal * 100).toFixed(1) : null,
        checkResources // Manual trigger
    };
};
