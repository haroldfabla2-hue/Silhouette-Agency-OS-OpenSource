---
name: reverse_engineering
description: Legal and operational protocol for analyzing external software with REA/Ghidra to recreate or improve features. Understand and rewrite from scratch — never copy decompiled code, never touch DRM.
---

# Reverse Engineering Protocol (REA / Ghidra)

## Hard legal rules — non-negotiable
1. NEVER copy decompiled, disassembled, or extracted code verbatim — not a function, not a snippet, not a string table. The legal and doctrinal path is: understand the behavior → write a fresh specification in your own words → implement from scratch. (EU 2009/24/EC decompilation exception and US fair use protect INTEROPERABILITY analysis, not copying.)
2. NEVER analyze, bypass, weaken, or instruct around DRM, license checks, activation, or any technical access/copy protection (DMCA 1201 analog). If a target is protected, STOP and report the block honestly.
3. Only analyze targets we are entitled to analyze: our own builds, open-source software, software the user owns or licenses, and the public surface of public web apps. If entitlement is unclear, ask before analyzing.
4. Terms of service / EULA clauses that prohibit reverse engineering create contractual risk even where the analysis itself is lawful. Flag the conflict to the Orchestrator before proceeding.
5. Analysis output is a BEHAVIORAL SPEC plus evidence — never pasted code. What you hand to builders contains no original expression from the target.

## Operational rules (REA CLI, $0 stack)
- Invoke REA via its CLI: `/opt/silhouette-tools/rea/node_modules/.bin/rea <command> --json`. Ghidra is linked via `/opt/silhouette-tools/rea/rea-env.sh`. Paid engines (IDA, Hopper) are forbidden by the CERO COBROS rule.
- REA outputs can reach ~100 MB of evidence JSON. NEVER paste raw output into prompts or replies: extract subsets with `jq` (by module, endpoint, or function) and cite `evidence_id`s.
- REA evidence is signed (sha256) and carries explicit limitations. Preserve both: absent facts are NOT proof of absence; repeat that caveat when reporting.
- Heavy native-binary analysis (Ghidra headless, 2-4 GB RAM) runs ONLY during the scheduled overnight window. Daytime: JavaScript/Electron/web analysis, which needs no native engine. Leave RAM free for the Silhouette service.

## Reporting template
Every REA-based deliverable states: (1) target and why we may analyze it; (2) the behavioral spec derived, with evidence ids; (3) what was reimplemented from scratch; (4) limitations carried from the evidence; (5) confirmation that no decompiled code was copied and no protection was touched.
