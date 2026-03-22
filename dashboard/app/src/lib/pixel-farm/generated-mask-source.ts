import type { PixelFarmAssetTileSelection } from "@/lib/pixel-farm/tileset-config";

export interface PixelFarmGeneratedTileOverride extends PixelFarmAssetTileSelection {
  stamped?: boolean;
}

export interface PixelFarmGeneratedLayerPayload {
  id: string;
  label: string;
  baseTile: PixelFarmAssetTileSelection;
  mask: string[];
  overrides: Record<string, PixelFarmGeneratedTileOverride>;
}

export interface PixelFarmGeneratedMaskPayload {
  layers: PixelFarmGeneratedLayerPayload[];
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function buildTile(tile: PixelFarmGeneratedTileOverride): string {
  if (tile.stamped) {
    return `{ sourceId: ${quote(tile.sourceId)}, frame: ${tile.frame}, stamped: true }`;
  }

  return `{ sourceId: ${quote(tile.sourceId)}, frame: ${tile.frame} }`;
}

function buildOverrides(overrides: Record<string, PixelFarmGeneratedTileOverride>): string[] {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return ["    overrides: {},"]; 
  }

  return [
    "    overrides: {",
    ...entries.map(([key, tile]) => `      ${quote(key)}: ${buildTile(tile)},`),
    "    },",
  ];
}

function buildLayer(layer: PixelFarmGeneratedLayerPayload): string {
  const lines = [
    "  {",
    `    id: ${quote(layer.id)},`,
    `    label: ${quote(layer.label)},`,
    `    baseTile: ${buildTile(layer.baseTile)},`,
    "    mask: [",
    ...layer.mask.map((row) => `      ${quote(row)},`),
    "    ],",
    ...buildOverrides(layer.overrides),
    "  },",
  ];

  return lines.join("\n");
}

export function buildPixelFarmGeneratedMaskSource(
  payload: PixelFarmGeneratedMaskPayload,
): string {
  return [
    "export const PIXEL_FARM_GENERATED_LAYERS = [",
    ...payload.layers.map(buildLayer),
    "] as const;",
  ].join("\n");
}
