import puppeteer from 'puppeteer';
import * as dns from 'dns';
import { promisify } from 'util';

const lookupAsync = promisify(dns.lookup);

/**
 * Checks if an IP address is private, loopback, or otherwise restricted to prevent SSRF.
 */
function isRestrictedIP(ip: string): boolean {
    // IPv4 Loopback
    if (ip === '127.0.0.1' || ip.startsWith('127.')) return true;

    // IPv4 Private
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true;

    // AWS / Cloud Metadata IP
    if (ip === '169.254.169.254') return true;

    // IPv6 Loopback
    if (ip === '::1') return true;
    // IPv6 Unique Local Address
    if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
    // IPv6 Link-Local
    if (ip.toLowerCase().startsWith('fe8') || ip.toLowerCase().startsWith('fe9') || ip.toLowerCase().startsWith('fea') || ip.toLowerCase().startsWith('feb')) return true;

    return false;
}

/**
 * Resolves the provided URL and ensures it doesn't point to a restricted local/private IP (SSRF protection).
 */
export async function validateSafeUrl(urlString: string): Promise<string> {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(urlString);
    } catch {
        throw new Error('Invalid URL format');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Only HTTP and HTTPS protocols are allowed');
    }

    if (parsedUrl.hostname === 'localhost') {
        throw new Error('SSRF Blocked: Localhost access is forbidden');
    }

    try {
        const { address } = await lookupAsync(parsedUrl.hostname);
        if (isRestrictedIP(address)) {
            throw new Error(`SSRF Blocked: Resolved IP (${address}) is in a restricted or private subnet.`);
        }
    } catch (err: any) {
        throw new Error(`SSRF Blocked: DNS resolution failed or returning unsafe address (${err.message})`);
    }

    return parsedUrl.toString();
}

/**
 * Navigates to a URL, strips out junk (scripts, styles), and returns the visible text.
 * Requires Puppeteer to handle client-side rendering.
 */
export async function readUrl(url: string): Promise<string> {
    const safeUrl = await validateSafeUrl(url);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();

        // Abort loading images, media, and fonts to speed up crawling
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'media', 'font', 'stylesheet'].includes(type) || req.url().includes('google-analytics')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(safeUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        // Extract visible text while ignoring <script> and <style>
        const content = await page.evaluate(() => {
            const body = document.body;
            if (!body) return '';

            // Remove unwanted tags
            const junk = body.querySelectorAll('script, style, noscript, iframe, svg, nav, footer, header');
            junk.forEach(el => el.remove());

            return body.innerText.replace(/\n{3,}/g, '\n\n').trim();
        });

        return content;
    } catch (error: any) {
        throw new Error(`Failed to read URL: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Searches the web using DuckDuckGo Html parsing as a fallback search.
 * This does not require an API key and simulates basic search capability.
 */
export async function searchWeb(query: string): Promise<string> {
    try {
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const results = await page.evaluate(() => {
                const resultsNodes = document.querySelectorAll('.result');
                const parsed: any[] = [];
                resultsNodes.forEach(node => {
                    const titleEl = node.querySelector('.result__title');
                    const snippetEl = node.querySelector('.result__snippet');
                    const linkEl = node.querySelector('.result__url');

                    if (titleEl && snippetEl && linkEl) {
                        parsed.push({
                            title: titleEl.textContent?.trim(),
                            snippet: snippetEl.textContent?.trim(),
                            url: linkEl.getAttribute('href') || linkEl.textContent?.trim()
                        });
                    }
                });
                return parsed;
            });

            if (results.length === 0) {
                return 'No results found.';
            }

            return results.slice(0, 5).map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   URL: ${r.url}`).join('\n\n');
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    } catch (error: any) {
        throw new Error(`Web search failed: ${error.message}`);
    }
}
