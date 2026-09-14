import { describe, expect, it } from "vitest";
import {
  CORRECTION_ANSWER_WINDOW_MS,
  CORRECTION_CAP_GROUPS,
  CORRECTION_COOLDOWN_AWAY_MS,
  CORRECTION_COOLDOWN_PHONE_MS,
} from "@shared/correction/constants";
import type { AppSettings } from "@shared/ipc";
import { DeskCorrections, localDay } from "./service";
import {
  correctingSettings,
  createMemoryFs,
  retainedRun,
  type MemoryFs,
} from "./harness";
import { correctionsIndexPath, correctionsPath } from "./paths";

const DIR = "/data";

function makeService(options: {
  settings?: AppSettings;
  fs?: MemoryFs;
  clock?: { ms: number };
} = {}): {
  service: DeskCorrections;
  fs: MemoryFs;
  clock: { ms: number };
  log: string[];
  pushed: number[];
  settings: AppSettings;
} {
  const fs = options.fs ?? createMemoryFs();
  const clock = options.clock ?? { ms: 5_000_000 };
  const log: string[] = [];
  const pushed: number[] = [];
  const settings = options.settings ?? correctingSettings();
  const service = new DeskCorrections({
    userDataDir: DIR,
    loadSettings: () => settings,
    appendLog: (detail) => log.push(detail),
    push: () => pushed.push(clock.ms),
    now: () => clock.ms,
    fs,
    attentionHeadFile: "/nowhere/attention-head.json",
  });
  return { service, fs, clock, log, pushed, settings };
}

function pause(
  service: DeskCorrections,
  at: number,
  kind: "phone" | "away" = "phone",
): string | null {
  return service.openPause({
    kind,
    at,
    frames: retainedRun(kind, 3, { from: at - 25_000 }),
    deskModelId: "custom",
  });
}

describe("the ring's switch", () => {
  it("captures only with the trained head, a pause switch, and the master switch", () => {
    const { service } = makeService();
    expect(service.shouldCapture(correctingSettings())).toBe(true);
    expect(service.shouldCapture(correctingSettings({ deskCorrectionsEnabled: false }))).toBe(false);
    expect(service.shouldCapture(correctingSettings({ deskModelId: "blazeface" }))).toBe(false);
    expect(service.shouldCapture(correctingSettings({ deskModelId: "stub" }))).toBe(false);
    expect(
      service.shouldCapture(
        correctingSettings({ pauseOnAwayEnabled: false, pauseOnPhoneEnabled: false }),
      ),
    ).toBe(false);
    // One switch is enough.
    expect(
      service.shouldCapture(
        correctingSettings({ pauseOnAwayEnabled: false, pauseOnPhoneEnabled: true }),
      ),
    ).toBe(true);
  });

  it("issues no correctionId at all when capture is off", () => {
    const { service } = makeService({ settings: correctingSettings({ deskModelId: "blazeface" }) });
    expect(pause(service, 5_000_000)).toBeNull();
    expect(service.getState().pending).toBeNull();
  });
});

describe("nothing is written without a deliberate tap", () => {
  it("a pause alone writes no file", () => {
    const { service, fs } = makeService();
    expect(pause(service, 5_000_000)).toBe("dc-0001");
    expect(fs.writes).toEqual([]);
    expect(fs.files.size).toBe(0);
    expect(fs.json.size).toBe(0);
  });

  it("the answer window lapsing writes no file and hides the chips", () => {
    const { service, fs, clock } = makeService();
    pause(service, clock.ms);
    expect(service.getState().pending).not.toBeNull();
    clock.ms += CORRECTION_ANSWER_WINDOW_MS;
    expect(service.getState().pending).toBeNull();
    expect(fs.writes).toEqual([]);
    // And the verdict that arrives too late records nothing.
    expect(service.record({ correctionId: "dc-0001", verdict: "wrong" }).recorded).toBe(false);
    expect(fs.writes).toEqual([]);
  });

  it("a second pause supersedes the first, and only the newer one can be answered", () => {
    const { service, clock } = makeService();
    const first = pause(service, clock.ms);
    clock.ms += 60_000;
    const second = pause(service, clock.ms);
    expect(first).toBe("dc-0001");
    expect(second).toBe("dc-0001");
    expect(service.getState().pending?.at).toBe(clock.ms);
  });

  it("an unparseable verdict records nothing and leaves the offer standing", () => {
    const { service, fs } = makeService();
    pause(service, 5_000_000);
    const result = service.record({ correctionId: "dc-0001", verdict: "maybe" as never });
    expect(result.recorded).toBe(false);
    expect(fs.writes).toEqual([]);
    expect(service.getState().pending).not.toBeNull();
  });
});

