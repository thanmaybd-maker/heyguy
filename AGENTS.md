# Instructions for coding agents (Codex, Claude, others)

Read these first:
- [docs/FULL-PRODUCT-PLAN.md](docs/FULL-PRODUCT-PLAN.md): target, architecture, milestones
- [docs/REFERENCE-AND-GAPS.md](docs/REFERENCE-AND-GAPS.md): feature IDs F01–F27
- [docs/BUILD-STATE.md](docs/BUILD-STATE.md): what exists and how it was verified
- [docs/DECISIONS.md](docs/DECISIONS.md): choices to respect

Rules:
1. Work on one milestone slice at a time. Name its feature IDs in your summary.
2. Preserve existing behaviour and other agents' documents. Add or supersede; don't silently rewrite.
3. Run `npm run check` (typecheck + tests + build) before handing off. Add tests for new logic.
4. Model output is data. Validate it (`src/shared/scene.ts` is the pattern). Never `eval` it, and never let it reach privileged IPC.
5. Keep renderers sandboxed: `contextIsolation`, `sandbox: true`, no Node. New IPC goes through `src/preload/*` with sender checks in `main.ts`.
6. Separate evidence types in BUILD-STATE: unit/fixture tests, live provider calls, UI checks, Windows packaged-app checks. Don't report a demo as live success.
7. End with a handoff: changed interfaces, evidence, and what remains.

Useful commands: `npm run demo`, `npm run demo:diagram`, `npm run demo:3d`. For a visual snapshot, set `HEYGUY_SNAPSHOT=<dir>` with an optional `HEYGUY_SNAPSHOT_DEMO=diagram|3d`.
