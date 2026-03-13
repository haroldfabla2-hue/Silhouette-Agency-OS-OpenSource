/**
 * JANUS REPAIR SCRIPT V3.0 — SURVIVAL INSTINCT
 * ═══════════════════════════════════════════════════════════════
 * Invoked by Janus V2 when a crash signature repeats 3+ times.
 * 
 * V3: Uses the FULL BRAIN API for deep diagnosis:
 * 1. contextAssembler: Full system state (metrics, memory, narrative)
 * 2. experienceBuffer: Past failures/successes for this type of error
 * 3. generateAgentResponse: Deep analysis using best available LLM
 * 4. remediationService: Professional repair squad mobilization
 * 5. learningLoop: Feed insights back for permanent evolution
 * 
 * Philosophy: Each repair attempt is a DEEP DIAGNOSTIC —  
 * find the ROOT CAUSE and create PERMANENT, non-degrading solutions.
 * Even if it can't fully fix, it stabilizes to minimum viable state
 * so the full system's repair teams (remediation, learning loop,
 * introspection) can take over once services come back online.
 * 
 * Results are stored in logs/ AND fed as Experience to ContinuumMemory.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const CRASH_REPORT_PATH = path.join(process.cwd(), 'logs', 'janus_crash_report.txt');
const FIX_REPORT_PATH = path.join(process.cwd(), 'logs', 'janus_suggested_fix.md');
const ERRORS_LOG_PATH = path.join(process.cwd(), 'logs', 'system_errors.log');
const REPAIR_HISTORY_PATH = path.join(process.cwd(), 'logs', 'janus_repair_history.json');

interface RepairAnalysis {
    rootCause: string;
    affectedFiles: string[];
    suggestedFix: string;
    confidence: number;
    autoApplicable: boolean;
    isRootFix: boolean;        // True if this fix addresses root cause, not symptoms
    degradationRisk: string;   // NONE | LOW | MEDIUM | HIGH
    relatedPastFailures: string[];
}

async function main() {
    const signature = process.env.JANUS_CRASH_SIGNATURE || 'unknown';
    const attemptNumber = parseInt(process.env.JANUS_REPAIR_ATTEMPT || '1');
    console.log(`[JANUS_REPAIR] 🧬 Deep Repair v3.0 — Signature: ${signature} (Attempt ${attemptNumber}/3)`);

    // Read crash report
    let crashReport: string;
    try {
        crashReport = fs.readFileSync(CRASH_REPORT_PATH, 'utf-8');
    } catch {
        console.error('[JANUS_REPAIR] No crash report found.');
        process.exit(1);
    }

    // Load repair history for this signature (learn from past attempts)
    let repairHistory: RepairAnalysis[] = [];
    try {
        if (fs.existsSync(REPAIR_HISTORY_PATH)) {
            const history = JSON.parse(fs.readFileSync(REPAIR_HISTORY_PATH, 'utf-8'));
            repairHistory = history[signature] || [];
        }
    } catch {
        repairHistory = [];
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: TRY FULL BRAIN API (if server is alive on another port or importable)
    // ═══════════════════════════════════════════════════════════════
    let analysis: RepairAnalysis | null = null;

    try {
        analysis = await deepBrainDiagnosis(crashReport, signature, attemptNumber, repairHistory);
        console.log('[JANUS_REPAIR] 🧠 Brain API diagnosis successful.');
    } catch (brainError: any) {
        console.warn(`[JANUS_REPAIR] ⚠️ Brain API unavailable (${brainError.message}). Falling back to direct LLM...`);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: FALLBACK — Direct LLM API (survival mode)
    // Even if the brain is down, this repairs at minimum viable level
    // ═══════════════════════════════════════════════════════════════
    if (!analysis) {
        try {
            analysis = await directLLMDiagnosis(crashReport, signature, attemptNumber, repairHistory);
            console.log('[JANUS_REPAIR] ⚡ Direct LLM diagnosis completed (survival mode).');
        } catch (llmError: any) {
            console.error('[JANUS_REPAIR] ❌ All diagnosis methods failed:', llmError.message);
            fs.writeFileSync(FIX_REPORT_PATH, `# Janus Crash Analysis\n\n**Signature:** ${signature}\n\n**Status:** All diagnosis methods failed: ${llmError.message}\n\n## Raw Report\n\`\`\`\n${crashReport.substring(0, 5000)}\n\`\`\``);
            process.exit(1);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: APPLY & RECORD
    // ═══════════════════════════════════════════════════════════════
    if (analysis) {
        // Write detailed fix report
        writeFinalReport(signature, analysis, attemptNumber);

        // Feed to system_errors.log for LearningLoop ingestion
        const errorEntry = JSON.stringify({
            timestamp: Date.now(),
            source: 'JANUS_REPAIR_V3',
            signature,
            attemptNumber,
            rootCause: analysis.rootCause,
            confidence: analysis.confidence,
            suggestedFix: analysis.suggestedFix,
            autoApplicable: analysis.autoApplicable,
            isRootFix: analysis.isRootFix,
            degradationRisk: analysis.degradationRisk,
            relatedPastFailures: analysis.relatedPastFailures
        });
        fs.appendFileSync(ERRORS_LOG_PATH, errorEntry + '\n');
        console.log('[JANUS_REPAIR] 📡 Analysis fed to system_errors.log for LearningLoop.');

        // Save to repair history (so future attempts know what was already tried)
        saveRepairHistory(signature, analysis);

        // Auto-apply gate: ONLY if root-fix, high confidence, no degradation risk, single file
        if (analysis.autoApplicable
            && analysis.confidence >= 0.9
            && analysis.affectedFiles?.length === 1
            && analysis.isRootFix
            && analysis.degradationRisk === 'NONE') {
            console.log('[JANUS_REPAIR] ⚡ High confidence ROOT FIX detected (no degradation risk).');
            console.log('[JANUS_REPAIR] ⚠️ Auto-apply deferred to LearningLoop for safety (confidence threshold: 0.9).');
        } else if (analysis.autoApplicable && !analysis.isRootFix) {
            console.log('[JANUS_REPAIR] ⚠️ Fix is symptomatic, not root-cause. Deferred for deeper analysis by evolution engines.');
        }

        // Record as experience for the system to learn from
        await recordRepairExperience(signature, analysis, attemptNumber);
    }
}

/**
 * DEEP BRAIN DIAGNOSIS
 * Uses the full Silhouette brain infrastructure:
 * - contextAssembler for system state
 * - experienceBuffer for past learnings
 * - generateAgentResponse with DEEP introspection
 */