describe("recording a verdict", () => {
  it("writes the photos, the record, and one log line", () => {
    const { service, fs, log, clock } = makeService();
    pause(service, clock.ms);
    const result = service.record({ correctionId: "dc-0001", verdict: "wrong" });

    expect(result.recorded).toBe(true);
    expect(result.correctionId).toBe("dc-0001");
    expect(fs.writes.filter((path) => path.endsWith(".jpg"))).toHaveLength(4);
    expect(fs.writes).toContain(correctionsIndexPath(DIR));
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("dc-0001");
    expect(log[0]).toContain("the model said phone");
    expect(log[0]).toContain("you said focused");
  });

  it("stamps the student's own calendar day, not a UTC date", () => {
    const at = new Date(2026, 2, 12, 23, 40).getTime();
    const { service } = makeService({ clock: { ms: at } });
    pause(service, at);
    service.record({ correctionId: "dc-0001", verdict: "right" });
    expect(service.getState().items[0]?.day).toBe(localDay(at));
    expect(localDay(at)).toBe("2026-03-12");
  });

  it("a `right` verdict is data too, and arms nothing", () => {
    const { service, clock } = makeService();
    pause(service, clock.ms);
    const result = service.record({ correctionId: "dc-0001", verdict: "right" });
    expect(result.recorded).toBe(true);
    expect(result.cooldown).toBeNull();
    expect(service.silencedKinds(clock.ms)).toEqual([]);
    expect(service.getState().items[0]?.label).toBe("phone");
  });

  it("at the cap the verdict still works — the record lands, the photos do not", () => {
    const { service, fs, clock } = makeService();
    for (let i = 0; i < CORRECTION_CAP_GROUPS; i += 1) {
      clock.ms += 60_000;
      service.openPause({
        kind: "phone",
        at: clock.ms,
        frames: retainedRun("phone", 1, { from: clock.ms }),
        deskModelId: "custom",
      });
      service.record({ correctionId: `dc-${String(i + 1).padStart(4, "0")}`, verdict: "right" });
    }
    expect(service.getState().capped).toBe(true);
    const jpegsBefore = fs.writes.filter((path) => path.endsWith(".jpg")).length;

    clock.ms += 60_000;
    const id = pause(service, clock.ms);
    const result = service.record({ correctionId: id ?? "", verdict: "wrong" });

    expect(result.recorded).toBe(true);
    // The behavioural half is never rationed.
    expect(result.cooldown).not.toBeNull();
    expect(fs.writes.filter((path) => path.endsWith(".jpg")).length).toBe(jpegsBefore);
    expect(service.getState().items[0]?.capped).toBe(true);
    expect(service.getState().items[0]?.frames).toBe(0);
  }, 20_000);
});

describe("the cooldown, derived from the records", () => {
  it("a wrong verdict silences that kind for its stated length, and no other", () => {
    const { service, clock } = makeService();
    pause(service, clock.ms, "phone");
    const result = service.record({ correctionId: "dc-0001", verdict: "wrong" });

    expect(result.cooldown).toEqual({
      kind: "phone",
      until: clock.ms + CORRECTION_COOLDOWN_PHONE_MS,
      correctionId: "dc-0001",
    });
    expect(service.silencedKinds(clock.ms)).toEqual(["phone"]);
    // `away` keeps working. Correcting one kind does not disarm the other.
    expect(service.silencedKinds(clock.ms)).not.toContain("away");
  });

  it("away is silenced for ten minutes, phone for twenty-five", () => {
    const { service, clock } = makeService();
    pause(service, clock.ms, "away");
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    expect(service.silencedKinds(clock.ms + CORRECTION_COOLDOWN_AWAY_MS - 1)).toEqual(["away"]);
    expect(service.silencedKinds(clock.ms + CORRECTION_COOLDOWN_AWAY_MS)).toEqual([]);

    clock.ms += CORRECTION_COOLDOWN_AWAY_MS;
    pause(service, clock.ms, "phone");
    service.record({ correctionId: "dc-0002", verdict: "wrong" });
    expect(service.silencedKinds(clock.ms + CORRECTION_COOLDOWN_PHONE_MS - 1)).toEqual(["phone"]);
    expect(service.silencedKinds(clock.ms + CORRECTION_COOLDOWN_PHONE_MS)).toEqual([]);
  });

  it("survives a restart, because the evidence is on disk", () => {
    const { service, fs, clock } = makeService();
    pause(service, clock.ms, "phone");
    service.record({ correctionId: "dc-0001", verdict: "wrong" });

    const restarted = makeService({ fs, clock: { ms: clock.ms + 60_000 } });
    expect(restarted.service.silencedKinds(clock.ms + 60_000)).toEqual(["phone"]);
  });

  it("deleting the correction drops the cooldown it armed — one object, not two", () => {
    const { service, clock } = makeService();
    pause(service, clock.ms, "phone");
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    expect(service.silencedKinds(clock.ms)).toEqual(["phone"]);

    service.delete("dc-0001");
    expect(service.silencedKinds(clock.ms)).toEqual([]);
    expect(service.getState().cooldowns).toEqual([]);
  });

  it("clearing everything drops every cooldown with it", () => {
    const { service, clock } = makeService();
    pause(service, clock.ms, "phone");
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    clock.ms += 1_000;
    pause(service, clock.ms, "away");
    service.record({ correctionId: "dc-0002", verdict: "wrong" });
    expect(service.silencedKinds(clock.ms).sort()).toEqual(["away", "phone"]);

    service.clear();
    expect(service.silencedKinds(clock.ms)).toEqual([]);
  });
});

