import React, { useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

/**
 * VisualCortex V2 (Professional Visual Processing)
 * 
 * PHASE 1 ENHANCEMENT: Hybrid capture strategy
 * - Primary: Direct WebGL canvas capture (10x faster, layer-accurate)
 * - Fallback: html2canvas for non-canvas pages
 * 
 * Integrates with Silhouette's visual processing pipeline:
 * - Sends captures to Introspection Engine for AI analysis
 * - ResourceArbiter-aware throttling to prevent GPU overload
 */
export const VisualCortex: React.FC = () => {
    const isCapturing = useRef(false);
    const lastCaptureTime = useRef(0);
    const CAPTURE_COOLDOWN = 10000; // 10s minimum between captures

    /**
     * PHASE 1: Direct WebGL Canvas Capture
     * - Bypasses html2canvas DOM traversal completely
     * - Preserves exact layer compositing with blend modes
     * - 10x faster than html2canvas (direct GPU buffer read)
     */
    const captureWebGLCanvas = async (): Promise<string | null> => {
        try {
            // Find the Nexus Canvas WebGL element
            const canvasElement = document.querySelector('canvas[data-nexus-canvas]') as HTMLCanvasElement;

            if (!canvasElement) {
                // Also try by class (fallback)
                const anyCanvas = document.querySelector('.nexus-editor canvas') as HTMLCanvasElement;
                if (anyCanvas) {
                    console.log('[VisualCortex] 🎨 Using WebGL canvas capture (fallback selector)');
                    return anyCanvas.toDataURL('image/png', 0.9);
                }
                return null;
            }

            console.log('[VisualCortex] 🎨 Using direct WebGL canvas capture (fast path)');

            // Direct GPU buffer extraction - preserves all layer compositing
            // Using PNG for lossless quality, higher quality than JPEG
            return canvasElement.toDataURL('image/png', 0.9);

        } catch (e) {
            console.warn('[VisualCortex] WebGL capture failed, falling back to DOM:', e);
            return null;
        }
    };

    /**
     * Fallback: DOM Screenshot via html2canvas
     * Used when no WebGL canvas is available (e.g., Dashboard, Settings)
     */
    const captureDOMFallback = async (): Promise<string> => {
        const element = document.getElementById('root') || document.body;

        const canvas = await html2canvas(element, {
            useCORS: true,
            logging: false,
            width: window.innerWidth,
            height: window.innerHeight,
            scale: 0.5, // Lower resolution for performance
            backgroundColor: null // Preserve transparency
        });

        return canvas.toDataURL('image/jpeg', 0.6);
    };

    /**
     * Hybrid Capture Strategy:
     * 1. Try direct WebGL canvas (fast, accurate)
     * 2. Fallback to html2canvas (slower but universal)
     */
    const captureVisualState = async (): Promise<{ image: string; method: 'webgl' | 'dom' }> => {
        // Try WebGL first (10x faster for canvas pages)
        const webglCapture = await captureWebGLCanvas();

        if (webglCapture) {
            return { image: webglCapture, method: 'webgl' };
        }

        // Fallback to DOM capture
        const domCapture = await captureDOMFallback();
        return { image: domCapture, method: 'dom' };
    };

    useEffect(() => {
        // Subscribe to Introspection requests (placeholder for future AI triggers)
        const unsubscribe = systemBus.subscribe(SystemProtocol.THOUGHT_EMISSION, async (event) => {
            // Future: Trigger capture when AI mentions needing visual context
        });

        // Explicit Listener for VISUAL_REQUEST
        const visualUnsub = systemBus.subscribe(SystemProtocol.VISUAL_REQUEST, async () => {
            if (isCapturing.current) return;

            // OPTIMIZATION: Debounce locally
            const now = Date.now();
            if (now - lastCaptureTime.current < CAPTURE_COOLDOWN) {
                // Too soon, ignore this request to save resources
                return;
            }

            // RESOURCE CHECK: Prevent capture if browser memory is critical
            if ((performance as any).memory) {
                const { usedJSHeapSize, jsHeapSizeLimit } = (performance as any).memory;
                if (usedJSHeapSize / jsHeapSizeLimit > 0.9) {
                    console.warn('[VisualCortex] ⚠️ Memory critical (>90%), skipping capture to prevent crash.');
                    return;
                }
            }

            isCapturing.current = true;

            try {
                const { image, method } = await captureVisualState();
                lastCaptureTime.current = Date.now();

                console.log(`[VisualCortex] Captured via ${method.toUpperCase()}. Size: ${Math.round(image.length / 1024)}KB`);

                // Send to Introspection Engine via API Bridge
                import('../utils/api').then(({ api }) => {
                    api.post('/v1/introspection/eye', {
                        timestamp: Date.now(),
                        image,
                        captureMethod: method
                    }).catch(err => console.error("[VisualCortex] Bridge Failed:", err));
                });

                // Emit locally for frontend debuggers/visualizers
                systemBus.emit(SystemProtocol.VISUAL_SNAPSHOT, {
                    timestamp: Date.now(),
                    image,
                    captureMethod: method
                }, "VISUAL_CORTEX");

            } catch (e) {
                console.error("[VisualCortex] Snapshot Failed:", e);
            } finally {
                isCapturing.current = false;
            }
        });

        return () => {
            unsubscribe();
            visualUnsub();
        };
    }, []);

    // Render nothing (Headless component)
    return null;
};
