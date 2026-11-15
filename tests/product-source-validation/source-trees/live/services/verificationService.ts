
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
            // Check 1: TypeScript Compiler (No Emit - check types)
            console.log("[VerificationService] ⏳ Running 'npm run typecheck'...");
            await execAsync('npm run typecheck', { cwd: process.cwd() });

            // Check 2: Run Unit Tests to prevent logical regressions
            console.log("[VerificationService] ⏳ Running 'npm run test'...");
            await execAsync('npm run test', { cwd: process.cwd() });

            console.log("[VerificationService] ✅ Code Integrity Verified.");
            return { success: true };

        } catch (error: any) {
            console.error("[VerificationService] ❌ Validation Failed.");

            // Extract stdout/stderr which contains the audit/test errors
            const output = error.stdout || error.stderr || error.message;
            const lines = output.toString().split('\n').filter((l: string) => l.trim().length > 0);

            return {
                success: false,
                errors: lines.slice(0, 15) // Return top 15 errors to avoid flooding
            };
        }
    }
}

export const verificationService = new VerificationService();
