// =============================================================================
// Device Fingerprint Utility
// Generate unique device identifier for auto-login
// =============================================================================

/**
 * Generate a device fingerprint based on browser/system characteristics
 * This runs in the browser (frontend)
 */
export function generateFingerprint(): string {
    const components: string[] = [];

    // User agent
    components.push(navigator.userAgent);

    // Screen dimensions
    components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);

    // Timezone
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

    // Language
    components.push(navigator.language);

    // Platform
    components.push(navigator.platform);

    // Hardware concurrency (CPU cores)
    components.push(String(navigator.hardwareConcurrency || 0));

    // Device memory (approximate)
    components.push(String((navigator as any).deviceMemory || 0));

    // Persistent UUID from localStorage (survives browser restart)
    let persistentId = localStorage.getItem('silhouette_device_id');
    if (!persistentId) {
        persistentId = crypto.randomUUID();
        localStorage.setItem('silhouette_device_id', persistentId);
    }
    components.push(persistentId);

    // Hash all components
    return hashString(components.join('|'));
}

/**
 * Simple string hashing (FNV-1a variant)
 */
function hashString(str: string): string {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    // Convert to hex string
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Get friendly device name
 */
export function getDeviceName(): string {
    const ua = navigator.userAgent;

    // Try to detect device type
    if (/Windows/.test(ua)) {
        if (/Win64|x64/.test(ua)) return 'Windows PC (64-bit)';
        return 'Windows PC';
    }
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'Linux PC';
    if (/Android/.test(ua)) return 'Android Device';
    if (/iPhone|iPad/.test(ua)) return 'iOS Device';

    return 'Unknown Device';
}

/**
 * Check if current device is trusted (has valid session)
 */
export async function checkDeviceTrust(): Promise<{
    trusted: boolean;
    user?: { email: string; name: string; role: string };
    isCreator?: boolean;
}> {
    const fingerprint = generateFingerprint();

    try {
        // Add timeout to prevent infinite hang if server is slow/unavailable
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch('/v1/identity/auto-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fingerprint,
                deviceName: getDeviceName()
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return { trusted: false };
        }

        const data = await response.json();

        if (data.success && data.user) {
            return {
                trusted: true,
                user: data.user,
                isCreator: data.isCreator
            };
        }

        return { trusted: false };
    } catch (error: any) {
        // Handle abort (timeout) or network errors gracefully
        if (error.name === 'AbortError') {
            console.warn('[Fingerprint] Auto-login timed out - server may be starting');
        } else {
            console.error('[Fingerprint] Auto-login check failed:', error.message);
        }
        return { trusted: false };
    }
}

/**
 * Start Google OAuth flow with fingerprint
 */
export function startGoogleAuth(): void {
    const fingerprint = generateFingerprint();

    // Open OAuth in popup, pass fingerprint as state parameter
    const width = 500;
    const height = 600;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;

    // TODO: Backend should include state param in OAuth URL
    const authUrl = `/v1/drive/auth?state=${encodeURIComponent(fingerprint)}`;

    window.open(
        authUrl,
        'Google Sign In',
        `width=${width},height=${height},left=${left},top=${top}`
    );
}
