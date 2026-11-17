// Verifies the configured asarUnpack roots landed outside app.asar with their
// native payloads, bidirectionally against the asar header:
//   header -> disk: every native entry (*.node/*.dll) under each root in the
//     asar header is metadata-marked unpacked (statFile().unpacked === true)
//     and exists as a real file outside the archive;
//   disk -> header: every native file under each root outside the archive has
//     a header entry marked unpacked;
//   non-vacuous: each root must contribute >=1 native header entry AND >=1
//     native file outside.
// @electron/asar 3.4.1 path semantics (verified empirically against a real
// fixture archive, both directions): listPackage returns entries with a
// LEADING OS separator ("/node_modules/..."), while statFile REJECTS that
// form and expects the relative path without a leading separator
// (filesystem.js:60 p.split(path.sep)). So every entry is normalized by
// stripping leading separators before any comparison, disk join, or statFile
// call; separators inside the path are OS-native, matching path.join roots.
// Uses the LOCKED @electron/asar API. Exits non-zero on any failure.
// Presence does not prove runtime load.
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const resourcesDir = path.join("dist-desktop", "win-unpacked", "resources");
const asarPath = path.join(resourcesDir, "app.asar");
const unpackedRoot = path.join(resourcesDir, "app.asar.unpacked");
const roots = [
  path.join("node_modules", "better-sqlite3"),
  path.join("node_modules", "@lancedb"),
  path.join("node_modules", "sharp"),
];
const isNative = (p) => p.endsWith(".node") || p.endsWith(".dll");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

let failures = 0;
const fail = (m) => {
  console.error("FAIL: " + m);
  failures++;
};

if (!fs.existsSync(asarPath)) {
  fail(`missing archive: ${asarPath}`);
} else {
  const headerFiles = asar
    .listPackage(asarPath)
    .map((entry) => entry.replace(/^[/\\]+/, ""));
  const headerSet = new Set(headerFiles);
  for (const root of roots) {
    const external = path.join(unpackedRoot, root);
    if (!fs.existsSync(external)) {
      fail(`missing asarUnpack root outside asar: ${external}`);
      continue;
    }
    const rootPrefix = root + path.sep;
    const headerNatives = headerFiles.filter(
      (entry) => entry.startsWith(rootPrefix) && isNative(entry)
    );
    const outsideNatives = walk(external)
      .filter(isNative)
      .map((p) => path.relative(unpackedRoot, p));
    if (headerNatives.length === 0) {
      fail(`no native header entry under root (vacuous oracle): ${root}`);
    }
    if (outsideNatives.length === 0) {
      fail(`no native binary (*.node/*.dll) under ${external}`);
    }
    for (const entry of headerNatives) {
      const st = asar.statFile(asarPath, entry);
      if (!st.unpacked) fail(`header entry not marked unpacked: ${entry}`);
      if (!fs.existsSync(path.join(unpackedRoot, entry))) {
        fail(`unpacked payload missing on disk: ${entry}`);
      }
      if (!outsideNatives.includes(entry)) {
        fail(`header native has no outside counterpart: ${entry}`);
      }
    }
    for (const rel of outsideNatives) {
      if (!headerSet.has(rel)) {
        fail(`outside native has no header entry: ${rel}`);
        continue;
      }
      const st = asar.statFile(asarPath, rel);
      if (!st.unpacked) fail(`outside native not marked unpacked in header: ${rel}`);
    }
    console.log(
      `OK: ${root} -> ${headerNatives.length} header natives, ${outsideNatives.length} outside natives`
    );
  }
}

if (failures) {
  console.error(`${failures} native-unpack assertion(s) failed`);
  process.exit(1);
}
console.log("Native unpack assertions passed");
