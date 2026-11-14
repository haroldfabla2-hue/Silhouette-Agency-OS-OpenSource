'use strict';
// Reviewed per-process TS->CJS loader. No tsx/esbuild/install hooks. Does NOT
// change product sources. Only explicit hash-manifest-listed TS may evaluate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = function installExactLoader(root, typescriptPath, manifest) {
  const ts = require(typescriptPath); // same fully byte-verified TS5.8.3 library
  const allowed = new Map(manifest.map(row => [path.resolve(root, row.path), row.sha256]));
  require.extensions['.ts'] = function exactTS(module, filename) {
    const absolute = fs.realpathSync(filename);
    const expected = allowed.get(absolute);
    if (!expected) throw new Error('Unreviewed TypeScript evaluation denied');
    const raw = fs.readFileSync(absolute);
    if (crypto.createHash('sha256').update(raw).digest('hex') !== expected) throw new Error('TS input SHA mismatch');
    const result = ts.transpileModule(raw.toString('utf8'), {
      fileName: absolute, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, sourceMap: false, inlineSourceMap: false },
    });
    if ((result.diagnostics || []).some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Runtime loader transpile diagnostics');
    module._compile(result.outputText, absolute);
  };
};