describe("review and delete", () => {
  it("delete removes the frame directory and says so in the log", () => {
    const { service, fs, log, clock } = makeService();
    pause(service, clock.ms);
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    log.length = 0;

    const state = service.delete("dc-0001");
    expect(state.items).toEqual([]);
    expect(fs.removed.some((path) => path.includes("dc-0001"))).toBe(true);
    expect(log[0]).toContain("dc-0001");
  });

  it("delete all removes the personal head too — deleted data stays deleted", () => {
    const { service, fs, clock } = makeService();
    pause(service, clock.ms);
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    fs.json.set(`${correctionsPath(DIR)}/personal-attention-head.json`, { v: 1 });

    const state = service.clear();
    expect(state.items).toEqual([]);
    expect(state.bytes).toBe(0);
    expect(state.lifetimeCorrections).toBe(0);
    expect(fs.json.has(`${correctionsPath(DIR)}/personal-attention-head.json`)).toBe(false);
  });

  it("delete all says the one thing it does not undo", () => {
    const { service, log, clock } = makeService();
    pause(service, clock.ms);
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    log.length = 0;
    service.clear();
    expect(log[0]).toContain("Your focus history keeps the drifts you retracted");
  });

  it("deleting an unknown id is a no-op, not an error", () => {
    const { service } = makeService();
    expect(() => service.delete("dc-9999")).not.toThrow();
    expect(() => service.delete(undefined as never)).not.toThrow();
  });
});

describe("the state payload", () => {
  it("counts corrections, not photos, and names what the refit still needs", () => {
    const { service, clock } = makeService();
    for (let i = 0; i < 3; i += 1) {
      clock.ms += 60_000;
      pause(service, clock.ms, "phone");
      service.record({ correctionId: `dc-000${i + 1}`, verdict: "right" });
    }
    const state = service.getState();
    expect(state.items).toHaveLength(3);
    expect(state.lifetimeCorrections).toBe(3);
    expect(state.refitNeeded).toBe(9);
    expect(state.refitReady).toBe(false);
    expect(state.refitTrainGroups).toBe(2);
    expect(state.refitEvalGroups).toBe(1);
  });

  it("an away correction never counts toward the refit pool", () => {
    const { service, clock } = makeService();
    for (let i = 0; i < 3; i += 1) {
      clock.ms += 60_000;
      pause(service, clock.ms, "away");
      service.record({ correctionId: `dc-000${i + 1}`, verdict: "right" });
    }
    const state = service.getState();
    expect(state.items).toHaveLength(3);
    expect(state.refitNeeded).toBe(12);
    expect(state.refitTrainGroups).toBe(0);
    expect(state.items.every((item) => item.excludedBecause !== null)).toBe(true);
  });

  it("says which head is running, and shipped when there is no personal one", () => {
    const { service } = makeService();
    expect(service.getState().activeHead).toBe("shipped");
    expect(service.getState().lastRefit).toBeNull();
  });

  it("reports enabled/available straight off the settings", () => {
    expect(makeService().service.getState()).toMatchObject({ enabled: true, available: true });
    expect(
      makeService({ settings: correctingSettings({ deskModelId: "blazeface" }) }).service.getState(),
    ).toMatchObject({ enabled: true, available: false });
    expect(
      makeService({ settings: correctingSettings({ deskCorrectionsEnabled: false }) }).service.getState(),
    ).toMatchObject({ enabled: false });
  });
});

