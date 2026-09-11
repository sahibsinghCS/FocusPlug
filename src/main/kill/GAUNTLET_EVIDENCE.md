# Gauntlet evidence (this branch)

Command:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --import ./src/main/kill/register.mjs \
  --test src/main/kill/*.test.ts
```

Last run (Linux cloud agent, Node v22.14.0): **25/25 pass, 0 fail**.

Live OS:

- `fp_blockstandin` (copy of `/bin/sleep`) killed via `ProcessKiller.kill(["fp_blockstandin"])`; process gone.
- `Discord` stand-in killed via `kill(["discord", "discord.exe"])`; process gone.
- `chrome` stand-in **still running** after `kill(["chrome", "chrome.exe"])`; error `Refused to kill allowlisted/protected process`.

Safety (MemoryProcessHost): Discord killed; chrome/Code/firefox/msedge/WINWORD/Notion never killed; every `DEFAULT_STUDY_PROCESS_MATCHERS` token refuses; explorer/lsass refused; self pid refused; empty/no-match/access-denied errors.

Windows path: `tasklist` CSV fixture + `taskkill /PID /F` argv asserted; PowerShell fallback asserted. This VM is not Windows, so `taskkill.exe` is not executed live.
