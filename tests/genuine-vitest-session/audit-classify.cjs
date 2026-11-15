// Trusted public-graph advisory classifier, not product code or npm installer.
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const base = '/mnt/silhouette-genuine-vitest';
const semver = require(base + '/fixtures/toolchain/npm/node_modules/semver');
const graphs = JSON.parse(fs.readFileSync(base + '/fixtures/audit-graphs.json', 'utf8'));
const raw = fs.readFileSync(base + '/transport/audit-response.json');
assert(raw.length > 0 && raw.length <= 4194304);
const response = JSON.parse(raw);
assert(response && typeof response === 'object' && !Array.isArray(response));
const payload = JSON.parse(fs.readFileSync(base + '/fixtures/audit-payload.json', 'utf8'));
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
function validateReport(report, requested) {
  assert(report && typeof report === 'object' && !Array.isArray(report));
  for (const [name, rows] of Object.entries(report)) {
    assert(Object.prototype.hasOwnProperty.call(requested, name), 'Unrequested package in advisory feed');
    assert(Array.isArray(rows) && rows.length <= 10000, 'Invalid advisory array');
    for (const advisory of rows) {
      assert(advisory && typeof advisory === 'object' && !Array.isArray(advisory));
      assert(advisory.name === undefined || advisory.name === name, 'Conflicting advisory name');
      assert((Number.isSafeInteger(advisory.id) && advisory.id > 0) ||
        (typeof advisory.id === 'string' && advisory.id.length > 0 && advisory.id.length <= 128), 'Invalid advisory ID');
      assert(severities.includes(advisory.severity), 'Invalid advisory severity');
      assert(typeof advisory.vulnerable_versions === 'string' && advisory.vulnerable_versions.length <= 4096 &&
        semver.validRange(advisory.vulnerable_versions) !== null, 'Invalid vulnerable range');
      assert(typeof advisory.url === 'string' && advisory.url.length <= 512 &&
        new URL(advisory.url).protocol === 'https:', 'Invalid advisory URL');
    }
  }
}
// Authored schema controls, not synthetic vulnerability or product test results.
// They execute only in a separately admitted future isolated validation run.
const shape = { id: 1, url: 'https://github.com/advisories/authored-schema-control',
  severity: 'high', vulnerable_versions: '<2.0.0', title: 'Authored schema control' };
const requested = { 'authored-package': ['1.0.0'] };
validateReport({ 'authored-package': [shape] }, requested); // Actual bulk shape has no row.name.
validateReport({ 'authored-package': [{ ...shape, name: 'authored-package' }] }, requested);
for (const invalid of [null, [], { unexpected: [shape] }, { 'authored-package': {} },
  { 'authored-package': [null] }, { 'authored-package': [{ ...shape, name: 'different-package' }] },
  { 'authored-package': [{ ...shape, id: null }] }, { 'authored-package': [{ ...shape, severity: 'unknown' }] },
  { 'authored-package': [{ ...shape, vulnerable_versions: 'not a semver range' }] },
  { 'authored-package': [{ ...shape, url: 'http://unsafe.invalid' }] }]) {
  assert.throws(() => validateReport(invalid, requested));
}
validateReport(response, payload); // Fresh real response, never dropped or replaced by authored fixtures.
const matches = {};
for (const [label, graph] of Object.entries(graphs)) {
  const rows = new Map();
  for (const item of graph) {
    assert(typeof item.name === 'string' && typeof item.version === 'string');
    const advisories = response[item.name] ?? [];
    assert(Array.isArray(advisories));
    for (const a of advisories) {
      assert(a && typeof a === 'object' && !Array.isArray(a));
      // Bulk schema binds name through its outer map key, not a row.name field.
      assert(a.name === undefined || a.name === item.name, 'Conflicting advisory name');
      assert(typeof a.id === 'number' || (typeof a.id === 'string' && a.id.length > 0));
      assert(severities.includes(a.severity) && typeof a.vulnerable_versions === 'string');
      // Exact package version and semver range, not a package-name hit.
      assert(semver.valid(item.version), 'Unverifiable locked version');
      if (!semver.satisfies(item.version, a.vulnerable_versions)) continue;
      const key = `${item.name}:${a.id}`;
      if (!rows.has(key)) rows.set(key, { package: item.name, advisoryId: a.id, severity: a.severity,
        url: typeof a.url === 'string' ? a.url.slice(0, 512) : null, versions: new Set(), placements: 0 });
      const row = rows.get(key); row.versions.add(item.version); row.placements++;
    }
  }
  matches[label] = [...rows.values()].map(r => ({ ...r, versions: [...r.versions].sort() }));
}
const old = new Set(matches.baseline.map(r => `${r.package}:${r.advisoryId}`));
const now = new Set(matches.candidate.map(r => `${r.package}:${r.advisoryId}`));
const introduced = matches.candidate.filter(r => !old.has(`${r.package}:${r.advisoryId}`));
const baselineByPair = new Map(matches.baseline.map(r => [`${r.package}:${r.advisoryId}`, r]));
const expanded = matches.candidate.filter(r => {
  const prior = baselineByPair.get(`${r.package}:${r.advisoryId}`);
  return prior && r.placements > prior.placements;
});
const resolved = matches.baseline.filter(r => !now.has(`${r.package}:${r.advisoryId}`));
const counts = rows => Object.fromEntries(severities.map(s => [s, rows.filter(r => r.severity === s).length]));
assert(introduced.length <= 32 && expanded.length <= 32 && resolved.length <= 32, 'Unexpected advisory delta, no truncated acceptance');
const summary = { status: introduced.length || expanded.length ? 'INTRODUCED_OR_EXPANDED_ADVISORY_REQUIRES_REVIEW' : 'NO_NEW_OR_EXPANDED_PACKAGE_ADVISORY_ON_SAME_FEED_NOT_SECURITY_CLEAN',
  source: 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
  schemaControls: { authoredValid: 2, authoredInvalidRejected: 10, actualResponseValidated: true },
  responseBytes: raw.length, responseSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  baseline: counts(matches.baseline), candidate: counts(matches.candidate), introduced, expanded, resolved,
  fullLockedGraphIncludingOptionalPlatforms: true, npmAuditNormalizedCounts: false,
  reachabilityOrExploitVerified: false, securityClean: false };
console.log('MCP_GRAPH_AUDIT ' + JSON.stringify(summary));
fs.writeFileSync(base + '/private/mcp-audit.summary.json', JSON.stringify(summary));
if (introduced.length || expanded.length) process.exitCode = 2;
