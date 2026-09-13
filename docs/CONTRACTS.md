# FocusPlug shared contracts (freeze for parallel work)

All workstreams MUST implement / consume these. Do not invent parallel APIs.

**Phase 2 (frozen):** smart-plug types + `DeskModel` factory seam. Types, docs, and IPC channel names only. No Kasa driver, plug UI, or extra ML in this freeze. Never power off the study PC.

## Stack
- TypeScript + Electron (Windows-first)
- Vite + React + Tailwind for renderer
- Monorepo layout under repo root (see prompt-pack/00-overview.md)
- Local JSON persistence in `userData`

## Types (`src/shared/types.ts`)
```ts
export type DeskLabel = "at_desk" | "away" | "uncertain";
export type AttentionLabel = "focused" | "unfocused" | "phone";
export type Decision = "ON_TASK" | "DISTRACTED" | "AWAY" | "IDLE";
export type DeskModelId = "stub" | "blazeface" | "custom";
export type PlugProtocol = "kasa" | "http" | "mock";

export interface AppEntry {
  id: string;
  name: string;          // display
  match: string[];       // process names and/or title substrings (case-insensitive)
  enabled: boolean;
}

export interface FocusSnapshot {
  ts: number;
  processName: string;
  windowTitle: string;
  matchedAllow: boolean;
  matchedBlock: boolean;
  blockEntryId?: string;
}

export interface DeskAttention {
  label: AttentionLabel;
  confidence: number; // 0..1
}

export interface DeskSnapshot {
  ts: number;
  label: DeskLabel;
  confidence: number; // 0..1
  webcamEnabled: boolean;
  /** only while at_desk, and only from a model with an attention head */
  attention?: DeskAttention;
}

/** RGB frame — same shape as src/main/desk `RgbFrame`, plus Float32 tensors. */
export interface DeskFrame {
  width: number;
  height: number;
  data: Uint8Array | Float32Array;
}

/** Timmy drops his model behind this. No training in this phase. */
export interface DeskModelOutput {
  label: DeskLabel;
  confidence: number; // 0..1
  /** optional: focused / unfocused / phone, only when label is at_desk */
  attention?: DeskAttention;
  /** optional debug faces */
  faces?: Array<{ probability: number; box: { x0: number; y0: number; x1: number; y1: number } }>;
}

export interface DeskModel {
  readonly id: string;
  init(): Promise<void>;
  /** RGB frame bytes + width/height — match existing desk/frame types if present */
  infer(frame: DeskFrame): Promise<DeskModelOutput>;
  dispose?(): Promise<void>;
}

export interface PlugDevice {
  id: string;
  name: string;
  protocol: PlugProtocol;
  /** host/ip or unique device id */
  address: string;
  enabled: boolean;
  /** NEVER true for study PC — fun/secondary devices only */
  isStudyPc: false;
}

export interface PlugSnapshot {
  ts: number;
  deviceId: string;
  online: boolean;
  powerOn: boolean | null;
  error?: string;
}

export interface PolicyInput {
  sessionActive: boolean;
  focus: FocusSnapshot | null;
  desk: DeskSnapshot | null;
  countdownSec: number;
  deskThreshold: number;
  strictMode: boolean; // on-task requires allowlist focus AND at_desk
}

export type PolicyEvent =
  | { type: "start_countdown"; reason: string; seconds: number }
  | { type: "cancel_countdown" }
  | { type: "kill"; targets: string[]; reason: string }
  | { type: "unlock" }
  | { type: "status"; decision: Decision; detail: string }
  | { type: "plug_off"; deviceIds: string[]; reason: string }
  | { type: "plug_on"; deviceIds: string[]; reason: string };

export interface SessionEvent {
  ts: number;
  kind: string;
  detail: string;
}
```

## Settings (`AppSettings` in `src/shared/ipc.ts`)
Persisted by `Store.loadSettings` / `saveSettings` — one settings blob, not a second store.

