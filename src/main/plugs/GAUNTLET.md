# Smart-plug gauntlet

Bar:

1. **Mock round-trip** — `off` then `on` toggles `MockPlugHost` power.
2. **Protect** — study-PC devices (`isStudyPc` or name like `study-pc`) are refused.
3. **Unknown id** — `off`/`on`/`snapshot`/`remove` throw `Unknown plug id: …`.
4. **Zero plugs** — store/controller boot with `[]`. App does not require hardware.
5. Docs: [docs/SMART-PLUGS.md](../../../docs/SMART-PLUGS.md) — add Kasa by IP; Demo Kill will cut it.

## Linux / CI

```bash
npm run test:plugs
npm run gauntlet:plugs
npm test
npm run typecheck
```

Evidence: `src/main/plugs/evidence/gauntlet-run.json`.

## Windows LAN (optional hardware)

See [docs/SMART-PLUGS.md](../../../docs/SMART-PLUGS.md). `npm run probe:plugs -- --ip <lan-ip>`. Never probe the study PC outlet.
