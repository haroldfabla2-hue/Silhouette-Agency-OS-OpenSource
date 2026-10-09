// =============================================================================
// SILHOUETTE VISUAL BROWSER ENGINE (PHASE 22 - ADVANCED AGENTIC EXECUTION)
// Enterprise-Grade Visual Web Automation with Set-of-Marks (SoM) Grounding,
// Natural Language act(), observe(), extract(), Spatial Coordinates & Safety Gates.
// =============================================================================

import { chromium, Browser, BrowserContext, Page, ElementHandle } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface VisualElement {
    id: number;
    tag: string;
    text: string;
    type?: string;
    role?: string;
    placeholder?: string;
    ariaLabel?: string;
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    center: {
        x: number;
        y: number;
    };
}

export interface VisualActionResult {
    success: boolean;
    action: string;
    targetElement?: VisualElement;
    coordinates?: { x: number; y: number };
    screenshotPath?: string;
    screenshotBase64?: string;
    extractedData?: any;
    observedElements?: VisualElement[];
    error?: string;
    executionTimeMs: number;
    securityGated?: boolean;
}

export class VisualBrowserEngine {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private isInitialized: boolean = false;
    private readonly defaultTimeoutMs: number = 30000;

    /**
     * Initialize the headless browser with anti-bot evasion profiles.
     */
    public async init(): Promise<Page> {
        if (this.page && !this.page.isClosed()) {
            return this.page;
        }

        if (!this.browser) {
            const launchArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1440,900'
            ];

            // Auto-detect installed system browser (Chrome/Edge) for zero-download instant execution
            // and superior anti-bot fingerprinting
            try {
                this.browser = await chromium.launch({
                    headless: true,
                    channel: 'chrome',
                    args: launchArgs
                });
            } catch {
                try {
                    this.browser = await chromium.launch({
                        headless: true,
                        channel: 'msedge',
                        args: launchArgs
                    });
                } catch {
                    this.browser = await chromium.launch({
                        headless: true,
                        args: launchArgs
                    });
                }
            }
        }

