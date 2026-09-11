# Session-wiring golden path

## Inspectable bar

- 1. Start session with Docs/Chrome-style allowlist focus
- 2. Distracted by Discord (or simulated FocusSnapshot with matchedBlock)
- 3. UI/state shows Distracted + countdown
- 4. Kill fires on blocklist target (or simulated host evidence)
- 5. Return to allowlist + at_desk → Unlocked
- 6. Demo Kill instant path works

## Verdict: **PASS**

- Ran: 2026-09-11T08:58:20.887Z
- Host: linux x64 · Node v22.14.0
- Assertions: 61/61
- IPC push channels seen: focusplug:policy:event, focusplug:log:event, focusplug:session:state, focusplug:focus:snapshot, focusplug:desk:snapshot
- ProcessKiller calls: 3
- Demo Kill: steam.exe (pid 300) | discord.exe (pid 202)

## Checklist

| # | Gate | Result | Detail |
| --- | --- | --- | --- |
| | session off does not arm countdown | PASS | {"sessionActive":false,"focus":{"ts":1000000,"processName":"Discord.exe","windowTitle":"Friends - Discord","matchedAllow":false,"matchedBlock":true,"blockEntryId":"discord"},"desk":{"ts":1000000,"label":"at_desk","confidence":0.94,"webcamEnabled":true},"decision":"IDLE","countdownSec":0,"detail":"Session off — observe only"} |
| | session off decision is IDLE | PASS | IDLE · Session off — observe only |
| | observe-only does not kill Discord | PASS | killed= |
| | no ProcessKiller calls while observing | PASS | [] |
| | 1. sessionActive after start | PASS | {"sessionActive":true,"focus":{"ts":1000250,"processName":"chrome.exe","windowTitle":"Essay - Google Docs - Google Chrome","matchedAllow":true,"matchedBlock":false},"desk":{"ts":1000250,"label":"at_desk","confidence":0.94,"webcamEnabled":true},"decision":"ON_TASK","countdownSec":0,"detail":"On task: chrome.exe"} |
| | 1. Chrome/Docs matchedAllow | PASS | {"ts":1000250,"processName":"chrome.exe","windowTitle":"Essay - Google Docs - Google Chrome","matchedAllow":true,"matchedBlock":false} |
| | 1. decision ON_TASK | PASS | ON_TASK · On task: chrome.exe |
| | 1. countdown idle | PASS | 0 |
| | 1. desk at_desk | PASS | {"ts":1000250,"label":"at_desk","confidence":0.94,"webcamEnabled":true} |
| | 1. Discord still running before violation | PASS | killed= |
| | 2. matchedBlock Discord | PASS | {"ts":1000500,"processName":"Discord.exe","windowTitle":"Friends - Discord","matchedAllow":false,"matchedBlock":true,"blockEntryId":"discord"} |
| | 3. decision DISTRACTED | PASS | DISTRACTED · Distracted: Discord.exe |
| | 3. countdown remaining equals fuse (10s) | PASS | 10 |
| | 3. start_countdown emitted | PASS | status,status,status,status,status,status,start_countdown,status,status |
| | 3. start_countdown reason is blocked_focus | PASS | {"type":"start_countdown","reason":"blocked_focus","seconds":10} |
| | 3. Discord not killed during countdown | PASS | killed= |
| | 3b. countdown remaining after 4s is 6 | PASS | 6 |
| | 3b. still DISTRACTED before fuse end | PASS | DISTRACTED |
| | 3b. Discord still alive at T-6s | PASS | killed= |
| | 4. countdown cleared after kill | PASS | 0 |
| | 4. policy emitted kill | PASS | status,status,status,status,status,status,start_countdown,status,status,status,kill,status |
| | 4. kill targets include Discord process | PASS | {"type":"kill","targets":["Discord.exe"],"reason":"blocked_focus"} |
| | 4. Discord.exe pid 200 terminated | PASS | killed=200 running=chrome.exe,steam.exe,explorer.exe,System,Code.exe |
| | 4. chrome.exe study process still running | PASS | killed=200 |
| | 4. Code.exe still running | PASS | killed=200 |
| | 4. explorer.exe still running | PASS | killed=200 |
| | 4. System pid 4 not killed | PASS | killed=200 |
| | 4. blocked-focus kill did not require steam (foreground target only) | PASS | steam killed early? killed=200 |
| | 4. session log recorded kill | PASS | [{"ts":1010500,"kind":"kill","detail":"Kill · blocked_focus · killed Discord.exe (pid 200)"},{"ts":1000500,"kind":"decision","detail":"DISTRACTED · Distracted: Discord.exe"},{"ts":1000500,"kind":"policy","detail":"start_countdown · blocked_focus · 10s"},{"ts":1000500,"kind":"focus","detail":"Discord.exe — Friends - Discord · block"},{"ts":1000250,"kind":"decision","detail":"ON_TASK · On task: chrome.exe"},{"ts":1000250,"kind":"session","detail":"Session started"}] |
| | 5. decision ON_TASK after return | PASS | ON_TASK · On task: chrome.exe |
| | 5. countdown 0 after unlock | PASS | 0 |
| | 5. policy emitted unlock | PASS | status,status,status,status,status,status,start_countdown,status,status,status,kill,status,unlock,status,status |
| | 5. chrome still running after unlock | PASS | killed=200 |
| | 6. Demo Kill returned a result | PASS | steam.exe (pid 300) \| discord.exe (pid 202) |
| | 6. Demo Kill terminated discord stand-in | PASS | killed pids=200,300,202 result=steam.exe (pid 300) \| discord.exe (pid 202) |
| | 6. Demo Kill terminated steam (enabled blocklist) | PASS | killed pids=200,300,202 result=steam.exe (pid 300) \| discord.exe (pid 202) |
| | 6. Demo Kill did not kill chrome | PASS | steam.exe (pid 300) \| discord.exe (pid 202) |
| | 6. Demo Kill did not kill Code | PASS | killed=200,300,202 |
| | 6. Demo Kill log event | PASS | [{"ts":1010750,"kind":"kill","detail":"Demo Kill · demo_kill · killed steam.exe (pid 300), discord.exe (pid 202)"},{"ts":1010500,"kind":"kill","detail":"Kill · blocked_focus · killed Discord.exe (pid 200)"}] |
| | 6. countdown remains 0 after Demo Kill | PASS | 0 |
| | desk-away decision AWAY | PASS | AWAY · Away from desk |
| | desk-away starts countdown | PASS | 10 |
| | desk-away does not kill immediately | PASS | killed=200,300,202 |
| | desk-away killed VALORANT | PASS | killed=200,300,202,600,301 running=chrome.exe,explorer.exe,System,Code.exe |
| | desk-away killed steam respawn | PASS | killed=200,300,202,600,301 |
| | desk-away never killed chrome study PC | PASS | killed=200,300,202,600,301 |
| | uncertain desk does not kill steam | PASS | killed=200,300,202,600,301 |
| | uncertain desk is not AWAY-enforced | PASS | IDLE · Allowlisted focus, uncertain desk — holding desk-only kill |
| | low-confidence away does not kill | PASS | killed=200,300,202,600,301 |
| | stopped session does not kill new Discord | PASS | killed=200,300,202,600,301 |
| | stopped session is IDLE observe-only | PASS | {"sessionActive":false,"focus":{"ts":1041750,"processName":"Discord.exe","windowTitle":"Friends - Discord","matchedAllow":false,"matchedBlock":true,"blockEntryId":"discord"},"desk":{"ts":1041750,"label":"at_desk","confidence":0.94,"webcamEnabled":true},"decision":"IDLE","countdownSec":0,"detail":"Session off — observe only"} |
| | ProcessKiller never received *blocklist* sentinel | PASS | [["Discord.exe"],["discord","discord.exe","steam","steam.exe","steamwebhelper","epicgameslauncher","epicgameslauncher.exe","epic games","leagueclient","leagueclient.exe","league of legends","valorant","valorant.exe","fortnite","fortniteclient-win64-shipping.exe","cs2","cs2.exe","csgo.exe","minecraft","minecraftlauncher.exe","roblox","robloxplayerbeta.exe"],["discord","discord.exe","steam","steam.exe","steamwebhelper","epicgameslauncher","epicgameslauncher.exe","epic games","leagueclient","leagueclient.exe","league of legends","valorant","valorant.exe","fortnite","fortniteclient-win64-shipping.exe","cs2","cs2.exe","csgo.exe","minecraft","minecraftlauncher.exe","roblox","robloxplayerbeta.exe"]] |
| | IPC push focusplug:session:state | PASS | focusplug:policy:event, focusplug:log:event, focusplug:session:state, focusplug:focus:snapshot, focusplug:desk:snapshot |
| | IPC push focusplug:policy:event | PASS | focusplug:policy:event, focusplug:log:event, focusplug:session:state, focusplug:focus:snapshot, focusplug:desk:snapshot |
| | IPC push focusplug:focus:snapshot | PASS | focusplug:policy:event, focusplug:log:event, focusplug:session:state, focusplug:focus:snapshot, focusplug:desk:snapshot |
| | IPC push focusplug:desk:snapshot | PASS | focusplug:policy:event, focusplug:log:event, focusplug:session:state, focusplug:focus:snapshot, focusplug:desk:snapshot |
| | IPC push focusplug:log:event | PASS | focusplug:policy:event, focusplug:log:event, focusplug:session:state, focusplug:focus:snapshot, focusplug:desk:snapshot |
| | session log persisted to disk | PASS | count=25 |
| | persisted log includes session start | PASS | [{"ts":1041500,"kind":"session","detail":"Session stopped — observe only"},{"ts":1000250,"kind":"session","detail":"Session started"}] |
| | persisted log includes Demo Kill | PASS | [{"ts":1021000,"kind":"kill","detail":"Kill · desk_away · killed VALORANT.exe (pid 600), steam.exe (pid 301)"},{"ts":1010750,"kind":"kill","detail":"Demo Kill · demo_kill · killed steam.exe (pid 300), discord.exe (pid 202)"},{"ts":1010500,"kind":"kill","detail":"Kill · blocked_focus · killed Discord.exe (pid 200)"}] |
| | settings persist with defaults | PASS | {"countdownSec":10,"deskThreshold":0.6,"strictMode":true,"webcamEnabled":true} |

