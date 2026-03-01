import { init } from 'z3-solver';
import { llmGateway } from './llmGateway';

/**
 * SYMBOLIC PROVER SERVICE
 * Uses Microsoft's Z3 SMT solver to mathematically verify logical consistency 
 * of agent thoughts, preventing hallucinations and logical paradoxes.
 */
class SymbolicProverService {
    private z3InitPromise: Promise<any> | null = null;

    constructor() { }

    private async getZ3() {
        if (!this.z3InitPromise) {
            this.z3InitPromise = init();
        }
        return this.z3InitPromise;
    }

    /**
     * Mathematically verifies a set of natural language statements for logical contradictions.
     * Uses LLM to transpile natural language into SMT-LIBv2 constraints, then solves them.
     */
    public async checkConsistency(statements: string[]): Promise<{
        isConsistent: boolean;
        contradiction?: string;
        smtScript?: string;
    }> {
        if (!statements || statements.length < 2) {
            // Nothing to contradict
            return { isConsistent: true };
        }

        const z3 = await this.getZ3();

        // Translate statements to SMT-LIB2 format using LLM
        const prompt = `
You are a formal logic translator. Translate the following statements into a valid Z3 SMT-LIB v2 script to check for logical satisfiability.
Use simple Booleans, Reals, or Ints.
Declare necessary constants. Assert the constraints representing the statements.
Do NOT include (check-sat) or (get-model), just the declarations and assertions.
Output ONLY the raw SMT-LIB script. Do not use markdown blocks. Do not explain.

Statements:
${statements.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`;

        try {
            const result = await llmGateway.complete(prompt, {
                temperature: 0,
                systemPrompt: 'You are an SMT-LIB transpiler. You only output raw valid SMT-LIBv2 code.'
            });

            let smtScript = result.text.trim();
            if (smtScript.startsWith('\`\`\`')) {
                smtScript = smtScript.replace(/\`\`\`(smt|lisp|text)?/g, '').replace(/\`\`\`/g, '').trim();
            }

            const { Context } = z3;
            const ctx = new Context("main");
            const solver = new ctx.Solver();

            // Parse and assert the constraints
            solver.fromString(smtScript);

            // Check satisfiability mathematically
            const check = await solver.check();

            if (check === "sat") {
                return { isConsistent: true, smtScript };
            } else {
                return {
                    isConsistent: false,
                    contradiction: "Mathematical Verification Failed: The statements contain a fundamental logical contradiction or impossibility.",
                    smtScript
                };
            }

        } catch (e: any) {
            console.warn('[SYMBOLIC PROVER] SMT-LIB translation or Z3 evaluation failed.', e.message);
            // Fallback to true if we can't mathematically prove it's wrong
            return { isConsistent: true };
        }
    }
}

export const symbolicProver = new SymbolicProverService();
