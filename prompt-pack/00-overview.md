# FocusPlug prompt pack — parallel cloud agents + gauntlet

## How this maps to git worktrees
Cursor cloud agents cannot share your local disk worktrees. Equivalent discipline:
- **One branch ↔ one agent ↔ one workstream** (same rule as worktrees)
- Branch naming: `agent/<slug>` (e.g. `agent/ui-shell`)
- Local clone optional: `git worktree add ../FocusPlug-<slug> -b agent/<slug> origin/main`
- **Never** two agents on the same branch or overlapping file ownership
- Commit often; open PR into `main` when stream WINs gauntlet

## Model
Every agent: **grok-4.6** with **effort=xhigh** (extra high).

## Gauntlet loop (required in every stream)
1. Name a **concrete inspectable bar** (listed per prompt)
2. Builder implements the real artifact
3. Launch a **fresh** harsh critic with NO builder rationale — only goal, bar, artifact, evidence
4. Critic returns WIN / LOSE(+largest gap) / UNJUDGEABLE
5. On LOSE: fix that gap; new fresh critic. No fixed round count. Exit = WIN or explicit stop
6. No 1–10 scores. Blind A/B vs bar when possible. Builder never judges itself.

## Merge order
1. `agent/foundation` → `main` first  
2. Parallel: `ui-shell`, `window-monitor`, `desk-ai`, `policy-engine`, `process-kill` (after foundation contracts exist on main)  
3. `agent/session-wiring` integrates policy→kill→UI countdown + Demo Kill  
4. `agent/polish-hyperbloom` docs/demo script/disclosure + visual pass  
5. Integration critic on full golden path

## File ownership (do not cross)
| Branch | Owns |
| --- | --- |
| agent/foundation | electron scaffold, package.json, src/shared/*, src/main/index bootstrap |
| agent/ui-shell | src/renderer/** |
| agent/window-monitor | src/main/window/** |
| agent/desk-ai | src/main/desk/** |
| agent/policy-engine | src/shared/policy/** (pure) |
| agent/process-kill | src/main/kill/** |
| agent/session-wiring | src/main/session/**, IPC wiring, Demo Kill |
| agent/polish-hyperbloom | docs/demo*, README polish, AI disclosure template |

## Success = MVP
Fresh Windows install → golden path Docs→Discord→kill→return works; desk AI visible; Demo Kill works; polished UI; submission-ready README.
