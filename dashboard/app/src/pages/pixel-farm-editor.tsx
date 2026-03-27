import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  maskHasTile,
  PIXEL_FARM_COLLISIONS,
  PIXEL_FARM_LAYERS,
  PIXEL_FARM_MASK_COLUMNS,
  PIXEL_FARM_MASK_ROWS,
  PIXEL_FARM_OBJECT_GROUPS,
  PIXEL_FARM_OBJECTS,
  tileOverrideAt,
  tileOverrideKey,
  type PixelFarmCollisionCell,
  type PixelFarmLayer,
  type PixelFarmObjectGroup,
  type PixelFarmObjectPlacement,
  type PixelFarmTileOverride,
  type PixelFarmTileOverrideMap,
} from "@/lib/pixel-farm/island-mask";
import {
  PIXEL_FARM_ASSET_SOURCE_IDS,
  PIXEL_FARM_TILESET_CONFIG,
  type PixelFarmAssetSourceId,
  type PixelFarmAssetTileSelection,
} from "@/lib/pixel-farm/tileset-config";

type LayerState = Omit<PixelFarmLayer, "mask"> & { mask: string[] };
type ObjectState = PixelFarmObjectPlacement;
type ObjectGroupState = PixelFarmObjectGroup;
type CollisionState = PixelFarmCollisionCell;
type TerrainTool = "paint" | "erase" | "fill" | "rectangle";
type ObjectTool = "place" | "erase";
type CollisionTool = "paint" | "erase";
type CollisionBrushSize = 1 | 2;
type EditorMode = "terrain" | "objects" | "collision";

interface ObjectPaletteSelection {
  sourceId: PixelFarmAssetSourceId;
  frames: number[];
}

interface ContentState {
  layers: LayerState[];
  objects: ObjectState[];
  objectGroups: ObjectGroupState[];
  collisions: CollisionState[];
}

interface HistoryState {
  past: ContentState[];
  present: ContentState;
  future: ContentState[];
}

interface DragState {
  tool:
    | "paint"
    | "erase"
    | "rectangle"
    | "objectPlace"
    | "objectErase"
    | "sortMarkerMove"
    | "collisionPlace"
    | "collisionErase";
  layerId: string;
  filled: boolean;
  tile: PixelFarmTileOverride | null;
  groupId?: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

interface EditorState {
  content: ContentState;
  selectedLayerId: string;
  selectedTile: PixelFarmAssetTileSelection;
  objectPaletteSelection: ObjectPaletteSelection;
  editorMode: EditorMode;
  terrainTool: TerrainTool;
  objectTool: ObjectTool;
  collisionTool: CollisionTool;
  collisionBrushSize: CollisionBrushSize;
  cellSize: number;
}

interface HoveredCell {
  row: number;
  column: number;
}

interface HoveredCollision {
  halfTileRow: number;
  halfTileColumn: number;
}

interface ObjectStampTile {
  sourceId: PixelFarmAssetSourceId;
  frame: number;
  rowOffset: number;
  columnOffset: number;
}

const CELL_SIZE_MIN = 12;
const CELL_SIZE_MAX = 64;
const CELL_SIZE_STEP = 2;
const INITIAL_CELL_SIZE = 32;
const PALETTE_CELL_SIZE = 28;
const MAX_HISTORY = 100;
const DRAFT_STORAGE_KEY = "pixel-farm-mask-editor-draft-v11";
const EXPORT_ENDPOINT = "/your-memory/__pixel-farm/export-generated-mask-data";
const OBJECT_LAYER_ID = "objects";
const DEFAULT_SELECTED_TILE: PixelFarmAssetTileSelection = {
  sourceId: PIXEL_FARM_LAYERS[0]?.baseTile.sourceId ?? "soil",
  frame: PIXEL_FARM_LAYERS[0]?.baseTile.frame ?? 0,
};
const COPY = {
  eyebrow: "DEV TOOL",
  title: "Layer Editor",
  addLayer: "Add layer",
  deleteLayer: "Delete layer",
  modes: {
    terrain: "Terrain",
    objects: "Objects",
    collision: "Collision",
  },
  objectTools: {
    place: "Place",
    erase: "Erase object",
  },
  objectSelectionHint:
    "Click to select one tile. Shift-click extra tiles from the same spritesheet to place them as one grouped stamp.",
  sortMarkerHint:
    "Grouped object stamps get a sort marker you can drag to choose the shared y-sort row.",
  collisionTools: {
    paint: "Paint",
    erase: "Erase",
  },
  collisionBrush: "Brush",
  finalPreview: "Final preview",
  paletteTitle: "Tileset Palette",
  paletteHint: "Pick any tile from any spritesheet, then paint it into the selected layer.",
  exportTitle: "Export File",
  exportHint: "Writes the generated layer data file.",
  undo: "Undo",
  redo: "Redo",
  save: "Save to localStorage",
  saved: "Saved",
  export: "Write to file",
  exporting: "Exporting",
  exported: "Exported",
  exportFailed: "Export failed",
  zoomIn: "Zoom In",
  zoomOut: "Zoom Out",
  reset: "Reset source",
  selectedTile: "Selected tile",
  generatedFile: "Generated file",
  cancel: "Cancel",
  create: "Create",
  delete: "Delete",
  addDialogTitle: "Create layer",
  addDialogDescription: "Enter a name for the new layer.",
  addDialogField: "Layer name",
  deleteDialogTitle: "Delete layer",
  deleteDialogDescription: "Delete the selected layer and its tiles?",
  deleteDialogHint: "This action cannot be undone with export history.",
  tools: {
    paint: "Paint",
    erase: "Erase",
    fill: "Fill",
    rectangle: "Rectangle",
  },
} as const;

function cloneLayers(): LayerState[] {
  return ensureObjectLayer(
    PIXEL_FARM_LAYERS.map((layer) => ({
      id: layer.id,
      label: layer.label,
      baseTile: { ...layer.baseTile },
      mask: [...layer.mask],
      overrides: { ...layer.overrides },
    })),
  );
}

function cloneObjects(): ObjectState[] {
  return PIXEL_FARM_OBJECTS.map((object) => ({ ...object }));
}

function cloneObjectGroups(): ObjectGroupState[] {
  return PIXEL_FARM_OBJECT_GROUPS.map((group) => ({ ...group }));
}

function cloneCollisions(): CollisionState[] {
  return PIXEL_FARM_COLLISIONS.map((segment) => ({ ...segment }));
}

function cloneContent(): ContentState {
  return {
    layers: cloneLayers(),
    objects: cloneObjects(),
    objectGroups: cloneObjectGroups(),
    collisions: cloneCollisions(),
  };
}

function sameContent(left: ContentState, right: ContentState): boolean {
  if (
    left.layers === right.layers ||
    left.layers.length !== right.layers.length ||
    left.objects.length !== right.objects.length ||
    left.objectGroups.length !== right.objectGroups.length ||
    left.collisions.length !== right.collisions.length
  ) {
    return (
      left.layers === right.layers &&
      left.objects === right.objects &&
      left.objectGroups === right.objectGroups &&
      left.collisions === right.collisions
    );
  }

  return (
    left.layers.every((layer, index) => layer === right.layers[index]) &&
    left.objects.every((object, index) => object === right.objects[index]) &&
    left.objectGroups.every((group, index) => group === right.objectGroups[index]) &&
    left.collisions.every((collision, index) => collision === right.collisions[index])
  );
}

function appendPast(past: ContentState[], snapshot: ContentState): ContentState[] {
  if (past.length >= MAX_HISTORY) {
    return [...past.slice(1), snapshot];
  }

  return [...past, snapshot];
}

function buildEmptyMask(rows: number, columns: number): string[] {
  return Array.from({ length: rows }, () => ".".repeat(columns));
}

function defaultObjectLayer(): LayerState {
  const existing = PIXEL_FARM_LAYERS.find((layer) => layer.id === OBJECT_LAYER_ID);
  if (existing) {
    return {
      id: existing.id,
      label: existing.label,
      baseTile: { ...existing.baseTile },
      mask: [...existing.mask],
      overrides: { ...existing.overrides },
    };
  }

  return {
    id: OBJECT_LAYER_ID,
    label: "Objects",
    baseTile: { ...DEFAULT_SELECTED_TILE },
    mask: buildEmptyMask(PIXEL_FARM_MASK_ROWS, PIXEL_FARM_MASK_COLUMNS),
    overrides: {},
  };
}

function ensureObjectLayer(layers: readonly LayerState[]): LayerState[] {
  const terrainLayers = layers.filter((layer) => layer.id !== OBJECT_LAYER_ID);
  const objectLayer = layers.find((layer) => layer.id === OBJECT_LAYER_ID) ?? defaultObjectLayer();
  return [...terrainLayers, objectLayer];
}

function findObjectAtCell(
  objects: readonly ObjectState[],
  layerId: string,
  row: number,
  column: number,
): ObjectState | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index]!;
    if (object.layerId === layerId && object.row === row && object.column === column) {
      return object;
    }
  }

  return null;
}