## Steps

### observe-off — Session OFF + Discord focus

```json
{
  "decision": "IDLE",
  "detail": "Session off — observe only",
  "sessionActive": false,
  "countdownSec": 0,
  "focus": {
    "ts": 1000000,
    "processName": "Discord.exe",
    "windowTitle": "Friends - Discord",
    "matchedAllow": false,
    "matchedBlock": true,
    "blockEntryId": "discord"
  },
  "desk": {
    "ts": 1000000,
    "label": "at_desk",
    "confidence": 0.94,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "Discord.exe#200",
    "steam.exe#300",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500"
  ],
  "killedPids": []
}
```

### start-docs — Start session on Chrome/Docs at desk

```json
{
  "decision": "ON_TASK",
  "detail": "On task: chrome.exe",
  "sessionActive": true,
  "countdownSec": 0,
  "focus": {
    "ts": 1000250,
    "processName": "chrome.exe",
    "windowTitle": "Essay - Google Docs - Google Chrome",
    "matchedAllow": true,
    "matchedBlock": false
  },
  "desk": {
    "ts": 1000250,
    "label": "at_desk",
    "confidence": 0.94,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "Discord.exe#200",
    "steam.exe#300",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500"
  ],
  "killedPids": []
}
```

### discord-countdown — Discord focus starts countdown

