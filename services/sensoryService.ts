
import { LogEntry, SemanticNode, SensoryData } from "../types";
import html2canvas from 'html2canvas';

// --- SENSORY HUB V1.0 ---
// The "Eyes and Ears" of the OS.
// Handles Multimodal input (Visual Screenshots, Network Logs, DOM Tree).

class SensoryService {
    private logBuffer: LogEntry[] = [];
    private MAX_LOGS = 50;

    constructor() {
        this.initLogInterceptor();
        this.initNetworkInterceptor();
    }

    // --- 1. VISUAL CORTEX (Sight) ---
    public async captureVisualContext(elementId: string = 'root'): Promise<string | undefined> {
        try {
            if (typeof document === 'undefined') return undefined;
            const element = document.getElementById(elementId);
            if (!element) return undefined;

            const canvas = await html2canvas(element, {
                useCORS: true,
                logging: false,
                scale: 0.8 // Lower scale for performance/token usage
            });

            // Return base64 png
            return canvas.toDataURL('image/png').split(',')[1];
        } catch (e) {
            console.error("[SENSORY] Visual capture failed", e);
            return undefined;
        }
    }

    // --- 2. DIGITAL EAR (Log & Network Interceptor) ---
    private initLogInterceptor() {
        try {
            const originalError = console.error;
            const originalWarn = console.warn;

            console.error = (...args) => {
                this.pushLog('ERROR', args.join(' '));
                originalError.apply(console, args);
            };

            console.warn = (...args) => {
                this.pushLog('WARN', args.join(' '));
                originalWarn.apply(console, args);
            };
        } catch (e) {
            console.warn("[SENSORY] Log interceptor init failed (environment protected).");
        }
    }

    private initNetworkInterceptor() {
        try {
            if (typeof window === 'undefined') return;
            const originalFetch = window.fetch;
            if (!originalFetch) return;

            // Safe wrapper that attempts to log but falls back gracefully
            const wrappedFetch = async (...args: [RequestInfo | URL, RequestInit?]) => {
                try {
                    const response = await originalFetch(...args);
                    if (!response.ok) {
                        const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : 'URL');
                        this.pushLog('NETWORK', `Failed ${url}: ${response.status} ${response.statusText}`);
                    }
                    return response;
                } catch (e: any) {
                    const url = typeof args[0] === 'string' ? args[0] : 'URL';
                    this.pushLog('NETWORK', `Network Error ${url}: ${e.message}`);
                    throw e;
                }
            };

            // TRY to overwrite fetch. If read-only, catch error and continue without telemetry.
            try {
                window.fetch = wrappedFetch;
            } catch (readonlyError) {
                console.warn("[SENSORY] window.fetch is read-only. Network telemetry disabled for stability.");
            }
        } catch (e) {
            console.warn("[SENSORY] Failed to initialize network interceptor:", e);
        }
    }

    private pushLog(type: LogEntry['type'], message: string) {
        // Ignore internal polling noise
        if (message.includes('chat/history') || message.includes('ui/state')) return;

        this.logBuffer.push({
            timestamp: Date.now(),
            type,
            message: message.substring(0, 300) // Truncate long logs
        });
        if (this.logBuffer.length > this.MAX_LOGS) this.logBuffer.shift();
    }

    public getTelemetry(): LogEntry[] {
        return [...this.logBuffer];
    }

    // --- 3. SEMANTIC NERVOUS SYSTEM (Accessibility Tree) ---
    public getSemanticTree(element: HTMLElement = document.body): SemanticNode[] {
        // Simplified AOM Mapper
        const ignoreTags = ['SCRIPT', 'STYLE', 'svg', 'path', 'NOSCRIPT'];

        const walk = (el: HTMLElement): SemanticNode | null => {
            if (ignoreTags.includes(el.tagName) || el.style.display === 'none') return null;

            const role = el.getAttribute('role') || el.tagName.toLowerCase();
            const label = el.getAttribute('aria-label') || el.innerText?.substring(0, 50) || '';
            const isInteractive = ['BUTTON', 'INPUT', 'A', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.onclick;

            // Only capture interesting nodes (interactive or having content)
            if (!isInteractive && !label && el.children.length === 0) return null;

            const children: SemanticNode[] = [];
            Array.from(el.children).forEach(child => {
                const node = walk(child as HTMLElement);
                if (node) children.push(node);
            });

            // Flatten div soup
            if (role === 'div' && children.length > 0) {
                // Return children directly if parent is just a wrapper
                // Note: logic simplified for demo
            }

            return {
                role,
                name: label.replace(/\n/g, ' ').trim(),
                children: children.length > 0 ? children : undefined
            };
        };

        const rootNode = walk(element);
        return rootNode ? [rootNode] : [];
    }
}

export const sensory = new SensoryService();