function nextObjectID(objects: readonly ObjectState[]): string {
  let index = objects.length + 1;
  let id = `object-${index}`;

  while (objects.some((object) => object.id === id)) {
    index += 1;
    id = `object-${index}`;
  }

  return id;
}

function nextObjectGroupID(groups: readonly ObjectGroupState[]): string {
  let index = groups.length + 1;
  let id = `group-${index}`;

  while (groups.some((group) => group.id === id)) {
    index += 1;
    id = `group-${index}`;
  }

  return id;
}

function paletteFrameCell(sourceId: PixelFarmAssetSourceId, frame: number): { row: number; column: number } {
  const source = PIXEL_FARM_TILESET_CONFIG[sourceId];

  return {
    row: Math.floor(frame / source.columns),
    column: frame % source.columns,
  };
}

function buildObjectStampTiles(selection: ObjectPaletteSelection): ObjectStampTile[] {
  if (selection.frames.length < 1) {
    return [];
  }

  const cells = selection.frames.map((frame) => ({
    frame,
    ...paletteFrameCell(selection.sourceId, frame),
  }));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const minColumn = Math.min(...cells.map((cell) => cell.column));

  return cells
    .map((cell) => ({
      sourceId: selection.sourceId,
      frame: cell.frame,
      rowOffset: cell.row - minRow,
      columnOffset: cell.column - minColumn,
    }))
    .sort(
      (left, right) =>
        left.rowOffset - right.rowOffset ||
        left.columnOffset - right.columnOffset ||
        left.frame - right.frame,
    );
}

function defaultGroupSortMarker(
  row: number,
  column: number,
  tiles: readonly ObjectStampTile[],
): Pick<ObjectGroupState, "sortRow" | "sortColumn"> {
  if (tiles.length < 1) {
    return {
      sortRow: row,
      sortColumn: column,
    };
  }

  const maxRowOffset = Math.max(...tiles.map((tile) => tile.rowOffset));
  const minColumnOffset = Math.min(...tiles.map((tile) => tile.columnOffset));
  const maxColumnOffset = Math.max(...tiles.map((tile) => tile.columnOffset));

  return {
    sortRow: row + maxRowOffset,
    sortColumn: column + Math.floor((minColumnOffset + maxColumnOffset) / 2),
  };
}

function nextCollisionID(collisions: readonly CollisionState[]): string {
  let index = collisions.length + 1;
  let id = `collision-${index}`;

  while (collisions.some((collision) => collision.id === id)) {
    index += 1;
    id = `collision-${index}`;
  }

  return id;
}

function collisionPlacementKey(halfTileRow: number, halfTileColumn: number): string {
  return `${halfTileRow}:${halfTileColumn}`;
}

function collisionCellKey(segment: Pick<CollisionState, "halfTileRow" | "halfTileColumn">): string {
  return `${Math.floor(segment.halfTileRow / 2)}:${Math.floor(segment.halfTileColumn / 2)}`;
}

function findCollisionIndex(
  collisions: readonly CollisionState[],
  halfTileRow: number,
  halfTileColumn: number,
): number {
  return collisions.findIndex(
    (collision) => collision.halfTileRow === halfTileRow && collision.halfTileColumn === halfTileColumn,
  );
}

function collisionStyle(
  segment: Pick<CollisionState, "halfTileRow" | "halfTileColumn">,
  preview = false,
): CSSProperties {
  const fill = preview ? "rgba(255, 99, 71, 0.38)" : "rgba(185, 28, 28, 0.48)";

  return {
    left: `${(segment.halfTileColumn % 2) * 50}%`,
    top: `${(segment.halfTileRow % 2) * 50}%`,
    width: "50%",
    height: "50%",
    backgroundColor: fill,
  };
}

function collectCollisionBrushCells(
  target: HoveredCollision,
  brushSize: CollisionBrushSize,
): HoveredCollision[] {
  const cells: HoveredCollision[] = [];

  for (let rowOffset = 0; rowOffset < brushSize; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < brushSize; columnOffset += 1) {
      cells.push({
        halfTileRow: target.halfTileRow + rowOffset,
        halfTileColumn: target.halfTileColumn + columnOffset,
      });
    }
  }

  return cells;
}


function layerIndexById(layers: readonly LayerState[], layerId: string): number {
  return layers.findIndex((layer) => layer.id === layerId);
}

function setTileOverride(
  overrides: PixelFarmTileOverrideMap,
  row: number,
  column: number,
  tile: PixelFarmTileOverride | null,
): PixelFarmTileOverrideMap {
  const key = tileOverrideKey(row, column);
  const current = overrides[key];

  if (tile === null) {
    if (current === undefined) {
      return overrides;
    }

    const { [key]: _removed, ...rest } = overrides;
    return rest;
  }

  if (
    current?.sourceId === tile.sourceId &&
    current.frame === tile.frame &&
    current.stamped === tile.stamped
  ) {
    return overrides;
  }

  return {
    ...overrides,
    [key]: tile,
  };
}

function updateMaskCell(mask: string[], row: number, column: number, filled: boolean): string[] {
  const currentRow = mask[row];
  if (!currentRow || column < 0 || column >= currentRow.length) {
    return mask;
  }

  const nextCell = filled ? "#" : ".";
  if (currentRow[column] === nextCell) {
    return mask;
  }

  const nextRow = `${currentRow.slice(0, column)}${nextCell}${currentRow.slice(column + 1)}`;
  const nextMask = [...mask];
  nextMask[row] = nextRow;
  return nextMask;
}

function collectMaskArea(mask: readonly string[], row: number, column: number): Array<[number, number]> {
  const sourceRow = mask[row];
  if (!sourceRow || column < 0 || column >= sourceRow.length) {
    return [];
  }

  const target = sourceRow[column];
  const grid = mask.map((item) => item.split(""));
  const queue: Array<[number, number]> = [[row, column]];
  const visited = new Set<string>();
  const cells: Array<[number, number]> = [];

  while (queue.length > 0) {
    const [currentRow, currentColumn] = queue.shift()!;
    const key = `${currentRow}:${currentColumn}`;
    if (visited.has(key)) {
      continue;
    }

    visited.add(key);
    if (grid[currentRow]?.[currentColumn] !== target) {
      continue;
    }

    cells.push([currentRow, currentColumn]);
    queue.push([currentRow - 1, currentColumn]);
    queue.push([currentRow + 1, currentColumn]);
    queue.push([currentRow, currentColumn - 1]);
    queue.push([currentRow, currentColumn + 1]);
  }

  return cells;
}

function collectMaskRect(
  mask: readonly string[],
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
): Array<[number, number]> {
  const top = Math.min(startRow, endRow);
  const bottom = Math.max(startRow, endRow);
  const left = Math.min(startColumn, endColumn);
  const right = Math.max(startColumn, endColumn);
  const cells: Array<[number, number]> = [];

  for (let row = top; row <= bottom; row += 1) {
    const currentRow = mask[row];
    if (!currentRow) {
      continue;
    }

    for (let column = left; column <= right; column += 1) {
      if (column < 0 || column >= currentRow.length) {
        continue;
      }

      cells.push([row, column]);
    }
  }

  return cells;
}

function sameTileSelection(
  left: PixelFarmTileOverride,
  right: PixelFarmAssetTileSelection,
): boolean {
  return left.sourceId === right.sourceId && left.frame === right.frame;
}

function normalizeOverrideTile(
  layer: LayerState,
  tile: PixelFarmTileOverride | null,
): PixelFarmTileOverride | null {
  if (!tile || sameTileSelection(tile, layer.baseTile)) {
    return null;
  }

  return tile;
}

function mutateLayerCells(
  layer: LayerState,
  cells: readonly (readonly [number, number])[],
  filled: boolean | null,
  tile: PixelFarmTileOverride | null | undefined,
): LayerState {
  let nextMask = layer.mask;
  let nextOverrides = layer.overrides;

  for (const [row, column] of cells) {
    if (filled !== null) {
      nextMask = updateMaskCell(nextMask, row, column, filled);
    }

    if (tile === undefined) {
      continue;
    }

    if (!maskHasTile(nextMask, row, column)) {
      nextOverrides = setTileOverride(nextOverrides, row, column, null);
      continue;
    }

    nextOverrides = setTileOverride(nextOverrides, row, column, normalizeOverrideTile(layer, tile));
  }

  if (nextMask !== layer.mask) {
    nextOverrides = pruneOverrideMap(nextMask, nextOverrides);
  }

  if (nextMask === layer.mask && nextOverrides === layer.overrides) {
    return layer;
  }

  return {
    ...layer,
    mask: nextMask,
    overrides: nextOverrides,
  };
}

