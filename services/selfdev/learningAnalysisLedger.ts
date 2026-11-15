import crypto from 'node:crypto';
import { sqliteService } from '../sqliteService';

/** Single exact-input admission across restarts/processes. This record is not
 * model entitlement, a call budget, result truth or permission to run a planner. */
export function admitLearningAnalysis(inputJson: string): { hash: string; cachedResult?: string } {
    const hash = crypto.createHash('sha256').update(inputJson).digest('hex');
    const db = sqliteService.db;
    const read = () => db.prepare('SELECT input_json, state, result_json FROM learning_analysis WHERE input_hash = ?').get(hash) as
        { input_json: string; state: string; result_json: string | null } | undefined;
    const inserted = db.prepare("INSERT OR IGNORE INTO learning_analysis (input_hash,input_json,state) VALUES (?,?,'STARTED')").run(hash, inputJson);
    const row = read();
    if (!row || row.input_json !== inputJson) throw new Error('Analysis admission persistence/conflict unknown');
    if (inserted.changes === 1 && row.state === 'STARTED') return { hash };
    if (row.state === 'COMPLETE' && row.result_json !== null) return { hash, cachedResult: row.result_json };
    throw new Error('Analysis already STARTED: pending/interrupted call UNKNOWN, no automatic retry');
}
export function completeLearningAnalysis(hash: string, resultJson: string): void {
    const db = sqliteService.db;
    const changed = db.prepare("UPDATE learning_analysis SET state='COMPLETE',result_json=? WHERE input_hash=? AND state='STARTED'").run(resultJson, hash);
    const row = db.prepare('SELECT state,result_json FROM learning_analysis WHERE input_hash=?').get(hash) as { state: string; result_json: string } | undefined;
    if (changed.changes !== 1 || !row || row.state !== 'COMPLETE' || row.result_json !== resultJson) {
        throw new Error('Analysis result persistence unknown; no automatic call retry');
    }
}
