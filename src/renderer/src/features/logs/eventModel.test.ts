import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@shared/ipc";
import goldenPathEvidence from "../../../../main/session/evidence/golden-path.json";
import { formatTimelineCopy } from "./copyTimeline";
import { presentEvent, presentLog } from "./eventModel";
import { resolveEmptyMode } from "./emptyMode";
import {
  ERROR_COUNTDOWN_CANCEL,
  ERROR_KILL,
  ERROR_PLUG_OFF,
  goldenSessionEvents,
} from "./fixtures";
import { countKindFilter, filterLogEvents, KIND_FILTERS } from "./filters";
import { formatEventDelta, groupLogEvents } from "./groupEvents";
import { goldenPathProgress, GOLDEN_PATH_STEPS, PRODUCT_LABELS } from "./goldenPath";

const backendLog = goldenPathEvidence.log as SessionEvent[];

describe("presentLog", () => {
  it("renders real session-controller SessionEvent shapes from golden-path evidence", () => {
    const views = presentLog(backendLog);
    expect(views.length).toBe(backendLog.length);
    expect(views.map((view) => view.kind)).toEqual(backendLog.map((event) => event.kind));
    expect(views.every((view) => view.detail === view.event.detail)).toBe(true);

    const kill = views.find((view) => view.kind === "kill");
    expect(kill?.title).toBe("App kill");
    expect(kill?.reason).toBe("Blocked focus");
    expect(kill?.detail).toBe("blocked_focus · killed discord.exe (pid 44552)");
    expect(kill?.tone).toBe("red");
    expect(kill?.stage).toBe("consequence");

    const countdown = views.find((view) => view.kind === "countdown");
    expect(countdown?.title).toBe("Countdown started");
    expect(countdown?.reason).toBe("Blocked focus");
    expect(countdown?.stage).toBe("countdown");

    const unlock = views.find((view) => view.kind === "unlock");
    expect(unlock?.title).toBe("Unlocked");
    expect(unlock?.tone).toBe("lime");
    expect(unlock?.stage).toBe("recovery");

    const demo = views.find((view) => view.kind === "demo");
    expect(demo?.kindLabel).toBe("Demo Kill");
    expect(demo?.title).toBe("Demo Kill");

    const onTask = views.find((view) => view.detail.startsWith("ON_TASK"));
    expect(onTask?.title).toBe("On task");
    expect(onTask?.kindLabel).toBe("Decision");
  });

  it("skips malformed rows instead of throwing", () => {
    const views = presentLog([
      { ts: 1, kind: "kill", detail: "blocked_focus · killed discord.exe" },
      { ts: "nope", kind: "kill", detail: "bad" },
      null,
      "x",
      { ts: 2, kind: "", detail: "empty kind" },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]?.kind).toBe("kill");
  });

  it("marks cancel and error statuses from real detail strings", () => {
    expect(presentEvent(ERROR_COUNTDOWN_CANCEL, 0).status).toBe("cancelled");
    expect(presentEvent(ERROR_COUNTDOWN_CANCEL, 0).title).toBe("Countdown cancelled");
    expect(presentEvent(ERROR_PLUG_OFF, 1).status).toBe("error");
    expect(presentEvent(ERROR_PLUG_OFF, 1).tone).toBe("red");
    expect(presentEvent(ERROR_KILL, 2).status).toBe("error");
    expect(presentEvent(ERROR_KILL, 2).reason).toBe("Desk AI Away");
  });

  it("maps mock policy/focus rows into the causal chain without dropping proof", () => {
    const views = presentLog([
      { ts: 3, kind: "policy", detail: "start_countdown · Distracted: Discord" },
      { ts: 2, kind: "focus", detail: "Discord — #general" },
      { ts: 1, kind: "desk", detail: "at_desk · 94%" },
    ]);
    expect(views[0]?.stage).toBe("countdown");
    expect(views[0]?.kindLabel).toBe("Countdown");
    expect(views[1]?.kindLabel).toBe("Window");
    expect(views[2]?.title).toBe("At desk");
    expect(views[2]?.tone).toBe("lime");
    expect(views[2]?.detail).toBe("at_desk · 94%");
  });
});