function sanitizeAssetTileSelection(input: unknown): PixelFarmAssetTileSelection | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const sourceId = (input as { sourceId?: unknown }).sourceId;
  const frame = (input as { frame?: unknown }).frame;
  if (
    typeof sourceId !== "string" ||
    !PIXEL_FARM_ASSET_SOURCE_IDS.includes(sourceId as PixelFarmAssetSourceId) ||
    typeof frame !== "number" ||
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame >= PIXEL_FARM_TILESET_CONFIG[sourceId as PixelFarmAssetSourceId].frameCount
  ) {
    return null;
  }

  return {
    sourceId: sourceId as PixelFarmAssetSourceId,
    frame,
  };
}

function sanitizeTileOverride(input: unknown): PixelFarmTileOverride | null {
  const tile = sanitizeAssetTileSelection(input);
  if (!tile) {
    return null;
  }

  const stamped =
    input && typeof input === "object" && !Array.isArray(input) && typeof (input as { stamped?: unknown }).stamped === "boolean"
      ? (input as { stamped: boolean }).stamped
      : undefined;

  return stamped === undefined ? tile : { ...tile, stamped };
}

function pruneOverrideMap(
  mask: readonly string[],
  overrides: PixelFarmTileOverrideMap,
): PixelFarmTileOverrideMap {
  let changed = false;
  const next: PixelFarmTileOverrideMap = {};

  for (const [key, value] of Object.entries(overrides)) {
    const [rowText, columnText] = key.split(":");
    const row = Number.parseInt(rowText ?? "", 10);
    const column = Number.parseInt(columnText ?? "", 10);

    if (Number.isNaN(row) || Number.isNaN(column) || !maskHasTile(mask, row, column)) {
      changed = true;
      continue;
    }

    const override = sanitizeTileOverride(value);
    if (!override) {
      changed = true;
      continue;
    }

    next[key] = override;
  }

  return changed ? next : overrides;
}

function sanitizeMaskRows(input: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(input)) {
    return [...fallback];
  }

  return fallback.map((fallbackRow, rowIndex) => {
    const rawRow = typeof input[rowIndex] === "string" ? (input[rowIndex] as string) : fallbackRow;
    return rawRow
      .slice(0, fallbackRow.length)
      .padEnd(fallbackRow.length, ".")
      .replace(/[^#.]/g, ".");
  });
}

function sanitizeLayerList(input: unknown, fallback: readonly LayerState[]): LayerState[] {
  if (!Array.isArray(input)) {
    return cloneLayers();
  }

  const usedIds = new Set<string>();
  const emptyMask = buildEmptyMask(PIXEL_FARM_MASK_ROWS, PIXEL_FARM_MASK_COLUMNS);
  const next: LayerState[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const rawId = (value as { id?: unknown }).id;
    const rawLabel = (value as { label?: unknown }).label;
    const rawBaseTile = (value as { baseTile?: unknown }).baseTile;
    const rawMask = (value as { mask?: unknown }).mask;
    const rawOverrides = (value as { overrides?: unknown }).overrides;

    let id = typeof rawId === "string" && rawId.trim() ? rawId.trim() : `layer-${index + 1}`;
    while (usedIds.has(id)) {
      id = `${id}-copy`;
    }
    usedIds.add(id);

    const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : `Layer ${index + 1}`;
    const baseTile = sanitizeAssetTileSelection(rawBaseTile) ?? fallback[index]?.baseTile ?? DEFAULT_SELECTED_TILE;
    const mask = sanitizeMaskRows(rawMask, emptyMask);
    const overrides = pruneOverrideMap(
      mask,
      typeof rawOverrides === "object" && rawOverrides && !Array.isArray(rawOverrides)
        ? (rawOverrides as PixelFarmTileOverrideMap)
        : {},
    );

    next.push({
      id,
      label,
      baseTile,
      mask,
      overrides,
    });
  }

  return ensureObjectLayer(next.length > 0 ? next : cloneLayers());
}

function sanitizeObjectList(input: unknown, layers: readonly LayerState[]): ObjectState[] {
  if (!Array.isArray(input)) {
    return cloneObjects();
  }

  const layerIDs = new Set(layers.map((layer) => layer.id));
  const objects: ObjectState[] = [];
  const usedIDs = new Set<string>();

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const rawID = (value as { id?: unknown }).id;
    const rawLayerID = (value as { layerId?: unknown }).layerId;
    const rawRow = (value as { row?: unknown }).row;
    const rawColumn = (value as { column?: unknown }).column;
    const rawGroupID = (value as { groupId?: unknown }).groupId;
    const tile = sanitizeAssetTileSelection(value);

    if (
      typeof rawID !== "string" ||
      !rawID.trim() ||
      usedIDs.has(rawID) ||
      typeof rawLayerID !== "string" ||
      !layerIDs.has(rawLayerID) ||
      typeof rawRow !== "number" ||
      !Number.isInteger(rawRow) ||
      rawRow < 0 ||
      typeof rawColumn !== "number" ||
      !Number.isInteger(rawColumn) ||
      rawColumn < 0 ||
      !tile
    ) {
      continue;
    }

    usedIDs.add(rawID);
    objects.push({
      id: rawID,
      layerId: rawLayerID,
      sourceId: tile.sourceId,
      frame: tile.frame,
      row: rawRow,
      column: rawColumn,
      groupId: typeof rawGroupID === "string" && rawGroupID.trim() ? rawGroupID : undefined,
    });
  }

  return objects;
}

function sanitizeObjectGroupList(input: unknown): ObjectGroupState[] {
  if (!Array.isArray(input)) {
    return cloneObjectGroups();
  }

  const groups: ObjectGroupState[] = [];
  const usedIDs = new Set<string>();

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const rawID = (value as { id?: unknown }).id;
    const rawSortRow = (value as { sortRow?: unknown }).sortRow;
    const rawSortColumn = (value as { sortColumn?: unknown }).sortColumn;

    if (
      typeof rawID !== "string" ||
      !rawID.trim() ||
      usedIDs.has(rawID) ||
      typeof rawSortRow !== "number" ||
      !Number.isInteger(rawSortRow) ||
      rawSortRow < 0 ||
      typeof rawSortColumn !== "number" ||
      !Number.isInteger(rawSortColumn) ||
      rawSortColumn < 0
    ) {
      continue;
    }

    usedIDs.add(rawID);
    groups.push({
      id: rawID,
      sortRow: rawSortRow,
      sortColumn: rawSortColumn,
    });
  }

  return groups;
}

function sanitizeCollisionList(input: unknown): CollisionState[] {
  if (!Array.isArray(input)) {
    return cloneCollisions();
  }

  const collisions: CollisionState[] = [];
  const usedIDs = new Set<string>();
  const usedPlacements = new Set<string>();

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const rawID = (value as { id?: unknown }).id;
    const rawQuarterRow = (value as { halfTileRow?: unknown }).halfTileRow;
    const rawQuarterColumn = (value as { halfTileColumn?: unknown }).halfTileColumn;

    if (
      typeof rawID === "string" &&
      rawID.trim() &&
      !usedIDs.has(rawID) &&
      typeof rawQuarterRow === "number" &&
      Number.isInteger(rawQuarterRow) &&
      rawQuarterRow >= 0 &&
      typeof rawQuarterColumn === "number" &&
      Number.isInteger(rawQuarterColumn) &&
      rawQuarterColumn >= 0
    ) {
      const placementKey = collisionPlacementKey(rawQuarterRow, rawQuarterColumn);
      if (usedPlacements.has(placementKey)) {
        continue;
      }

      usedIDs.add(rawID);
      usedPlacements.add(placementKey);
      collisions.push({
        id: rawID,
        halfTileRow: rawQuarterRow,
        halfTileColumn: rawQuarterColumn,
      });
      continue;
    }

    const rawOrientation = (value as { orientation?: unknown }).orientation;
    const rawHalfRow = (value as { halfRow?: unknown }).halfRow;
    const rawHalfColumn = (value as { halfColumn?: unknown }).halfColumn;

    if (
      typeof rawID !== "string" ||
      !rawID.trim() ||
      usedIDs.has(rawID) ||
      (rawOrientation !== "horizontal" && rawOrientation !== "vertical") ||
      typeof rawHalfRow !== "number" ||
      !Number.isInteger(rawHalfRow) ||
      rawHalfRow < 0 ||
      typeof rawHalfColumn !== "number" ||
      !Number.isInteger(rawHalfColumn) ||
      rawHalfColumn < 0
    ) {
      continue;
    }

    const halfTileRowBase = rawHalfRow;
    const halfTileColumnBase = rawHalfColumn;
    const quarterCells: Array<[number, number]> =
      rawOrientation === "horizontal"
        ? [
            [halfTileRowBase, halfTileColumnBase],
            [halfTileRowBase, halfTileColumnBase + 1],
          ]
        : [
            [halfTileRowBase, halfTileColumnBase],
            [halfTileRowBase + 1, halfTileColumnBase],
          ];

    let migrated = false;
    for (const [halfTileRow, halfTileColumn] of quarterCells) {
      const placementKey = collisionPlacementKey(halfTileRow, halfTileColumn);
      if (usedPlacements.has(placementKey)) {
        continue;
      }

      usedPlacements.add(placementKey);
      collisions.push({
        id: migrated ? nextCollisionID(collisions) : rawID,
        halfTileRow,
        halfTileColumn,
      });
      migrated = true;
    }

    if (migrated) {
      usedIDs.add(rawID);
    }
  }

  return collisions;
}

