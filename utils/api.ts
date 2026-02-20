import { DEFAULT_API_CONFIG } from '../constants';

// Determine Base URL
// In Dev (Vite): Empty string '' allows the proxy to handle /v1 requests
// In Prod: Can be injected via VITE_API_URL or default to relative
// Safe access for both Vite and Node.js environments
declare const __VITE_API_URL__: string | undefined;
const getEnvUrl = (): string => {
    // Check for Vite environment
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) {
        return (import.meta as any).env.VITE_API_URL;
    }
    // Check for build-time replacement
    if (typeof __VITE_API_URL__ !== 'undefined') {
        return __VITE_API_URL__;
    }
    return '';
};
export const API_BASE_URL = getEnvUrl();

const REQUEST_TIMEOUT_MS = 30000; // 30s default timeout

const getHeaders = () => {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
    };
};

/** Parse error response body for detailed error messages */
async function parseErrorResponse(res: Response): Promise<string> {
    try {
        const body = await res.json();
        return body?.error || body?.message || body?.detail || res.statusText;
    } catch {
        return res.statusText || `HTTP ${res.status}`;
    }
}

/** Create an AbortSignal with timeout */
function withTimeout(timeoutMs: number = REQUEST_TIMEOUT_MS): AbortSignal {
    return AbortSignal.timeout(timeoutMs);
}

export const api = {
    get: async <T>(endpoint: string): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'GET',
            headers: getHeaders(),
            signal: withTimeout()
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res));
        return res.json();
    },

    post: async <T>(endpoint: string, body: any): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body),
            signal: withTimeout()
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res));
        return res.json();
    },

    put: async <T>(endpoint: string, body: any): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(body),
            signal: withTimeout()
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res));
        return res.json();
    },

    patch: async <T>(endpoint: string, body: any): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify(body),
            signal: withTimeout()
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res));
        return res.json();
    },

    delete: async <T>(endpoint: string): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'DELETE',
            headers: getHeaders(),
            signal: withTimeout()
        });
        if (!res.ok) throw new Error(await parseErrorResponse(res));
        return res.json();
    },

    // For streaming or special cases where we need the raw response
    // For FormData uploads, DO NOT set Content-Type - browser will set multipart/form-data with boundary
    fetch: async (endpoint: string, options: RequestInit = {}) => {
        const isFormData = options.body instanceof FormData;
        const headers = isFormData
            ? { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`, ...options.headers }
            : { ...getHeaders(), ...options.headers };

        return fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers,
            signal: options.signal || withTimeout(60000) // 60s for raw fetch (uploads, streams)
        });
    }
};
