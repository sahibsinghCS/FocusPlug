/// <reference types="vite/client" />

/**
 * BlazeFace graph + weights, inlined at build time by the
 * `focusplug-blazeface-weights` plugin in `demo/vite.config.ts`. Kept loose on
 * purpose: the adapter validates the shape it needs before handing anything to
 * tfjs, and the real contract lives in tfjs' own `io.ModelArtifacts`.
 */
declare module "virtual:focusplug/blazeface-weights" {
  export const modelJson: {
    format?: string;
    generatedBy?: string;
    convertedBy?: string;
    modelTopology: object;
    weightsManifest: Array<{ paths: string[]; weights: unknown[] }>;
  };
  export const weightsBase64: string;
}
