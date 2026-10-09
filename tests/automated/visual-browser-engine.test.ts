import { describe, it, expect, afterAll } from 'vitest';
import { visualBrowserEngine } from '../../services/browser/visualBrowserEngine';
import { browserService } from '../../services/browserService';

describe('VisualBrowserEngine & Enhanced BrowserService', () => {
    afterAll(async () => {
        await visualBrowserEngine.close();
    });

    it('initializes browser with stealth flags and loads an inline data URL', async () => {
        const testHtml = `
            <!DOCTYPE html>
            <html>
            <head><title>Silhouette Test Page</title></head>
            <body>
                <h1>Silhouette Visual Testing</h1>
                <button id="book-btn" style="position:absolute; left:50px; top:100px; width:120px; height:40px;">Book Flight</button>
                <input id="email-input" type="text" placeholder="Enter your email" style="position:absolute; left:50px; top:160px; width:200px; height:30px;" />
                <a href="#test" id="link-details" style="position:absolute; left:50px; top:210px;">Flight Details</a>
            </body>
            </html>
        `;

        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`;
        const nav = await visualBrowserEngine.goto(dataUrl);

        expect(nav.title).toBe('Silhouette Test Page');
    });

    it('identifies interactive elements and calculates visual geometry via observe()', async () => {
        const elements = await visualBrowserEngine.observe();

        expect(elements.length).toBeGreaterThanOrEqual(3);

        const button = elements.find(e => e.text.includes('Book Flight'));
        expect(button).toBeDefined();
        expect(button?.tag).toBe('button');
        expect(button?.center.x).toBeGreaterThan(0);
        expect(button?.center.y).toBeGreaterThan(0);

        const input = elements.find(e => e.placeholder === 'Enter your email');
        expect(input).toBeDefined();
        expect(input?.tag).toBe('input');
    });

    it('executes natural language visual act() without CSS selectors', async () => {
        const actResult = await visualBrowserEngine.act('Click the Book Flight button');

        expect(actResult.success).toBe(true);
        expect(actResult.targetElement?.text).toBe('Book Flight');
        expect(actResult.coordinates?.x).toBeGreaterThan(0);
    });

    it('supports spatial coordinate clicks with human cursor trajectory', async () => {
        const coordResult = await visualBrowserEngine.clickCoordinate(100, 120);

        expect(coordResult.success).toBe(true);
        expect(coordResult.coordinates).toEqual({ x: 100, y: 120 });
    });

    it('renders visual Set-of-Marks overlay and captures screenshot', async () => {
        const overlay = await visualBrowserEngine.renderVisualOverlayAndScreenshot();

        expect(overlay.elements.length).toBeGreaterThanOrEqual(3);
        expect(overlay.screenshotPath).toBeDefined();
        expect(overlay.base64.length).toBeGreaterThan(100);
    });

    it('browserService wraps visual methods cleanly with backwards compatibility', async () => {
        const observed = await browserService.observe();
        expect(observed.length).toBeGreaterThanOrEqual(3);

        const text = await browserService.extractText();
        expect(text).toContain('Silhouette Visual Testing');
    });
});
