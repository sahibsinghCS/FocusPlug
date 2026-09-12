import { readFeatureRows } from "./lib";
import { deskHeadPredict, loadDeskHeadWeights } from "../../src/main/desk/model/your-model";

/** Miss autopsy: for each raw label, how many misses have no detectable face
 * at any crop scale, and what they were predicted as. */
const weights = loadDeskHeadWeights();
if (!weights) {
  throw new Error("no weights");
}
const rows = readFeatureRows().filter((r) => r.split === "eval" && r.bucket === "main");
interface Bucket {
  n: number;
  noFace: number;
  someFace: number;
  pred: Record<string, number>;
  examples: string[];
}
const stats: Record<string, Bucket> = {};
for (const r of rows) {
  const pred = deskHeadPredict(weights, r.vector).label;
  if (pred === r.mapped) {
    continue;
  }
  const v = r.vector;
  const faceMax = Math.max(v[154] ?? 0, v[168] ?? 0, v[171] ?? 0, v[174] ?? 0);
  const s = (stats[r.label] = stats[r.label] ?? {
    n: 0,
    noFace: 0,
    someFace: 0,
    pred: {},
    examples: [],
  });
  s.n += 1;
  if (faceMax < 0.5) {
    s.noFace += 1;
  } else {
    s.someFace += 1;
  }
  s.pred[pred] = (s.pred[pred] ?? 0) + 1;
  if (s.examples.length < 6) {
    s.examples.push(`${r.path} ->${pred} face:${faceMax.toFixed(2)}`);
  }
}
console.log(JSON.stringify(stats, null, 1));
