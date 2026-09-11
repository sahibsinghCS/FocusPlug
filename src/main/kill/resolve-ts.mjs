import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolve extensionless relative imports to .ts so the gauntlet probe can run
 * with `node --experimental-strip-types` without changing repo tsconfig.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!context.parentURL) {
      throw error;
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const tsCandidate = join(parentDir, `${specifier}.ts`);
      if (existsSync(tsCandidate)) {
        return nextResolve(pathToFileURL(tsCandidate).href, context);
      }
    }
    throw error;
  }
}
