/**
 * [W3] Anti-theater gate.
 *
 * Factory fire test: PLAN_EXECUTOR ran 5/5 steps, the workflow emitted
 * COMPLETE, and the project workspace held zero squad-written files.
 * Simulated success is the one failure mode this system may not have.
 *
 * The gate is plan-level (per the approved design): when any step declared
 * file-producing work and the jail recorded ZERO verified writes across the
 * whole plan, the plan CANNOT be reported as completed. Default: strict.
 * SILHOUETTE_ANTI_THEATER=off disables (operator escape hatch, audited by
 * its mere presence in env).
 */
export function antiTheaterEnabled(): boolean {
    return (process.env.SILHOUETTE_ANTI_THEATER || 'strict').toLowerCase() !== 'off';
}

export interface HonestyVerdict {
    pass: boolean;
    error?: string;
}

export function evaluatePlanHonesty(declaredFileWork: boolean, artifactsProduced: number): HonestyVerdict {
    if (!antiTheaterEnabled()) return { pass: true };
    if (declaredFileWork && artifactsProduced === 0) {
        return {
            pass: false,
            error: 'ANTI_THEATER: the plan declared file-producing work but zero verified writes were recorded. Reporting honest FAILURE instead of simulated completion. Either the agents lacked working tools, the jail denied every write (see fs-audit journal), or the plan was prose-only by nature and should not have declared file work.'
        };
    }
    return { pass: true };
}
