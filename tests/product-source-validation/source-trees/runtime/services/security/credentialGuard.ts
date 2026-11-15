
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export class CredentialError extends Error {
    constructor(public keyName: string, public serviceName: string) {
        super(`Missing credential: ${keyName} for ${serviceName}`);
        this.name = 'CredentialError';
    }
}

export class CredentialGuard {
    /**
     * Safely executes a function that requires credentials.
     * If a credential is missing (or a specific error is caught), it emits a MISSING_CREDENTIAL event.
     * @param serviceName The name of the service (e.g., 'GoogleDrive')
     * @param keyName The name of the environment variable (e.g., 'GOOGLE_DRIVE_CLIENT_ID')
     * @param operation The async operation to perform
     * @param fallback Optional fallback value to return on failure
     */
    static async protect<T>(
        serviceName: string,
        keyName: string,
        operation: () => Promise<T>,
        fallback?: T
    ): Promise<T | undefined> {
        try {
            // Check if key exists in env (basic check)
            // Note: In client-side logic, this might assume the key should be injected or available in config.
            // For backend/server-side, process.env is standard.
            // If the operation purely fails on missing key logic inside it, the catch block handles it.

            return await operation();
        } catch (error: any) {
            // Check if it's a known credential issue or generic
            if (error instanceof CredentialError ||
                error.message?.includes('auth') ||
                error.message?.includes('credential') ||
                error.message?.includes('key') ||
                error.message?.includes('token')) {

                console.warn(`[CREDENTIAL GUARD] 🛡️ Caught missing credential for ${serviceName}`);

                systemBus.emit(SystemProtocol.MISSING_CREDENTIAL, {
                    service: serviceName,
                    key: keyName,
                    message: error.message
                });

                if (fallback !== undefined) return fallback;
                return undefined;
            }

            // Re-throw if it's a real logic error not related to auth
            throw error;
        }
    }

    /**
     * Checks if a key exists and returns it, or throws a controlled CredentialError
     */
    static ensureKey(key: string | undefined, keyName: string, serviceName: string): string {
        if (!key || key.trim() === '') {
            throw new CredentialError(keyName, serviceName);
        }
        return key;
    }
}
