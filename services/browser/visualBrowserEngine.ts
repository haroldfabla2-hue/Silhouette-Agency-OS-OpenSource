// =============================================================================
// SILHOUETTE VISUAL BROWSER ENGINE (PHASE 22 - ADVANCED AGENTIC EXECUTION)
// Enterprise-Grade Visual Web Automation with Set-of-Marks (SoM) Grounding,
// Natural Language act(), observe(), extract(), Spatial Coordinates & Safety Gates.
// =============================================================================

import { matchInstruction } from './elementMatcher';
import { chromium, Browser, BrowserContext, Page, ElementHandle } from 'playwright';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';
import { requiresPaymentApproval, ClickDescriptor } from './paymentGate';
import { defaultPaymentApproval } from './paymentApproval';

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
     * Human-approval provider for payment-like clicks. Default routes through the
     * ActionExecutor (human in the loop, single-use grant bound to this destination).
     * Tests can inject their own. Returning false (or throwing) blocks the click.
     */
    private approvalProvider: (d: ClickDescriptor) => Promise<boolean> = defaultPaymentApproval;

    public setApprovalProvider(fn: (d: ClickDescriptor) => Promise<boolean>): void {
        this.approvalProvider = fn;
    }

    /** Hard gate. Returns a blocking result when approval is required and not granted, else null. */
    private async gateClick(d: ClickDescriptor, action: string, startTime: number): Promise<VisualActionResult | null> {
        if (!requiresPaymentApproval(d)) return null;
        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'VisualBrowserEngine',
            event: 'PAYMENT_CLICK_REQUIRES_APPROVAL',
            action
        });
        let approved = false;
        try { approved = await this.approvalProvider(d); } catch { approved = false; }
        if (approved) return null;
        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'VisualBrowserEngine',
            event: 'PAYMENT_CLICK_BLOCKED',
            action
        });
        return {
            success: false,
            action,
            error: 'Blocked: payment/commitment action requires explicit human approval.',
            securityGated: true,
            executionTimeMs: Date.now() - startTime
        };
    }


    /**
     * Records an action in the audit ledger. Every browser action goes through here (act, coordinate click,
     * CSS click, goto, autofill). DOM is hashed AFTER redacting input values; screenshots are skipped when
     * sensitive fields may be visible (autofill). A recording failure is reported via telemetry, never silent.
     */
    private async auditAction(page: Page, a: { actionType: string; description?: string; coordinates?: { x: number; y: number }; screenshot?: boolean }): Promise<void> {
        try {
            const { browserAuditLedger } = await import('./browserAuditLedger');
            const screenshotBuffer = a.screenshot === false ? undefined : await page.screenshot({ fullPage: false }).catch(() => undefined);
            const domContent = await page.evaluate(() => {
                const clone = document.documentElement.cloneNode(true) as HTMLElement;
                clone.querySelectorAll('input,textarea,select').forEach((el: any) => {
                    el.removeAttribute('value'); if ('value' in el) el.value = '';
                    el.textContent = '';
                });
                clone.querySelectorAll('script,style').forEach(el => el.remove());
                return clone.outerHTML;
            }).catch(() => undefined);
            const frame = await browserAuditLedger.recordFrame({
                actionType: a.actionType,
                targetDescription: a.description,
                coordinates: a.coordinates,
                url: page.url(),
                screenshotBuffer,
                domContent
            });
            if (frame === null && browserAuditLedger.hasActiveSession?.()) {
                systemBus.emit(SystemProtocol.TELEMETRY_LOG, { service: 'VisualBrowserEngine', event: 'AUDIT_RECORD_REJECTED', action: a.actionType });
            }
        } catch (e: any) {
            systemBus.emit(SystemProtocol.TELEMETRY_LOG, { service: 'VisualBrowserEngine', event: 'AUDIT_RECORD_FAILED', action: a.actionType, error: String(e?.message || e) });
        }
    }

    /** Describe the element under a point (for gating coordinate clicks). */
    private async describePoint(page: Page, x: number, y: number): Promise<ClickDescriptor> {
        try {
            const d = await page.evaluate(([px, py]) => {
                const el = document.elementFromPoint(px as number, py as number) as HTMLElement | null;
                if (!el) return null;
                const c = (el.closest('button,a,input,[role=button],[type=submit]') as HTMLElement | null) || el;
                const inp = c as HTMLInputElement;
                return {
                    text: [c.innerText, c.getAttribute('aria-label'), inp.value, c.getAttribute('title')].filter(Boolean).join(' '),
                    type: inp.type || c.getAttribute('type') || ''
                };
            }, [x, y]);
            if (!d) return { elementUnknown: true, url: page.url() };
            return { elementText: d.text, elementType: d.type, url: page.url() };
        } catch {
            return { elementUnknown: true, url: page.url() };
        }
    }

    /** Legacy CSS-selector fill, now audited. The typed text is NOT recorded (only its length). */
    public async typeSelector(selector: string, text: string): Promise<void> {
        const page = await this.init();
        await page.fill(selector, text);
        await this.auditAction(page, { actionType: 'typeSelector', description: `type(${selector}, ${text.length} chars)`, screenshot: false });
    }

    /** Legacy CSS-selector click, now behind the same payment gate. */
    public async clickSelector(selector: string): Promise<VisualActionResult> {
        const startTime = Date.now();
        const page = await this.init();
        let desc: ClickDescriptor;
        try {
            const d = await page.locator(selector).first().evaluate((el: any) => ({
                text: [el.innerText, el.getAttribute('aria-label'), el.value, el.getAttribute('title')].filter(Boolean).join(' '),
                type: el.type || el.getAttribute('type') || ''
            }), undefined, { timeout: 5000 });
            desc = { elementText: d.text, elementType: d.type, url: page.url() };
        } catch {
            desc = { elementUnknown: true, url: page.url() };
        }
        const blocked = await this.gateClick(desc, `click(${selector})`, startTime);
        if (blocked) return blocked;
        await page.click(selector);
        await this.auditAction(page, { actionType: 'clickSelector', description: `click(${selector})` });
        return { success: true, action: `click(${selector})`, executionTimeMs: Date.now() - startTime };
    }

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

        // Chameleon hardware fingerprint randomization: hide automation & spoof GPU/Canvas
        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 12 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 16 });

            // Spoof WebGL vendor & renderer to high-end hardware
            const getParameterProto = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function (param: number) {
                if (param === 37445) return 'Google Inc. (Apple)'; // UNMASKED_VENDOR_WEBGL
                if (param === 37446) return 'ANGLE (Apple, Apple M2 Max, OpenGL 4.1)'; // UNMASKED_RENDERER_WEBGL
                return getParameterProto.apply(this, [param]);
            };

            // Canvas noise perturbation (defeats canvas hash trackers without visual distortion)
            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (type?: string, ...args: any[]) {
                const ctx = this.getContext('2d');
                if (ctx && this.width > 0 && this.height > 0) {
                    try {
                        const img = ctx.getImageData(0, 0, 1, 1);
                        img.data[0] = (img.data[0] ^ 1);
                        ctx.putImageData(img, 0, 0);
                    } catch {}
                }
                return origToDataURL.apply(this, [type, ...args]);
            };

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
        await this.auditAction(page, { actionType: 'goto', description: url });
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
                const cleanText = rawText.replace(/\s+/g, ' ').substring(0, 100);

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

        let target = matched;

        // [SELF-HEALING RETRY] If no element matched, auto-clear popup/modal obstructions and retry
        if (!target) {
            const cleared = await this.clearObstructions();
            if (cleared.dismissedCount > 0) {
                await page.waitForTimeout(500);
                const freshElements = await this.observe();
                target = this.matchElementByInstruction(instruction, freshElements);
            }
        }

        if (!target) {
            return {
                success: false,
                action: instruction,
                observedElements: elements.slice(0, 15),
                error: this.lastAmbiguousCandidates.length > 1
                    ? `AMBIGUOUS: "${instruction}" matches ${this.lastAmbiguousCandidates.length} elements (${this.lastAmbiguousCandidates.map(c => `#${c.id} ${c.tag} "${(c.text || c.ariaLabel || '').slice(0, 30)}"`).join(', ')}). Specify one by #id.`
                    : `Could not identify an element matching: "${instruction}". Found ${elements.length} other interactive elements.`,
                executionTimeMs: Date.now() - startTime
            };
        }

        // 3b. HARD GATE: payment / irreversible commitment requires human approval BEFORE any interaction
        const gated = await this.gateClick({
            instruction,
            elementText: [target.text, target.ariaLabel, target.placeholder].filter(Boolean).join(' '),
            elementType: target.type,
            url: page.url()
        }, instruction, startTime);
        if (gated) return gated;

        // 4. Perform human-like interaction with jitter and smooth movement
        await page.mouse.move(target.center.x, target.center.y, { steps: 5 });
        await page.waitForTimeout(100);

        if (target.tag === 'input' || target.tag === 'textarea' || textToType) {
            await page.mouse.click(target.center.x, target.center.y);
            const content = textToType || this.extractTextToTypeFromInstruction(instruction) || '';
            if (content) {
                await page.keyboard.type(content, { delay: 45 });
            }
        } else {
            await page.mouse.click(target.center.x, target.center.y);
        }

        await page.waitForTimeout(1000); // Allow navigation or reaction

        // 5. Cryptographic Audit Recording
        await this.auditAction(page, { actionType: 'act', description: instruction, coordinates: target.center });

        return {
            success: true,
            action: instruction,
            targetElement: target,
            coordinates: target.center,
            executionTimeMs: Date.now() - startTime
        };
    }

    /**
     * Direct spatial click by (x, y) coordinates with human-like cursor trajectory.
     */
    public async clickCoordinate(x: number, y: number): Promise<VisualActionResult> {
        const startTime = Date.now();
        const page = await this.init();

        const gated = await this.gateClick(await this.describePoint(page, x, y), `clickCoordinate(${x}, ${y})`, startTime);
        if (gated) return gated;

        await page.mouse.move(x, y, { steps: 8 });
        await page.waitForTimeout(120);
        await page.mouse.down();
        await page.waitForTimeout(80);
        await page.mouse.up();
        await this.auditAction(page, { actionType: 'clickCoordinate', description: `clickCoordinate(${x}, ${y})`, coordinates: { x, y } });

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
     * Autonomous and safe payment checkout autofill.
     * Injects virtual card details directly into DOM form elements
     * WITHOUT exposing raw card data into LLM context logs.
     */
    public async autofillPayment(cardId: string): Promise<{ success: boolean; fieldsInjected: string[]; maskedLast4?: string; error?: string }> {
        const { financialVault } = await import('../vault/financialVault');
        const card = financialVault.getCardForAutofill(cardId);

        if (!card) {
            return {
                success: false,
                fieldsInjected: [],
                error: `Active virtual card ${cardId} not found or expired.`
            };
        }

        const page = await this.init();
        const fieldsInjected: string[] = [];

        // 1. Card Number field
        const numSelector = 'input[autocomplete*="cc-number" i], input[name*="cardnumber" i], input[name*="card_num" i], input[name*="card" i], input[placeholder*="card number" i], input[id*="card" i]';
        const numElement = await page.$(numSelector);
        if (numElement) {
            await numElement.click();
            await page.keyboard.type(card.cardNumber, { delay: 35 });
            fieldsInjected.push('cardNumber');
        }

        // 2. Expiration Date (Single field or split)
        const expSelector = 'input[autocomplete*="cc-exp" i], input[name*="exp" i], input[placeholder*="mm/yy" i], input[placeholder*="mm / yy" i]';
        const expElement = await page.$(expSelector);
        if (expElement) {
            await expElement.click();
            await page.keyboard.type(`${card.expMonth}${card.expYear}`, { delay: 35 });
            fieldsInjected.push('expiration');
        } else {
            // Split month / year
            const monthEl = await page.$('input[name*="month" i], select[name*="month" i]');
            const yearEl = await page.$('input[name*="year" i], select[name*="year" i]');
            if (monthEl) {
                await monthEl.fill(card.expMonth);
                fieldsInjected.push('expMonth');
            }
            if (yearEl) {
                await yearEl.fill(`20${card.expYear}`);
                fieldsInjected.push('expYear');
            }
        }

        // 3. CVV / Security Code
        const cvvSelector = 'input[autocomplete*="cc-csc" i], input[name*="cvv" i], input[name*="cvc" i], input[placeholder*="cvv" i], input[placeholder*="cvc" i], input[placeholder*="security code" i]';
        const cvvElement = await page.$(cvvSelector);
        if (cvvElement) {
            await cvvElement.click();
            await page.keyboard.type(card.cvv, { delay: 35 });
            fieldsInjected.push('cvv');
        }

        // 4. Cardholder Name
        const nameSelector = 'input[autocomplete*="cc-name" i], input[name*="cardholder" i], input[name*="holder" i], input[placeholder*="name on card" i]';
        const nameElement = await page.$(nameSelector);
        if (nameElement) {
            await nameElement.click();
            await page.keyboard.type(card.cardholderName, { delay: 35 });
            fieldsInjected.push('cardholderName');
        }

        // Audit without screenshot (card digits may be visible) and with redacted DOM; never log card values
        await this.auditAction(page, { actionType: 'autofillPayment', description: `autofill fields: ${fieldsInjected.join(',')} (card ****${card.last4})`, screenshot: false });

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'VisualBrowserEngine',
            event: 'PAYMENT_FORM_AUTOFILLED',
            cardId,
            last4: card.last4,
            fieldsInjected
        });

        return {
            success: fieldsInjected.length > 0,
            fieldsInjected,
            maskedLast4: `•••• ${card.last4}`
        };
    }

    /**
     * Autonomous Self-Healing: detects and dismisses cookie consent banners,
     * GDPR notices, subscription overlays, and modal backdrops.
     */
    public async clearObstructions(): Promise<{ cleared: boolean; dismissedCount: number; details: string[] }> {
        const page = await this.init();
        const details: string[] = [];

        const dismissedCount = await page.evaluate(() => {
            let count = 0;
            const dismissButtonSelectors = [
                'button[aria-label*="close" i]',
                'button[aria-label*="dismiss" i]',
                'button[id*="cookie" i]',
                'button[class*="close" i]',
                'button[class*="dismiss" i]',
                '.modal-close',
                '.popup-close'
            ];

            // 1. Click accept/dismiss buttons inside popups
            dismissButtonSelectors.forEach(selector => {
                const buttons = Array.from(document.querySelectorAll(selector));
                buttons.forEach((btn: any) => {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        try {
                            btn.click();
                            count++;
                        } catch {}
                    }
                });
            });

            // 2. Clear lingering dark modal backdrops with high z-index
            const overlays = Array.from(document.querySelectorAll('.modal-backdrop, .overlay, [class*="backdrop" i]'));
            overlays.forEach((overlay: any) => {
                try {
                    overlay.remove();
                    count++;
                } catch {}
            });

            return count;
        });

        if (dismissedCount > 0) {
            systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
                service: 'VisualBrowserEngine',
                event: 'OBSTRUCTIONS_SELF_HEALED',
                dismissedCount
            });
        }

        return {
            cleared: dismissedCount > 0,
            dismissedCount,
            details
        };
    }

    /**
     * Starts an immutable, cryptographically signed visual audit session.
     */
    public async startAuditSession(): Promise<string> {
        const page = await this.init();
        const { browserAuditLedger } = await import('./browserAuditLedger');
        return browserAuditLedger.startSession(page.url());
    }

    /**
     * Seals the cryptographic audit trail and returns verified manifest.
     */
    public async sealAuditSession(sessionId?: string): Promise<{ isValid: boolean; reportPath: string }> {
        const { browserAuditLedger } = await import('./browserAuditLedger');
        const result = await browserAuditLedger.sealSession(sessionId);
        return {
            isValid: result.isValid,
            reportPath: result.reportPath
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

    private lastAmbiguousCandidates: VisualElement[] = [];

    private matchElementByInstruction(instruction: string, elements: VisualElement[]): VisualElement | null {
        const r = matchInstruction(instruction, elements);
        this.lastAmbiguousCandidates = r.ambiguous ? r.candidates : [];
        return r.element;
    }

    private extractTextToTypeFromInstruction(instruction: string): string | null {
        // Looks for quoted text: type "my password" or type 'hello'
        const quoted = instruction.match(/["']([^"']+)["']/);
        if (quoted) return quoted[1];

        // Looks for keywords: type myemail@test.com
        const match = instruction.match(/(?:type|write|fill|enter)\s+(?:in\s+)?(?:.*?\s+with\s+)?(.*)/i);
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
