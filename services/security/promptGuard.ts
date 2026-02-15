/**
 * PROMPT GUARD - COGNITIVE HARDENING
 * ═══════════════════════════════════════════════════════════════
 * Firewall for incoming user prompts to prevent injection attacks.
 * 
 * Capabilities:
 * 1. Regex-based pattern matching for common jailbreaks.
 * 2. Sanity check for system override attempts.
 * 3. Logging of security events.
 */

import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface GuardResult {
    safe: boolean;
    reason?: string;
    sanitizedPrompt?: string;
}

export class PromptGuard {
    private static instance: PromptGuard;

    // Known Jailbreak Patterns (DAN, Developer Mode, etc.)
    private unsafePatterns = [
        /ignore previous instructions/i,
        /ignore all instructions/i,
        /system override/i,
        /you are now a/i,
        /act as a hacked/i,
        /developer mode/i,
        /disable ethical/i,
        /security protocols disabled/i,
        /god mode/i
    ];

    private constructor() { }

    public static getInstance(): PromptGuard {
        if (!PromptGuard.instance) {
            PromptGuard.instance = new PromptGuard();
        }
        return PromptGuard.instance;
    }

    /**
     * Inspect and sanitize a prompt.
     */
    public inspect(prompt: string): GuardResult {
        if (!prompt) return { safe: true, sanitizedPrompt: "" };

        // 1. Check for unsafe patterns
        for (const pattern of this.unsafePatterns) {
            if (pattern.test(prompt)) {
                console.warn(`[GUARD] 🛡️ Injection Attempt Detected: ${pattern}`);

                // Emit Security Alert
                systemBus.emit(SystemProtocol.SECURITY_ALERT, {
                    source: 'PromptGuard',
                    threat: 'INJECTION_ATTEMPT',
                    details: `Pattern matched: ${pattern}`
                });

                return {
                    safe: false,
                    reason: `Security Injection Detected: ${pattern}`
                };
            }
        }

        // 2. Heuristic Checks (Length, entropy - placeholder)

        return {
            safe: true,
            sanitizedPrompt: prompt.trim()
        };
    }
}

export const promptGuard = PromptGuard.getInstance();