- `countdownSec`, `deskThreshold`, `strictMode`, `webcamEnabled` (Phase 1)
- `deskModelId`: `"stub" | "blazeface" | "custom"` (default `"blazeface"` so a later factory wiring keeps today’s Desk AI)
- `faceId`: immersive session face (`flight` | `hourglass` | `readout` | `movement` | `line` | `growth` | `flask` | `garden` | `candle`). Default `flight`. Union lives in `src/shared/faces.ts` — not in the frozen Types block. Retired: Column / Grid / Eclipse / Field, and Descent / Record / Circuit / Orbit (removed 2026-09-13); a saved retired id falls back to `flight`. Do not revive Eclipse or Field; Garden is the sunrise face; Candle is the melting-wax face.
- `flightDep` / `flightArr`: curated IATA codes for the Flight face origin and arrival. Default `DUB` → `EDI`. Same settings blob — not a second store.
- `plugMode`: `"nudge" | "cut"` (default `"nudge"`). `nudge`: when you drift (phone, looking away, leaving the room, blocked app) enabled plugs switch **on** — a lamp that pulls you back — and the policy's `plug_off` / `plug_on` are not executed. `cut`: the original enforcer, `plug_off` on kill and `plug_on` on unlock. Union lives in `src/shared/nudge.ts`.
- Drift-pause keys — `pauseOnAwayEnabled`, `pauseOnPhoneEnabled`, `pauseAwayConfidence`, `pausePhoneConfidence`: see **Drift pause** below.
- `plugs`: `PlugDevice[]` (default `[]`)

`isStudyPc` is the literal `false`. Persistence MUST drop any device that is not explicitly `isStudyPc: false`. Never persist a study-PC plug.

## Module seams
- `WindowMonitor.start(cb)` / `stop()` → FocusSnapshot
- `DeskMonitor.start(cb)` / `stop()` / `setEnabled(bool)` → DeskSnapshot
- `DeskModelFactory.create(id: DeskModelId) → DeskModel` — interchangeable infer backend. Do **not** hard-code BlazeFace. No training in this phase. `DeskMonitor` stays the runtime presence seam; `DeskModel` is the model Timmy drops behind it. Do not add a second monitor.
- `DeskModel.init()` / `infer(frame: DeskFrame)` / optional `dispose()` → `DeskModelOutput`
- `PolicyEngine.step(input) → PolicyEvent[]` (pure). May emit `plug_off` / `plug_on` alongside `kill`. Existing kill/unlock/countdown/status events stay. Never power off the study PC.
- `ProcessKiller.kill(matchers: string[]) → { killed: string[]; errors: string[] }`
- `PlugController.off(ids)` / `on(ids)` / `list()` / `discover()` → `PlugSnapshot[]` / `PlugDevice[]`. Fun/secondary devices only. No Kasa/HTTP driver in this freeze (`plugs:test` returns a not-implemented snapshot).
- `Store` load/save allowlist, blocklist, settings (including `deskModelId` + `plugs`), append session log
- IPC: main↔renderer typed channels in `src/shared/ipc.ts`

## IPC (Phase 2 additions)
Same `focusplug:<area>:<verb>` style as Phase 1. Dedicated channels are the operational API for plugs and desk-model id — the same pattern as `webcamEnabled` + `focusplug:desk:setEnabled`, not a second settings store.

Invoke:

- `focusplug:plugs:list` → `PlugDevice[]`
- `focusplug:plugs:add` (`PlugDevice`) → `PlugDevice[]`
- `focusplug:plugs:remove` (`deviceId`) → `PlugDevice[]`
- `focusplug:plugs:test` (`deviceId`) → `PlugSnapshot` (stub: `online: false`, `powerOn: null`, `error: "plug driver not implemented"`)
- `focusplug:desk:getModelId` → `DeskModelId`
- `focusplug:desk:setModelId` (`DeskModelId`) → `DeskModelId`

