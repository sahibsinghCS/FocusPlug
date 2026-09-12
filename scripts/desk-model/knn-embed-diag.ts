import { readFeatureRows } from "./lib";

/** Signal check: 1-NN accuracy on eval/main using only slices of the v3
 * vector — do the deep-embedding dims separate the main bucket at all? */
const rows = readFeatureRows();
const train = rows.filter((r) => r.split === "train");
const evals = rows.filter((r) => r.split === "eval" && r.bucket === "main");
const dim = train[0]?.vector.length ?? 0;
console.log("dim", dim, "train", train.length, "eval-main", evals.length);

const SLICES: Record<string, [number, number]> = {
  "hand (0-177)": [0, 177],
  "blaze embed (177-745)": [177, Math.min(745, dim)],
  ...(dim > 745 ? { "mobilenet (745-2025)": [745, dim] as [number, number] } : {}),
  "full vector": [0, dim],
};

for (const [name, [a, b]] of Object.entries(SLICES)) {
  const d = b - a;
  const mean = new Float64Array(d);
  const std = new Float64Array(d);
  for (const r of train) {
    for (let i = 0; i < d; i += 1) {
      mean[i] = (mean[i] ?? 0) + (r.vector[a + i] ?? 0);
    }
  }
  for (let i = 0; i < d; i += 1) {
    mean[i] = (mean[i] ?? 0) / train.length;
  }
  for (const r of train) {
    for (let i = 0; i < d; i += 1) {
      const diff = (r.vector[a + i] ?? 0) - (mean[i] ?? 0);
      std[i] = (std[i] ?? 0) + diff * diff;
    }
  }
  for (let i = 0; i < d; i += 1) {
    std[i] = Math.sqrt((std[i] ?? 0) / train.length) || 1;
  }
  const zs = (v: number[]): Float64Array => {
    const x = new Float64Array(d);
    for (let i = 0; i < d; i += 1) {
      x[i] = ((v[a + i] ?? 0) - (mean[i] ?? 0)) / ((std[i] ?? 1) > 1e-6 ? (std[i] as number) : 1);
    }
    return x;
  };
  const trainZ = train.map((r) => ({ z: zs(r.vector), label: r.mapped }));
  let correct = 0;
  for (const r of evals) {
    const z = zs(r.vector);
    let bestDist = Number.POSITIVE_INFINITY;
    let bestLabel = "";
    for (const t of trainZ) {
      let s = 0;
      for (let i = 0; i < d; i += 1) {
        const diff = (z[i] ?? 0) - (t.z[i] ?? 0);
        s += diff * diff;
        if (s >= bestDist) {
          break;
        }
      }
      if (s < bestDist) {
        bestDist = s;
        bestLabel = t.label;
      }
    }
    if (bestLabel === r.mapped) {
      correct += 1;
    }
  }
  console.log(`${name}: 1-NN main ${((correct / evals.length) * 100).toFixed(2)}%`);
}
