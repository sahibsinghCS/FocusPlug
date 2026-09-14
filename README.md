# FocusPlug Take B — Setup (draft)

**Clip:** `focusplug-take-b-setup-15s.mp4`  
**Slot in final film:** 0:40.0–0:55.0  
**Duration:** exactly 15.00s · **1920×1080** · **30fps** · **no audio**

## Action (real Electron app, real xdotool clicks)
Allowlist → Blocklist → Session → pick Garden → Hold to lock ≥0.9s

## Capture
- Xvfb `:98` (isolated from Take A)
- `TZ=America/New_York`
- `--remote-debugging-port=9222`
- faceId seeded `flight` so Garden pick is visible
- Trim only from raw capture (no preview:renderer, no Demo Kill, no app code changes)

## Attempts
3 (keeper = attempt 3 after trim sync)

## Cues off by >0.25s
None (attempt 3). Max |delta| ≈ 0.105s.
