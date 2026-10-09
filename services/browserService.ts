import { visualBrowserEngine, VisualElement, VisualActionResult } from './browser/visualBrowserEngine';

export class BrowserService {
    /**
     * Navigates to a URL safely using anti-bot evasion profiles.
     */
    public async goto(url: string): Promise<string> {
        const result = await visualBrowserEngine.goto(url);
        return result.title;
    }

    /**
     * Natural language visual action: clicks, types, or interacts with elements
     * without requiring brittle CSS selectors.
     */
    public async act(instruction: string, textToType?: string): Promise<VisualActionResult> {
        return await visualBrowserEngine.act(instruction, textToType);
    }

    /**
     * Inspects the page and returns all currently visible interactive elements
     * with their spatial coordinates and labels.
     */
    public async observe(instruction?: string): Promise<VisualElement[]> {
        return await visualBrowserEngine.observe(instruction);
    }

    /**
     * Direct spatial click by (x, y) coordinates.
     */
    public async clickCoordinate(x: number, y: number): Promise<VisualActionResult> {
        return await visualBrowserEngine.clickCoordinate(x, y);
    }

    /**
     * Injects Set-of-Marks visual badges and takes a screenshot with all numbers.
     */
    public async renderVisualOverlayAndScreenshot(): Promise<{ elements: VisualElement[]; screenshotPath: string; base64: string }> {
        return await visualBrowserEngine.renderVisualOverlayAndScreenshot();
    }

    /**
     * Safely injects virtual card payment details directly into active checkout fields.
     */
    public async autofillPayment(cardId: string): Promise<{ success: boolean; fieldsInjected: string[]; maskedLast4?: string; error?: string }> {
        return await visualBrowserEngine.autofillPayment(cardId);
    }

    /**
     * Autonomous Self-Healing: clears popups, cookie consent banners, and modal overlays.
     */
    public async clearObstructions(): Promise<{ cleared: boolean; dismissedCount: number; details: string[] }> {
        return await visualBrowserEngine.clearObstructions();
    }

    /**
     * Starts an immutable, cryptographically signed visual audit session.
     */
    public async startAuditSession(): Promise<string> {
        return await visualBrowserEngine.startAuditSession();
    }

    /**
     * Seals the cryptographic audit trail and returns verified manifest.
     */
    public async sealAuditSession(sessionId?: string): Promise<{ isValid: boolean; reportPath: string }> {
        return await visualBrowserEngine.sealAuditSession(sessionId);
    }

    /**
     * Legacy CSS selector click with fallback.
     */
    public async click(selector: string): Promise<void> {
        const result = await visualBrowserEngine.clickSelector(selector);
        if (!result.success) throw new Error(result.error || 'click blocked');
    }

    /**
     * Legacy CSS selector fill with fallback.
     */
    public async type(selector: string, text: string): Promise<void> {
        const page = await visualBrowserEngine.init();
        await page.fill(selector, text);
    }

    /**
     * Extracts text content from the current page.
     */
    public async extractText(): Promise<string> {
        const result = await visualBrowserEngine.extract('all text');
        return result.extractedData?.content || '';
    }

    /**
     * Takes a screenshot and saves it to disk.
     */
    public async screenshot(): Promise<{ base64: string; path: string }> {
        return await visualBrowserEngine.screenshot();
    }

    /**
     * Closes the browser instance.
     */
    public async close(): Promise<void> {
        await visualBrowserEngine.close();
    }
}

export const browserService = new BrowserService();
