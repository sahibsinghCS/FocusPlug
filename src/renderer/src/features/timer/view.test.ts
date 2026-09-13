import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, SHAPES, planFromShape, planSegments, type TimerPlan } from "./plan";
import { positionAt, shouldEnforce, type RunStatus } from "./runtime";
import { shellView, viewIsLocked, type ShellView } from "./view";

const RENDERER_SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STATUSES: RunStatus[] = ["setup", "running", "paused", "done"];
const FLAGS = [false, true];

function everyState(): { status: RunStatus; consoleOpen: boolean; sessionActive: boolean }[] {
  return STATUSES.flatMap((status) =>
    FLAGS.flatMap((consoleOpen) =>
      FLAGS.map((sessionActive) => ({ status, consoleOpen, sessionActive })),
    ),
  );
}

describe("shellView", () => {
  it("shows the plan only when nothing is live", () => {
    for (const state of everyState()) {
      const view = shellView(state);
      if (view === "plan") {
        expect(state.status).toBe("setup");
        expect(state.sessionActive).toBe(false);
      }
    }
    expect(shellView({ status: "setup", consoleOpen: false, sessionActive: false })).toBe("plan");
  });

  it("lands the hold switch in lock mode, and keeps the finish screen there", () => {
    // `start()` clears the console view, so this is the state right after the
    // switch is thrown.
    expect(shellView({ status: "running", consoleOpen: false, sessionActive: true })).toBe("lock");
    expect(shellView({ status: "paused", consoleOpen: false, sessionActive: false })).toBe("lock");
    // Done is the finish screen inside LockPage; a console for a spent session
    // would have no session to instrument.
    for (const consoleOpen of FLAGS) {
      for (const sessionActive of FLAGS) {
        expect(shellView({ status: "done", consoleOpen, sessionActive })).toBe("lock");
      }
    }
  });

  it("opens the console on a live plan without ending the session", () => {
    expect(shellView({ status: "running", consoleOpen: true, sessionActive: true })).toBe("console");
    // A break stops enforcement but not the plan: the console still belongs to
    // the session you are in, not the plan editor you already committed.
    expect(shellView({ status: "running", consoleOpen: true, sessionActive: false })).toBe(
      "console",
    );
    expect(shellView({ status: "paused", consoleOpen: true, sessionActive: true })).toBe("console");
  });

  it("still shows the console for a session with no plan behind it", () => {
    // The seeded mock scenes (`?scene=live`) and the action smoke drive exactly
    // this: session live, plan timer untouched.
    expect(shellView({ status: "setup", consoleOpen: false, sessionActive: true })).toBe("console");
  });

  it("locks the window for exactly one of the three views", () => {
    const seen = new Set<ShellView>();
    for (const state of everyState()) {
      const view = shellView(state);
      seen.add(view);
      expect(viewIsLocked(view)).toBe(view === "lock");
    }
    expect([...seen].sort()).toEqual(["console", "lock", "plan"]);
  });
});

/**
 * The regression this file exists for. Enforcement is armed only while the plan
 * is `running`; if `running` also forced lock mode, the console — the only host
 * of the forecast instrument, the pre-arm plate, the sensor rail and the
 * enforcement timeline in the Electron app — could never render while anything
 * was being enforced. It typechecks and screenshots fine through the mock path,
 * so nothing but this catches it.
 */
describe("the live console is reachable while enforcement is armed", () => {
  const plans: TimerPlan[] = [
    DEFAULT_PLAN,
    ...SHAPES.map((shape) => planFromShape(shape.id)),
    { shape: "custom", focusMin: 15, breakMin: 3, rounds: 4 },
  ];

  it("has an armed state on every plan shape whose view is the console", () => {
    let armedStates = 0;
    let armedConsole = 0;

    for (const plan of plans) {
      const segments = planSegments(plan);
      const total = segments[segments.length - 1]?.endSec ?? 0;
      for (let elapsed = 0; elapsed < total; elapsed += 15) {
        for (const status of STATUSES) {
          const position = status === "setup" || status === "done" ? null : positionAt(segments, elapsed);
          if (!shouldEnforce(position, status)) {
            continue;
          }
          armedStates += 1;
          // `sessionActive` follows `armed` through Shell's onEnforce.
          if (shellView({ status, consoleOpen: true, sessionActive: true }) === "console") {
            armedConsole += 1;
          }
        }
      }
    }

    expect(armedStates).toBeGreaterThan(100);
    // Every single one of them, not just some.
    expect(armedConsole).toBe(armedStates);
  });

  it("is what the shell routes on, and the only lock rule", () => {
    const shell = readFileSync(join(RENDERER_SRC, "components/Shell.tsx"), "utf8");
    // One derivation, from the pure function, not from the lifecycle.
    expect(shell.match(/\bconst locked = /gu)).toHaveLength(1);
    expect(shell).toMatch(/const locked = viewIsLocked\(view\)/u);
    expect(shell).toMatch(/shellView\(\{/u);
    expect(shell).not.toMatch(/const locked = timer\.status/u);
    // The console renders on the view, never on `sessionActive` alone — that
    // predicate is the one the mock path satisfies and the app cannot.
    expect(shell).toMatch(/view === "console" \? \(\s*<SessionPage/u);
    expect(shell).not.toMatch(/app\.state\.sessionActive \? <SessionPage/u);
  });

  it("has a door out of lock mode that does not end the session", () => {
    const lock = readFileSync(join(RENDERER_SRC, "pages/LockPage.tsx"), "utf8");
    expect(lock).toMatch(/onClick=\{timer\.openConsole\}/u);
    // And a way back, so the console is not a one-way trip out of the face.
    const session = readFileSync(join(RENDERER_SRC, "pages/SessionPage.tsx"), "utf8");
    expect(session).toMatch(/onLock/u);
  });
});
