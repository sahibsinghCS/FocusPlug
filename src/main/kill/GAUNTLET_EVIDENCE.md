# Gauntlet evidence (this branch)

Command:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --import ./src/main/kill/register.mjs \
  --test src/main/kill/*.test.ts
```

Last run (**Windows 11**, Node v22.17.0, 2026-09-11): **25/25 pass, 0 fail** — `npm run test:kill`.
Prior run (Linux cloud agent, Node v22.14.0): 25/25 pass, 0 fail.

Live OS (now executed on Windows, not only Linux):

- `fp_blockstandin` (copy of `ping.exe`) killed via `ProcessKiller.kill(["fp_blockstandin"])`; process gone.
- `Discord` stand-in killed via `kill(["discord", "discord.exe"])`; process gone.
- `chrome` stand-in **still running** after `kill(["chrome", "chrome.exe"])`; error `Refused to kill allowlisted/protected process`.

The Windows stand-in was `timeout.exe`, which exits with "Input redirection is not
supported" under `stdio: "ignore"`; all three live tests failed on Windows while
passing in Linux CI. `ping.exe -n 45 127.0.0.1` survives redirected stdio, so
`tasklist` / `taskkill` are now exercised for real on Windows.

Safety (MemoryProcessHost): Discord killed; chrome/Code/firefox/msedge/WINWORD/Notion never killed; every `DEFAULT_STUDY_PROCESS_MATCHERS` token refuses; explorer/lsass refused; self pid refused; empty/no-match/access-denied errors.

Windows path: `tasklist` CSV fixture + `taskkill /PID /F` argv asserted; PowerShell fallback asserted. On the Windows run above, `tasklist.exe` and `taskkill.exe` are also executed live against the stand-ins.

Independent critic (fresh read of `src/main/kill/**` + re-run of the probe command, no builder rationale): **WIN**.