describe("the failure paths", () => {
  it("a write that throws costs the correction and never the caller", () => {
    const { service, fs, log, clock } = makeService();
    fs.failWrites = "EROFS: read-only file system";
    pause(service, clock.ms);
    const result = service.record({ correctionId: "dc-0001", verdict: "wrong" });

    expect(result.recorded).toBe(false);
    expect(log.some((line) => line.startsWith("off · EROFS"))).toBe(true);
    // Latched off: no further pause holds anything, so nothing retries into a
    // broken disk on every drift.
    expect(pause(service, clock.ms + 60_000)).toBeNull();
    expect(service.shouldCapture()).toBe(false);
  });

  it("a settings read that throws skips ONE capture and does not latch", () => {
    const fs = createMemoryFs();
    const clock = { ms: 5_000_000 };
    const log: string[] = [];
    let broken = true;
    const service = new DeskCorrections({
      userDataDir: DIR,
      loadSettings: () => {
        if (broken) {
          throw new Error("settings unreadable");
        }
        return correctingSettings();
      },
      appendLog: (detail) => log.push(detail),
      now: () => clock.ms,
      fs,
      attentionHeadFile: "/nowhere",
    });

    expect(pause(service, clock.ms)).toBeNull();
    expect(log.some((line) => line.startsWith("capture skipped"))).toBe(true);

    broken = false;
    clock.ms += 60_000;
    expect(pause(service, clock.ms)).toBe("dc-0001");
    expect(service.record({ correctionId: "dc-0001", verdict: "wrong" }).recorded).toBe(true);
  });

  it("delete keeps working after a write failure — erasing is never latched off", () => {
    const fs = createMemoryFs();
    const { service, clock } = makeService({ fs });
    pause(service, clock.ms);
    service.record({ correctionId: "dc-0001", verdict: "right" });
    expect(service.getState().items).toHaveLength(1);

    fs.failWrites = "EROFS";
    pause(service, clock.ms + 60_000);
    service.record({ correctionId: "dc-0002", verdict: "wrong" });
    fs.failWrites = null;

    expect(service.delete("dc-0001").items).toEqual([]);
    expect(fs.removed.some((path) => path.includes("dc-0001"))).toBe(true);
  });

  it("delete all un-latches, because the directory it failed into is gone", () => {
    const fs = createMemoryFs();
    const { service, clock } = makeService({ fs });
    fs.failWrites = "EROFS";
    pause(service, clock.ms);
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    expect(service.shouldCapture()).toBe(false);

    fs.failWrites = null;
    service.clear();
    expect(service.shouldCapture()).toBe(true);
  });

  it("a log that throws does not take the correction — or the session — with it", () => {
    const fs = createMemoryFs();
    const clock = { ms: 5_000_000 };
    const settings = correctingSettings();
    const service = new DeskCorrections({
      userDataDir: DIR,
      loadSettings: () => settings,
      appendLog: () => {
        throw new Error("log is gone");
      },
      now: () => clock.ms,
      fs,
      attentionHeadFile: "/nowhere",
    });
    pause(service, clock.ms);
    let result: ReturnType<DeskCorrections["record"]> | null = null;
    expect(() => {
      result = service.record({ correctionId: "dc-0001", verdict: "wrong" });
    }).not.toThrow();
    // And the correction that WAS written is not reported as lost.
    expect(result).not.toBeNull();
    expect((result as unknown as { recorded: boolean }).recorded).toBe(true);
    expect(service.getState().items).toHaveLength(1);
  });

  it("settings that throw leave the state readable rather than crashing Settings", () => {
    const fs = createMemoryFs();
    const service = new DeskCorrections({
      userDataDir: DIR,
      loadSettings: () => {
        throw new Error("settings gone");
      },
      now: () => 1,
      fs,
      attentionHeadFile: "/nowhere",
    });
    const state = service.getState();
    expect(state.available).toBe(false);
    expect(state.items).toEqual([]);
  });

  it("a push that throws does not turn a written correction into a lost one", () => {
    const fs = createMemoryFs();
    const clock = { ms: 5_000_000 };
    const settings = correctingSettings();
    const service = new DeskCorrections({
      userDataDir: DIR,
      loadSettings: () => settings,
      push: () => {
        throw new Error("renderer is gone");
      },
      now: () => clock.ms,
      fs,
      attentionHeadFile: "/nowhere",
    });
    pause(service, clock.ms);
    const result = service.record({ correctionId: "dc-0001", verdict: "wrong" });
    expect(result.recorded).toBe(true);
    expect(result.cooldown?.kind).toBe("phone");
    expect(service.getState().items).toHaveLength(1);
  });

  it("a missing attention head hashes to empty rather than throwing", () => {
    const { service, clock } = makeService();
    pause(service, clock.ms);
    service.record({ correctionId: "dc-0001", verdict: "wrong" });
    expect(service.baseHeadHash()).toBe("");
  });

  it("hashes the shipped attention head to sixteen hex characters when it is there", () => {
    const fs = createMemoryFs();
    const settings = correctingSettings();
    const service = new DeskCorrections({
      userDataDir: DIR,
      loadSettings: () => settings,
      now: () => 1,
      fs,
      attentionHeadFile: "package.json",
    });
    expect(service.baseHeadHash()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses a refit rather than pretending, when no refit is attached", () => {
    const { service } = makeService();
    expect(() => service.refit()).toThrow(/not available/i);
  });
});