```json
{
  "decision": "DISTRACTED",
  "detail": "Distracted: Discord.exe",
  "sessionActive": true,
  "countdownSec": 10,
  "focus": {
    "ts": 1000500,
    "processName": "Discord.exe",
    "windowTitle": "Friends - Discord",
    "matchedAllow": false,
    "matchedBlock": true,
    "blockEntryId": "discord"
  },
  "desk": {
    "ts": 1000500,
    "label": "at_desk",
    "confidence": 0.94,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "Discord.exe#200",
    "steam.exe#300",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500"
  ],
  "killedPids": []
}
```

### kill-discord — Countdown elapsed → kill Discord

```json
{
  "decision": "DISTRACTED",
  "detail": "Distracted: Discord.exe",
  "sessionActive": true,
  "countdownSec": 0,
  "focus": {
    "ts": 1000500,
    "processName": "Discord.exe",
    "windowTitle": "Friends - Discord",
    "matchedAllow": false,
    "matchedBlock": true,
    "blockEntryId": "discord"
  },
  "desk": {
    "ts": 1000500,
    "label": "at_desk",
    "confidence": 0.94,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "steam.exe#300",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500"
  ],
  "killedPids": [
    200
  ]
}
```

### return-unlock — Return to Chrome/Docs + at_desk

