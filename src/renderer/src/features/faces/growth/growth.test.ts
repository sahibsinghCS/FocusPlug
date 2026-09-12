import { describe, expect, it } from "vitest";
import { wiltFromKills } from "./colors";
import {
  killCountFromEvents,
  poseGrowth,
  resolveKillCount,
  resolveProgress,
} from "./pose";
import { GAUNTLET_SESSION_ID, GROWTH_SCENES, parseGrowthScene } from "./scenes";
import { buildDrawModel, leafPath } from "./svg";
import { generateGrowthTree, peekGrowthTree, resetGrowthTreeCache, serializeGrowthTree } from "./tree";

describe("growth tree is session-seeded and stall-proof", () => {
  it("returns identical geometry for the same sessionId", () => {
    resetGrowthTreeCache();
    const a = generateGrowthTree("session-alpha");
    const b = generateGrowthTree("session-alpha");
    expect(a).toBe(b);
    expect(serializeGrowthTree(a)).toBe(serializeGrowthTree(b));
    expect(peekGrowthTree("session-alpha")).toBe(a);
  });

  it("rebuilds the same skeleton after a cache stall", () => {
    resetGrowthTreeCache();
    const first = serializeGrowthTree(generateGrowthTree("stall-session"));
    resetGrowthTreeCache();
    const second = serializeGrowthTree(generateGrowthTree("stall-session"));
    expect(second).toBe(first);
  });

  it("changes topology when the sessionId changes", () => {
    resetGrowthTreeCache();
    const a = serializeGrowthTree(generateGrowthTree("seed-a"));
    const b = serializeGrowthTree(generateGrowthTree("seed-b"));
    expect(a).not.toBe(b);
  });

  it("does not regenerate geometry from progress or kills", () => {
    resetGrowthTreeCache();
    const tree = generateGrowthTree(GAUNTLET_SESSION_ID);
    const low = poseGrowth(tree, 0.2, 0);
    const high = poseGrowth(tree, 1, 3);
    expect(low.tree).toBe(tree);
    expect(high.tree).toBe(tree);
    expect(low.branches.map((branch) => branch.length)).toEqual(
      high.branches.map((branch) => branch.length),
    );
    expect(low.branches.map((branch) => branch.id)).toEqual(high.branches.map((branch) => branch.id));
    expect(serializeGrowthTree(tree)).toBe(serializeGrowthTree(generateGrowthTree(GAUNTLET_SESSION_ID)));
  });
});

describe("progress reveals frozen branch length", () => {
  it("hides every segment at 0 and reveals all at 1", () => {
    resetGrowthTreeCache();
    const tree = generateGrowthTree("reveal-session");
    expect(tree.totalLength).toBeGreaterThan(0);
    const empty = poseGrowth(tree, 0, 0);
    const full = poseGrowth(tree, 1, 0);
    expect(empty.branches.every((branch) => branch.reveal === 0)).toBe(true);
    expect(full.branches.every((branch) => branch.reveal === 1)).toBe(true);
    expect(empty.view.blossomOpen).toBe(false);
    expect(full.view.blossomOpen).toBe(true);
  });

  it("reveals a continuous prefix of total arc length", () => {
    resetGrowthTreeCache();
    const tree = generateGrowthTree("arc-session");
    const posed = poseGrowth(tree, 0.4, 0);
    const drawn = posed.branches.reduce((sum, branch) => sum + branch.reveal * branch.length, 0);
    expect(drawn).toBeCloseTo(tree.totalLength * 0.4, 4);
    const earlier = poseGrowth(tree, 0.15, 0);
    for (const branch of posed.branches) {
      const prev = earlier.branches.find((item) => item.id === branch.id);
      expect(prev).toBeDefined();
      expect(prev && prev.reveal).toBeLessThanOrEqual(branch.reveal + 1e-9);
    }
  });

  it("opens exactly one blossom host at completion", () => {
    resetGrowthTreeCache();
    const tree = generateGrowthTree(GAUNTLET_SESSION_ID);
    const hosts = tree.branches.filter((branch) => branch.blossomHost);
    expect(hosts).toHaveLength(1);
    const mid = buildDrawModel(poseGrowth(tree, GROWTH_SCENES.healthy.progress, 0));
    const done = buildDrawModel(poseGrowth(tree, 1, 0));
    expect(mid.blossom).toBeNull();
    expect(done.blossom?.open).toBe(true);
    expect(done.blossom?.petals).toHaveLength(5);
  });
});

