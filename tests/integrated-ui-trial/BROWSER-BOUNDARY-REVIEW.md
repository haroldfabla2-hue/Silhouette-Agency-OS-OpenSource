# Explicit browser bootstrap source proposal
2026-11-14. SOURCE ONLY. No build, typecheck, browser launch, product test, execution, push or activation.

## Decision
Preserve original frontend modules and behavior. Introduce a genuine explicit browser ownership boundary before the original React entry is dynamically imported. Do not change any service's ownership checks or invent a fallback host, mock bus, fake UI or authentication shortcut.

This addresses a concrete source-level pre-mount throw path. The first exception in failed run43624824627 remains unobserved because its driver captured neither pageerror nor compiled asset failures. An earlier vendor/chunk exception is still possible. The proposed correction is not an executed diagnosis or a successful render.

## Four destination files
- index.html: ONLY module entry src changes from /index.tsx to /browser.bootstrap.ts. Existing root, UI CSS, titles, external references and other HTML remain byte-equivalent.
- browser.bootstrap.ts (new): existing pure installPreparationHost -> entry scope -> retained dynamic import of unchanged original ./index. Original failed import is retained in the real host and rethrown in browser, never replaced by fallback UI.
- browser/ownershipCapacity.ts (new): explicit proposal values128scopes/512active/64failures/256resources. These mirror finite isolated runtime limits, not measured browser high-water and not proof of sufficient limits.43 initial scopes=42existing fixed scopes+1frontend-entry. All checks still throw on exhaustion. No env or secrets injected.
- tsconfig.json: existing includes preserved, add browser.bootstrap.ts and browser/**/* for future actual typecheck. No errors or includes hidden.

No change to index.tsx, App.tsx, LoginGate, service bus, its adapters, settingsManager, sensoryService, auth, Vite aliases/manualChunks, server bootstrap, providers, package files or lock.

## Source graph qualification
Source AST graph scanner uses TypeScript transpilation ONLY to erase type imports, never evaluates application modules or Vite config. Ordered Vite aliases are explicitly reproduced. It walks static imports, re-exports, literal dynamic imports and requires, reports unresolved/computed edges, and preserves eager/deferred classification.

Failed source graph:108first-party modules,21eager. Candidate:113modules,6eager bootstrap-only modules. All108original nodes retained; no added external npm/builtin specifiers;0unknown/computed first-party edges;0server/*nodes. Added nodes are browser bootstrap, capacity file, existing bootstrapAuthority, host and recoveryEvidence. Existing preparationBindings was already in original graph.

Exact six eager candidate files:
1.browser.bootstrap.ts
2.browser/ownershipCapacity.ts
3.services/lifecycle/bootstrapAuthority.ts
4.services/lifecycle/host.ts
5.services/lifecycle/preparationBindings.ts
6.services/lifecycle/recoveryEvidence.ts

Existing bootstrapAuthority creates only genuine bookkeeping host/scopes and marks PRODUCT_FRONTIER_INTEGRATION_INCOMPLETE permanently. Its graph has no Node import, timer, native client, provider, server entry, IO or network call. Installing fixed scope names does not construct named backend services. It does not authorize global release.

The original dynamic graph still has real browser bus subscribers and emitter semantics, plus deferred settingsManager/sensoryService ownership. Removing or mocking only the bus would miss those genuine owners. Existing deferred aliases to mocks/redis.ts and mocks/geminiService.ts are unchanged, not new test mocks. Redis branch remains source-guarded by Node detection. No claim that such branches were runtime exercised or that browser package graph is free of all server-related strings.

## Boundaries and caveats
- This scanner is NOT Rollup's final graph or an analysis of every package/vendor internal module. Chunk merging, manualChunks cycles, preloading and actual browser exception ordering require real build/runtime evidence.
- Dynamic import establishes a source evaluation boundary. Actual emitted output still needs inspection that installation precedes actual original React/module side effects.
- Existing vendor-react/vendor-ui/manual chunk setup is not changed speculatively. Source discovery does not prove it lacks a separate issue.
- Capacity numbers are an explicit finite engineering proposal to review, not a fallback. Actual browser concurrency, resource use and retained failure capacity are unmeasured.
- No pagehide/unload sealing added. A bfcache-restored page can resume, so stopping there would silently break real behavior. This proposal does not claim browser async teardown, global quiescence or a successful host report.
- Original failure is logged and rethrown; failed setup/import remains blank/error evidence for genuine browser screenshot capture, not a constructed error screen.
- No end-to-end chat/authentication/SQLite correlation is implied. Existing fresh setup boundary remains.

## Validation actually done
22finite static source/AST assertions passed. Two new TS files transpiled with no syntax diagnostics. No complete typecheck or behavioral test ran. Failed immutable source and terminal evidence were not modified.

## Owed before execution acceptance
Independent source review of pure bootstrap and capacity contract; full build output inspection for evaluation/chunk ordering; actual typecheck rather than syntax-only; real regression of missing/double/late bootstrap, original entry rejection, actual bus publish/subscribe/unsubscribe, deferred settings/sensory ownership, capacity exhaustion and authentic failed/blank page capture. Any behavioral activity requires separately approved scope. A new integrated run still requires exact admitted source GO and all existing zero-charge/isolation/privacy limits.

Actual immutable failed source:
https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource/commit/c2a1c7fd3316027bf45c318d78144111717951d8
Actual immutable failed run:
https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource/actions/runs/43624824627

Module evaluation semantics source, fetched2026-11-14:
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import
Static imports create eager dependencies; import() evaluation begins when reached and rejects with thrown evaluation error. These semantics support the source proposal, not an assertion about the missing actual browser exception.
