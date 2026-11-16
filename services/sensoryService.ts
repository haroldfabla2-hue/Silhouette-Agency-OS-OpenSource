import { BrowserWorkScope } from './runtime/browserWorkScope';

import { LogEntry, SemanticNode, SensoryData } from "../types";
import html2canvas from 'html2canvas';

// --- SENSORY HUB V1.0 ---
// The "Eyes and Ears" of the OS.
// Handles Multimodal input (Visual Screenshots, Network Logs, DOM Tree).

class SensoryService {
    private logBuffer: LogEntry[] = [];
    private MAX_LOGS = 50;

    private readonly lifecycle = new BrowserWorkScope();
    private started = false;
    private readonly restorers: Array<() => void> = [];
    constructor() {}
    public start(): void {
        this.lifecycle.assertOpen();
        if (this.started) return;
        this.started = true;
        this.initLogInterceptor();
        this.initNetworkInterceptor();
    }
    public shutdown() { return this.lifecycle.close(() => { for (const restore of this.restorers.reverse()) { try { restore(); } catch { this.lifecycle.record('sensory-wrapper-restoration', true); } } }); }
    public getLifecycleDiagnostics() { return this.lifecycle.getDiagnostics(); }

    // --- 1. VISUAL CORTEX (Sight) ---
    public async captureVisualContext(elementId: string = 'root'): Promise<string | undefined> {
        return this.lifecycle.run('captureVisualContext', async () => {

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
    
        });
    }

    // --- 2. DIGITAL EAR (Log & Network Interceptor) ---
    private initLogInterceptor() {
        try {
            const originalError = console.error;
            const originalWarn = console.warn;

            const wrappedError = (...args: unknown[]) => {
                this.pushLog('ERROR', args.join(' '));
                originalError.apply(console, args);
            };

            const wrappedWarn = (...args: unknown[]) => {
                this.pushLog('WARN', args.join(' '));
                originalWarn.apply(console, args);
            };
            // Register before mutation, including partial-assignment failure.
            this.restorers.push(() => {
                if (console.error === wrappedError) console.error = originalError;
                else if (console.error !== originalError) this.lifecycle.record('console-error-restoration-unverified');
                if (console.warn === wrappedWarn) console.warn = originalWarn;
                else if (console.warn !== originalWarn) this.lifecycle.record('console-warn-restoration-unverified');
            });
            console.error = wrappedError;
            console.warn = wrappedWarn;
        } catch (e) {
            this.lifecycle.record('sensory-log-interceptor');
            console.warn("[SENSORY] Log interceptor init failed (environment protected).");
        }
    }

    private initNetworkInterceptor() {
        try {
            if (typeof window === 'undefined') return;
            const originalFetch = window.fetch;
            if (!originalFetch) return;

            // Safe wrapper that attempts to log but falls back gracefully
            const wrappedFetch = (...args: [RequestInfo | URL, RequestInit?]) => {
                if (!this.lifecycle.isOpen) return originalFetch.apply(window, args);
                return this.lifecycle.run('sensory-observed-fetch', async () => {
                try {
                    const response = await originalFetch.apply(window, args);
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
                });
            };

            // TRY to overwrite fetch. If read-only, catch error and continue without telemetry.
            try {
                this.restorers.push(() => {
                    if (window.fetch === wrappedFetch) window.fetch = originalFetch;
                    else if (window.fetch !== originalFetch) this.lifecycle.record('fetch-restoration-unverified');
                });
                window.fetch = wrappedFetch;
            } catch (readonlyError) {
                this.lifecycle.record('sensory-fetch-interceptor');
                console.warn("[SENSORY] window.fetch is read-only. Network telemetry disabled for stability.");
            }
        } catch (e) {
            console.warn("[SENSORY] Failed to initialize network interceptor:", e);
        }
    }

    private pushLog(type: LogEntry['type'], message: string) {
        if (!this.lifecycle.isOpen) return;
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
        this.lifecycle.assertOpen();

        return [...this.logBuffer];
    }

    // --- 3. SEMANTIC NERVOUS SYSTEM (Accessibility Tree) ---
    public getSemanticTree(element: HTMLElement = document.body): SemanticNode[] {
        this.lifecycle.assertOpen();

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
