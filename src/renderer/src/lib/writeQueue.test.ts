import { describe, expect, it } from "vitest";
import { createWriteQueue } from "./writeQueue";

interface Row {
  id: string;
  enabled: boolean;
}

interface Gate {
  resolve: () => void;
  reject: (error: Error) => void;
}

function gatedPersist(): {
  persist: (next: Row[]) => Promise<Row[]>;
  gates: Gate[];
  persisted: Row[][];
} {
  const gates: Gate[] = [];
  const persisted: Row[][] = [];
  const persist = async (next: Row[]): Promise<Row[]> => {
    await new Promise<void>((resolve, reject) => {
      gates.push({ resolve, reject: (error) => reject(error) });
    });
    persisted.push(next);
    return next;
  };
  return { persist, gates, persisted };
}

async function flushUntil(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i += 1) {
    await Promise.resolve();
  }
}

const snapshot: Row[] = [
  { id: "a", enabled: false },
  { id: "b", enabled: false },
];

const enable =
  (id: string) =>
  (current: readonly Row[]): Row[] =>
    current.map((row) => (row.id === id ? { ...row, enabled: true } : row));

describe("write queue", () => {
  it("computes a second in-flight edit from the first write's result, not the stale snapshot", async () => {
    const { persist, gates, persisted } = gatedPersist();
    const queue = createWriteQueue<Row>(persist);

    // Both clicks land before the first IPC resolves — both from the same
    // render snapshot. The old code persisted B's payload with A disabled.
    const first = queue(snapshot, enable("a"));
    const second = queue(snapshot, enable("b"));

    await flushUntil(() => gates.length === 1);
    gates[0]?.resolve();
    await first;
    await flushUntil(() => gates.length === 2);
    gates[1]?.resolve();
    const returned = await second;

    expect(persisted[0]).toEqual([
      { id: "a", enabled: true },
      { id: "b", enabled: false },
    ]);
    // The second write must keep A's just-saved toggle.
    expect(returned).toEqual([
      { id: "a", enabled: true },
      { id: "b", enabled: true },
    ]);
  });

  it("starts from the caller's fresh snapshot once the queue drains", async () => {
    const { persist, gates, persisted } = gatedPersist();
    const queue = createWriteQueue<Row>(persist);

    const first = queue(snapshot, enable("a"));
    await flushUntil(() => gates.length === 1);
    gates[0]?.resolve();
    await first;

    const later: Row[] = [{ id: "c", enabled: false }];
    const second = queue(later, enable("c"));
    await flushUntil(() => gates.length === 2);
    gates[1]?.resolve();
    await second;

    expect(persisted[1]).toEqual([{ id: "c", enabled: true }]);
  });

  it("drops a failed write instead of building later writes on its payload", async () => {
    const { persist, gates, persisted } = gatedPersist();
    const queue = createWriteQueue<Row>(persist);

    const first = queue(snapshot, enable("a"));
    const second = queue(snapshot, enable("b"));

    await flushUntil(() => gates.length === 1);
    gates[0]?.reject(new Error("disk"));
    await expect(first).rejects.toThrow("disk");
    await flushUntil(() => gates.length === 2);
    gates[1]?.resolve();
    await second;

    // First never committed, so the second write's snapshot is authoritative.
    expect(persisted[0]).toEqual([
      { id: "a", enabled: false },
      { id: "b", enabled: true },
    ]);
  });
});
