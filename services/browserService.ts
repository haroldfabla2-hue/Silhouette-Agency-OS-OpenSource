import { chromium, Browser, Page } from 'playwright';

export class BrowserService {
    private browser: Browser | null = null;
    private page: Page | null = null;

    private async init() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
        }
        if (!this.page) {
            this.page = await this.browser.newPage();
        }
    }

    public async goto(url: string): Promise<string> {
        await this.init();
        await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
        return this.page!.title();
    }

    public async click(selector: string): Promise<void> {
        await this.init();
        await this.page!.click(selector);
    }

    public async type(selector: string, text: string): Promise<void> {
        await this.init();
        await this.page!.fill(selector, text);
    }

    public async extractText(): Promise<string> {
        await this.init();
        return await this.page!.evaluate(() => {
            document.querySelectorAll('script, style, noscript').forEach(el => el.remove());
            return document.body.innerText.substring(0, 10000);
        });
    }

    public async screenshot(): Promise<{ base64: string; path: string }> {
        await this.init();
        const fs = await import('fs');
        const pathMod = await import('path');
        const dir = pathMod.resolve(process.cwd(), 'uploads', 'screenshots');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filename = `screenshot_${Date.now()}.png`;
        const filePath = pathMod.join(dir, filename);

        const buffer = await this.page!.screenshot({ fullPage: true });
        fs.writeFileSync(filePath, buffer);

        return {
            base64: buffer.toString('base64'),
            path: filePath
        };
    }

    public async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}

export const browserService = new BrowserService();
