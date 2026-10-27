export function normalizeRelativePath(input: string): string {
  const normalized = input.replaceAll("\\", "/").trim();
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/")) {
    throw new Error("File paths must be non-empty relative paths.");
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    throw new Error("File paths must not include drive prefixes.");
  }

  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("File path traversal is not allowed.");
    parts.push(part);
  }
  if (parts.length === 0) throw new Error("File paths must be non-empty relative paths.");
  return parts.join("/");
}