No `plugs:discover` channel in this freeze — `PlugController.discover()` is the later driver seam.

## Default lists
Allow: chrome, msedge, firefox, Code, notion, WINWORD, Google Docs titles  
Block: Discord, steam, EpicGamesLauncher, common game exes

## UI must always show
Window status · Desk AI status · Decision · Countdown overlay · Start/Stop · Demo Kill

## Focus Forecast (Phase 4)
Additive only. `src/shared/types.ts` receives ZERO changes (byte-locked against the Types fence above). New shared types live in `src/shared/forecast/types.ts` and are re-exported from `src/shared/ipc.ts` (`ForecastSnapshot`, `ForecastEvent`, `ForecastBand`). Full frozen appendix: `docs/FORECAST-CONTRACTS.md`; design: `docs/FORECAST-DESIGN.md`.

### IPC (Phase 4 additions)
Invoke:

- `focusplug:forecast:getState` → `ForecastSnapshot | null` (null when no session is active or the forecast is off)

Push:

- `focusplug:forecast:snapshot` → `ForecastSnapshot` (1 Hz + band changes)
- `focusplug:forecast:event` → `ForecastEvent`

`FocusPlugApi` gains `forecastGetState()`, `onForecastSnapshot(cb)`, `onForecastEvent(cb)`. There is no forecast settings invoke — settings flow through the existing `focusplug:settings:set` patch.

### Settings (Phase 4 additions to `AppSettings`)
Five flat keys (house `requirePatch`/`normalizeSettings` style — no nested block):

| key | type | default | `normalizeSettings` clamp |
|---|---|---|---|
| `forecastEnabled` | boolean | `true` | boolean else default |
| `forecastPrearmEnabled` | boolean | `true` | boolean else default |
| `forecastNudgeRisk` | number | `0.50` | finite → clamp [0.05, 0.90] else default |
| `forecastPrearmRisk` | number | `0.65` | finite → clamp [0.10, 0.95] else default; then raised to ≥ `forecastNudgeRisk` + 0.05 |
| `forecastPrearmFuseSec` | number | `5` | finite → `Math.round`, clamp [3, 600] else default (runtime additionally caps at `countdownSec`) |

The two risk defaults are operating points re-derived with the model, not free constants. Code-side parity is enforced: `scripts/forecast/eval.ts` asserts `weights.thresholds.nudge/prearm` equal `DEFAULT_SETTINGS.forecastNudgeRisk/forecastPrearmRisk` (`nudge` 0.50 / `prearm` 0.65 today). This *table* is not machine-guarded — `npm run check:contracts` byte-compares source fences only, never prose tables — so re-check it by hand after any threshold re-derivation, against `src/shared/defaults.ts` and `docs/FORECAST-CONTRACTS.md § 3`.

`forecastEnabled: false` (or any load/inference failure) reproduces today's behavior event-for-event. The forecast's only authority over enforcement is `PolicyInput.countdownSec`, bounded to `[3, countdownSec]`, never lengthened. `src/shared/policy/**` and `SessionPush` (`src/main/session/push.ts`) stay untouched.

---

## Drift pause

Two behaviours over one channel, both additive. Neither adds a rule to
`src/shared/policy/**`, and neither invents a second lock: a stopped clock
*releases* the one there is, exactly as the Pause button always has.

**Leaving the room lights the lamp.** `NudgeKind` gains `away`, so `away`,
`unfocused` and `phone` are all drifts: two sustained readings (`NUDGE_SUSTAIN_READINGS`)
nudge, and in `plugMode: "nudge"` the nudge switches enabled plugs on. `away`
is read from the **presence** head — `DeskSnapshot.label === "away"` with
`DeskSnapshot.confidence >= deskThreshold` — while `phone` / `unfocused` come
from the attention head's own confidence. The two are never compared against
one floor: they are different models. `uncertain`, a low-confidence reading, a
webcam that is off and a model with no attention head are all *unsure*, which
breaks a streak and re-arms nothing. Nothing actionable ever comes from an
`uncertain` reading.