describe("wilt is session-persistent stakes", () => {
  it("reads killCount or kill event list", () => {
    expect(resolveKillCount({ killCount: 2 })).toBe(2);
    expect(resolveKillCount({ killEvents: [{}, {}, {}] })).toBe(3);
    expect(killCountFromEvents([{ kind: "kill" }, { kind: "unlock" }, { kind: "KILL" }])).toBe(2);
    expect(wiltFromKills(0)).toBe(0);
    expect(wiltFromKills(3)).toBe(1);
    expect(wiltFromKills(6)).toBe(1);
  });

  it("droops headings and desaturates without changing topology", () => {
    resetGrowthTreeCache();
    const tree = generateGrowthTree(GAUNTLET_SESSION_ID);
    const healthy = poseGrowth(tree, 0.74, 0);
    const wilted = poseGrowth(tree, 0.74, 3);
    expect(wilted.view.wilt).toBe(1);
    expect(healthy.view.wilt).toBe(0);
    const healthyTips = healthy.branches.filter((branch) => branch.depth === tree.maxDepth);
    const wiltedTips = wilted.branches.filter((branch) => branch.depth === tree.maxDepth);
    expect(wiltedTips.length).toBe(healthyTips.length);
    const healthyMeanY =
      healthy.branches.reduce((sum, branch) => sum + branch.end.y, 0) / healthy.branches.length;
    const wiltedMeanY =
      wilted.branches.reduce((sum, branch) => sum + branch.end.y, 0) / wilted.branches.length;
    expect(wiltedMeanY).toBeGreaterThan(healthyMeanY);
    const healthyGreen = buildDrawModel(healthy).palette.greenA;
    const wiltedGreen = buildDrawModel(wilted).palette.greenA;
    expect(wiltedGreen).not.toBe(healthyGreen);
    expect(buildDrawModel(healthy).palette.soil).toBe(buildDrawModel(wilted).palette.soil);
  });

  it("keeps wilt for the rest of the session even at full progress", () => {
    resetGrowthTreeCache();
    const tree = generateGrowthTree("persist-wilt");
    const wiltedDone = poseGrowth(tree, 1, 2);
    expect(wiltedDone.view.wilt).toBeGreaterThan(0);
    expect(wiltedDone.view.blossomOpen).toBe(true);
  });
});

describe("leaves are two quadratic curves scaled by reveal", () => {
  it("encodes a leaf as two Q commands", () => {
    const path = leafPath({ x: 0, y: 0 }, -Math.PI / 2, 12);
    expect(path.match(/Q /g)?.length).toBe(2);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("scales leaf size with branch reveal", () => {
    resetGrowthTreeCache();
    const tree = generateGrowthTree("leaf-scale");
    const empty = poseGrowth(tree, 0, 0);
    const full = poseGrowth(tree, 1, 0);
    expect(empty.branches.every((branch) => branch.leafScale === 0)).toBe(true);
    const leafy = full.branches.filter((branch) => branch.leaf);
    expect(leafy.length).toBeGreaterThan(0);
    expect(leafy.every((branch) => branch.leafScale === 1)).toBe(true);
  });
});

describe("public argument checks", () => {
  it("rejects empty session ids and non-finite progress", () => {
    expect(() => generateGrowthTree("")).toThrow(/sessionId/);
    expect(() => resolveProgress(Number.NaN)).toThrow(/progress/);
    expect(resolveProgress(1.4)).toBe(1);
    expect(resolveProgress(-2)).toBe(0);
  });

  it("parses gauntlet preview scenes", () => {
    expect(parseGrowthScene("?scene=wilted")).toBe("wilted");
    expect(parseGrowthScene("?scene=diptych")).toBe("diptych");
    expect(parseGrowthScene("")).toBe("healthy");
    expect(GROWTH_SCENES.healthy.sessionId).toBe(GROWTH_SCENES.wilted.sessionId);
    expect(GROWTH_SCENES.healthy.progress).toBe(GROWTH_SCENES.wilted.progress);
    expect(GROWTH_SCENES.wilted.killCount).toBeGreaterThan(0);
  });
});
