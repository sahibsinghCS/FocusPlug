import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Start (and tear down) the Vite preview server a stills script screenshots.
 *
 * The stills scripts used to assume somebody had already run the preview by
 * hand in another terminal, so on a fresh clone they died with
 * ERR_CONNECTION_REFUSED. Now each script owns its server: it reuses one that
 * is already listening (so `npm run renderer:preview` in another terminal
 * still works), otherwise spawns Vite and kills it on the way out.
 *
 * Vite is launched through `node node_modules/vite/bin/vite.js` rather than
 * the `.bin` shim so the same code path works on Windows.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

async function isListening(origin) {
  try {
    const response = await fetch(origin, { redirect: "manual" });
    // Any HTTP answer means something is serving; Vite 404s unknown roots.
    return response.status > 0;
  } catch {
    return false;
  }
}

async function waitFor(origin, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child !== null && child.exitCode !== null) {
      throw new Error(`vite exited with code ${child.exitCode} before serving ${origin}`);
    }
    if (await isListening(origin)) {
      return;
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`vite did not serve ${origin} within ${timeoutMs}ms`);
}

/**
 * @param {object} options
 * @param {string} options.config  Vite config path, relative to the repo root.
 * @param {number} options.port    Port the config pins with `strictPort`.
 * @param {string} [options.base]  Caller's env override; used verbatim, never spawned.
 * @param {string} [options.host]  Defaults to 127.0.0.1.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ origin: string, stop: () => Promise<void> }>}
 */
export async function startPreview(options) {
  if (typeof options.base === "string" && options.base.length > 0) {
    return { origin: options.base.replace(/\/$/, ""), stop: async () => {} };
  }
  const host = options.host ?? "127.0.0.1";
  const origin = `http://${host}:${options.port}`;

  if (await isListening(origin)) {
    console.log(`reusing preview already serving ${origin}`);
    return { origin, stop: async () => {} };
  }

  const viteBin = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  const child = spawn(process.execPath, [viteBin, "--config", options.config], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const ended = new Promise((done) => child.once("exit", done));
    child.kill("SIGTERM");
    const forced = setTimeout(() => child.kill("SIGKILL"), 3000);
    await ended;
    clearTimeout(forced);
  };

  try {
    await waitFor(origin, child, options.timeoutMs ?? 60_000);
  } catch (error) {
    await stop();
    throw error;
  }
  console.log(`started preview (${options.config}) at ${origin}`);
  return { origin, stop };
}
