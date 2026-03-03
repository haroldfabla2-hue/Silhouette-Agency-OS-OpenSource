/**
 * JANUS REPAIR SCRIPT
 * 
 * Invoked by Janus V2 when a crash signature repeats 3+ times.
 * Uses backgroundLLM (direct Gemini API) to analyze the crash,
 * generate a root-cause diagnosis, and attempt an auto-fix.
 * 
 * Results are stored in logs/ and fed back as Experience to ContinuumMemory.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const CRASH_REPORT_PATH = path.join(process.cwd(), 'logs', 'janus_crash_report.txt');
const FIX_REPORT_PATH = path.join(process.cwd(), 'logs', 'janus_suggested_fix.md');
const ERRORS_LOG_PATH = path.join(process.cwd(), 'logs', 'system_errors.log');

async function main() {
    const signature = process.env.JANUS_CRASH_SIGNATURE || 'unknown';
    console.log(`[JANUS_REPAIR] 🧬 Analyzing crash signature: ${signature}`);

    // Read crash report
    let crashReport: string;
    try {
        crashReport = fs.readFileSync(CRASH_REPORT_PATH, 'utf-8');
    } catch {
        console.error('[JANUS_REPAIR] No crash report found.');
        process.exit(1);
    }

    // Call Gemini for analysis
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('[JANUS_REPAIR] No API key available for analysis.');
        // Still write the report for manual review
        fs.writeFileSync(FIX_REPORT_PATH, `# Janus Crash Analysis\n\n**Signature:** ${signature}\n\n**Status:** Could not auto-analyze (no API key)\n\n## Raw Report\n\`\`\`\n${crashReport}\n\`\`\``);
        process.exit(1);
    }

    try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `You are an expert Node.js/TypeScript debugger for Silhouette Agency OS.
Analyze this crash report and provide:
1. ROOT CAUSE (1-2 sentences)
2. AFFECTED FILE(S) (exact paths if identifiable)
3. SUGGESTED FIX (code patch if possible)
4. CONFIDENCE (0.0 to 1.0)
5. AUTO_APPLICABLE (true/false — true only if the fix is safe and reversible)

CRASH REPORT:
\`\`\`
${crashReport.substring(0, 8000)}
\`\`\`

Respond in this JSON format:
{
  "rootCause": "...",
  "affectedFiles": ["..."],
  "suggestedFix": "...",
  "confidence": 0.0,
  "autoApplicable": false
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt
        });

        const text = response.text || '';
        console.log('[JANUS_REPAIR] LLM Analysis received.');

        // Try to parse JSON from response
        let analysis: any = {};
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                analysis = JSON.parse(jsonMatch[0]);
            }
        } catch {
            analysis = { rootCause: text, confidence: 0.3, autoApplicable: false };
        }

        // Write human-readable fix report
        const fixReport = [
            `# Janus Auto-Repair Report`,
            ``,
            `**Timestamp:** ${new Date().toISOString()}`,
            `**Crash Signature:** ${signature}`,
            `**Confidence:** ${analysis.confidence || 'unknown'}`,
            `**Auto-Applicable:** ${analysis.autoApplicable || false}`,
            ``,
            `## Root Cause`,
            analysis.rootCause || 'Could not determine',
            ``,
            `## Affected Files`,
            (analysis.affectedFiles || []).map((f: string) => `- ${f}`).join('\n') || '- Unknown',
            ``,
            `## Suggested Fix`,
            '```',
            analysis.suggestedFix || 'No fix generated',
            '```',
        ].join('\n');

        fs.writeFileSync(FIX_REPORT_PATH, fixReport);
        console.log(`[JANUS_REPAIR] 📝 Fix report written to ${FIX_REPORT_PATH}`);

        // Feed to system_errors.log for LearningLoop ingestion
        const errorEntry = JSON.stringify({
            timestamp: Date.now(),
            source: 'JANUS_REPAIR',
            signature,
            rootCause: analysis.rootCause,
            confidence: analysis.confidence,
            suggestedFix: analysis.suggestedFix,
            autoApplicable: analysis.autoApplicable
        });

        fs.appendFileSync(ERRORS_LOG_PATH, errorEntry + '\n');
        console.log('[JANUS_REPAIR] 📡 Analysis fed to system_errors.log for LearningLoop.');

        // Auto-apply if confidence is high enough
        if (analysis.autoApplicable && analysis.confidence >= 0.8 && analysis.affectedFiles?.length === 1) {
            console.log('[JANUS_REPAIR] ⚡ High confidence auto-applicable fix detected.');
            console.log('[JANUS_REPAIR] ⚠️ Auto-apply deferred to LearningLoop for safety.');
            // We intentionally do NOT auto-write to files from Janus.
            // The LearningLoop will pick up the fix from system_errors.log 
            // and apply it through its own verified pipeline.
        }

    } catch (error: any) {
        console.error('[JANUS_REPAIR] Analysis failed:', error.message);
        fs.writeFileSync(FIX_REPORT_PATH, `# Janus Crash Analysis\n\n**Signature:** ${signature}\n\n**Status:** LLM analysis failed: ${error.message}\n\n## Raw Report\n\`\`\`\n${crashReport.substring(0, 5000)}\n\`\`\``);
    }
}

main().catch(console.error);
