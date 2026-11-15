/** Single managed MCP key implementation. No default DB or credential imports. */
import crypto from 'node:crypto';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';
export interface ApiKey {
    id: string;
    name: string;           // Friendly name (e.g., "Claude Desktop", "Cursor")
    keyHash: string;        // SHA-256 hash of the actual key
    keyPrefix: string;      // First 8 chars for identification (e.g., "sk_live_")
    createdAt: number;
    createdBy: string;      // Admin user ID
    expiresAt?: number;     // Optional expiration timestamp
    lastUsedAt?: number;
    usageCount: number;
    permissions: ApiKeyPermission[];
    active: boolean;
}

export type ApiKeyPermission =
    | 'tools:read'          // List tools
    | 'tools:execute'       // Execute tools
    | 'resources:read'      // Read resources
    | 'admin:full';         // Full admin access

export interface ApiKeyCreateRequest {
    name: string;
    permissions: ApiKeyPermission[];
    expiresInDays?: number;
}

/** Narrow record repository. No generic config names, SQL or secret lookup API. */
export interface McpKeyRegistry {
    read(): unknown;
    write(keys: ApiKey[]): void;
    transaction<T>(body: () => T): T;
}
export class ApiKeyService {
    constructor(private readonly registry: McpKeyRegistry) {}
    // ==================== API KEY MANAGEMENT ====================

    /**
     * Create a new API key (ADMIN ONLY)
     * Returns the full key ONCE - it cannot be retrieved again
     */
    public createApiKey(
        request: ApiKeyCreateRequest,
        adminId: string
    ): { id: string; key: string } {
        const keys = this.getAllKeys();

        // Generate cryptographically secure key
        const keyId = crypto.randomUUID();
        const rawKey = `sk_silhouette_${crypto.randomBytes(32).toString('hex')}`;
        const keyHash = this.hashString(rawKey);
        const keyPrefix = rawKey.substring(0, 16);

        const newKey: ApiKey = {
            id: keyId,
            name: request.name,
            keyHash,
            keyPrefix,
            createdAt: Date.now(),
            createdBy: adminId,
            expiresAt: request.expiresInDays
                ? Date.now() + (request.expiresInDays * 24 * 60 * 60 * 1000)
                : undefined,
            usageCount: 0,
            permissions: request.permissions,
            active: true
        };

        keys.push(newKey);
        this.registry.write(keys);

        // Emit event
        systemBus.emit(SystemProtocol.API_KEY_CREATED, {
            keyId,
            name: request.name,
            createdBy: adminId
        }, 'ApiKeyService');

        console.log(`[ApiKeyService] 🔑 API Key created: ${request.name} (${keyPrefix}...)`);

        return { id: keyId, key: rawKey };
    }

    /**
     * Validate an API key and return its metadata if valid
     */
    public validateKey(rawKey: string): ApiKey | null {
        const keys = this.getAllKeys();
        const keyHash = this.hashString(rawKey);

        const key = keys.find(k => k.keyHash === keyHash);

        if (!key) {
            console.warn('[ApiKeyService] ⚠️ Invalid API key attempted');
            return null;
        }

        // Check if expired
        if (key.expiresAt && Date.now() > key.expiresAt) {
            console.warn(`[ApiKeyService] ⚠️ Expired API key: ${key.name}`);
            return null;
        }

        // Check if active
        if (!key.active) {
            console.warn(`[ApiKeyService] ⚠️ Inactive API key: ${key.name}`);
            return null;
        }

        // Update usage stats
        key.lastUsedAt = Date.now();
        key.usageCount++;
        this.updateKey(key);

        return key;
    }

    /**
     * Check if key has specific permission
     */
    /** Validate schema BEFORE recording usage. The registry transaction keeps
     * the shape/read/usage write on one snapshot; failures roll back. */
    public validateMcpKey(rawKey: string): ApiKey | null {
        return this.registry.transaction(() => {
            this.readActiveKey(''); // Whole-store schema check; no lookup match.
            const key = this.validateKey(rawKey);
            return key ? this.readActiveKey(key.id) : null;
        });
    }

    /** Read-only revalidation for open MCP sessions. Missing/corrupt stores
     * deny rather than retaining admission-time credentials. No usage writes. */
    public readActiveKey(id: string): ApiKey | null {
        const keys: unknown = this.registry.read();
        if (keys === null) return null;
        if (!Array.isArray(keys)) throw new Error('Invalid MCP key store');
        const ids = new Set<string>();
        const hashes = new Set<string>();
        for (const item of keys) {
            const k = item as ApiKey | null;
            if (!k || typeof k.id !== 'string' || !k.id || ids.has(k.id) ||
                typeof k.keyHash !== 'string' || !/^[0-9a-f]{64}$/i.test(k.keyHash) || hashes.has(k.keyHash.toLowerCase()) ||
                typeof k.active !== 'boolean' || !Array.isArray(k.permissions) ||
                k.permissions.some(p => !['tools:read', 'tools:execute', 'resources:read', 'admin:full'].includes(p)) ||
                (k.expiresAt !== undefined && (typeof k.expiresAt !== 'number' || !Number.isFinite(k.expiresAt)))) {
                throw new Error('Invalid MCP key store');
            }
            ids.add(k.id); hashes.add(k.keyHash.toLowerCase());
        }
        const key = (keys as ApiKey[]).find(k => k.id === id);
        return key && key.active && (key.expiresAt === undefined || key.expiresAt > Date.now()) ? key : null;
    }

    public hasPermission(key: ApiKey, permission: ApiKeyPermission): boolean {
        return key.permissions.includes(permission) || key.permissions.includes('admin:full');
    }

    /**
     * Revoke an API key
     */
    public revokeKey(keyId: string): boolean {
        const keys = this.getAllKeys();
        const key = keys.find(k => k.id === keyId);

        if (!key) return false;

        key.active = false;
        this.updateKey(key);

        systemBus.emit(SystemProtocol.API_KEY_REVOKED, {
            keyId,
            name: key.name
        }, 'ApiKeyService');

        console.log(`[ApiKeyService] 🚫 API Key revoked: ${key.name}`);
        return true;
    }

    /**
     * Delete an API key permanently
     */
    public deleteKey(keyId: string): boolean {
        let keys = this.getAllKeys();
        const initialLength = keys.length;
        keys = keys.filter(k => k.id !== keyId);

        if (keys.length === initialLength) return false;

        this.registry.write(keys);
        console.log(`[ApiKeyService] 🗑️ API Key deleted: ${keyId}`);
        return true;
    }

    // ==================== HELPERS ====================

    private getAllKeys(): ApiKey[] {
        return this.registry.read() || [];
    }

    private updateKey(key: ApiKey): void {
        const keys = this.getAllKeys();
        const index = keys.findIndex(k => k.id === key.id);
        if (index !== -1) {
            keys[index] = key;
            this.registry.write(keys);
        }
    }

    private hashString(str: string): string {
        return crypto.createHash('sha256').update(str).digest('hex');
    }

    // ==================== PUBLIC GETTERS ====================

    /**
     * Get all keys (without the hash, for admin listing)
     */
    public listKeys(): Omit<ApiKey, 'keyHash'>[] {
        return this.getAllKeys().map(({ keyHash, ...rest }) => rest);
    }

    /**
     * Get key statistics
     */
    public getStats(): { total: number; active: number; expired: number } {
        const keys = this.getAllKeys();
        const now = Date.now();
        return {
            total: keys.length,
            active: keys.filter(k => k.active && (!k.expiresAt || k.expiresAt > now)).length,
            expired: keys.filter(k => k.expiresAt && k.expiresAt <= now).length
        };
    }
}
