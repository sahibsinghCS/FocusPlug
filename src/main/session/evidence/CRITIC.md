# Independent critic (session-plugs, post-rebase onto latest main)

Blind critic (no builder rationale). Bar: frozen plug IPC/types; distracted → countdown → kill + plug_off; unlock → plug_on; Demo Kill hits plugs; zero plugs does not throw; never command study-pc.

**Verdict: WIN**

Inspected after rebase onto `86d1e29` (contracts #12 + policy #10 + smart-plug-core #15 + model-seam #13). Session feeds `enabledFunPlugIds` / `plugsArmed` / `settings.plugs` into `PolicyEngineInput` and consumes policy `{ deviceIds, reason }` with `PlugSnapshot[]` only (no parallel `ids` / `PlugResult` API). Kill/unlock do not re-command plugs; `plug_off`/`plug_on` drive `PlugController.off`/`on` once. Demo Kill still cuts enabled fun plugs (IPC no longer double-calls `cutSecondary`). Inventory is `AppSettings.plugs` via `SettingsPlugStore`. Desk monitor still gets `deskModelId` via `syncDeskModel`. `golden-path.json` shows `kill`→`plug_off`, `unlock`→`plug_on`, Demo Kill `plugOff: console-lamp, tv-outlet`. Zero-plug no-throw and study-pc filter proven in `controller.test.ts`. `check:contracts` byte-identical. vitest 163/163.
