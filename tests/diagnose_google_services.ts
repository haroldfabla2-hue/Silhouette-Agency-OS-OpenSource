/**
 * GOOGLE SERVICES DIAGNOSTIC SCRIPT
 * ═══════════════════════════════════════════════════════════════
 * Tests all Google integrations: Drive, Gmail, Gemini, Search
 * Run with: npx tsx tests/diagnose_google_services.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

const log = {
    success: (msg: string) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    error: (msg: string) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
    warn: (msg: string) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
    info: (msg: string) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`),
    header: (msg: string) => console.log(`\n${colors.bold}${colors.cyan}═══ ${msg} ═══${colors.reset}\n`)
};

interface DiagnosticResult {
    service: string;
    status: 'OK' | 'WARN' | 'FAIL';
    message: string;
    details?: any;
}

const results: DiagnosticResult[] = [];

async function checkEnvVars(): Promise<void> {
    log.header('1. ENVIRONMENT VARIABLES');

    const vars = {
        'GOOGLE_CLIENT_ID': process.env.GOOGLE_CLIENT_ID,
        'GOOGLE_CLIENT_SECRET': process.env.GOOGLE_CLIENT_SECRET,
        'GOOGLE_REDIRECT_URI': process.env.GOOGLE_REDIRECT_URI,
        'GOOGLE_DRIVE_FOLDER_ID': process.env.GOOGLE_DRIVE_FOLDER_ID,
        'GEMINI_API_KEY': process.env.GEMINI_API_KEY || process.env.API_KEY,
        'GOOGLE_SEARCH_API_KEY': process.env.GOOGLE_SEARCH_API_KEY,
        'GOOGLE_CX_ID': process.env.GOOGLE_CX_ID
    };

    for (const [name, value] of Object.entries(vars)) {
        if (value) {
            const masked = value.length > 10 ? `${value.substring(0, 8)}...${value.slice(-4)}` : '***';
            log.success(`${name} = ${masked}`);
        } else {
            if (name === 'GOOGLE_DRIVE_FOLDER_ID' || name === 'GOOGLE_SEARCH_API_KEY' || name === 'GOOGLE_CX_ID') {
                log.warn(`${name} not set (optional)`);
            } else {
                log.error(`${name} NOT SET (required)`);
                results.push({ service: 'Environment', status: 'FAIL', message: `Missing ${name}` });
            }
        }
    }
}

async function checkDriveService(): Promise<void> {
    log.header('2. GOOGLE DRIVE SERVICE');

    try {
        const { driveService } = await import('../services/driveService');
        await driveService.init();

        const isAuth = driveService.isAuthenticated();
        const email = driveService.getCurrentUser();

        if (isAuth && email) {
            log.success(`Authenticated as: ${email}`);
            results.push({ service: 'Google Drive', status: 'OK', message: `Authenticated as ${email}` });

            // Try to list files
            try {
                const files = await driveService.listFiles({ pageSize: 3 });
                log.success(`Can list files: ${files.length} files found`);
                if (files.length > 0) {
                    log.info(`  First file: "${files[0].name}"`);
                }
            } catch (listErr: any) {
                log.error(`Cannot list files: ${listErr.message}`);
                results.push({ service: 'Drive Files', status: 'FAIL', message: listErr.message });
            }
        } else {
            log.warn('Not authenticated - OAuth flow needed');
            log.info('Run the server and visit: http://localhost:3001/v1/drive/auth');
            results.push({ service: 'Google Drive', status: 'WARN', message: 'Not authenticated' });
        }
    } catch (error: any) {
        log.error(`Drive init failed: ${error.message}`);
        results.push({ service: 'Google Drive', status: 'FAIL', message: error.message });
    }
}

async function checkGmailService(): Promise<void> {
    log.header('3. GMAIL SERVICE');

    try {
        const { gmailService } = await import('../services/gmailService');
        await gmailService.init();

        if (gmailService.isReady()) {
            log.success('Gmail service initialized');

            // Try to get unread count
            try {
                const unreadCount = await gmailService.getUnreadCount();
                log.success(`Unread emails: ${unreadCount}`);
                results.push({ service: 'Gmail', status: 'OK', message: `Ready, ${unreadCount} unread` });
            } catch (gmailErr: any) {
                log.error(`Gmail API error: ${gmailErr.message}`);
                results.push({ service: 'Gmail', status: 'FAIL', message: gmailErr.message });
            }
        } else {
            log.warn('Gmail not ready - depends on Drive OAuth');
            results.push({ service: 'Gmail', status: 'WARN', message: 'Waiting for Drive OAuth' });
        }
    } catch (error: any) {
        log.error(`Gmail init failed: ${error.message}`);
        results.push({ service: 'Gmail', status: 'FAIL', message: error.message });
    }
}

async function checkGeminiService(): Promise<void> {
    log.header('4. GEMINI AI SERVICE');

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!apiKey) {
        log.error('No GEMINI_API_KEY found');
        results.push({ service: 'Gemini AI', status: 'FAIL', message: 'No API key' });
        return;
    }

    try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        log.info('Testing Gemini API...');
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{ role: 'user', parts: [{ text: 'Say "OK" if you can read this.' }] }],
            config: { maxOutputTokens: 10 }
        } as any);

        const text = response.text || '';
        if (text.toLowerCase().includes('ok')) {
            log.success('Gemini API working');
            results.push({ service: 'Gemini AI', status: 'OK', message: 'API responding' });
        } else {
            log.warn(`Gemini responded but unexpected: ${text.substring(0, 50)}`);
            results.push({ service: 'Gemini AI', status: 'WARN', message: 'Unexpected response' });
        }
    } catch (error: any) {
        log.error(`Gemini API error: ${error.message}`);
        results.push({ service: 'Gemini AI', status: 'FAIL', message: error.message });
    }
}

async function checkGoogleSearch(): Promise<void> {
    log.header('5. GOOGLE CUSTOM SEARCH');

    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cxId = process.env.GOOGLE_CX_ID;

    if (!apiKey || !cxId) {
        log.warn('Google Search not configured (optional)');
        log.info('Set GOOGLE_SEARCH_API_KEY and GOOGLE_CX_ID to enable');
        results.push({ service: 'Google Search', status: 'WARN', message: 'Not configured' });
        return;
    }

    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cxId}&q=test&num=1`;
        const response = await fetch(url);

        if (response.ok) {
            const data = await response.json();
            log.success(`Google Search working - ${data.searchInformation?.totalResults || 0} results`);
            results.push({ service: 'Google Search', status: 'OK', message: 'API responding' });
        } else {
            const errText = await response.text();
            log.error(`Google Search error: ${response.status} - ${errText.substring(0, 100)}`);
            results.push({ service: 'Google Search', status: 'FAIL', message: `HTTP ${response.status}` });
        }
    } catch (error: any) {
        log.error(`Google Search failed: ${error.message}`);
        results.push({ service: 'Google Search', status: 'FAIL', message: error.message });
    }
}

async function checkCredentialGuard(): Promise<void> {
    log.header('6. CREDENTIAL GUARD (Security)');

    try {
        const { CredentialGuard } = await import('../services/security/credentialGuard');

        // Check if getStatus method exists (may vary by version)
        const credGuard = CredentialGuard as any;
        if (typeof credGuard.getStatus !== 'function') {
            log.warn('CredentialGuard.getStatus() method not available');
            results.push({ service: 'CredentialGuard', status: 'WARN', message: 'Method not available' });
            return;
        }

        const status = credGuard.getStatus();

        if (status.leakedCredentials && status.leakedCredentials.length > 0) {
            log.error(`Leaked credentials detected: ${status.leakedCredentials.join(', ')}`);
            results.push({ service: 'CredentialGuard', status: 'FAIL', message: 'Credentials leaked!' });
        } else {
            log.success('No credential leaks detected');
            log.info(`Protected services: ${Object.keys(status.guardedServices || {}).length}`);
            results.push({ service: 'CredentialGuard', status: 'OK', message: 'Security OK' });
        }
    } catch (error: any) {
        log.warn(`CredentialGuard check skipped: ${error.message}`);
        results.push({ service: 'CredentialGuard', status: 'WARN', message: 'Check skipped' });
    }
}

async function printSummary(): Promise<void> {
    log.header('DIAGNOSTIC SUMMARY');

    const ok = results.filter(r => r.status === 'OK').length;
    const warn = results.filter(r => r.status === 'WARN').length;
    const fail = results.filter(r => r.status === 'FAIL').length;

    console.log('┌───────────────────────────────────────────────────────────┐');
    console.log('│ Service              │ Status │ Message                   │');
    console.log('├───────────────────────────────────────────────────────────┤');

    for (const r of results) {
        const statusIcon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️ ' : '❌';
        const servicePad = r.service.padEnd(20);
        const msgPad = r.message.substring(0, 25).padEnd(25);
        console.log(`│ ${servicePad} │ ${statusIcon}     │ ${msgPad} │`);
    }

    console.log('└───────────────────────────────────────────────────────────┘');
    console.log('');
    console.log(`${colors.green}OK: ${ok}${colors.reset}  ${colors.yellow}WARN: ${warn}${colors.reset}  ${colors.red}FAIL: ${fail}${colors.reset}`);

    if (fail > 0) {
        console.log(`\n${colors.red}${colors.bold}⚠️  Some services are failing. Check the details above.${colors.reset}`);
        process.exit(1);
    } else if (warn > 0) {
        console.log(`\n${colors.yellow}Some services need attention but are not critical.${colors.reset}`);
    } else {
        console.log(`\n${colors.green}${colors.bold}🎉 All Google services are working correctly!${colors.reset}`);
    }
}

async function main(): Promise<void> {
    console.log(`\n${colors.bold}${colors.cyan}╔═══════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}║       SILHOUETTE - GOOGLE SERVICES DIAGNOSTIC         ║${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}╚═══════════════════════════════════════════════════════╝${colors.reset}\n`);

    await checkEnvVars();
    await checkDriveService();
    await checkGmailService();
    await checkGeminiService();
    await checkGoogleSearch();
    await checkCredentialGuard();
    await printSummary();
}

main().catch(err => {
    console.error('Diagnostic failed:', err);
    process.exit(1);
});
