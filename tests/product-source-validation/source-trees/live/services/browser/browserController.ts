// =============================================================================
// BROWSER CONTROL TOOL
// Puppeteer-based web automation for Silhouette agents.
// Provides page screenshotting, navigation, element interaction, and scraping.
// =============================================================================

import puppeteer, { Browser, Page } from 'puppeteer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BrowserAction {
    type: 'navigate' | 'screenshot' | 'click' | 'type' | 'evaluate' | 'scrape' | 'pdf' | 'wait';
    /** URL for navigate actions */
    url?: string;
    /** CSS selector for click/type/scrape */
    selector?: string;
    /** Text to type */
    text?: string;
    /** JavaScript to evaluate in the page */
    script?: string;
    /** Wait duration in ms */
    waitMs?: number;
    /** Screenshot options */
    screenshotOptions?: {
        fullPage?: boolean;
        path?: string;
        quality?: number;
    };
}

export interface BrowserResult {
    success: boolean;
    action: string;
    data?: unknown;
    screenshot?: string; // base64
    error?: string;
    timing?: number;
}

// ─── Browser Pool ────────────────────────────────────────────────────────────

class BrowserController {
    private browser: Browser | null = null;
    private pages: Map<string, Page> = new Map();
    private readonly MAX_PAGES = 5;
    private readonly DEFAULT_TIMEOUT = 30_000;