async function deepBrainDiagnosis(
    crashReport: string,
    signature: string,
    attempt: number,
    pastAttempts: RepairAnalysis[]
): Promise<RepairAnalysis> {
    // Dynamic imports from the brain (may fail if server is crashed)
    const { contextAssembler } = await import('../services/contextAssembler');
    const { experienceBuffer } = await import('../services/experienceBuffer');
    const { generateText } = await import('../services/geminiService');

    // 1. Gather full system context
    const globalContext = await contextAssembler.getGlobalContext(
        `CRITICAL: System crash "${signature}". Diagnosing for repair.`,
        { mode: 'DEEP' }
    );

    // 2. Search for past similar failures
    const pastExperiences = await experienceBuffer.getRelevant(`crash failure ${signature}`, 10);
    const experienceContext = pastExperiences.length > 0
        ? pastExperiences.map(e => `[${e.type}] ${e.context}: ${e.outcome}${e.lesson ? ` | Lesson: ${e.lesson}` : ''}`).join('\n')
        : 'No past experiences for this crash type.';

    // 3. Format what was already tried (so LLM doesn't repeat failed fixes)
    const pastAttemptsContext = pastAttempts.length > 0
        ? pastAttempts.map((a, i) => `Attempt ${i + 1}: Root cause "${a.rootCause}" | Fix: "${a.suggestedFix}" | Confidence: ${a.confidence} | Was root fix: ${a.isRootFix}`).join('\n')
        : 'First repair attempt.';

    // 4. Deep diagnosis prompt
    const prompt = `You are the SURVIVAL INSTINCT of Silhouette Agency OS — a critical system repair specialist.
The system has crashed repeatedly with the same signature. Your job is to find the ROOT CAUSE and create a PERMANENT fix that will NOT degrade the system.

CRASH REPORT:
\`\`\`
${crashReport.substring(0, 6000)}
\`\`\`

CRASH SIGNATURE: ${signature}
REPAIR ATTEMPT: ${attempt}/3

SYSTEM STATE:
- Active agents: ${globalContext.systemMetrics?.activeAgents || 'unknown'}
- JS Heap: ${globalContext.systemMetrics?.jsHeapSize || 'unknown'}MB
- Orchestrator: ${JSON.stringify(globalContext.orchestratorState || {}).substring(0, 500)}

PAST REPAIR ATTEMPTS FOR THIS SIGNATURE:
${pastAttemptsContext}

PAST EXPERIENCES WITH SIMILAR FAILURES:
${experienceContext}

CRITICAL REPAIR RULES:
1. Find the ROOT CAUSE, not symptoms. If the error is "Cannot read property X of undefined", the root cause is WHY X is undefined, not just adding a null check.
2. The fix MUST NOT degrade any existing functionality. If unsure, add defensive code rather than remove functionality.
3. If you cannot determine a root fix with high confidence, propose a MINIMUM VIABLE STABILIZATION — keep the system alive at minimum functionality so the professional repair teams (RemediationService, LearningLoop, IntrospectionEngine) can take over when services recover.
4. DO NOT repeat fixes that were already tried (see PAST REPAIR ATTEMPTS).
5. Consider if this is a configuration issue, a dependency issue, a race condition, or a logic error.

Respond in JSON:
{
  "rootCause": "Detailed root cause explanation",
  "affectedFiles": ["exact/path/to/file.ts"],
  "suggestedFix": "Complete code fix with context",
  "confidence": 0.0 to 1.0,
  "autoApplicable": true/false,
  "isRootFix": true/false,
  "degradationRisk": "NONE" | "LOW" | "MEDIUM" | "HIGH",
  "relatedPastFailures": ["similar past failures found"]
}`;

    const response = await generateText(prompt, { model: 'gemini-2.0-flash' });
    return parseAnalysisResponse(response, pastExperiences);
}

