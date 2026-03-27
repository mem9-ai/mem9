import type {
  PixelFarmAssetSourceId,
  PixelFarmAssetTileSelection,
} from "@/lib/pixel-farm/tileset-config";

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
  objects: PixelFarmGeneratedObjectPlacement[];
  objectGroups: PixelFarmGeneratedObjectGroup[];
  collisions: PixelFarmGeneratedCollisionCell[];
}

export interface PixelFarmGeneratedObjectPlacement {
  id: string;
  layerId: string;
  sourceId: PixelFarmAssetSourceId;
  frame: number;
  row: number;
  column: number;
  groupId?: string;
}

export interface PixelFarmGeneratedObjectGroup {
  id: string;
  sortRow: number;
  sortColumn: number;
}

export interface PixelFarmGeneratedCollisionCell {
  id: string;
  halfTileRow: number;
  halfTileColumn: number;
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

function buildObject(object: PixelFarmGeneratedObjectPlacement): string {
  const lines = [
    "  {",
    `    id: ${quote(object.id)},`,
    `    layerId: ${quote(object.layerId)},`,
    `    sourceId: ${quote(object.sourceId)},`,
    `    frame: ${object.frame},`,
    `    row: ${object.row},`,
    `    column: ${object.column},`,
  ];

  if (object.groupId) {
    lines.push(`    groupId: ${quote(object.groupId)},`);
  }

  lines.push("  },");
  return lines.join("\n");
}

function buildObjectGroup(group: PixelFarmGeneratedObjectGroup): string {
  return [
    "  {",
    `    id: ${quote(group.id)},`,
    `    sortRow: ${group.sortRow},`,
    `    sortColumn: ${group.sortColumn},`,
    "  },",
  ].join("\n");
}

function buildCollision(cell: PixelFarmGeneratedCollisionCell): string {
  return [
    "  {",
    `    id: ${quote(cell.id)},`,
    `    halfTileRow: ${cell.halfTileRow},`,
    `    halfTileColumn: ${cell.halfTileColumn},`,
    "  },",
  ].join("\n");
}

export function buildPixelFarmGeneratedMaskSource(
  payload: PixelFarmGeneratedMaskPayload,
): string {
  return [
    "export const PIXEL_FARM_GENERATED_LAYERS = [",
    ...payload.layers.map(buildLayer),
    "] as const;",
    "",
    "export const PIXEL_FARM_GENERATED_OBJECTS = [",
    ...payload.objects.map(buildObject),
    "] as const;",
    "",
    "export const PIXEL_FARM_GENERATED_OBJECT_GROUPS = [",
    ...payload.objectGroups.map(buildObjectGroup),
    "] as const;",
    "",
    "export const PIXEL_FARM_GENERATED_COLLISIONS = [",
    ...payload.collisions.map(buildCollision),
    "] as const;",
  ].join("\n");
}