function frameStyle(sourceId: PixelFarmAssetSourceId, frame: number, size: number): CSSProperties {
  const tileset = PIXEL_FARM_TILESET_CONFIG[sourceId];
  const frameColumn = frame % tileset.columns;
  const frameRow = Math.floor(frame / tileset.columns);

  return {
    backgroundImage: `url(${tileset.imageUrl})`,
    backgroundPosition: `-${frameColumn * size}px -${frameRow * size}px`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${tileset.columns * size}px ${tileset.rows * size}px`,
    imageRendering: "pixelated",
  };
}

function sourceColor(sourceId: PixelFarmAssetSourceId): string {
  switch (sourceId) {
    case "soil":
      return "#9e7c53";
    case "grassDark":
      return "#87bb63";
    case "grassLight":
      return "#bedc7f";
    case "bush":
      return "#4a7a36";
    default:
      return "#c7b082";
  }
}

function previewTile(layer: LayerState, row: number, column: number): PixelFarmAssetTileSelection | null {
  if (!maskHasTile(layer.mask, row, column)) {
    return null;
  }

  return tileOverrideAt(layer.overrides, row, column) ?? layer.baseTile;
}

function previewTilesForLayers(
  layers: readonly LayerState[],
  objects: readonly ObjectState[],
  row: number,
  column: number,
): PixelFarmAssetTileSelection[] {
  const tiles: PixelFarmAssetTileSelection[] = [];

  for (const layer of layers) {
    const terrainTile = previewTile(layer, row, column);
    if (terrainTile) {
      tiles.push(terrainTile);
    }

    for (const object of objects) {
      if (object.layerId === layer.id && object.row === row && object.column === column) {
        tiles.push({
          sourceId: object.sourceId,
          frame: object.frame,
        });
      }
    }
  }

  return tiles;
}

function backgroundColor(layers: readonly LayerState[], row: number, column: number): string {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const tile = previewTile(layers[index]!, row, column);
    if (tile) {
      return sourceColor(tile.sourceId);
    }
  }

  return "#9bd4c3";
}

function loadDraftState(): EditorState {
  const defaults: EditorState = {
    content: cloneContent(),
    selectedLayerId: PIXEL_FARM_LAYERS[0]?.id ?? "",
    selectedTile: { ...DEFAULT_SELECTED_TILE },
    objectPaletteSelection: {
      sourceId: DEFAULT_SELECTED_TILE.sourceId,
      frames: [DEFAULT_SELECTED_TILE.frame],
    },
    editorMode: "terrain",
    terrainTool: "paint",
    objectTool: "place",
    collisionTool: "paint",
    collisionBrushSize: 1,
    cellSize: INITIAL_CELL_SIZE,
  };

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as {
      layers?: unknown;
      objects?: unknown;
      objectGroups?: unknown;
      collisions?: unknown;
      selectedLayerId?: unknown;
      selectedTile?: unknown;
      objectPaletteSelection?: unknown;
      editorMode?: unknown;
      terrainTool?: unknown;
      objectTool?: unknown;
      collisionTool?: unknown;
      collisionBrushSize?: unknown;
      cellSize?: unknown;
    };
    const layers = sanitizeLayerList(parsed.layers, defaults.content.layers);
    const objectGroups = sanitizeObjectGroupList(parsed.objectGroups);
    const groupIDs = new Set(objectGroups.map((group) => group.id));
    const objects = sanitizeObjectList(parsed.objects, layers).map((object) => ({
      ...object,
      groupId: object.groupId && groupIDs.has(object.groupId) ? object.groupId : undefined,
    }));
    const collisions = sanitizeCollisionList(parsed.collisions);
    const selectedLayerId =
      typeof parsed.selectedLayerId === "string" &&
      layers.some((layer) => layer.id === parsed.selectedLayerId)
        ? parsed.selectedLayerId
        : layers[0]!.id;

    return {
      content: { layers, objects, objectGroups, collisions },
      selectedLayerId,
      selectedTile: sanitizeAssetTileSelection(parsed.selectedTile) ?? { ...DEFAULT_SELECTED_TILE },
      objectPaletteSelection:
        (() => {
          const value = parsed.objectPaletteSelection;
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return defaults.objectPaletteSelection;
          }

          const rawSourceID = (value as { sourceId?: unknown }).sourceId;
          const rawFrames = (value as { frames?: unknown }).frames;
          if (
            typeof rawSourceID !== "string" ||
            !PIXEL_FARM_ASSET_SOURCE_IDS.includes(rawSourceID as PixelFarmAssetSourceId) ||
            !Array.isArray(rawFrames)
          ) {
            return defaults.objectPaletteSelection;
          }

          const frames = Array.from(
            new Set(
              rawFrames.filter(
                (frame): frame is number =>
                  typeof frame === "number" &&
                  Number.isInteger(frame) &&
                  frame >= 0 &&
                  frame < PIXEL_FARM_TILESET_CONFIG[rawSourceID as PixelFarmAssetSourceId].frameCount,
              ),
            ),
          ).sort((left, right) => left - right);

          return frames.length > 0
            ? {
                sourceId: rawSourceID as PixelFarmAssetSourceId,
                frames,
              }
            : defaults.objectPaletteSelection;
        })(),
      editorMode:
        parsed.editorMode === "objects" || parsed.editorMode === "collision"
          ? parsed.editorMode
          : defaults.editorMode,
      terrainTool:
        parsed.terrainTool === "paint" ||
        parsed.terrainTool === "erase" ||
        parsed.terrainTool === "fill" ||
        parsed.terrainTool === "rectangle"
          ? parsed.terrainTool
          : defaults.terrainTool,
      objectTool:
        parsed.objectTool === "erase" || parsed.objectTool === "place"
          ? parsed.objectTool
          : defaults.objectTool,
      collisionTool:
        parsed.collisionTool === "erase" || parsed.collisionTool === "paint"
          ? parsed.collisionTool
          : defaults.collisionTool,
      collisionBrushSize:
        parsed.collisionBrushSize === 1 || parsed.collisionBrushSize === 2
          ? parsed.collisionBrushSize
          : defaults.collisionBrushSize,
      cellSize:
        typeof parsed.cellSize === "number"
          ? Math.min(CELL_SIZE_MAX, Math.max(CELL_SIZE_MIN, parsed.cellSize))
          : defaults.cellSize,
    };
  } catch {
    return defaults;
  }
}

function nextLayerID(layers: readonly LayerState[]): string {
  let index = layers.length + 1;
  let id = `layer-${index}`;

  while (layers.some((layer) => layer.id === id)) {
    index += 1;
    id = `layer-${index}`;
  }

  return id;
}

function nextLayerLabel(layers: readonly LayerState[]): string {
  return `Layer ${layers.length + 1}`;
}

export function PixelFarmEditorPage() {
  const initialState = useMemo(loadDraftState, []);
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialState.content,
    future: [],
  });
  const [selectedLayerId, setSelectedLayerId] = useState(initialState.selectedLayerId);
  const [selectedTile, setSelectedTile] = useState<PixelFarmAssetTileSelection>(initialState.selectedTile);
  const [objectPaletteSelection, setObjectPaletteSelection] = useState<ObjectPaletteSelection>(
    initialState.objectPaletteSelection,
  );
  const [editorMode, setEditorMode] = useState<EditorMode>(initialState.editorMode);
  const [terrainTool, setTerrainTool] = useState<TerrainTool>(initialState.terrainTool);
  const [objectTool, setObjectTool] = useState<ObjectTool>(initialState.objectTool);
  const [collisionTool, setCollisionTool] = useState<CollisionTool>(initialState.collisionTool);
  const [collisionBrushSize, setCollisionBrushSize] = useState<CollisionBrushSize>(initialState.collisionBrushSize);
  const [cellSize, setCellSize] = useState(initialState.cellSize);
  const [showFinalPreview, setShowFinalPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [previewRect, setPreviewRect] = useState<DragState | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const [hoveredCollision, setHoveredCollision] = useState<HoveredCollision | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const dragStateRef = useRef<DragState | null>(null);
  const historyRef = useRef(history);
  const gestureSnapshotRef = useRef<ContentState | null>(null);
  const gestureCommittedRef = useRef(false);

  historyRef.current = history;

  const { layers, objects, objectGroups, collisions } = history.present;
  const terrainLayers = layers.filter((layer) => layer.id !== OBJECT_LAYER_ID);
  const objectLayer = layers.find((layer) => layer.id === OBJECT_LAYER_ID) ?? layers[layers.length - 1]!;
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? layers[0]!;
  const selectedLayerIndex = Math.max(0, layerIndexById(layers, selectedLayer.id));
  const topTerrainLayer = terrainLayers[terrainLayers.length - 1] ?? layers[0]!;
  const rows = PIXEL_FARM_MASK_ROWS;
  const columns = PIXEL_FARM_MASK_COLUMNS;
  const selectedStampTiles = useMemo(
    () => buildObjectStampTiles(objectPaletteSelection),
    [objectPaletteSelection],
  );
  const isGroupedObjectStamp = selectedStampTiles.length > 1;
  const collisionsByCell = useMemo(() => {
    const next = new Map<string, CollisionState[]>();

    for (const collision of collisions) {
      const key = collisionCellKey(collision);
      const bucket = next.get(key);
      if (bucket) {
        bucket.push(collision);
      } else {
        next.set(key, [collision]);
      }
    }

    return next;
  }, [collisions]);
  const showBrushPreview =
    (hoveredCell !== null &&
      ((editorMode === "terrain" &&
        (terrainTool === "paint" ||
          terrainTool === "fill" ||
          terrainTool === "rectangle")) ||
        (editorMode === "objects" && objectTool === "place"))) ||
    (editorMode === "collision" && hoveredCollision !== null && collisionTool === "paint");
  const collisionPreview =
    editorMode === "collision" && collisionTool === "paint" ? hoveredCollision : null;

  useEffect(() => {
    if (!layers.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(layers[0]?.id ?? "");
    }
  }, [layers, selectedLayerId]);

  useEffect(() => {
    if (editorMode === "objects" && selectedLayerId !== objectLayer.id) {
      setSelectedLayerId(objectLayer.id);
    }
  }, [editorMode, selectedLayerId, objectLayer.id]);

  useEffect(() => {
    if (editorMode === "terrain" && selectedLayerId === OBJECT_LAYER_ID) {
      setSelectedLayerId(topTerrainLayer.id);
    }
  }, [editorMode, selectedLayerId, topTerrainLayer.id]);

  useEffect(() => {
    if (editorMode !== "collision") {
      setHoveredCollision(null);
    }
  }, [editorMode]);

  useEffect(() => {
    setSaved(false);
    setExportState("idle");
  }, [
    layers,
    objects,
    objectGroups,
    collisions,
    selectedLayerId,
    selectedTile,
    objectPaletteSelection,
    editorMode,
    terrainTool,
    objectTool,
    collisionTool,
    collisionBrushSize,
    cellSize,
  ]);

  useEffect(() => {
    const stopDrag = () => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      if (dragState.tool === "rectangle") {
        const layerIndex = layerIndexById(historyRef.current.present.layers, dragState.layerId);
        const layer = historyRef.current.present.layers[layerIndex];
        applyCellsMutation(
          dragState.layerId,
          collectMaskRect(
            layer?.mask ?? [],
            dragState.startRow,
            dragState.startColumn,
            dragState.endRow,
            dragState.endColumn,
          ),
          dragState.filled,
          dragState.tile ?? undefined,
          false,
        );
      }

      endGesture();
      dragStateRef.current = null;
      setPreviewRect(null);
    };

    window.addEventListener("pointerup", stopDrag);
    return () => window.removeEventListener("pointerup", stopDrag);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function startGesture(): void {
    if (gestureSnapshotRef.current) {
      return;
    }

    gestureSnapshotRef.current = historyRef.current.present;
    gestureCommittedRef.current = false;
  }

  function endGesture(): void {
    gestureSnapshotRef.current = null;
    gestureCommittedRef.current = false;
  }

  function applyContentMutation(
    updater: (current: ContentState) => ContentState,
    useGestureHistory: boolean,
  ): void {
    const gestureSnapshot = useGestureHistory
      ? (gestureSnapshotRef.current ?? historyRef.current.present)
      : null;
    const gestureCommitted = useGestureHistory ? gestureCommittedRef.current : false;

    setHistory((currentHistory) => {
      const nextPresent = updater(currentHistory.present);
      if (sameContent(nextPresent, currentHistory.present)) {
        return currentHistory;
      }

      if (useGestureHistory) {
        if (gestureCommitted) {
          return {
            ...currentHistory,
            present: nextPresent,
          };
        }

        gestureCommittedRef.current = true;
        return {
          past: appendPast(currentHistory.past, gestureSnapshot ?? currentHistory.present),
          present: nextPresent,
          future: [],
        };
      }

      return {
        past: appendPast(currentHistory.past, currentHistory.present),
        present: nextPresent,
        future: [],
      };
    });
  }

  function applyLayerMutation(
    layerId: string,
    updater: (layer: LayerState) => LayerState,
    useGestureHistory: boolean,
  ): void {
    applyContentMutation((current) => {
      const index = layerIndexById(current.layers, layerId);
      if (index < 0) {
        return current;
      }

      const currentLayer = current.layers[index]!;
      const nextLayer = updater(currentLayer);
      if (nextLayer === currentLayer) {
        return current;
      }

      const nextLayers = [...current.layers];
      nextLayers[index] = nextLayer;
      return {
        ...current,
        layers: nextLayers,
      };
    }, useGestureHistory);
  }

  function applyCellsMutation(
    layerId: string,
    cells: readonly (readonly [number, number])[],
    filled: boolean | null,
    tile: PixelFarmTileOverride | null | undefined,
    useGestureHistory: boolean,
  ): void {
    applyLayerMutation(
      layerId,
      (layer) => mutateLayerCells(layer, cells, filled, tile),
      useGestureHistory,
    );
  }

  function applyObjectGroupsMutation(
    updater: (groups: readonly ObjectGroupState[]) => ObjectGroupState[],
    useGestureHistory: boolean,
  ): void {
    applyContentMutation((current) => {
      const nextObjectGroups = updater(current.objectGroups);
      if (nextObjectGroups === current.objectGroups) {
        return current;
      }

      return {
        ...current,
        objectGroups: nextObjectGroups,
      };
    }, useGestureHistory);
  }

  function applyCollisionsMutation(
    updater: (collisions: readonly CollisionState[]) => CollisionState[],
    useGestureHistory: boolean,
  ): void {
    applyContentMutation((current) => {
      const nextCollisions = updater(current.collisions);
      if (nextCollisions === current.collisions) {
        return current;
      }

      return {
        ...current,
        collisions: nextCollisions,
      };
    }, useGestureHistory);
  }

  function upsertObjectAtCell(row: number, column: number, useGestureHistory: boolean): void {
    const stampTiles = buildObjectStampTiles(objectPaletteSelection);

    applyContentMutation((current) => {
      const nextObjects = [...current.objects];
      let nextObjectGroups = current.objectGroups;

      const shouldCreateGroup = stampTiles.length > 1;
      const groupId = shouldCreateGroup ? nextObjectGroupID(nextObjectGroups) : undefined;
      if (groupId) {
        nextObjectGroups = [
          ...nextObjectGroups,
          {
            id: groupId,
            ...defaultGroupSortMarker(row, column, stampTiles),
          },
        ];
      }

      for (const tile of stampTiles) {
        nextObjects.push({
          id: nextObjectID(nextObjects),
          layerId: selectedLayer.id,
          sourceId: tile.sourceId,
          frame: tile.frame,
          row: row + tile.rowOffset,
          column: column + tile.columnOffset,
          groupId,
        });
      }

      return {
        ...current,
        objects: nextObjects,
        objectGroups: nextObjectGroups,
      };
    }, useGestureHistory);
  }

  function removeObjectAtCell(row: number, column: number, useGestureHistory: boolean): void {
    applyContentMutation((current) => {
      const target = findObjectAtCell(current.objects, selectedLayer.id, row, column);
      if (!target) {
        return current;
      }

      if (!target.groupId) {
        return {
          ...current,
          objects: current.objects.filter((object) => object.id !== target.id),
        };
      }

      return {
        ...current,
        objects: current.objects.filter((object) => object.groupId !== target.groupId),
        objectGroups: current.objectGroups.filter((group) => group.id !== target.groupId),
      };
    }, useGestureHistory);
  }

  function updateObjectGroupSortMarker(
    groupId: string,
    row: number,
    column: number,
    useGestureHistory: boolean,
  ): void {
    applyObjectGroupsMutation((currentGroups) => {
      const index = currentGroups.findIndex((group) => group.id === groupId);
      if (index < 0) {
        return currentGroups as ObjectGroupState[];
      }

      const currentGroup = currentGroups[index]!;
      if (currentGroup.sortRow === row && currentGroup.sortColumn === column) {
        return currentGroups as ObjectGroupState[];
      }

      const nextGroups = [...currentGroups];
      nextGroups[index] = {
        ...currentGroup,
        sortRow: row,
        sortColumn: column,
      };
      return nextGroups;
    }, useGestureHistory);
  }

  function mutateCollisionsAtBrush(
    target: HoveredCollision,
    mode: CollisionTool,
    useGestureHistory: boolean,
  ): void {
    const brushTargets = collectCollisionBrushCells(target, collisionBrushSize);

    applyCollisionsMutation((currentCollisions) => {
      if (mode === "paint") {
        let nextCollisions = currentCollisions as CollisionState[];

        for (const brushTarget of brushTargets) {
          if (findCollisionIndex(nextCollisions, brushTarget.halfTileRow, brushTarget.halfTileColumn) >= 0) {
            continue;
          }

          nextCollisions = [
            ...nextCollisions,
            {
              id: nextCollisionID(nextCollisions),
              halfTileRow: brushTarget.halfTileRow,
              halfTileColumn: brushTarget.halfTileColumn,
            },
          ];
        }

        return nextCollisions;
      }

      const targetKeys = new Set(
        brushTargets.map((brushTarget) =>
          collisionPlacementKey(brushTarget.halfTileRow, brushTarget.halfTileColumn),
        ),
      );
      const nextCollisions = currentCollisions.filter(
        (collision) => !targetKeys.has(collisionPlacementKey(collision.halfTileRow, collision.halfTileColumn)),
      );

      return nextCollisions.length === currentCollisions.length
        ? (currentCollisions as CollisionState[])
        : nextCollisions;
    }, useGestureHistory);
  }

  function undo(): void {
    endGesture();
    dragStateRef.current = null;
    setPreviewRect(null);
    setHoveredCollision(null);

    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) {
        return current;
      }

      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }

  function redo(): void {
    endGesture();
    dragStateRef.current = null;
    setPreviewRect(null);
    setHoveredCollision(null);

    setHistory((current) => {
      const next = current.future[0];
      if (!next) {
        return current;
      }

      return {
        past: appendPast(current.past, current.present),
        present: next,
        future: current.future.slice(1),
      };
    });
  }

  function resolveCollisionTarget(
    row: number,
    column: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): HoveredCollision {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width - 0.001);
    const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height - 0.001);

    return {
      halfTileRow: row * 2 + Math.floor((offsetY / rect.height) * 2),
      halfTileColumn: column * 2 + Math.floor((offsetX / rect.width) * 2),
    };
  }

  function handlePointerDown(
    row: number,
    column: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    setHoveredCell({ row, column });

    if (editorMode === "collision") {
      const target = resolveCollisionTarget(row, column, event);
      setHoveredCollision(target);
      startGesture();
      dragStateRef.current = {
        tool: collisionTool === "paint" ? "collisionPlace" : "collisionErase",
        layerId: selectedLayer.id,
        filled: false,
        tile: null,
        startRow: row,
        startColumn: column,
        endRow: row,
        endColumn: column,
      };

      mutateCollisionsAtBrush(target, collisionTool, true);
      return;
    }

    if (editorMode === "objects") {
      startGesture();
      dragStateRef.current = {
        tool: objectTool === "place" ? "objectPlace" : "objectErase",
        layerId: selectedLayer.id,
        filled: false,
        tile: null,
        startRow: row,
        startColumn: column,
        endRow: row,
        endColumn: column,
      };

      if (objectTool === "place") {
        upsertObjectAtCell(row, column, true);
      } else {
        removeObjectAtCell(row, column, true);
      }

      return;
    }

    if (terrainTool === "fill") {
      applyCellsMutation(
        selectedLayer.id,
        collectMaskArea(selectedLayer.mask, row, column),
        true,
        selectedTile,
        false,
      );
      return;
    }

    if (terrainTool === "rectangle") {
      dragStateRef.current = {
        tool: terrainTool,
        layerId: selectedLayer.id,
        filled: true,
        tile: selectedTile,
        startRow: row,
        startColumn: column,
        endRow: row,
        endColumn: column,
      };
      setPreviewRect(dragStateRef.current);
      return;
    }

    startGesture();
    const filled = terrainTool === "paint";
    dragStateRef.current = {
      tool: terrainTool,
      layerId: selectedLayer.id,
      filled,
      tile: filled ? selectedTile : null,
      startRow: row,
      startColumn: column,
      endRow: row,
      endColumn: column,
    };
    applyCellsMutation(
      selectedLayer.id,
      [[row, column]],
      filled,
      filled ? selectedTile : undefined,
      true,
    );
  }

  function handleSortMarkerPointerDown(
    groupId: string,
    row: number,
    column: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    setHoveredCell({ row, column });
    startGesture();
    dragStateRef.current = {
      tool: "sortMarkerMove",
      groupId,
      layerId: selectedLayer.id,
      filled: false,
      tile: null,
      startRow: row,
      startColumn: column,
      endRow: row,
      endColumn: column,
    };
  }

  function handlePointerEnter(
    row: number,
    column: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    setHoveredCell({ row, column });

    if (editorMode === "collision") {
      const target = resolveCollisionTarget(row, column, event);
      setHoveredCollision(target);

      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      if (dragState.tool === "collisionPlace") {
        mutateCollisionsAtBrush(target, "paint", true);
      } else if (dragState.tool === "collisionErase") {
        mutateCollisionsAtBrush(target, "erase", true);
      }

      return;
    }

    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    if (dragState.tool === "objectPlace") {
      upsertObjectAtCell(row, column, true);
      return;
    }

    if (dragState.tool === "objectErase") {
      removeObjectAtCell(row, column, true);
      return;
    }

    if (dragState.tool === "rectangle") {
      const nextDragState = {
        ...dragState,
        endRow: row,
        endColumn: column,
      };

      dragStateRef.current = nextDragState;
      setPreviewRect(nextDragState);
      return;
    }

    if (dragState.tool === "sortMarkerMove" && dragState.groupId) {
      updateObjectGroupSortMarker(dragState.groupId, row, column, true);
      return;
    }

    applyCellsMutation(
      dragState.layerId,
      [[row, column]],
      dragState.filled,
      dragState.filled ? dragState.tile ?? undefined : undefined,
      true,
    );
  }

  function handleOpenAddLayerDialog(): void {
    setNewLayerName(nextLayerLabel(terrainLayers));
    setIsAddDialogOpen(true);
  }

  function handleCreateLayer(): void {
    const label = newLayerName.trim() || nextLayerLabel(terrainLayers);
    const id = nextLayerID(layers);
    const nextLayer: LayerState = {
      id,
      label,
      baseTile: { ...selectedTile },
      mask: buildEmptyMask(rows, columns),
      overrides: {},
    };

    applyContentMutation(
      (current) => {
        const nextLayers = [
          ...current.layers.filter((layer) => layer.id !== OBJECT_LAYER_ID),
          nextLayer,
          current.layers.find((layer) => layer.id === OBJECT_LAYER_ID) ?? defaultObjectLayer(),
        ];

        return {
          ...current,
          layers: nextLayers,
        };
      },
      false,
    );
    setSelectedLayerId(id);
    setIsAddDialogOpen(false);
    setNewLayerName("");
  }

  function handleSelectLayer(layerId: string): void {
    setSelectedLayerId(layerId);
    if (editorMode !== "collision") {
      setEditorMode(layerId === OBJECT_LAYER_ID ? "objects" : "terrain");
    }
  }

  function handleSelectTile(
    sourceId: PixelFarmAssetSourceId,
    frame: number,
    shiftKey: boolean,
  ): void {
    setSelectedTile({
      sourceId,
      frame,
    });

    setObjectPaletteSelection((current) => {
      if (!shiftKey || current.sourceId !== sourceId) {
        return {
          sourceId,
          frames: [frame],
        };
      }

      const nextFrames = current.frames.includes(frame)
        ? current.frames.filter((candidate) => candidate !== frame)
        : [...current.frames, frame];

      return {
        sourceId,
        frames: (nextFrames.length > 0 ? nextFrames : [frame]).sort((left, right) => left - right),
      };
    });

    if (editorMode === "terrain" && terrainTool === "erase") {
      setTerrainTool("paint");
    }
  }

  function handleDeleteLayer(): void {
    if (selectedLayer.id === OBJECT_LAYER_ID || terrainLayers.length <= 1) {
      return;
    }

    const nextSelectedLayer =
      layers[selectedLayerIndex - 1] ??
      layers[selectedLayerIndex + 1] ??
      layers.find((layer) => layer.id !== selectedLayer.id) ??
      null;

    applyContentMutation(
      (current) => {
        const nextObjects = current.objects.filter((object) => object.layerId !== selectedLayer.id);
        const nextGroupIDs = new Set(nextObjects.map((object) => object.groupId).filter(Boolean));

        return {
          layers: current.layers.filter((layer) => layer.id !== selectedLayer.id),
          objects: nextObjects,
          objectGroups: current.objectGroups.filter((group) => nextGroupIDs.has(group.id)),
          collisions: current.collisions,
        };
      },
      false,
    );
    setSelectedLayerId(nextSelectedLayer?.id ?? "");
    setIsDeleteDialogOpen(false);
  }

  async function handleExport(): Promise<void> {
    setExportState("exporting");

    try {
      const response = await fetch(EXPORT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          layers,
          objects,
          objectGroups,
          collisions,
        }),
      });

      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }

      setExportState("done");
    } catch {
      setExportState("error");
    }
  }

  function handleSaveDraft(): void {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        layers,
        objects,
        objectGroups,
        collisions,
        selectedLayerId,
        selectedTile,
        objectPaletteSelection,
        editorMode,
        terrainTool,
        objectTool,
        collisionTool,
        collisionBrushSize,
        cellSize,
      }),
    );
    setSaved(true);
  }

  function handleReset(): void {
    endGesture();
    setHistory({
      past: [],
      present: cloneContent(),
      future: [],
    });
    setSelectedLayerId(PIXEL_FARM_LAYERS[0]?.id ?? "");
    setSelectedTile({ ...DEFAULT_SELECTED_TILE });
    setObjectPaletteSelection({
      sourceId: DEFAULT_SELECTED_TILE.sourceId,
      frames: [DEFAULT_SELECTED_TILE.frame],
    });
    setEditorMode("terrain");
    setTerrainTool("paint");
    setObjectTool("place");
    setCollisionTool("paint");
    setCollisionBrushSize(1);
    setCellSize(INITIAL_CELL_SIZE);
    dragStateRef.current = null;
    setPreviewRect(null);
    setHoveredCell(null);
    setHoveredCollision(null);
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  }

  return (
    <main className="min-h-screen bg-[#f3e6b6] text-[#3f3322]">
      <div className="mx-auto flex min-h-screen max-w-[1680px] gap-6 px-6 py-6">
        <section className="min-w-0 flex-1 rounded-[28px] border border-[#92714c] bg-[#ebddb1] p-5 shadow-[0_24px_70px_rgba(89,70,36,0.18)]">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8d6b43]">
                {COPY.eyebrow}
              </p>
              <h1 className="text-2xl font-semibold text-[#3f3322]">{COPY.title}</h1>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="mr-2 inline-flex rounded-full border border-[#92714c] bg-[#f5e9c3] p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={editorMode === "terrain" ? "default" : "ghost"}
                  onClick={() => setEditorMode("terrain")}
                >
                  {COPY.modes.terrain}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={editorMode === "objects" ? "default" : "ghost"}
                  onClick={() => setEditorMode("objects")}
                >
                  {COPY.modes.objects}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={editorMode === "collision" ? "default" : "ghost"}
                  onClick={() => setEditorMode("collision")}
                >
                  {COPY.modes.collision}
                </Button>
              </div>
              {layers.map((layer) => (
                <Button
                  key={layer.id}
                  type="button"
                  size="sm"
                  variant={selectedLayer.id === layer.id ? "default" : "outline"}
                  onClick={() => handleSelectLayer(layer.id)}
                >
                  {layer.label}
                </Button>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={handleOpenAddLayerDialog}>
                {COPY.addLayer}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedLayer.id === OBJECT_LAYER_ID || terrainLayers.length <= 1}
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                {COPY.deleteLayer}
              </Button>
              <label className="ml-1 inline-flex items-center gap-2 rounded-full border border-[#92714c] bg-[#f5e9c3] px-3 py-1.5 text-sm text-[#5a452b]">
                <Switch checked={showFinalPreview} onCheckedChange={setShowFinalPreview} />
                <span>{COPY.finalPreview}</span>
              </label>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleSaveDraft}>
              {saved ? COPY.saved : COPY.save}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleExport}>
              {exportState === "exporting"
                ? COPY.exporting
                : exportState === "done"
                  ? COPY.exported
                  : exportState === "error"
                    ? COPY.exportFailed
                    : COPY.export}
            </Button>
            <div className="ml-auto text-xs uppercase tracking-[0.18em] text-[#8d6b43]">
              {COPY.generatedFile}: `generated-mask-data.ts`
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {editorMode === "terrain" ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant={terrainTool === "paint" ? "default" : "outline"}
                  onClick={() => setTerrainTool("paint")}
                >
                  {COPY.tools.paint}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={terrainTool === "erase" ? "default" : "outline"}
                  onClick={() => setTerrainTool("erase")}
                >
                  {COPY.tools.erase}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={terrainTool === "fill" ? "default" : "outline"}
                  onClick={() => setTerrainTool("fill")}
                >
                  {COPY.tools.fill}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={terrainTool === "rectangle" ? "default" : "outline"}
                  onClick={() => setTerrainTool("rectangle")}
                >
                  {COPY.tools.rectangle}
                </Button>
              </>
            ) : editorMode === "objects" ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant={objectTool === "place" ? "default" : "outline"}
                  onClick={() => setObjectTool("place")}
                >
                  {COPY.objectTools.place}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={objectTool === "erase" ? "default" : "outline"}
                  onClick={() => setObjectTool("erase")}
                >
                  {COPY.objectTools.erase}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant={collisionTool === "paint" ? "default" : "outline"}
                  onClick={() => setCollisionTool("paint")}
                >
                  {COPY.collisionTools.paint}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={collisionTool === "erase" ? "default" : "outline"}
                  onClick={() => setCollisionTool("erase")}
                >
                  {COPY.collisionTools.erase}
                </Button>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#92714c] bg-[#f5e9c3] px-3 py-1.5 text-sm text-[#5a452b]">
                  <span>{COPY.collisionBrush}</span>
                  <div className="flex gap-1">
                    {[1, 2].map((size) => (
                      <Button
                        key={size}
                        type="button"
                        size="sm"
                        variant={collisionBrushSize === size ? "default" : "ghost"}
                        onClick={() => setCollisionBrushSize(size as CollisionBrushSize)}
                      >
                        {`${size}x${size}`}
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={history.past.length === 0}
              onClick={undo}
            >
              {COPY.undo}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={history.future.length === 0}
              onClick={redo}
            >
              {COPY.redo}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCellSize((size) => Math.max(CELL_SIZE_MIN, size - CELL_SIZE_STEP))}
            >
              {COPY.zoomOut}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCellSize((size) => Math.min(CELL_SIZE_MAX, size + CELL_SIZE_STEP))}
            >
              {COPY.zoomIn}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleReset}>
              {COPY.reset}
            </Button>
            <div className="ml-auto text-xs uppercase tracking-[0.18em] text-[#8d6b43]">
              {`${rows} rows · ${columns} cols · ${cellSize}px`}
            </div>
          </div>

          <div className="overflow-auto rounded-[22px] border border-[#92714c] bg-[#9bd4c3] p-4">
            <div
              className="relative grid w-max gap-px rounded-md bg-[#7ab6ab] p-px"
              style={{
                gridTemplateColumns: `repeat(${columns}, ${cellSize}px)`,
              }}
              onPointerLeave={() => {
                setHoveredCell(null);
                setHoveredCollision(null);
              }}
            >
              {Array.from({ length: rows }, (_, rowIndex) =>
                Array.from({ length: columns }, (_, columnIndex) => {
                  const override = tileOverrideAt(selectedLayer.overrides, rowIndex, columnIndex);
                  const isPreviewed =
                    previewRect?.layerId === selectedLayer.id &&
                    rowIndex >= Math.min(previewRect.startRow, previewRect.endRow) &&
                    rowIndex <= Math.max(previewRect.startRow, previewRect.endRow) &&
                    columnIndex >= Math.min(previewRect.startColumn, previewRect.endColumn) &&
                    columnIndex <= Math.max(previewRect.startColumn, previewRect.endColumn);
                  const tiles =
                    showFinalPreview || editorMode === "objects" || editorMode === "collision"
                      ? previewTilesForLayers(layers, objects, rowIndex, columnIndex)
                      : (() => {
                          const tile = previewTile(selectedLayer, rowIndex, columnIndex);
                          return tile ? [tile] : [];
                        })();
                  const cellCollisions = collisionsByCell.get(`${rowIndex}:${columnIndex}`) ?? [];
                  const shadows: string[] = [];

                  if (override?.stamped === true) {
                    shadows.push("0 0 0 2px rgba(255,196,108,0.92)");
                  }

                  if (isPreviewed) {
                    shadows.push("inset 0 0 0 2px rgba(255,248,190,0.95)");
                  }

                  return (
                    <button
                      key={`${rowIndex}-${columnIndex}`}
                      type="button"
                      className={cn(
                        "relative overflow-hidden border-0 p-0",
                        showBrushPreview ? "cursor-none" : "cursor-crosshair transition-transform hover:scale-[1.08]",
                      )}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        backgroundColor:
                          tiles.length === 0 ? backgroundColor(layers, rowIndex, columnIndex) : undefined,
                        boxShadow: shadows.join(", ") || undefined,
                      }}
                      onPointerDown={(event) => handlePointerDown(rowIndex, columnIndex, event)}
                      onPointerEnter={(event) => handlePointerEnter(rowIndex, columnIndex, event)}
                    >
                      {tiles.map((tile, tileIndex) => (
                        <span
                          key={`${tile.sourceId}-${tile.frame}-${tileIndex}`}
                          className="pointer-events-none absolute inset-0"
                          style={frameStyle(tile.sourceId, tile.frame, cellSize)}
                        />
                      ))}
                      {editorMode === "collision" && (
                        <>
                          {Array.from({ length: 1 }, (_, index) => (
                            <span
                              key={`collision-v-${index}`}
                              className="pointer-events-none absolute top-0 h-full w-px bg-[rgba(128,42,42,0.18)]"
                              style={{ left: `${(index + 1) * 50}%` }}
                            />
                          ))}
                          {Array.from({ length: 1 }, (_, index) => (
                            <span
                              key={`collision-h-${index}`}
                              className="pointer-events-none absolute left-0 h-px w-full bg-[rgba(128,42,42,0.18)]"
                              style={{ top: `${(index + 1) * 50}%` }}
                            />
                          ))}
                        </>
                      )}
                      {cellCollisions.map((collision) => (
                        <span
                          key={collision.id}
                          className="pointer-events-none absolute"
                          style={collisionStyle(collision)}
                        />
                      ))}
                      {collisionPreview
                        ? collectCollisionBrushCells(collisionPreview, collisionBrushSize)
                            .filter(
                              (previewCollision) =>
                                Math.floor(previewCollision.halfTileRow / 2) === rowIndex &&
                                Math.floor(previewCollision.halfTileColumn / 2) === columnIndex,
                            )
                            .map((previewCollision, previewIndex) => (
                              <span
                                key={`preview-${previewCollision.halfTileRow}-${previewCollision.halfTileColumn}-${previewIndex}`}
                                className="pointer-events-none absolute"
                                style={collisionStyle(previewCollision, true)}
                              />
                            ))
                        : null}
                    </button>
                  );
                }),
              )}

              {editorMode !== "collision" && showBrushPreview && hoveredCell !== null && (
                <>
                  {(editorMode === "objects" ? selectedStampTiles : [
                    {
                      sourceId: selectedTile.sourceId,
                      frame: selectedTile.frame,
                      rowOffset: 0,
                      columnOffset: 0,
                    },
                  ]).map((tile) => (
                    <span
                      key={`preview-${tile.sourceId}-${tile.frame}-${tile.rowOffset}-${tile.columnOffset}`}
                      className="pointer-events-none absolute z-20 opacity-90"
                      style={{
                        left: 1 + (hoveredCell.column + tile.columnOffset) * (cellSize + 1),
                        top: 1 + (hoveredCell.row + tile.rowOffset) * (cellSize + 1),
                        width: cellSize,
                        height: cellSize,
                        ...frameStyle(tile.sourceId, tile.frame, cellSize),
                      }}
                    />
                  ))}
                </>
              )}
              {editorMode === "objects" &&
                objectGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className="absolute z-30 flex items-center justify-center rounded-full border border-[#7b4e20] bg-[rgba(255,247,196,0.95)] text-[10px] font-semibold text-[#7b4e20] shadow-[0_0_0_2px_rgba(123,78,32,0.18)]"
                    style={{
                      left: 1 + group.sortColumn * (cellSize + 1) + Math.floor((cellSize - 16) / 2),
                      top: 1 + group.sortRow * (cellSize + 1) + Math.floor((cellSize - 16) / 2),
                      width: 16,
                      height: 16,
                    }}
                    onPointerDown={(event) =>
                      handleSortMarkerPointerDown(group.id, group.sortRow, group.sortColumn, event)
                    }
                    title={`${group.id} @ ${group.sortRow},${group.sortColumn}`}
                  >
                    +
                  </button>
                ))}
            </div>
          </div>
        </section>

        <aside className="sticky top-6 flex h-[calc(100vh-3rem)] w-[460px] shrink-0 flex-col gap-4 rounded-[28px] border border-[#92714c] bg-[#efe3b7] p-5 shadow-[0_20px_60px_rgba(89,70,36,0.16)]">
          <div>
            <h2 className="text-lg font-semibold">{COPY.paletteTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-[#695238]">
              {editorMode === "objects"
                ? `${COPY.objectSelectionHint} ${COPY.sortMarkerHint}`
                : COPY.paletteHint}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#8d6b43]">
              {editorMode === "objects"
                ? `${selectedLayer.label} · ${objectPaletteSelection.sourceId} · ${objectPaletteSelection.frames.length} selected${isGroupedObjectStamp ? " · grouped stamp" : ""}`
                : `${selectedLayer.label} · ${COPY.selectedTile} ${selectedTile.sourceId}:${selectedTile.frame}`}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-4">
              {PIXEL_FARM_ASSET_SOURCE_IDS.map((sourceId) => {
                const source = PIXEL_FARM_TILESET_CONFIG[sourceId];

                return (
                  <div key={sourceId}>
                    <h2 className="text-base font-semibold">{sourceId}</h2>
                    <div
                      className="mt-3 grid gap-1 rounded-[20px] border border-[#92714c] bg-[#fff9df] p-3"
                      style={{
                        gridTemplateColumns: `repeat(${source.columns}, ${PALETTE_CELL_SIZE}px)`,
                      }}
                    >
                      {Array.from({ length: source.frameCount }, (_, frame) => (
                        <button
                          key={`${sourceId}-${frame}`}
                          type="button"
                          aria-pressed={
                            editorMode === "objects"
                              ? objectPaletteSelection.sourceId === sourceId &&
                                objectPaletteSelection.frames.includes(frame)
                              : selectedTile.sourceId === sourceId && selectedTile.frame === frame
                          }
                          className={cn(
                            "border border-transparent transition-transform hover:scale-[1.08]",
                            (
                              editorMode === "objects"
                                ? objectPaletteSelection.sourceId === sourceId &&
                                  objectPaletteSelection.frames.includes(frame)
                                : selectedTile.sourceId === sourceId && selectedTile.frame === frame
                            )
                              ? "scale-[1.08] border-[#7b4e20] ring-2 ring-[#f3d46f] shadow-[0_0_0_2px_rgba(123,78,32,0.28)]"
                              : "",
                          )}
                          style={{
                            width: PALETTE_CELL_SIZE,
                            height: PALETTE_CELL_SIZE,
                            ...frameStyle(sourceId, frame, PALETTE_CELL_SIZE),
                          }}
                          onClick={(event: ReactMouseEvent<HTMLButtonElement>) =>
                            handleSelectTile(sourceId, frame, event.shiftKey)
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      <Dialog
        open={isAddDialogOpen}
        onOpenChange={(open) => {
          setIsAddDialogOpen(open);
          if (!open) {
            setNewLayerName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{COPY.addDialogTitle}</DialogTitle>
            <DialogDescription>{COPY.addDialogDescription}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreateLayer();
            }}
          >
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#5a452b]" htmlFor="pixel-farm-layer-name">
                {COPY.addDialogField}
              </label>
              <Input
                id="pixel-farm-layer-name"
                value={newLayerName}
                onChange={(event) => setNewLayerName(event.target.value)}
                placeholder={nextLayerLabel(layers)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                {COPY.cancel}
              </Button>
              <Button type="submit">{COPY.create}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{COPY.deleteDialogTitle}</DialogTitle>
            <DialogDescription>
              {`${COPY.deleteDialogDescription} "${selectedLayer.label}"`}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-[#695238]">{COPY.deleteDialogHint}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              {COPY.cancel}
            </Button>
            <Button type="button" variant="destructive" onClick={handleDeleteLayer}>
              {COPY.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
