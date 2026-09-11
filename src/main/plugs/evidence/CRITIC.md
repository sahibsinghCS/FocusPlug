# Independent critic (round 1)

Blind critic (no builder rationale). Bar: mock off→on; protect rejects study-PC; unknown id errors cleanly; zero-plug boot; SMART-PLUGS.md documents Kasa-by-IP + Demo Kill cut.

**Verdict: WIN**

Inspected `src/main/plugs/{types,protect,mock,kasa,http,controller,index}.ts`, shared types/IPC/defaults, `appStore.ts`, main and preload IPC, `docs/SMART-PLUGS.md`, README, gauntlet evidence, and the plug unit tests. `off` then `on` changes `MockPlugHost` power; `npm run test:plugs` is 15/15 green and `npm run gauntlet:plugs` plus typecheck pass. `protect.ts` refuses `isStudyPc` and names/ids like `study-pc`; `off`/`on` call `assertControllable` before any host `setPower`. Unknown ids throw `Unknown plug id: …`. Defaults and store boot as `[]`; Kasa is local TCP/UDP 9999 XOR (HTTP is LAN POST); Demo Kill IPC runs `cutSecondary()`. README and `docs/SMART-PLUGS.md` document add-by-IP and that Demo Kill cuts the plug.
