# Visual editor: reproduced failure and isolated correction

## Two separate deployment defects

1. Installed PhotoCraft assets were not copied into the new release. Its global tool path resolves into the preserved original application tree, whose UID/modes cannot be read by the zero-capability service. A new release must include byte-verified copies of bin and web assets with the runtime's ownership. Never change the preserved originals or remove service restrictions.
2. Once assets are supplied to an isolated full application, browser module requests carry their own Origin and were rejected by CORS. The previous default allowlist only included the development frontend. Provider-OFF also removed the explicit local CORS setting.

This PR fixes (2), not a claim that live packaging has already been changed. Same-origin equality includes scheme, host and port. Explicit cross-origin configuration remains in force, authentication is unchanged, and no wildcard origin was added.

## Executed evidence

- Before correction, real Chromium in the real fixture application received 403 for both hashed JS and WASM; no loaded editor bindings. A static-only server had loaded the same assets, which isolated the application CORS problem.
- After correction, actual production-mode application, providers OFF, disposable SQLite/Lance paths, a network namespace with loopback only, real copied PhotoCraft assets and real Chromium: opened a fixture PNG, painted a brush stroke, saved a PSD through the actual UI. The original bridge called the real POST /v1/visual/import, HTTP 200. The server workspace file and downloaded PSD were byte-identical (78,399 bytes). Reopening the saved PSD in the actual UI preserved the stroke. No provider, production data, replacement service, or fake save response.
- The real HTTP CORS test accepts the exact request origin and configured external origin, denies other origins/ports/schemes, and still returns 401 without authentication.
- Full unit suite: 1459 pass, 0 failures, 2 pre-existing skips, 226 files. This suite includes existing tests with doubles; it is not a global zero-mock or autonomous end-to-end claim.
- 13 real process boot/source/transport checks pass, including preservation of explicit CORS config and isolation of external credentials.
- Global types pass in a fresh-source private-network root with no production data or credential mounts. Global lint: zero errors, 420 existing warnings. Frontend and server builds pass with 1400 MB heap.
- Native PhotoCraft registry: 909 commands. Composition/export/readback produced a real PNG, visually inspected.
- Private mount-overlay preparation: only the disposable asset copy receives writes. All 37 original asset files remain byte-identical. No symlink in the preserved original is changed.

`tests/real-process/editor-open-edit-save.cjs` preserves the exact browser/application runner. It expects a disposable source archive at `/tmp/work`, real dependencies at `/tmp/project` and `/tmp/deps`, Node at `/tmp/node`, and disposable output at `/tmp/result`. Supply the real PhotoCraft assets at both the application's relative tools path and its configured global tools path. Its source `.env` contains only the fixed fake local API fixture credential used by `production-off-auth.py`; its config must disable providers, autonomy and external stores and select port 33005. It must run in an isolated network namespace with loopback enabled. The input `packaging-fixture.png` is a generated test image, never a user document. This runner starts and stops only the disposable application. Do not run it against an installed application or production data.

## Remaining boundaries

No merge or live application restart is authorized by this PR. Applying packaging requires a reviewed, private service mount of the release asset copy, rollback of only that service override on failure, and another stable read-only production health check. No shared proxy edit, source-tree chmod/chown, provider/autonomy activation, paid service, or unrelated project change. This editor route does not validate image generation, all editor commands, a complete mission, or complete memory durability.