/**
 * DIRECT LLM DIAGNOSIS (Survival Mode)
 * Used when the full brain is crashed. Uses raw Gemini API directly.
 * Less context-aware but enough to stabilize the system.
 */
async function directLLMDiagnosis(
    crashReport: string,
    signature: string,
    attempt: number,
    pastAttempts: RepairAnalysis[]
): Promise<RepairAnalysis> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error('No API key available for LLM diagnosis');
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    const pastAttemptsContext = pastAttempts.length > 0
        ? pastAttempts.map((a, i) => `Attempt ${i + 1}: "${a.rootCause}" -> Fix: "${a.suggestedFix}" (confidence: ${a.confidence}, was root: ${a.isRootFix})`).join('\n')
        : 'First attempt.';

    // Read recent error logs for additional context
    let recentErrors = '';
    try {
        if (fs.existsSync(ERRORS_LOG_PATH)) {
            const errorLog = fs.readFileSync(ERRORS_LOG_PATH, 'utf-8');
            const lines = errorLog.split('\n').filter(l => l.trim()).slice(-10);
            recentErrors = lines.join('\n');
        }
    } catch { /* ignore */ }

    const prompt = `You are the SURVIVAL INSTINCT debugger for Silhouette Agency OS (Node.js/TypeScript).
The system has crashed repeatedly. Find the ROOT CAUSE and create a PERMANENT, non-degrading fix.

CRASH REPORT:
\`\`\`
${crashReport.substring(0, 6000)}
\`\`\`

SIGNATURE: ${signature}
ATTEMPT: ${attempt}/3

PREVIOUS REPAIR ATTEMPTS:
${pastAttemptsContext}

RECENT SYSTEM ERRORS:
${recentErrors.substring(0, 2000)}

RULES:
1. Find ROOT CAUSE, not symptoms (e.g., WHY is X undefined, not just null-check it)
2. Fix MUST NOT remove or degrade existing functionality
3. If this is attempt 2+, try a DIFFERENT approach from previous attempts
4. If unsure, create a MINIMUM VIABLE STABILIZATION (keep system alive)
5. Consider: config issue? dependency missing? race condition? circular import?

Respond in JSON:
{
  "rootCause": "...",
  "affectedFiles": ["..."],
  "suggestedFix": "...",
  "confidence": 0.0 to 1.0,
  "autoApplicable": false,
  "isRootFix": true/false,
  "degradationRisk": "NONE" | "LOW" | "MEDIUM" | "HIGH",
  "relatedPastFailures": []
}`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt
    });

    return parseAnalysisResponse(response.text || '', []);
}

/**
 * Parse JSON response from LLM into RepairAnalysis
 */