**Which drifts a default install can even raise, and which it may act on.**
`away` is a *presence* reading, so it works on the shipped `deskModelId:
"blazeface"` — the away **nudge** is live on a default install. The away
**pause** is not, and that is the model card's asymmetry applied to itself.
`blazeface` is a face detector with no `away` class: `classifyDesk` returns
`away` for any frame with no usable face, so a dim room, a bad angle or a
covered lens all read as an empty chair, at a fixed 0.90-0.92 — a constant, not
a score, so `pauseAwayConfidence` cannot sort the wrong ones from the right
ones at any setting a student would use. On the repo's own held-out desk eval it is right on
250 of its 594 `away` calls (42.1%) and calls `away` on 66.7% of the frames of
someone sitting right there; the trained head is right on 272 of 294 (92.5%)
and does that to 4.3%. So `deskModelMayPauseOnAway` (`src/shared/nudge.ts`)
gates the pause on the presence head that earned it — `custom` — and the
controller ANDs it into `DriftPolicy.pauseOnAway`, where no setting can undo
it. On `blazeface` and `stub` an away pulls you back and stops there, which is
the rule `unfocused` already lives under, applied to the model rather than the
label. `phone` and `unfocused` need no such gate: they come from the attention
head, which exists only under `deskModelId: "custom"`, so a default install
never raises either and `pauseOnPhoneEnabled` has nothing to act on until the
trained head is switched on. All of it is load-bearing when quoting the model
card — **the head with the number is the head that carries the consequence**,
and on a default install nothing stops the clock at all. Numbers and the
command that prints them: `docs/CUSTOM-MODEL.md § Away, on the model that
actually ships`. Pinned in `src/main/session/controller.test.ts` › "only the
trained presence head may stop the clock on away", which drives the *shipped*
`classifyDesk` output for a dark room through the shipped tracker.

**A confirmed drift stops the study clock.** The Pomodoro clock lives in the
renderer (`useSessionTimer`), so main does not stop it — it raises `pause:
true` on the `NudgeEvent` stream it already pushes, and the renderer pauses and
*never* auto-resumes. There is no second channel, no new IPC, and
`src/shared/policy/**` is untouched: no rule in the policy engine mentions the
clock, and none had to. The lock does lift while it is stopped, but only the
way it lifts for a hand pause — the renderer stops the session, `shouldEnforce`
is unchanged, and the engine is told nothing new. See the paragraph below on
what a stopped clock costs.

The flag rides that stream, but at the shipped timings it is its **own** event
rather than a rider on an earlier one: 15 s of away lands inside
`NUDGE_REPEAT_MS`, so the reading that stops the clock is gated out of nudging
(`Drift.nudge` is false) and the controller pulls them back on the pause flag
instead — window forward, overlay, and the lamp on again in `plugMode:
"nudge"`. That is deliberate, not incidental. A clock that stopped itself and
said nothing reads as a bug, and the student is by definition not looking at
the screen. `controller.test.ts` pins both the two-event shape and the second
lamp call — at the shipped defaults, which is the only place the two-event
*shape* is a contract. At the top of the Countdown slider the pause waits out a
fuse as long as `NUDGE_REPEAT_MS` (see below), so it can arrive on the same
reading as the next repeat nudge instead of on one of its own. The controller
pulls them back on **either** flag, so nothing is lost either way.

Only `PauseKind` — `away` and `phone` — may carry the flag. The bar is
proportioned to how much each head can be trusted, and the first column is the
one that decides whether the rest is ever reached:

| | model that may raise it | sustained readings | sustained for | confidence floor | and not while a fuse burns | default |
|---|---|---|---|---|---|---|
| `away` (trained presence head: 92.5% precision on that call, 89.44% 3-way on the diverse-stock slice) | `custom` only — `deskModelMayPauseOnAway` | 3 | 15 s | `pauseAwayConfidence` | `fuseBurning` | **on** |
| `phone` (attention head, 50-69% phone recall, ~17% false phones) | `custom` only — nothing else has an attention head | 5 | 30 s | `pausePhoneConfidence` | `fuseBurning` | **off** |

All five, not any. A reading count on its own is not a duration: the desk
monitor runs at 250 ms (`DEFAULT_DESK_INTERVAL_MS`), so three readings is three
quarters of a second — a student reaching for a pen, not one who has left. And
a duration on its own is not evidence: fifteen seconds of a detector that
answers `away` whenever it cannot see a face is fifteen seconds of nothing,
which is why the model column exists. **On the shipped default install neither
row can fire**; the pause is a thing the trained model buys.

<a id="the-kill-goes-first"></a>
**THE KILL GOES FIRST.** The last gate is the one that keeps the two features
in their own lanes, and it is not arithmetic. Stopping the clock stops the
session — `Shell` turns `pause: true` into `status: "paused"`, `shouldEnforce`
drops, `onEnforce(false)` calls `stopSession()` — and `SessionController.stop()`
builds a fresh `PolicyEngine`, which discards a countdown mid-burn. A pause
allowed to land inside the fuse would therefore **cancel the force-quit**, with
the student out of the room and nobody there to restart the clock.

The 15 s floor clears the shipped 10 s fuse, but a constant cannot carry that
argument on its own: the Countdown slider goes to 30 s (0-600 s from a
hand-edited `settings.json`), `AdaptiveFuse` personalises the fuse and may
explore up to `MAX_FUSE_SEC`, and the forecast can pre-arm a shorter one. So
the gate is the live fuse itself — `DriftPolicy.fuseBurning`, which the
controller reads straight off `countdownStartedAt`, non-null exactly while a
countdown burns. While it is set, no pause fires, whatever the counters say;
nothing latches, so the pause lands on the first reading after the countdown
resolves. That resolution is either a kill (which has now run) or a recovery
(which clears the pause run anyway). The nudge is **not** gated on it: the
lamp, the window and the overlay are what a burning fuse wants more of.

Pinned end to end at every countdown length the slider offers, single-variable
with the pause switch on and off, in `src/main/session/controller.test.ts` ›
"a drift pause never displaces the kill"; the counter's own half is
`src/main/session/nudge.test.ts` › "holding the pause while the kill burns".
Before that gate existed, `countdownSec: 20` with the default-on away pause
force-quit **nothing** in two minutes of away.

`unfocused` never pauses — it is the vaguest thing the attention head says.
The run only advances on consecutive readings of ONE kind that all clear that
kind's floor (a single dip below it drops the run to zero, duration included),
and it latches, so one drift stops the clock once; `NudgeTracker.reset()` on
session start re-arms it. The pause is counted separately from the nudge on
purpose: `NUDGE_REPEAT_MS` deliberately silences a drift that is still going,
and 15 s falls inside that window, so a pause that rode the nudge would be
silenced with it.

