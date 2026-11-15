#!/usr/bin/env node
/** Offline operator status on ALREADY PROVIDED disposable private copies only.
 * Never point at live/original DB or cycle files. Operator must quiesce and
 * copy DB with matching WAL before invoking; this command makes no copy and
 * cannot authenticate that provenance. Native SQLite may create copy sidecars.
 * Usage: node scripts/selfdev-learning-status.mjs --db-copy PATH --cycles-copy PATH --copy-state quiescent
 * No product-service imports, migration, repair, retry/reset or raw payload output.
 * Copy consistency is UNVERIFIED; failed reads remain UNKNOWN, not healthy. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
    if (!['--db-copy', '--cycles-copy', '--copy-state', '--input-hash', '--cycle-id'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error('Use supplied --db-copy PATH --cycles-copy PATH --copy-state quiescent; optional --input-hash SHA256 --cycle-id ID');
    options.set(args[i], args[i + 1]);
}
if (options.has('--input-hash') && !/^[a-f0-9]{64}$/.test(options.get('--input-hash'))) throw new Error('Invalid input hash');
if (options.has('--cycle-id') && !/^[A-Za-z0-9:._-]{1,160}$/.test(options.get('--cycle-id'))) throw new Error('Invalid cycle ID');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9:._-]{1,160}$/.test(value) ? value : '[INVALID_ID]';
const ids = value => Array.isArray(value) ? value.slice(0, 100).map(identifier) : [];
const report = { mode: 'READ_ONLY_RECONCILIATION', executionPermitted: false, applied: false,
    authority: 'UNESTABLISHED', copyConsistency: 'UNKNOWN_NOT_AUTHENTICATED', bounds: { rows: 50, inputBytes: 262144, cycleFileBytes: 2097152, dbFileBytes: 67108864, walFileBytes: 16777216 }, analysis: {}, cycles: {} };
let db;
try {
    if (!options.get('--db-copy') || options.get('--copy-state') !== 'quiescent') throw new Error('Quiescent private copy required');
    // No capture, no live/source path default, no immutable shortcut ignoring WAL.
    // SQLite reads only this supplied copy. Copy provenance is not authenticated.
    const dbCopy = path.resolve(options.get('--db-copy'));
    if (!fs.statSync(dbCopy).isFile() || fs.statSync(dbCopy).size > 67108864) throw new Error('Copy bound');
    if (fs.existsSync(dbCopy + '-wal') && fs.statSync(dbCopy + '-wal').size > 16777216) throw new Error('WAL copy bound');
    db = new Database(dbCopy, { readonly: true, fileMustExist: true });
    // SELECT only. Missing table (migration unexecuted) remains UNAVAILABLE.
    const query = 'SELECT input_hash,state,length(CAST(input_json AS BLOB)) AS bytes, CASE WHEN length(CAST(input_json AS BLOB)) <= 262144 THEN input_json ELSE NULL END AS input_json FROM learning_analysis';
    const rows = options.has('--input-hash') ? db.prepare(query + ' WHERE input_hash = ? LIMIT 1').all(options.get('--input-hash'))
        : db.prepare(query + ' ORDER BY input_hash LIMIT 51').all();
    report.analysis = { status: rows.length ? 'READ' : 'NO_MATCHING_RECORD', copyConsistency: 'UNVERIFIED_OPERATOR_ASSERTED_QUIESCENT', truncated: rows.length > 50, records: rows.slice(0, 50).map(row => {
        const item = { inputHash: identifier(row.input_hash), status: row.state === 'STARTED' ? 'UNKNOWN_PENDING_OR_INTERRUPTED' : 'UNVERIFIED_RECORD',
            cause: row.state === 'STARTED' ? 'No automatic retry; original call outcome unconfirmed' : 'Stored completion is not application evidence',
            source: '[UNAVAILABLE]', failureExperienceIds: [], incidentIds: [] };
        try {
            if (!row.input_json) throw new Error('Bound');
            if (crypto.createHash('sha256').update(row.input_json).digest('hex') !== row.input_hash) throw new Error('Digest');
            const original = JSON.parse(row.input_json);
            if (original.version !== 1 || !Array.isArray(original.failures) || original.failures.length > 100) throw new Error('Shape');
            item.source = identifier(original.context);
            item.failureExperienceIds = ids(original.failures.map(f => f.id));
            item.incidentIds = ids(original.failures.map(f => f.incident?.id));
            if (row.state === 'COMPLETE') item.status = 'COMPLETE_STORED_NOT_REVERIFIED';
        } catch { item.cause = 'Original input oversized, invalid or hash mismatch; reconcile preserved source, no retry authority'; }
        return item;
    }) };
} catch { report.analysis = { status: 'UNAVAILABLE', cause: 'Required private copy/table unavailable, inconsistent or unreadable; UNKNOWN, no initialization or repair attempted' }; }
finally { if (db) db.close(); }
try {
    if (!options.get('--cycles-copy') || options.get('--copy-state') !== 'quiescent') throw new Error('Quiescent private copy required');
    const location = path.resolve(options.get('--cycles-copy'));
    const stat = fs.statSync(location);
    if (!stat.isFile() || stat.size > 2097152) throw new Error('Bound');
    const file = fs.readFileSync(location);
    if (file.length > 2097152) throw new Error('Bound');
    const store = JSON.parse(file.toString('utf8'));
    if (!Array.isArray(store.cycles) || store.cycles.length > 1000) throw new Error('Shape/bound');
    const linked = store.cycles.filter(c => c.learningProposal && (!options.has('--cycle-id') || c.id === options.get('--cycle-id')));
    report.cycles = { status: linked.length ? 'READ' : 'NO_MATCHING_RECORD', truncated: linked.length > 50, fileSha256: crypto.createHash('sha256').update(file).digest('hex'), records: linked.slice(0, 50).map(c => {
        const p = c.learningProposal;
        const provenShape = Array.isArray(p.failureExperienceIds) && p.failureExperienceIds.length >= 5 && p.failureExperienceIds.length <= 100
            && new Set(p.failureExperienceIds).size === p.failureExperienceIds.length && p.failureExperienceIds.includes(`incident:${p.incidentId}`);
        return { cycleId: identifier(c.id), memoryId: identifier(p.memoryId), incidentId: identifier(p.incidentId), source: identifier(p.source),
            failureExperienceIds: ids(p.failureExperienceIds), state: identifier(c.state),
            status: provenShape ? 'PROVENANCE_RECORDED_NOT_REVERIFIED' : 'LEGACY_OR_INVALID_PROVENANCE_REVIEW_REQUIRED',
            cause: provenShape ? 'Stored linkage only; independent evidence/authority not established' : 'Original distinct failure IDs absent/invalid; never inferred or silently upgraded',
            executionPermitted: false, applied: false };
    }) };
} catch { report.cycles = { status: 'UNAVAILABLE', cause: 'Cycle file missing, oversized or invalid; no quarantine, rewrite or inferred empty state' }; }
// ID association only, not causal proof or a new trusted linkage.
for (const row of report.analysis.records || []) {
    row.relatedStoredCycleIds = (report.cycles.records || []).filter(c => row.incidentIds.includes(c.incidentId)).map(c => c.cycleId);
    row.cycleLookup = report.cycles.status === 'UNAVAILABLE' || report.cycles.truncated || options.has('--cycle-id') ? 'INCOMPLETE' : 'BOUNDED_STORED_ID_MATCH_ONLY';
}
console.log(JSON.stringify(report, null, 2));
