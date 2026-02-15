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

const getHeaders = () => {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
    };
};

export const api = {
    get: async <T>(endpoint: string): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'GET',
            headers: getHeaders()
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
        return res.json();
    },

    post: async <T>(endpoint: string, body: any): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
        return res.json();
    },

    put: async <T>(endpoint: string, body: any): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
        return res.json();
    },

    patch: async <T>(endpoint: string, body: any): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
        return res.json();
    },

    delete: async <T>(endpoint: string): Promise<T> => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
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
            headers
        });
    }
};
