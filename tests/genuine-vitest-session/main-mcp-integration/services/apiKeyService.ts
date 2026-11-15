/** Production singleton facade. Existing SQLite guards remain authoritative. */
import { sqliteService } from './sqliteService';
import { hashPassword, verifyPassword } from '../server/utils/password';
import { ApiKeyService, type ApiKey } from './mcpKeyService';
export type { ApiKey, ApiKeyPermission, ApiKeyCreateRequest } from './mcpKeyService';
const registry = {
    read: (): unknown => sqliteService.getConfig('mcp_api_keys'),
    write: (keys: ApiKey[]): void => sqliteService.setConfig('mcp_api_keys', keys),
    transaction: <T>(body: () => T): T => sqliteService.db.transaction(body)(),
};
class ProductionApiKeyService extends ApiKeyService {
    // ==================== ADMIN VERIFICATION ====================

    /**
     * Set admin password (first time setup or reset)
     */
    public setAdminPassword(password: string): void {
        // Salted scrypt (see server/utils/password.ts) instead of unsalted SHA-256.
        sqliteService.setConfig('admin_password_hash', hashPassword(password));
        console.log('[ApiKeyService] ✅ Admin password set');
    }

    /**
     * Verify admin password (supports legacy SHA-256 hashes + transparent upgrade)
     */
    public verifyAdminPassword(password: string): boolean {
        const storedHash = sqliteService.getConfig('admin_password_hash');
        if (!storedHash) {
            // No password set - first time setup
            return false;
        }
        const { valid, needsUpgrade } = verifyPassword(password, storedHash);
        if (valid && needsUpgrade) {
            try { sqliteService.setConfig('admin_password_hash', hashPassword(password)); } catch { /* best-effort */ }
        }
        return valid;
    }

    /**
     * Check if admin password is configured
     */
    public isAdminConfigured(): boolean {
        return !!sqliteService.getConfig('admin_password_hash');
    }

}
export const apiKeyService = new ProductionApiKeyService(registry);