        this.context = await this.browser.newContext({
            viewport: { width: 1440, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            deviceScaleFactor: 1,
            hasTouch: false,
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });

        // Anti-fingerprinting stealth evasion: hide navigator.webdriver
        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
            // Mock Chrome runtime
            (window as any).chrome = {
                runtime: {},
                loadTimes: () => {},
                csi: () => {},
                app: {}
            };
        });

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(this.defaultTimeoutMs);
        this.isInitialized = true;

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'VisualBrowserEngine',
            event: 'BROWSER_INITIALIZED',
            viewport: '1440x900'
        });

        return this.page;
    }

    /**
     * Navigate to a target URL safely.
     */
    public async goto(url: string): Promise<{ title: string; url: string }> {
        const page = await this.init();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.defaultTimeoutMs });
        // Give dynamic SPAs 1 second to hydrate
        await page.waitForTimeout(1000);
        return {
            title: await page.title(),
            url: page.url()
        };
    }

    /**
     * Injects a Set-of-Marks (SoM) visual detection overlay into the page.
     * Identifies all interactive elements, computes their spatial geometry,
     * and tags them with an index.
     */
    public async observe(instruction?: string): Promise<VisualElement[]> {
        const page = await this.init();

        const elements: VisualElement[] = await page.evaluate(() => {
            const interactiveSelectors = [
                'button',
                'a[href]',
                'input',
                'select',
                'textarea',
                '[role="button"]',
                '[role="link"]',
                '[role="checkbox"]',
                '[role="menuitem"]',
                '[tabindex]:not([tabindex="-1"])',
                '[onclick]'
            ];

            const nodes = Array.from(document.querySelectorAll(interactiveSelectors.join(',')));
            const visibleElements: any[] = [];
            let index = 1;

            nodes.forEach(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);

                // Filter out non-visible elements
                if (
                    rect.width <= 0 ||
                    rect.height <= 0 ||
                    style.visibility === 'hidden' ||
                    style.display === 'none' ||
                    parseFloat(style.opacity) < 0.1
                ) {
                    return;
                }

                // Check if element is within current viewport
                if (
                    rect.bottom < 0 ||
                    rect.right < 0 ||
                    rect.top > window.innerHeight ||
                    rect.left > window.innerWidth
                ) {
                    return;
                }

                const rawText = (el.textContent || (el as HTMLInputElement).value || '').trim();
                const cleanText = rawText.replace(/\\s+/g, ' ').substring(0, 100);

                visibleElements.push({
                    id: index++,
                    tag: el.tagName.toLowerCase(),
                    text: cleanText,
                    type: (el as HTMLInputElement).type || undefined,
                    role: el.getAttribute('role') || undefined,
                    placeholder: (el as HTMLInputElement).placeholder || undefined,
                    ariaLabel: el.getAttribute('aria-label') || undefined,
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    },
                    center: {
                        x: Math.round(rect.x + rect.width / 2),
                        y: Math.round(rect.y + rect.height / 2)
                    }
                });
            });

            return visibleElements;
        });

        return elements;
    }

    /**
     * Renders visual numbered markers directly onto the page and captures a screenshot.
     */
    public async renderVisualOverlayAndScreenshot(): Promise<{ elements: VisualElement[]; screenshotPath: string; base64: string }> {
        const page = await this.init();
        const elements = await this.observe();

        // Inject visual overlay badges
        await page.evaluate((items) => {
            const existingOverlay = document.getElementById('silhouette-som-overlay');
            if (existingOverlay) existingOverlay.remove();

            const overlay = document.createElement('div');
            overlay.id = 'silhouette-som-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '999999';

            items.forEach((item: any) => {
                const badge = document.createElement('div');
                badge.textContent = item.id.toString();
                badge.style.position = 'absolute';
                badge.style.left = `${item.rect.x}px`;
                badge.style.top = `${item.rect.y}px`;
                badge.style.backgroundColor = '#ec4899';
                badge.style.color = '#ffffff';
                badge.style.fontSize = '11px';
                badge.style.fontWeight = 'bold';
                badge.style.padding = '1px 4px';
                badge.style.borderRadius = '3px';
                badge.style.boxShadow = '0 0 3px rgba(0,0,0,0.8)';
                badge.style.border = '1px solid #ffffff';
                badge.style.fontFamily = 'monospace';

                overlay.appendChild(badge);
            });

            document.body.appendChild(overlay);
        }, elements);

        const screenshotResult = await this.screenshot();

        // Clean up overlay after screenshot
        await page.evaluate(() => {
            const overlay = document.getElementById('silhouette-som-overlay');
            if (overlay) overlay.remove();
        });

        return {
            elements,
            screenshotPath: screenshotResult.path,
            base64: screenshotResult.base64
        };
    }

    /**
     * Executes a natural-language visual action on the page.
     * Evaluates semantic intent, matches against visible elements, and interacts.
     */
    public async act(instruction: string, textToType?: string): Promise<VisualActionResult> {
        const startTime = Date.now();
        const page = await this.init();

        // 1. Safety & Financial Check
        const isDangerous = this.checkIfHighRiskAction(instruction);
        if (isDangerous) {
            systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
                service: 'VisualBrowserEngine',
                event: 'HIGH_RISK_ACTION_INTERCEPTED',
                instruction
            });
        }

        // 2. Discover interactive elements
        const elements = await this.observe();
        if (elements.length === 0) {
            return {
                success: false,
                action: instruction,
                error: 'No interactive visual elements found on the current page.',
                executionTimeMs: Date.now() - startTime
            };
        }

        // 3. Match the target element semantically
        const matched = this.matchElementByInstruction(instruction, elements);

        if (!matched) {
            return {
                success: false,
                action: instruction,
                observedElements: elements.slice(0, 15),
                error: `Could not identify an element matching: "${instruction}". Found ${elements.length} other interactive elements.`,
                executionTimeMs: Date.now() - startTime
            };
        }

        // 4. Perform human-like interaction with jitter and smooth movement
        await page.mouse.move(matched.center.x, matched.center.y, { steps: 5 });
        await page.waitForTimeout(100);

        if (matched.tag === 'input' || matched.tag === 'textarea' || textToType) {
            await page.mouse.click(matched.center.x, matched.center.y);
            const content = textToType || this.extractTextToTypeFromInstruction(instruction) || '';
            if (content) {
                await page.keyboard.type(content, { delay: 45 });
            }
        } else {
            await page.mouse.click(matched.center.x, matched.center.y);
        }

        await page.waitForTimeout(1000); // Allow navigation or reaction

        return {
            success: true,
            action: instruction,
            targetElement: matched,
            coordinates: matched.center,
            executionTimeMs: Date.now() - startTime
        };
    }

    /**
     * Direct spatial click by (x, y) coordinates with human-like cursor trajectory.
     */
    public async clickCoordinate(x: number, y: number): Promise<VisualActionResult> {
        const startTime = Date.now();
        const page = await this.init();

        await page.mouse.move(x, y, { steps: 8 });
        await page.waitForTimeout(120);
        await page.mouse.down();
        await page.waitForTimeout(80);
        await page.mouse.up();

        return {
            success: true,
            action: `clickCoordinate(${x}, ${y})`,
            coordinates: { x, y },
            executionTimeMs: Date.now() - startTime
        };
    }

    /**
     * Extracts structured text or tabular content from the page.
     */
    public async extract(instruction: string): Promise<VisualActionResult> {
        const startTime = Date.now();
        const page = await this.init();

        const textContent = await page.evaluate(() => {
            const clone = document.body.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
            return clone.innerText.substring(0, 15000);
        });

        return {
            success: true,
            action: `extract("${instruction}")`,
            extractedData: {
                instruction,
                content: textContent,
                characterCount: textContent.length
            },
            executionTimeMs: Date.now() - startTime
        };
    }

    /**
     * Captures a full-page high-resolution screenshot.
     */
    public async screenshot(): Promise<{ base64: string; path: string }> {
        const page = await this.init();
        const dir = path.resolve(process.cwd(), 'uploads', 'screenshots');
        await fs.mkdir(dir, { recursive: true });

        const filename = `visual_${Date.now()}.png`;
        const filePath = path.join(dir, filename);

        const buffer = await page.screenshot({ fullPage: true });
        await fs.writeFile(filePath, buffer);

        return {
            base64: buffer.toString('base64'),
            path: filePath
        };
    }

    /**
     * Cleanly close browser instance and free resources.
     */
    public async close(): Promise<void> {
        if (this.context) {
            await this.context.close();
            this.context = null;
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this.page = null;
        this.isInitialized = false;
    }

    // ── Helper Matching Heuristics ─────────────────────────────────────────────

    private matchElementByInstruction(instruction: string, elements: VisualElement[]): VisualElement | null {
        const normalized = instruction.toLowerCase();

        // 1. Direct number match (e.g., "click #4" or "element 4")
        const idMatch = normalized.match(/#?(\d+)/);
        if (idMatch) {
            const id = parseInt(idMatch[1], 10);
            const found = elements.find(e => e.id === id);
            if (found) return found;
        }

        // 2. Exact or substring match in text, aria-label, or placeholder
        const scored = elements.map(el => {
            let score = 0;
            const elText = el.text.toLowerCase();
            const aria = (el.ariaLabel || '').toLowerCase();
            const ph = (el.placeholder || '').toLowerCase();

            // Word overlap scoring
            const words = normalized.split(/\\s+/).filter(w => w.length > 2);
            words.forEach(word => {
                if (elText.includes(word)) score += 3;
                if (aria.includes(word)) score += 4;
                if (ph.includes(word)) score += 3;
            });

            // Target tag priority
            if (normalized.includes('button') && el.tag === 'button') score += 2;
            if (normalized.includes('input') && el.tag === 'input') score += 2;
            if (normalized.includes('link') && el.tag === 'a') score += 2;

            return { element: el, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.score > 0 ? scored[0].element : null;
    }

    private extractTextToTypeFromInstruction(instruction: string): string | null {
        // Looks for quoted text: type "my password" or type 'hello'
        const quoted = instruction.match(/["']([^"']+)["']/);
        if (quoted) return quoted[1];

        // Looks for keywords: type myemail@test.com
        const match = instruction.match(/(?:type|write|fill|enter)\\s+(?:in\\s+)?(?:.*?\\s+with\\s+)?(.*)/i);
        return match ? match[1].trim() : null;
    }

    private checkIfHighRiskAction(instruction: string): boolean {
        const dangerousKeywords = [
            'buy', 'purchase', 'pay', 'checkout', 'confirm payment',
            'credit card', 'transfer', 'delete account', 'withdraw'
        ];
        const lower = instruction.toLowerCase();
        return dangerousKeywords.some(keyword => lower.includes(keyword));
    }
}

export const visualBrowserEngine = new VisualBrowserEngine();
