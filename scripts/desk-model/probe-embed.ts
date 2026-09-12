import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { loadGraphModel } from "@tensorflow/tfjs-converter";
import { join } from "node:path";
import { deskRoot } from "../../src/main/desk/assets";
import { filesystemGraphModelHandler } from "../../src/main/desk/model-io";

/** Probe: execute the local BlazeFace graph to intermediate backbone nodes
 * and print their shapes — feasibility check for deep embedding features. */
const MID = "StatefulPartitionedCall/model/activation_11/Relu";
const LATE = "StatefulPartitionedCall/model/activation_16/Relu";

async function main(): Promise<void> {
  await tf.setBackend("cpu");
  await tf.ready();
  const dir = join(deskRoot(), "models", "blazeface");
  const model = await loadGraphModel(filesystemGraphModelHandler(dir));
  const input = tf.zeros([1, 128, 128, 3]);
  const started = Date.now();
  const outputs = model.execute({ input }, [MID, LATE]) as tf.Tensor[];
  console.log("execute ms:", Date.now() - started);
  for (const [index, tensor] of outputs.entries()) {
    console.log(index === 0 ? "mid" : "late", tensor.shape);
    tensor.dispose();
  }
  const second = Date.now();
  const again = model.execute({ input }, [MID, LATE]) as tf.Tensor[];
  console.log("execute #2 ms:", Date.now() - second);
  again.forEach((t) => t.dispose());
  input.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
