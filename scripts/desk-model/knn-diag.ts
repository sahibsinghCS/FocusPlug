import { readFeatureRows } from "./lib";

/** Diagnostic: 1-NN / 3-NN accuracy of standardized v2 features on eval,
 * per bucket — how much pure retrieval could contribute. */
const rows = readFeatureRows();
const train = rows.filter((r) => r.split === "train");
const evals = rows.filter((r) => r.split === "eval");
const dim = train[0]?.vector.length ?? 0;
const mean = new Float64Array(dim);
const std = new Float64Array(dim);
for (const r of train) {
  for (let i = 0; i < dim; i += 1) {
    mean[i] = (mean[i] ?? 0) + (r.vector[i] ?? 0);
  }
}
for (let i = 0; i < dim; i += 1) {
  mean[i] = (mean[i] ?? 0) / train.length;
}
for (const r of train) {
  for (let i = 0; i < dim; i += 1) {
    const d = (r.vector[i] ?? 0) - (mean[i] ?? 0);
    std[i] = (std[i] ?? 0) + d * d;
  }
}
for (let i = 0; i < dim; i += 1) {
  std[i] = Math.sqrt((std[i] ?? 0) / train.length) || 1;
}
const zs = (v: number[]): Float64Array => {
  const x = new Float64Array(dim);
  for (let i = 0; i < dim; i += 1) {
    x[i] = ((v[i] ?? 0) - (mean[i] ?? 0)) / ((std[i] ?? 1) > 1e-6 ? (std[i] as number) : 1);
  }
  return x;
};
const trainZ = train.map((r) => ({ z: zs(r.vector), label: r.mapped }));
const stats: Record<string, { n: number; c1: number; c3: number }> = {};
for (const r of evals) {
  const z = zs(r.vector);
  const dists: Array<{ d: number; label: string }> = [];
  for (const t of trainZ) {
    let s = 0;
    for (let i = 0; i < dim; i += 1) {
      const diff = (z[i] ?? 0) - (t.z[i] ?? 0);
      s += diff * diff;
    }
    dists.push({ d: s, label: t.label });
  }
  dists.sort((a, b) => a.d - b.d);
  const top1 = dists[0]?.label;
  const votes: Record<string, number> = {};
  for (const n of dists.slice(0, 3)) {
    votes[n.label] = (votes[n.label] ?? 0) + 1;
  }
  const top3 = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  const s = (stats[r.bucket] = stats[r.bucket] ?? { n: 0, c1: 0, c3: 0 });
  s.n += 1;
  if (top1 === r.mapped) {
    s.c1 += 1;
  }
  if (top3 === r.mapped) {
    s.c3 += 1;
  }
}
for (const [bucket, s] of Object.entries(stats)) {
  console.log(
    `${bucket}: 1-NN ${((s.c1 / s.n) * 100).toFixed(2)}% | 3-NN ${((s.c3 / s.n) * 100).toFixed(2)}% (n=${s.n})`,
  );
}
