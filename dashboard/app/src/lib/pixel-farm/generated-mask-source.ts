export interface PixelFarmGeneratedMaskPayload {
  masks: {
    soil: string[];
    grassDark: string[];
    grassLight: string[];
    bush: string[];
  };
  overrides: {
    soil: Record<string, number>;
    grassDark: Record<string, number>;
    grassLight: Record<string, number>;
    bush: Record<string, number>;
  };
}

function buildMaskSection(name: string, rows: string[]): string {
  const body = rows.map((row) => `  "${row}",`).join("\n");
  return `export const ${name} = [\n${body}\n] as const;`;
}

function buildOverrideSection(name: string, overrides: Record<string, number>): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return `export const ${name} = {};`;
  }

  const body = entries
    .map(([key, frame]) => `  "${key}": ${frame},`)
    .join("\n");
  return `export const ${name} = {\n${body}\n};`;
}

export function buildPixelFarmGeneratedMaskSource(
  payload: PixelFarmGeneratedMaskPayload,
): string {
  return [
    buildMaskSection("SOIL_MASK", payload.masks.soil),
    buildMaskSection("GRASS_DARK_MASK", payload.masks.grassDark),
    buildMaskSection("GRASS_LIGHT_MASK", payload.masks.grassLight),
    buildMaskSection("BUSH_MASK", payload.masks.bush),
    buildOverrideSection("SOIL_TILE_OVERRIDES", payload.overrides.soil),
    buildOverrideSection("GRASS_DARK_TILE_OVERRIDES", payload.overrides.grassDark),
    buildOverrideSection("GRASS_LIGHT_TILE_OVERRIDES", payload.overrides.grassLight),
    buildOverrideSection("BUSH_TILE_OVERRIDES", payload.overrides.bush),
  ].join("\n\n");
}