The rule is tuned to **miss** rather than to fire wrongly: a missed pause costs
a student nothing they had, a wrong one costs them a round they were working
through. A stopped clock releases the lock exactly as the Pause button does —
`shouldEnforce` is unchanged, `paused` is `paused` — and enforcement re-arms the
moment they restart. So a drift pause hands the blocklist back until they press
the button, and the paused screen and the overlay both say so in as many words
(`pauseNotice` in `src/shared/nudge.ts`). That screen is `LockPage`, and it is
where a drift pause always lands: `useSessionTimer.pauseForDrift` clears the
console view before it stops the clock, because the console is an instrument
panel with no timer controls on it — a clock main stopped would otherwise sit
there frozen, with no reason on screen and nothing to press. A pause the
student chose leaves the view alone; they know both. Pinned in
`src/renderer/src/features/timer/view.test.ts`. The process kill is still the only
enforcement in the product, and the pause makes it briefly *less* aggressive,
never more; the kill it does not displace has already run, because a pause
cannot fire while a fuse burns — see [THE KILL GOES FIRST](#the-kill-goes-first)
above, which is a structural gate rather than a property of the shipped
10 s-fuse / 15 s-pause arithmetic. Stopping the session also stops the
desk monitor, which releases the camera — so nothing accumulates, and no
reading can arrive, while the clock sits there. Resuming re-arms the session
under the **same** Focus Plan `roundKey`, so a drift pause merges into one
round exactly as a hand pause does (`docs/FOCUS-PLAN.md` §3.4).

### Settings (additions to `AppSettings`)
Four flat keys (house `requirePatch`/`normalizeSettings` style — no nested block):

| key | type | default | `normalizeSettings` clamp |
|---|---|---|---|
| `pauseOnAwayEnabled` | boolean | `true` | boolean else default |
| `pauseOnPhoneEnabled` | boolean | `false` | boolean else default |
| `pauseAwayConfidence` | number | `0.75` | finite → clamp [0.50, 0.95] else default |
| `pausePhoneConfidence` | number | `0.90` | finite → clamp [0.50, 0.99] else default; then raised to ≥ `pauseAwayConfidence` + 0.05 |

The defaults are the honest reading of the model card, not free constants: the
*trained* presence head is reliable enough to stop a clock, the attention head
is not, so pause-on-phone ships **off** and is switchable on its own. Raising
phone above away is structural rather than advisory — a hand-edited
`settings.json` cannot make the weaker head stop the clock on weaker evidence.

`pauseOnAwayEnabled: true` is a **preference, not a capability**. It is stored
and honoured on every model, and it can only *do* anything on the one presence
head whose `away` earns it (`deskModelMayPauseOnAway`, above). On the shipped
`blazeface` default it is inert by construction — no floor, no sustain and no
edited settings file changes that — and Settings says so in as many words, on
the card, whenever the running model is not `custom`. A switch that reads "on"
while doing nothing would be its own small lie, so the UI names the model and
the two numbers (42% against 92%) rather than leaving the student to infer it.

Do not over-read `pausePhoneConfidence`. Measured, it screens 39 of the head's
44 false `phone` calls on the pooled 286-image eval (88.6%) and lets five
through, the worst a head-down-over-a-notebook at 0.9955 — a pose a student
holds for the full thirty seconds, not a flicker a floor can catch
(`docs/CUSTOM-MODEL.md § Stock attention proxies`). The guards that carry that
risk are the switch shipping **off** and the 5-reading / 30-second sustain.
With both switches off — which is also what a **default install** does, since
neither kind can reach a pause there — no `NudgeEvent` ever carries the flag
and the extra pull-back described above never happens: the stream is one
sustained-drift nudge per drift, as it was before this feature
(`src/main/session/controller.test.ts` › "with both switches off no nudge
carries the flag"). That is not the same as *no change to the
nudge stream*: `NudgeKind` gained `away`, so leaving the room now nudges and
switches the lamp on where it used to do neither. The flag is what the switches
add; the away nudge is the feature. This table is not
machine-guarded — `npm run check:contracts` byte-compares source fences only —
so re-check it by hand against `src/shared/defaults.ts` and
`src/main/store/appStore.ts`.

`NudgeEvent` gains one optional field, `pause?: boolean`; `src/shared/types.ts`
receives ZERO changes.

---

## Focus Plan (Phase 5)
Additive only. `src/shared/types.ts` receives ZERO changes (byte-locked against the Types fence above). New shared types live in `src/shared/plan/types.ts` and are re-exported from `src/shared/ipc.ts` (`FocusPlanState`, `FocusPlanLedger`, `PlanRound`, `PlanEstimate`, `PlanRecommendation`, `PlanDebrief`, `PlanRevision`, `PlanTrend`, `SessionArmContext`, `SessionPlanContext`). Design: `docs/FOCUS-PLAN.md`.

Focus Plan is a coaching layer, and the contract is written so it cannot become anything else. It **never** locks, blocks or kills: the process kill stays the only enforcement in this product. Its one authority over the running session is **none** — `SessionControllerOptions` gains no plan-shaped key, `src/main/session/adaptiveFuse.ts` and `fuseAuthority.ts` are untouched, and `src/main/focusplan/integration.test.ts` fails the build if a plan-shaped option is ever added.

### IPC (Phase 5 additions)
Invoke:

- `focusplug:plan:getState` → `FocusPlanState` (closed rounds only; the live round is assembled renderer-side)
- `focusplug:plan:reset` → `FocusPlanState` (forgets the ledger; touches neither the adaptive model, the log, nor settings)

Push:

- `focusplug:plan:round` → `PlanRound` (on round close only, roughly once per focus block)

Widened:

- `focusplug:session:start` gains **one optional argument**, `SessionPlanContext`. It is consumed in `src/main/index.ts` by `FocusPlan.declareRound` and handed to `controller.start()` **never** — the session controller does not see it. Every pre-Phase-5 caller (`probe.ts`, the smoke script, `mockApi`) still typechecks and still works, and a missing or malformed context costs a labelled round and nothing else.

`FocusPlugApi` gains `planGetState()`, `planReset()`, `onPlanRound(cb)`, and the optional argument on `sessionStart(context?)`. There is no plan settings invoke — settings flow through the existing `focusplug:settings:set` patch.

### Settings (Phase 5 additions to `AppSettings`)
Two flat keys (house `requirePatch`/`normalizeSettings` style — no nested block):

| key | type | default | `normalizeSettings` clamp |
|---|---|---|---|
| `focusPlanEnabled` | boolean | `true` | boolean else default |
| `focusPlanStretchEnabled` | boolean | `true` | boolean else default |

`focusPlanEnabled: false` reproduces today's screens exactly: `PlanCard` and `DebriefCard` render `null`, `PLAN_GET_STATE` returns an empty window, and nothing is recorded. `focusPlanStretchEnabled: false` keeps the measurement and the debrief and plans to the estimate with no progression step. `FOCUSPLUG_NO_PLAN=1` is a different thing from that switch, and mirrors `FOCUSPLUG_NO_ADAPT=1`: for one run the feature stays on and `PLAN_GET_STATE` reports `enabled: true` with an empty window and `lifetimeRounds: 0`, so the cards stay on screen at the `no-history` rung, while `focus-plan.json` is not read, not written and not cleared — `PLAN_RESET` is refused under the pin. Settings are untouched either way.

### Storage
`<userData>/focus-plan.json`, a sibling of `adaptive-model.json`, written through the existing `writeJsonAtomic` on round close only. Wrong version, wrong shape or unreadable ⇒ an empty ledger, never a throw. It holds round durations, drift offsets and risk peaks — **no process name, no window title and no frame**, which is structural rather than promised: `src/main/focusplan/tap.ts` observes `sessionState`, `policyEvent`, `forecastSnapshot` and `forecastEvent` only, and never subscribes to `focusSnapshot`, `deskSnapshot`, `sessionEvent` or `nudge`.

### Uncoupling
Both taps forward to the base push **first** and only then mirror, and `swallow()` catches anything that escapes the recorder's own `guard()`, so a coaching layer can never delay, reorder or drop an enforcement message. `src/main/focusplan/integration.test.ts` deep-equals the push trace of a scripted session with Focus Plan attached against the same session without it. This table is not machine-guarded — `npm run check:contracts` byte-compares source fences only: the Types fence above, plus the two "complete source" fences for `src/shared/plan/types.ts` and `src/shared/plan/constants.ts` in `docs/FOCUS-PLAN.md`.
