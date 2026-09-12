import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { loadGraphModel } from "@tensorflow/tfjs-converter";
import { join } from "node:path";
import { deskRoot } from "../../src/main/desk/assets";
import { filesystemGraphModelHandler } from "../../src/main/desk/model-io";

async function main(): Promise<void> {
  await tf.setBackend("cpu");
  await tf.ready();
  const dir = join(deskRoot(), "model", "weights", "mobilenet");
  const model = await loadGraphModel(filesystemGraphModelHandler(dir));
  console.log("inputs:", model.inputs.map((i) => `${i.name} ${JSON.stringify(i.shape)}`));
  console.log("outputs:", model.outputs.map((o) => `${o.name} ${JSON.stringify(o.shape)}`));
  const input = tf.zeros([1, 160, 160, 3]);
  const t0 = Date.now();
  const out = model.execute({ images: input }) as tf.Tensor;
  console.log("execute ms:", Date.now() - t0, "shape:", out.shape);
  out.dispose();
  const t1 = Date.now();
  const out2 = model.execute({ images: input }) as tf.Tensor;
  console.log("execute #2 ms:", Date.now() - t1);
  out2.dispose();
  input.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
