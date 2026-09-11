# Independent critic

Blind critic (no builder rationale). Bar: mock off→on; protect rejects study-PC; unknown id errors cleanly; zero-plug boot; frozen contracts; SMART-PLUGS.md documents Kasa-by-IP + Demo Kill cut.

## Round 1 — WIN

Inspected the first landing of `src/main/plugs/**` (pre-rebase). Mock off→on, protect, unknown id, zero-plug boot, docs.

## Round 2 (after rebase onto contracts-hw `35fe7dc`) — WIN

Inspected `src/main/plugs/{protect,mock,kasa,http,controller,index}.ts`, `src/shared/types.ts` vs the `docs/CONTRACTS.md` Types fence (byte-identical; unchanged vs `35fe7dc`), `src/shared/ipc.ts` (`plugs:list|add|remove|test`), `appStore.ts` / `defaults.ts` (`plugs: []`), `session/runtime.ts`, `src/main/index.ts`, README + `docs/SMART-PLUGS.md`, and `evidence/gauntlet-run.json`. `controller.off` then `on` toggles `MockPlugHost` power; `npm run test:plugs` (15), `gauntlet:plugs`, `typecheck`, and `npm test` (121) are green. `protect` refuses `isStudyPc !== false` and names/ids like `study-pc`; `off`/`on` call `assertControllable` before any host `setPower`; unknown ids throw `Unknown plug id: …`. Persistence is `AppSettings.plugs` via `SettingsPlugStore`; Kasa is local TCP/UDP 9999 XOR and HTTP is LAN POST; Demo Kill IPC runs `cutSecondary()`.
