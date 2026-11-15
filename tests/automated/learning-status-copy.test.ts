/** Authored offline-copy inspection. No product runtime, provider, real unknown
 * operation, legitimate verifier authority or useful repair is demonstrated. */
import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { canonicalLearningAnalysisInput } from '../../services/selfdev/learningAnalysisInput';
it('surfaces unknown and legacy causes from supplied copies without reset or source rewrite', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-status-authored-'));
    const database = path.join(root, 'provided-copy.sqlite'), cycles = path.join(root, 'provided-cycles.json');
    const digest = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    try {
        const db = new Database(database);
        try {
            db.exec(fs.readFileSync(path.resolve('db/migrations/sqlite/005_learning_analysis.up.sql'), 'utf8'));
            const input = canonicalLearningAnalysisInput('continuum-promote', [{ id: 'incident:episode',
                incident: { id: 'episode', source: 'continuum-promote', firstSeen: 12 }, timestamp: 12,
                context: 'continuum-promote', action: 'Observe authored episode', error: 'PRIVATE_ERROR_SENTINEL_NOT_FOR_OUTPUT', source: 'SYSTEM' }]);
            const hash = crypto.createHash('sha256').update(input).digest('hex');
            db.prepare("INSERT INTO learning_analysis(input_hash,input_json,state) VALUES (?,?,'STARTED')").run(hash, input);
        } finally { db.close(); }
        fs.writeFileSync(cycles, JSON.stringify({ cycles: [{ id: 'legacy-cycle', state: 'PROPOSAL_PENDING',
            learningProposal: { memoryId: 'legacy-memory', incidentId: 'episode', source: 'continuum-promote', applied: false } }] }));
        const before = [digest(database), digest(cycles)];
        const script = path.resolve('scripts/selfdev-learning-status.mjs');
        const output = execFileSync(process.execPath, [script, '--db-copy', database, '--cycles-copy', cycles, '--copy-state', 'quiescent'], { encoding: 'utf8', timeout: 10000 });
        expect(output).not.toContain('PRIVATE_ERROR_SENTINEL_NOT_FOR_OUTPUT');
        const report = JSON.parse(output);
        expect(report).toMatchObject({ authority: 'UNESTABLISHED', executionPermitted: false, applied: false, copyConsistency: 'UNKNOWN_NOT_AUTHENTICATED' });
        expect(report.analysis.records[0]).toMatchObject({ status: 'UNKNOWN_PENDING_OR_INTERRUPTED', incidentIds: ['episode'], relatedStoredCycleIds: ['legacy-cycle'] });
        expect(report.cycles.records[0]).toMatchObject({ status: 'LEGACY_OR_INVALID_PROVENANCE_REVIEW_REQUIRED', executionPermitted: false, applied: false });
        expect([digest(database), digest(cycles)]).toEqual(before);
        const unconfigured = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 }));
        expect(unconfigured.analysis.status).toBe('UNAVAILABLE');
        expect(unconfigured.cycles.status).toBe('UNAVAILABLE');
        expect([digest(database), digest(cycles)]).toEqual(before);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
