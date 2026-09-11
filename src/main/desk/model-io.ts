import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { io } from "@tensorflow/tfjs-core";

interface GraphModelJson {
  format?: string;
  generatedBy?: string;
  convertedBy?: string;
  modelTopology: object;
  weightsManifest: Array<{
    paths: string[];
    weights: io.WeightsManifestEntry[];
  }>;
}

export function filesystemGraphModelHandler(modelDir: string): io.IOHandler {
  return {
    load: async () => {
      const json = JSON.parse(
        readFileSync(join(modelDir, "model.json"), "utf8"),
      ) as GraphModelJson;
      const specs: io.WeightsManifestEntry[] = [];
      const chunks: Buffer[] = [];
      for (const group of json.weightsManifest) {
        specs.push(...group.weights);
        for (const rel of group.paths) {
          chunks.push(readFileSync(join(modelDir, rel)));
        }
      }
      const weightData = Buffer.concat(chunks);
      return {
        modelTopology: json.modelTopology,
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        weightSpecs: specs,
        weightData: weightData.buffer.slice(
          weightData.byteOffset,
          weightData.byteOffset + weightData.byteLength,
        ),
      };
    },
  };
}
