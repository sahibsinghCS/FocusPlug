export function newEntryId(prefix: string): string {
  if (prefix.trim().length === 0) {
    throw new Error("Entry id prefix is required");
  }
  return `${prefix}-${crypto.randomUUID()}`;
}
