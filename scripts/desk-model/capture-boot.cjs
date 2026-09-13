// Electron entry point for `capture-attention.ts`.
//
// Electron's main process runs CommonJS JavaScript, so the TypeScript require
// hook is registered here first (tsx is already a devDependency — no new
// package) and then the real script is loaded. `capture-attention.ts`
// relaunches itself through this file so it can open `ElectronCameraSource`
// from src/main/desk/camera.ts, the same camera source the shipped desk
// monitor uses. Flags travel in FOCUSPLUG_CAPTURE_ARGS because Electron
// rewrites `process.argv` with its own switches.
require("tsx/cjs");
require("./capture-attention.ts");
