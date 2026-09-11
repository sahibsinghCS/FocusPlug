import type { PlugDevice } from "../../shared/types.ts";

/** Fun/secondary devices for harness + Demo Kill. Never includes a study PC. */
export const SAMPLE_PLUGS: PlugDevice[] = [
  {
    id: "console-lamp",
    name: "Console lamp",
    protocol: "mock",
    address: "127.0.0.1",
    enabled: true,
    isStudyPc: false,
  },
  {
    id: "tv-outlet",
    name: "TV outlet",
    protocol: "mock",
    address: "127.0.0.2",
    enabled: true,
    isStudyPc: false,
  },
];