    private browserTimeout: NodeJS.Timeout | null = null;
    private readonly BROWSER_TIMEOUT_MS = 10 * 60 * 1000; // 10 Minutes

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /**
     * Get or launch the browser instance.
     */
    private async getBrowser(): Promise<Browser> {
        this.resetBrowserTimeout();

        // [PA-058] Lite Mode Check
        const { configLoader } = await import('../../server/config/configLoader');
        const config = configLoader.getConfig();
        if (config.modules.browser === false) {
            console.log("[Browser] 🚫 Browser module disabled in config (Lite Mode). Skipping launch.");
            throw new Error("Browser module is disabled in configuration.");
        }

        if (!this.browser || !this.browser.connected) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--window-size=1280,720',
                ],
                defaultViewport: {
                    width: 1280,
                    height: 720,
                },
            });
            console.log('[Browser] 🌐 Browser launched');
        }
        return this.browser;
    }

    private resetBrowserTimeout() {
        if (this.browserTimeout) clearTimeout(this.browserTimeout);
        this.browserTimeout = setTimeout(() => {
            console.log("[Browser] 💤 Idle timeout reached. Shutting down browser.");
            this.shutdown();
        }, this.BROWSER_TIMEOUT_MS);
    }

    /**
     * Get or create a page by ID.
     */
    private async getPage(pageId: string = 'default'): Promise<Page> {
        let page = this.pages.get(pageId);
        if (page && !page.isClosed()) return page;

        // Evict old pages if at limit
        if (this.pages.size >= this.MAX_PAGES) {
            const oldestKey = this.pages.keys().next().value;
            if (oldestKey) {
                const oldPage = this.pages.get(oldestKey);
                if (oldPage && !oldPage.isClosed()) await oldPage.close();
                this.pages.delete(oldestKey);
            }
        }

        const browser = await this.getBrowser();
        page = await browser.newPage();
        page.setDefaultTimeout(this.DEFAULT_TIMEOUT);

        // Set user agent to avoid bot detection
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        this.pages.set(pageId, page);
        return page;
    }

    // ── Actions ────────────────────────────────────────────────────────────

    /**
     * Execute a browser action.
     */
    async execute(action: BrowserAction, pageId?: string): Promise<BrowserResult> {
        this.resetBrowserTimeout();
        const start = Date.now();

        try {
            const page = await this.getPage(pageId);

            switch (action.type) {
                case 'navigate':
                    return await this.actionNavigate(page, action, start);
                case 'screenshot':
                    return await this.actionScreenshot(page, action, start);
                case 'click':
                    return await this.actionClick(page, action, start);
                case 'type':
                    return await this.actionType(page, action, start);
                case 'evaluate':
                    return await this.actionEvaluate(page, action, start);
                case 'scrape':
                    return await this.actionScrape(page, action, start);
                case 'pdf':
                    return await this.actionPdf(page, action, start);
                case 'wait':
                    return await this.actionWait(page, action, start);
                default:
                    return { success: false, action: action.type, error: `Unknown action: ${action.type}` };
            }
        } catch (err: any) {
            return {
                success: false,
                action: action.type,
                error: err.message,
                timing: Date.now() - start,
            };
        }
    }

    private async actionNavigate(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        if (!action.url) return { success: false, action: 'navigate', error: 'URL required' };

        const response = await page.goto(action.url, { waitUntil: 'networkidle2', timeout: this.DEFAULT_TIMEOUT });
        return {
            success: true,
            action: 'navigate',
            data: {
                url: page.url(),
                title: await page.title(),
                status: response?.status(),
            },
            timing: Date.now() - start,
        };
    }

    private async actionScreenshot(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        const buffer = await page.screenshot({
            fullPage: action.screenshotOptions?.fullPage ?? false,
            type: 'png',
            ...(action.screenshotOptions?.path ? { path: action.screenshotOptions.path } : {}),
        });

        return {
            success: true,
            action: 'screenshot',
            screenshot: Buffer.from(buffer).toString('base64'),
            data: {
                url: page.url(),
                title: await page.title(),
                saved: action.screenshotOptions?.path ?? null,
            },
            timing: Date.now() - start,
        };
    }

    private async actionClick(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        if (!action.selector) return { success: false, action: 'click', error: 'Selector required' };

        await page.waitForSelector(action.selector, { visible: true, timeout: 5000 });
        await page.click(action.selector);
        return {
            success: true,
            action: 'click',
            data: { selector: action.selector },
            timing: Date.now() - start,
        };
    }

    private async actionType(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        if (!action.selector || !action.text) {
            return { success: false, action: 'type', error: 'Selector and text required' };
        }

        await page.waitForSelector(action.selector, { visible: true, timeout: 5000 });
        await page.click(action.selector, { clickCount: 3 }); // Select all existing text
        await page.type(action.selector, action.text, { delay: 50 });
        return {
            success: true,
            action: 'type',
            data: { selector: action.selector, textLength: action.text.length },
            timing: Date.now() - start,
        };
    }

    private async actionEvaluate(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        if (!action.script) return { success: false, action: 'evaluate', error: 'Script required' };

        const result = await page.evaluate(action.script);
        return {
            success: true,
            action: 'evaluate',
            data: result,
            timing: Date.now() - start,
        };
    }

    private async actionScrape(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        // If selector provided, scrape specific elements; otherwise scrape full page text
        if (action.selector) {
            const elements = await page.$$eval(action.selector, (els: Element[]) =>
                els.map(el => ({
                    text: el.textContent?.trim(),
                    html: el.innerHTML,
                    tag: el.tagName.toLowerCase(),
                    attrs: Object.fromEntries(
                        Array.from(el.attributes).map(a => [a.name, a.value])
                    ),
                }))
            );

            return {
                success: true,
                action: 'scrape',
                data: { count: elements.length, elements },
                timing: Date.now() - start,
            };
        }

        // Full page text extraction
        const text = await page.evaluate(() => {
            return document.body.innerText;
        });

        return {
            success: true,
            action: 'scrape',
            data: {
                url: page.url(),
                title: await page.title(),
                text: text.slice(0, 50_000), // Limit to 50KB
                length: text.length,
            },
            timing: Date.now() - start,
        };
    }

    private async actionPdf(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        const path = action.screenshotOptions?.path ?? `./uploads/page_${Date.now()}.pdf`;
        await page.pdf({ path, format: 'A4', printBackground: true });

        return {
            success: true,
            action: 'pdf',
            data: { path },
            timing: Date.now() - start,
        };
    }

    private async actionWait(page: Page, action: BrowserAction, start: number): Promise<BrowserResult> {
        if (action.selector) {
            await page.waitForSelector(action.selector, { timeout: action.waitMs ?? 5000 });
        } else {
            await new Promise(resolve => setTimeout(resolve, action.waitMs ?? 1000));
        }

        return {
            success: true,
            action: 'wait',
            data: { waited: action.waitMs ?? (action.selector ? 'selector' : 1000) },
            timing: Date.now() - start,
        };
    }

    // ── Convenience Methods ────────────────────────────────────────────────

    /**
     * Navigate and scrape a URL in one call.
     */
    async scrapeUrl(url: string, selector?: string): Promise<BrowserResult> {
        const navResult = await this.execute({ type: 'navigate', url });
        if (!navResult.success) return navResult;

        return this.execute({ type: 'scrape', selector });
    }

    /**
     * Navigate and screenshot a URL in one call.
     */
    async screenshotUrl(url: string, fullPage: boolean = false, savePath?: string): Promise<BrowserResult> {
        const navResult = await this.execute({ type: 'navigate', url });
        if (!navResult.success) return navResult;

        return this.execute({
            type: 'screenshot',
            screenshotOptions: { fullPage, path: savePath },
        });
    }

    // ── Cleanup ────────────────────────────────────────────────────────────

    /**
     * Close a specific page.
     */
    async closePage(pageId: string): Promise<void> {
        const page = this.pages.get(pageId);
        if (page && !page.isClosed()) await page.close();
        this.pages.delete(pageId);
    }

    /**
     * Close all pages and the browser.
     */
    async shutdown(): Promise<void> {
        if (this.browserTimeout) clearTimeout(this.browserTimeout);

        for (const [id, page] of this.pages) {
            if (!page.isClosed()) await page.close();
            this.pages.delete(id);
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        console.log('[Browser] Browser closed');
    }

    /**
     * Get status of the browser controller.
     */
    getStatus() {
        return {
            browserConnected: this.browser?.connected ?? false,
            openPages: this.pages.size,
            maxPages: this.MAX_PAGES,
        };
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const browserController = new BrowserController();
