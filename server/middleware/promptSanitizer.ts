// =============================================================================
// PROMPT SANITIZER MIDDLEWARE
// Protects the LLM from prompt injection attacks by stripping/escaping
// known malicious patterns from user input before it reaches the model.
// =============================================================================

import { Request, Response, NextFunction } from 'express';

// ─── Injection Patterns ─────────────────────────────────────────────────────

const INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
    // Direct instruction override
    { pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directives?)/gi, label: 'instruction_override' },
    { pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi, label: 'instruction_override' },
    { pattern: /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|context)/gi, label: 'instruction_override' },

    // Role hijacking
    { pattern: /you\s+are\s+now\s+(a|an|the)\s+/gi, label: 'role_hijack' },
    { pattern: /pretend\s+(you\s+are|to\s+be|you're)\s+/gi, label: 'role_hijack' },
    { pattern: /act\s+as\s+(if\s+you\s+are|a|an|the)\s+/gi, label: 'role_hijack' },
    { pattern: /from\s+now\s+on\s+(you\s+are|you\s+will|your\s+role)/gi, label: 'role_hijack' },

    // System prompt extraction
    { pattern: /what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions?|rules?|directives?)/gi, label: 'prompt_extraction' },
    { pattern: /show\s+me\s+your\s+(system\s+)?(prompt|instructions?|configuration)/gi, label: 'prompt_extraction' },
    { pattern: /repeat\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?)/gi, label: 'prompt_extraction' },
    { pattern: /print\s+(your|the)\s+(system\s+)?(prompt|instructions?)/gi, label: 'prompt_extraction' },

    // Encoded/obfuscated injections
    { pattern: /\[SYSTEM\s*\]/gi, label: 'fake_system_tag' },
    { pattern: /\[ADMIN\s*\]/gi, label: 'fake_admin_tag' },
    { pattern: /\[OVERRIDE\s*\]/gi, label: 'fake_override_tag' },
    { pattern: /<\s*system\s*>/gi, label: 'fake_xml_system' },

    // Destructive command injection
    { pattern: /rm\s+-rf\s+\//gi, label: 'destructive_command' },
    { pattern: /format\s+[a-z]:\s*/gi, label: 'destructive_command' },
    { pattern: /del\s+\/[sf]\s+/gi, label: 'destructive_command' },
    { pattern: /drop\s+table/gi, label: 'sql_injection' },
    { pattern: /;\s*--\s*/g, label: 'sql_injection' },
];

// ─── Sanitization Logic ─────────────────────────────────────────────────────

export interface SanitizationResult {
    original: string;
    sanitized: string;
    flagged: boolean;
    detections: string[];
}

export function sanitizePrompt(input: string): SanitizationResult {
    let sanitized = input;
    const detections: string[] = [];

    for (const { pattern, label } of INJECTION_PATTERNS) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        if (pattern.test(sanitized)) {
            detections.push(label);
            // Replace the matched pattern with a neutralized version
            pattern.lastIndex = 0;
            sanitized = sanitized.replace(pattern, (match) => {
                // Wrap in quotes to neutralize — the LLM sees it as quoted text, not instruction
                return `"${match}"`;
            });
        }
    }

    return {
        original: input,
        sanitized,
        flagged: detections.length > 0,
        detections
    };
}

// ─── Express Middleware ──────────────────────────────────────────────────────

/**
 * Middleware that sanitizes user messages in chat requests.
 * Looks for message content in common request body shapes:
 * - { message: "..." }
 * - { messages: [{ content: "..." }] }
 * - { prompt: "..." }
 * - { text: "..." }
 */
export function promptSanitizerMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!req.body || typeof req.body !== 'object') {
        return next();
    }

    let totalDetections: string[] = [];

    // Shape 1: { message: string }
    if (typeof req.body.message === 'string') {
        const result = sanitizePrompt(req.body.message);
        req.body.message = result.sanitized;
        totalDetections.push(...result.detections);
    }

    // Shape 2: { prompt: string }
    if (typeof req.body.prompt === 'string') {
        const result = sanitizePrompt(req.body.prompt);
        req.body.prompt = result.sanitized;
        totalDetections.push(...result.detections);
    }

    // Shape 3: { text: string }
    if (typeof req.body.text === 'string') {
        const result = sanitizePrompt(req.body.text);
        req.body.text = result.sanitized;
        totalDetections.push(...result.detections);
    }

    // Shape 4: { messages: [{ content: string }] }
    if (Array.isArray(req.body.messages)) {
        for (const msg of req.body.messages) {
            if (msg && typeof msg.content === 'string') {
                const result = sanitizePrompt(msg.content);
                msg.content = result.sanitized;
                totalDetections.push(...result.detections);
            }
        }
    }

    if (totalDetections.length > 0) {
        const unique = [...new Set(totalDetections)];
        console.warn(`[SANITIZER] ⚠️ Prompt injection detected: [${unique.join(', ')}] from ${req.ip}`);
    }

    next();
}
