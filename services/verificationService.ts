
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export class VerificationService {

    /**
     * Runs the System Validation Suite.
     * Current checks:
     * 1. TypeScript Compilation (check for syntax/type errors)
     */
    public async validate(): Promise<{ success: boolean; errors?: string[] }> {
        console.log("[VerificationService] 🕵️ Starting Code Audit...");

        try {
            // Check 1: TypeScript Compiler (No Emit - just check types)
            // Using npx to use local tsc if available
            console.log("[VerificationService] ⏳ Running 'tsc --noEmit'...");
            await execAsync('npx tsc --noEmit', { cwd: process.cwd() });

            console.log("[VerificationService] ✅ Code Integrity Verified.");
            return { success: true };

        } catch (error: any) {
            console.error("[VerificationService] ❌ Validation Failed.");

            // Extract stdout/stderr which contains the compiler errors
            const compilerOutput = error.stdout || error.stderr || error.message;
            const lines = compilerOutput.toString().split('\n').filter((l: string) => l.trim().length > 0);

            return {
                success: false,
                errors: lines.slice(0, 10) // Return top 10 errors to avoid flooding
            };
        }
    }
}

export const verificationService = new VerificationService();
