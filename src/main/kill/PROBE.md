# Process kill probe

Gauntlet bar: start a harmless stand-in, kill it via `ProcessKiller.kill(matchers)`, verify it exited. **Hard fail** if an allowlisted study process can be killed.

## Command (from repo root)

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --import ./src/main/kill/register.mjs \
  --test src/main/kill/*.test.ts
```

Windows (PowerShell), same command. The live stand-in tests copy `sleep` (POSIX) or can be skipped if no sleeper exists; matching + allowlist invariant tests always run against `MemoryProcessHost` and a fake `tasklist`/`taskkill` runner.

## What must pass

1. **Kill works** — `fp_blockstandin` (copy of `sleep`) is listed, `kill(["fp_blockstandin"])` returns it in `killed`, then `kill(pid, 0)` fails (process exited).
2. **Allowlist cannot be killed** — a stand-in whose image name is `chrome` is **still running** after `kill(["chrome"])`. Errors include `Refused to kill allowlisted/protected process`. Default study matchers (`chrome`, `Code`, `firefox`, `msedge`, `WINWORD`, `notion`, …) never appear in `killed[]`.
3. **Clear errors** — empty matchers → `No process matchers provided`; unknown names → `No running processes matched: …`; access denied → `Failed to kill …`.

## Module seam (for session-wiring)

```ts
import { createProcessKiller } from "../kill";

const killer = createProcessKiller({
  getAllowlistMatchers: () =>
    allowlist.flatMap((entry) => (entry.enabled ? entry.match : [])),
});

const { killed, errors } = await killer.kill(["discord", "discord.exe"]);
```

`kill` never terminates:

- CONTRACTS default study processes (chrome, msedge, firefox, Code, notion, WINWORD, …) even if the caller omits them
- live allowlist matchers from `getAllowlistMatchers`
- critical OS images (explorer, lsass, csrss, systemd, …)
- this process / parent pid

Windows production host: `tasklist /FO CSV` then `taskkill /PID <pid> /F`, PowerShell `Get-Process` fallback. POSIX host exists so this probe can run in Linux CI/VMs.