```json
{
  "decision": "ON_TASK",
  "detail": "On task: chrome.exe",
  "sessionActive": true,
  "countdownSec": 0,
  "focus": {
    "ts": 1010750,
    "processName": "chrome.exe",
    "windowTitle": "Essay - Google Docs - Google Chrome",
    "matchedAllow": true,
    "matchedBlock": false
  },
  "desk": {
    "ts": 1010750,
    "label": "at_desk",
    "confidence": 0.94,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "steam.exe#300",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500"
  ],
  "killedPids": [
    200
  ]
}
```

### demo-kill — Demo Kill instant blocklist termination

```json
{
  "decision": "ON_TASK",
  "detail": "On task: chrome.exe",
  "sessionActive": true,
  "countdownSec": 0,
  "focus": {
    "ts": 1010750,
    "processName": "chrome.exe",
    "windowTitle": "Essay - Google Docs - Google Chrome",
    "matchedAllow": true,
    "matchedBlock": false
  },
  "desk": {
    "ts": 1010750,
    "label": "at_desk",
    "confidence": 0.94,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500"
  ],
  "killedPids": [
    200,
    300,
    202
  ]
}
```

### desk-away-kill — High-conf away → kill running blocklist

```json
{
  "decision": "AWAY",
  "detail": "Away from desk",
  "sessionActive": true,
  "countdownSec": 0,
  "focus": {
    "ts": 1011000,
    "processName": "chrome.exe",
    "windowTitle": "Essay - Google Docs - Google Chrome",
    "matchedAllow": true,
    "matchedBlock": false
  },
  "desk": {
    "ts": 1011000,
    "label": "away",
    "confidence": 0.92,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500"
  ],
  "killedPids": [
    200,
    300,
    202,
    600,
    301
  ]
}
```

### uncertain-hold — Uncertain desk must not desk-only kill

```json
{
  "decision": "IDLE",
  "detail": "Allowlisted focus, uncertain desk — holding desk-only kill",
  "sessionActive": true,
  "countdownSec": 0,
  "focus": {
    "ts": 1021250,
    "processName": "chrome.exe",
    "windowTitle": "Essay - Google Docs - Google Chrome",
    "matchedAllow": true,
    "matchedBlock": false
  },
  "desk": {
    "ts": 1021250,
    "label": "uncertain",
    "confidence": 0.99,
    "webcamEnabled": true
  },
  "running": [
    "chrome.exe#100",
    "explorer.exe#400",
    "System#4",
    "Code.exe#500",
    "steam.exe#302"
  ],
  "killedPids": [
    200,
    300,
    202,
    600,
    301
  ]
}
```

## How to re-run

```bash
npx vitest run src/main/session
npx tsx --tsconfig tsconfig.node.json src/main/session/gauntlet.ts
```

