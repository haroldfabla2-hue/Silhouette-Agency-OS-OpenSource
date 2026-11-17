import crypto from 'node:crypto';
import path from 'node:path';
export interface BaselineEvaluation {
    version: 1; target: string; oracleSha256: string; closureSha256: string; baselineExit: number;
    baselineTests: number; candidateExit?: number; oracleUnchanged?: boolean;
    verdict: 'pending' | 'regression' | 'improved' | 'preserved' | 'oracle-changed';
}
export function canonicalEvaluationPath(input: string): string {
    if (typeof input !== 'string' || !input || input.includes('\\') || input.includes('\0') || path.posix.isAbsolute(input)) throw new Error('invalid evaluation path');
    const canonical = path.posix.normalize(input);
    if (canonical === '..' || canonical.startsWith('../') || canonical === '.') throw new Error('evaluation path escapes');
    return canonical;
}
export function oracleDigest(content: string | Buffer): string { return crypto.createHash('sha256').update(content).digest('hex'); }
export function compareBaseline(baseline: BaselineEvaluation, currentOracle: string, candidateExit: number, closureSha256 = baseline.closureSha256): BaselineEvaluation {
    if (!Number.isInteger(candidateExit) || !Number.isInteger(baseline.baselineExit) || !(baseline.baselineTests > 0)) throw new Error('evaluation requires meaningful baseline');
    const oracleUnchanged = oracleDigest(currentOracle) === baseline.oracleSha256 && closureSha256 === baseline.closureSha256;
    return { ...baseline, candidateExit, oracleUnchanged,
        verdict: !oracleUnchanged ? 'oracle-changed' : candidateExit !== 0 ? 'regression' : baseline.baselineExit === 0 ? 'preserved' : 'improved' };
}
export function evaluationScopeFailure(paths: string[], target: string): string | undefined {
    let canonical: string[], oracle: string;
    try { canonical = paths.map(canonicalEvaluationPath); oracle = canonicalEvaluationPath(target); }
    catch { return 'EVALUATION_ORACLE_SCOPE: invalid or escaping path'; }
    const protectedPath = (p: string) => p === oracle || /(^|\/)(?:package(?:-lock)?\.json|(?:vitest|vite|tsconfig)[^/]*|\.npmrc)$/.test(p) ||
        /(^|\/)(?:tests?|__tests__|fixtures?|scripts|\.github)\//.test(p) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p) ||
        !/^(?:services|server|tools|utils)\/.+\.[cm]?[jt]sx?$/.test(p);
    return canonical.some(protectedPath) ? 'EVALUATION_ORACLE_SCOPE: candidate touches protected evaluation/test-runner paths' : undefined;
}
