export function normalizePluginSpecForMatch(spec: string): string {
  const trimmed = spec.trim();
  if (
    trimmed.startsWith(".") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("file:") ||
    trimmed.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  ) {
    return trimmed;
  }

  if (!trimmed.startsWith("@")) {
    const versionAt = trimmed.indexOf("@");
    return versionAt === -1 ? trimmed : trimmed.slice(0, versionAt);
  }

  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return trimmed;
  }

  const nextSlash = trimmed.indexOf("/", slash + 1);
  const packageEnd = nextSlash === -1 ? trimmed.length : nextSlash;
  const packageSpec = trimmed.slice(0, packageEnd);
  const versionAt = packageSpec.indexOf("@", slash + 1);

  return versionAt === -1 ? packageSpec : packageSpec.slice(0, versionAt);
}

export function resolveServerPluginSpec(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  if (trimmed.endsWith("/tui")) {
    return trimmed.slice(0, -4);
  }

  if (trimmed.endsWith("\\tui")) {
    return trimmed.slice(0, -4);
  }

  const tsMatch = trimmed.match(/([\\/])tui\1index\.ts$/);
  if (tsMatch) {
    const sep = tsMatch[1];
    return trimmed.replace(/[\\/]tui[\\/]index\.ts$/, `${sep}src${sep}index.ts`);
  }

  const jsMatch = trimmed.match(/([\\/])tui\1index\.js$/);
  if (jsMatch) {
    const sep = jsMatch[1];
    return trimmed.replace(/[\\/]tui[\\/]index\.js$/, `${sep}src${sep}index.js`);
  }

  return trimmed;
}
