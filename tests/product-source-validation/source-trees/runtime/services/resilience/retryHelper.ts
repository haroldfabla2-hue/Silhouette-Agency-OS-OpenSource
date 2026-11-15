/**
 * RETRY HELPER - Resilient Operation Execution
 * 
 * Provides:
 * 1. Retry with exponential backoff
 * 2. Jitter to prevent thundering herd
 * 3. Configurable retry conditions
 * 4. Timeout support
 * 
 * Part of the Crash-Proof Resilience Layer (Phase 4)
 */

// ==================== INTERFACES ====================

export interface RetryOptions {
    maxRetries: number;          // Maximum retry attempts (default: 3)
    baseDelayMs: number;         // Initial delay in ms (default: 1000)
    maxDelayMs: number;          // Maximum delay cap (default: 30000)
    backoffMultiplier: number;   // Exponential multiplier (default: 2)
    jitterPercent: number;       // Random jitter 0-100 (default: 20)
    timeoutMs?: number;          // Overall timeout (optional)
    retryCondition?: (error: any) => boolean;  // Custom retry condition
}

export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: Error;
    attempts: number;
    totalTimeMs: number;
}

// ==================== DEFAULT OPTIONS ====================

const DEFAULT_OPTIONS: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterPercent: 20
};

// ==================== RETRY HELPER ====================

/**
 * Execute an async function with retry and exponential backoff
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            // Check overall timeout
            if (opts.timeoutMs && Date.now() - startTime > opts.timeoutMs) {
                return {
                    success: false,
                    error: new Error(`Operation timed out after ${opts.timeoutMs}ms`),
                    attempts: attempt,
                    totalTimeMs: Date.now() - startTime
                };
            }

            const result = await fn();
            return {
                success: true,
                result,
                attempts: attempt + 1,
                totalTimeMs: Date.now() - startTime
            };

        } catch (error: any) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Check if we should retry
            if (attempt < opts.maxRetries) {
                // Check custom retry condition
                if (opts.retryCondition && !opts.retryCondition(error)) {
                    console.warn(`[RetryHelper] ⛔ Non-retryable error: ${lastError.message}`);
                    break;
                }

                // Calculate delay with exponential backoff
                const baseDelay = opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt);
                const cappedDelay = Math.min(baseDelay, opts.maxDelayMs);

                // Add jitter
                const jitter = cappedDelay * (opts.jitterPercent / 100) * Math.random();
                const delay = cappedDelay + jitter;

                console.log(`[RetryHelper] ⏳ Attempt ${attempt + 1} failed. Retrying in ${Math.round(delay)}ms...`);
                await sleep(delay);
            }
        }
    }

    return {
        success: false,
        error: lastError,
        attempts: opts.maxRetries + 1,
        totalTimeMs: Date.now() - startTime
    };
}

/**
 * Execute with retry, throwing on failure
 */
export async function withRetryThrow<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<T> {
    const result = await withRetry(fn, options);

    if (!result.success) {
        const error = result.error || new Error('Unknown error');
        error.message = `Failed after ${result.attempts} attempts: ${error.message}`;
        throw error;
    }

    return result.result!;
}

/**
 * Check if error is retryable (default implementation)
 */
export function isRetryableError(error: any): boolean {
    const message = String(error?.message || error).toLowerCase();

    // Non-retryable errors
    const nonRetryable = [
        'invalid',
        'unauthorized',
        'forbidden',
        'not found',
        'validation',
        'schema'
    ];

    for (const keyword of nonRetryable) {
        if (message.includes(keyword)) {
            return false;
        }
    }

    // Retryable errors
    const retryable = [
        'timeout',
        'econnreset',
        'econnrefused',
        'quota',
        'rate limit',
        '429',
        '500',
        '502',
        '503',
        '504',
        'overloaded',
        'capacity'
    ];

    for (const keyword of retryable) {
        if (message.includes(keyword)) {
            return true;
        }
    }

    // Default: retry
    return true;
}

// ==================== UTILITIES ====================

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a timeout wrapper for any promise
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string = 'Operation timed out'
): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${timeoutMessage} after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId!);
    }
}

/**
 * Execute multiple operations with retry, returning all results
 */
export async function withRetryAll<T>(
    fns: (() => Promise<T>)[],
    options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>[]> {
    return Promise.all(fns.map(fn => withRetry(fn, options)));
}