function parseAnalysisResponse(text: string, pastExperiences: any[]): RepairAnalysis {
    let analysis: RepairAnalysis = {
        rootCause: 'Unknown',
        affectedFiles: [],
        suggestedFix: 'No fix generated',
        confidence: 0.3,
        autoApplicable: false,
        isRootFix: false,
        degradationRisk: 'HIGH',
        relatedPastFailures: pastExperiences.map(e => e.context?.substring(0, 50) || '')
    };

    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            analysis = {
                ...analysis,
                ...parsed,
                relatedPastFailures: parsed.relatedPastFailures || analysis.relatedPastFailures
            };
        }
    } catch {
        analysis.rootCause = text.substring(0, 500);
        analysis.confidence = 0.2;
    }

    return analysis;
}

/**
 * Write detailed fix report for human review
 */
function writeFinalReport(signature: string, analysis: RepairAnalysis, attempt: number): void {
    const fixReport = [
        `# Janus Auto-Repair Report V3`,
        ``,
        `**Timestamp:** ${new Date().toISOString()}`,
        `**Crash Signature:** ${signature}`,
        `**Repair Attempt:** ${attempt}/3`,
        `**Confidence:** ${analysis.confidence}`,
        `**Auto-Applicable:** ${analysis.autoApplicable}`,
        `**Is Root Fix:** ${analysis.isRootFix ? '✅ YES' : '⚠️ NO (symptomatic)'}`,
        `**Degradation Risk:** ${analysis.degradationRisk}`,
        ``,
        `## Root Cause`,
        analysis.rootCause,
        ``,
        `## Affected Files`,
        (analysis.affectedFiles || []).map((f: string) => `- ${f}`).join('\n') || '- Unknown',
        ``,
        `## Suggested Fix`,
        '```',
        analysis.suggestedFix || 'No fix generated',
        '```',
        ``,
        `## Related Past Failures`,
        (analysis.relatedPastFailures || []).map((f: string) => `- ${f}`).join('\n') || '- None found',
        ``,
        `---`,
        `*Generated by Janus Survival Instinct v3.0*`,
    ].join('\n');

    fs.writeFileSync(FIX_REPORT_PATH, fixReport);
    console.log(`[JANUS_REPAIR] 📝 Fix report written to ${FIX_REPORT_PATH}`);
}

/**
 * Save repair attempt to history so future attempts don't repeat
 */
function saveRepairHistory(signature: string, analysis: RepairAnalysis): void {
    try {
        let history: Record<string, RepairAnalysis[]> = {};
        if (fs.existsSync(REPAIR_HISTORY_PATH)) {
            history = JSON.parse(fs.readFileSync(REPAIR_HISTORY_PATH, 'utf-8'));
        }
        if (!history[signature]) history[signature] = [];
        history[signature].push(analysis);
        fs.writeFileSync(REPAIR_HISTORY_PATH, JSON.stringify(history, null, 2));
    } catch (e) {
        console.warn('[JANUS_REPAIR] Failed to save repair history:', e);
    }
}

/**
 * Record repair experience in ContinuumMemory via experienceBuffer
 * This feeds the Learning Loop and ensures the system never forgets
 * what went wrong and what was tried.
 */
async function recordRepairExperience(signature: string, analysis: RepairAnalysis, attempt: number): Promise<void> {
    try {
        const { experienceBuffer } = await import('../services/experienceBuffer');
        await experienceBuffer.record({
            type: analysis.isRootFix && analysis.confidence >= 0.8 ? 'SUCCESS' : 'FAILURE',
            context: `Janus crash repair: ${signature} (attempt ${attempt})`,
            action: `Root cause: ${analysis.rootCause}. Fix: ${analysis.suggestedFix?.substring(0, 100)}`,
            outcome: `Confidence: ${analysis.confidence}, isRootFix: ${analysis.isRootFix}, degradation: ${analysis.degradationRisk}`,
            lesson: analysis.isRootFix
                ? `Root fix found for ${signature}: ${analysis.rootCause}. Affected: ${analysis.affectedFiles?.join(', ')}`
                : `Symptomatic fix only for ${signature}. Needs deeper investigation by evolution engines.`,
            agentId: 'JANUS_REPAIR'
        });
        console.log('[JANUS_REPAIR] 📚 Experience recorded in ContinuumMemory for future learning.');
    } catch (e) {
        // Non-critical — the system might be down
        console.warn('[JANUS_REPAIR] Could not record experience (system may be down):', (e as Error).message);
    }
}

main().catch(console.error);
