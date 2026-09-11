import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function deskRoot(): string {
  const fromMeta = dirname(fileURLToPath(import.meta.url));
  const candidates = [fromMeta, join(process.cwd(), "src", "main", "desk")];
  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "fixtures")) ||
      existsSync(join(candidate, "models")) ||
      existsSync(join(candidate, "monitor.ts"))
    ) {
      return candidate;
    }
  }
  return fromMeta;
}