describe("filterLogEvents", () => {
  const views = presentLog(backendLog);

  it("filters by kind aliases and status", () => {
    const countdown = filterLogEvents(views, { kind: "countdown", status: "all", query: "" });
    expect(countdown.every((view) => view.kind === "countdown" || view.kind === "policy")).toBe(
      true,
    );
    expect(countdown.length).toBeGreaterThan(0);

    const kills = filterLogEvents(views, { kind: "kill", status: "all", query: "" });
    expect(kills.every((view) => view.kind === "kill")).toBe(true);

    const errors = filterLogEvents(presentLog([...backendLog, ERROR_PLUG_OFF]), {
      kind: "all",
      status: "error",
      query: "",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe("plug_off");
  });

  it("searches kind, product label, and raw detail", () => {
    const byLabel = filterLogEvents(views, { kind: "all", status: "all", query: "On task" });
    expect(byLabel.some((view) => view.title === "On task")).toBe(true);
    const byRaw = filterLogEvents(views, { kind: "all", status: "all", query: "blocked_focus" });
    expect(byRaw.some((view) => view.kind === "kill")).toBe(true);
  });

  it("treats unknown filter ids as All", () => {
    const all = filterLogEvents(views, { kind: "nope", status: "also-nope", query: "" });
    expect(all).toHaveLength(views.length);
  });

  it("counts All as the full log", () => {
    const allFilter = KIND_FILTERS.find((filter) => filter.id === "all");
    expect(allFilter).toBeDefined();
    if (!allFilter) {
      return;
    }
    expect(countKindFilter(views, allFilter)).toBe(views.length);
  });
});

describe("groupLogEvents", () => {
  it("reads the golden path as sensor → decision → countdown → kill/plug off → unlock/plug on", () => {
    const groups = groupLogEvents(presentLog(goldenSessionEvents(2_000_000)));
    const summaries = groups.map((group) => group.summary);
    expect(summaries.some((summary) => summary.includes("Demo Kill"))).toBe(true);
    expect(
      summaries.some(
        (summary) =>
          summary.includes("Countdown") &&
          summary.includes("Kill") &&
          summary.includes("Unlock"),
      ),
    ).toBe(true);
    const enforcement = groups.find(
      (group) => group.summary.includes("Kill") && group.summary.includes("Unlock"),
    );
    expect(enforcement).toBeDefined();
    const stages = enforcement?.events.map((event) => event.stage) ?? [];
    expect(stages).toContain("countdown");
    expect(stages).toContain("consequence");
    expect(stages).toContain("recovery");
  });

  it("splits Demo Kill from an already recovered kill chain", () => {
    const groups = groupLogEvents(presentLog(goldenSessionEvents(2_000_000)));
    const demo = groups.find((group) => group.events.some((event) => event.kind === "demo"));
    const recovered = groups.find((group) => group.events.some((event) => event.kind === "unlock"));
    expect(demo?.id).not.toBe(recovered?.id);
  });

  it("formats fuse deltas from real timestamps", () => {
    expect(formatEventDelta(1000, 11_000)).toBe("+10s");
    expect(formatEventDelta(1000, 1400)).toBe("+0.4s");
    expect(formatEventDelta(1000, 1080)).toBeNull();
  });
});

describe("golden path", () => {
  it("uses real product labels and no invented runtime metrics", () => {
    expect(PRODUCT_LABELS).toContain("Start session");
    expect(PRODUCT_LABELS).toContain("On task");
    expect(PRODUCT_LABELS).toContain("Demo Kill");
    expect(GOLDEN_PATH_STEPS.every((step) => /\d/.test(step.beat))).toBe(true);
    expect(GOLDEN_PATH_STEPS.some((step) => /fps|latency|ms p95/i.test(step.cue))).toBe(false);
  });

  it("lights steps from real backend log kinds", () => {
    const progress = goldenPathProgress(backendLog);
    expect(progress.total).toBe(6);
    expect(progress.seen).toBe(6);
    expect(progress.steps.every((step) => step.seen)).toBe(true);
    expect(goldenPathProgress([]).seen).toBe(0);
  });
});

describe("formatTimelineCopy", () => {
  it("exports chronological SessionEvent proof, not rewritten copy", () => {
    const text = formatTimelineCopy(backendLog);
    expect(text.startsWith("FocusPlug session log")).toBe(true);
    expect(text).toContain("kill");
    expect(text).toContain("blocked_focus · killed discord.exe (pid 44552)");
    expect(text).toContain("unlock");
    const killIndex = text.indexOf("\tkill\t");
    const sessionIndex = text.indexOf("\tsession\t");
    expect(sessionIndex).toBeGreaterThan(-1);
    expect(killIndex).toBeGreaterThan(sessionIndex);
  });

  it("still formats an empty log", () => {
    expect(formatTimelineCopy([])).toContain("(no events)");
  });
});

describe("resolveEmptyMode", () => {
  it("covers loading, error, empty, filtered, and populated", () => {
    expect(resolveEmptyMode({ ready: false, error: null, logCount: 0, filteredCount: 0 })).toBe(
      "loading",
    );
    expect(
      resolveEmptyMode({ ready: true, error: "Failed to load", logCount: 0, filteredCount: 0 }),
    ).toBe("error");
    expect(resolveEmptyMode({ ready: true, error: null, logCount: 0, filteredCount: 0 })).toBe(
      "empty",
    );
    expect(resolveEmptyMode({ ready: true, error: null, logCount: 4, filteredCount: 0 })).toBe(
      "filtered",
    );
    expect(resolveEmptyMode({ ready: true, error: "stale", logCount: 4, filteredCount: 2 })).toBe(
      null,
    );
  });
});
