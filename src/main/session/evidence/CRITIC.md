# Independent critic (session-plugs, round 1)

Blind critic (no builder rationale). Bar: distracted → countdown → kill + plug_off; unlock → plug_on; Demo Kill hits plugs; zero plugs does not throw; never command `isStudyPc`.

**Verdict: WIN**

Inspected: `SessionController` kill/unlock/Demo Kill + `PlugController`, `commandablePlugIds` / `isStudyPc` filter, harness `RecordingPlugController`, `golden-path.json` (`kill`→`plug_off`, `unlock`→`plug_on`, Demo Kill `plugOff: console-lamp, tv-outlet`), vitest session+plugs 23/23. Zero-plug no-throw proven by `controller.test.ts` (empty inventory). `study-pc` absent from recorded off/on ids.
