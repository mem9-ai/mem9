import type { CSSProperties } from "react";
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
  PIXEL_FARM_LAYERS,
  PIXEL_FARM_MASK_COLUMNS,
  PIXEL_FARM_MASK_ROWS,
  PIXEL_FARM_OBJECTS,
  objectOccupiesCell,
  tileOverrideAt,
  tileOverrideKey,
  type PixelFarmLayer,
  type PixelFarmObjectFootprint,
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
type TerrainTool = "paint" | "erase" | "fill" | "rectangle" | "stamp" | "clearStamp";
type ObjectTool = "place" | "erase";
type EditorMode = "terrain" | "objects";

interface ContentState {
  layers: LayerState[];
  objects: ObjectState[];
}

interface HistoryState {
  past: ContentState[];
  present: ContentState;
  future: ContentState[];
}

interface DragState {
  tool: "paint" | "erase" | "rectangle" | "stamp" | "clearStamp" | "objectPlace" | "objectErase";
  layerId: string;
  filled: boolean;
  tile: PixelFarmTileOverride | null;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

interface EditorState {
  content: ContentState;
  selectedLayerId: string;
  selectedTile: PixelFarmAssetTileSelection;
  editorMode: EditorMode;
  terrainTool: TerrainTool;
  objectTool: ObjectTool;
  objectWalkable: boolean;
  objectFootprint: PixelFarmObjectFootprint;
  cellSize: number;
}

interface HoveredCell {
  row: number;
  column: number;
}

const CELL_SIZE_MIN = 12;
const CELL_SIZE_MAX = 64;
const CELL_SIZE_STEP = 2;
const INITIAL_CELL_SIZE = 32;
const PALETTE_CELL_SIZE = 28;
const MAX_HISTORY = 100;
const GRID_GAP = 1;
const GRID_PADDING = 1;
const DRAFT_STORAGE_KEY = "pixel-farm-mask-editor-draft-v8";
const EXPORT_ENDPOINT = "/your-memory/__pixel-farm/export-generated-mask-data";
const OBJECT_LAYER_ID = "objects";
const OBJECT_FOOTPRINT_PRESETS = [
  { id: "1x1", label: "1x1", rows: 1, columns: 1 },
  { id: "1x2", label: "1x2", rows: 1, columns: 2 },
  { id: "2x1", label: "2x1", rows: 2, columns: 1 },
  { id: "2x2", label: "2x2", rows: 2, columns: 2 },
  { id: "3x2", label: "3x2", rows: 3, columns: 2 },
  { id: "4x2", label: "4x2", rows: 4, columns: 2 },
 ] as const satisfies Array<{
  id: string;
  label: string;
  rows: number;
  columns: number;
}>;
const DEFAULT_OBJECT_FOOTPRINT = {
  rows: OBJECT_FOOTPRINT_PRESETS[0].rows,
  columns: OBJECT_FOOTPRINT_PRESETS[0].columns,
} satisfies PixelFarmObjectFootprint;
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
  },
  objectTools: {
    place: "Place",
    erase: "Erase object",
  },
  walkable: "Walkable",
  footprint: "Footprint",
  finalPreview: "Final preview",
  paletteTitle: "Tileset Palette",
  paletteHint: "Pick any tile from any spritesheet, then stamp it into the selected layer.",
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
    stamp: "Stamp",
    clearStamp: "Clear stamp",
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
  return PIXEL_FARM_OBJECTS.map((object) => ({
    ...object,
    footprint: { ...object.footprint },
  }));
}

function cloneContent(): ContentState {
  return {
    layers: cloneLayers(),
    objects: cloneObjects(),
  };
}

function sameContent(left: ContentState, right: ContentState): boolean {
  if (
    left.layers === right.layers ||
    left.layers.length !== right.layers.length ||
    left.objects.length !== right.objects.length
  ) {
    return left.layers === right.layers && left.objects === right.objects;
  }

  return (
    left.layers.every((layer, index) => layer === right.layers[index]) &&
    left.objects.every((object, index) => object === right.objects[index])
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
    if (object.layerId === layerId && objectOccupiesCell(object, row, column)) {
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

function sanitizeFootprint(input: unknown): PixelFarmObjectFootprint | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const rows = (input as { rows?: unknown }).rows;
  const columns = (input as { columns?: unknown }).columns;
  if (
    typeof rows !== "number" ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    typeof columns !== "number" ||
    !Number.isInteger(columns) ||
    columns < 1
  ) {
    return null;
  }

  return { rows, columns };
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
    const rawWalkable = (value as { walkable?: unknown }).walkable;
    const rawFootprint = (value as { footprint?: unknown }).footprint;
    const tile = sanitizeAssetTileSelection(value);
    const footprint = sanitizeFootprint(rawFootprint);

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
      typeof rawWalkable !== "boolean" ||
      !tile ||
      !footprint
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
      footprint,
      walkable: rawWalkable,
    });
  }

  return objects;
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
    editorMode: "terrain",
    terrainTool: "paint",
    objectTool: "place",
    objectWalkable: false,
    objectFootprint: { ...DEFAULT_OBJECT_FOOTPRINT },
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
      selectedLayerId?: unknown;
      selectedTile?: unknown;
      editorMode?: unknown;
      terrainTool?: unknown;
      objectTool?: unknown;
      objectWalkable?: unknown;
      objectFootprint?: unknown;
      cellSize?: unknown;
    };
    const layers = sanitizeLayerList(parsed.layers, defaults.content.layers);
    const objects = sanitizeObjectList(parsed.objects, layers);
    const selectedLayerId =
      typeof parsed.selectedLayerId === "string" &&
      layers.some((layer) => layer.id === parsed.selectedLayerId)
        ? parsed.selectedLayerId
        : layers[0]!.id;

    return {
      content: { layers, objects },
      selectedLayerId,
      selectedTile: sanitizeAssetTileSelection(parsed.selectedTile) ?? { ...DEFAULT_SELECTED_TILE },
      editorMode: parsed.editorMode === "objects" ? "objects" : defaults.editorMode,
      terrainTool:
        parsed.terrainTool === "paint" ||
        parsed.terrainTool === "erase" ||
        parsed.terrainTool === "fill" ||
        parsed.terrainTool === "rectangle" ||
        parsed.terrainTool === "stamp" ||
        parsed.terrainTool === "clearStamp"
          ? parsed.terrainTool
          : defaults.terrainTool,
      objectTool:
        parsed.objectTool === "erase" || parsed.objectTool === "place"
          ? parsed.objectTool
          : defaults.objectTool,
      objectWalkable:
        typeof parsed.objectWalkable === "boolean"
          ? parsed.objectWalkable
          : defaults.objectWalkable,
      objectFootprint: sanitizeFootprint(parsed.objectFootprint) ?? defaults.objectFootprint,
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
  const [editorMode, setEditorMode] = useState<EditorMode>(initialState.editorMode);
  const [terrainTool, setTerrainTool] = useState<TerrainTool>(initialState.terrainTool);
  const [objectTool, setObjectTool] = useState<ObjectTool>(initialState.objectTool);
  const [objectWalkable, setObjectWalkable] = useState(initialState.objectWalkable);
  const [objectFootprint, setObjectFootprint] = useState<PixelFarmObjectFootprint>(
    initialState.objectFootprint,
  );
  const [cellSize, setCellSize] = useState(initialState.cellSize);
  const [showFinalPreview, setShowFinalPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [previewRect, setPreviewRect] = useState<DragState | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const dragStateRef = useRef<DragState | null>(null);
  const historyRef = useRef(history);
  const gestureSnapshotRef = useRef<ContentState | null>(null);
  const gestureCommittedRef = useRef(false);

  historyRef.current = history;

  const { layers, objects } = history.present;
  const terrainLayers = layers.filter((layer) => layer.id !== OBJECT_LAYER_ID);
  const objectLayer = layers.find((layer) => layer.id === OBJECT_LAYER_ID) ?? layers[layers.length - 1]!;
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? layers[0]!;
  const selectedLayerIndex = Math.max(0, layerIndexById(layers, selectedLayer.id));
  const topTerrainLayer = terrainLayers[terrainLayers.length - 1] ?? layers[0]!;
  const rows = PIXEL_FARM_MASK_ROWS;
  const columns = PIXEL_FARM_MASK_COLUMNS;
  const showBrushPreview =
    hoveredCell !== null &&
    ((editorMode === "terrain" &&
      (terrainTool === "paint" ||
        terrainTool === "fill" ||
        terrainTool === "rectangle" ||
        terrainTool === "stamp")) ||
      (editorMode === "objects" && objectTool === "place"));

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
    setSaved(false);
    setExportState("idle");
  }, [
    layers,
    objects,
    selectedLayerId,
    selectedTile,
    editorMode,
    terrainTool,
    objectTool,
    objectWalkable,
    objectFootprint,
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

  function applyOverrideMutation(
    layerId: string,
    row: number,
    column: number,
    tile: PixelFarmTileOverride | null,
    useGestureHistory: boolean,
  ): void {
    applyLayerMutation(
      layerId,
      (layer) => {
        if (!maskHasTile(layer.mask, row, column)) {
          return layer;
        }

        const nextOverrides = setTileOverride(layer.overrides, row, column, tile);
        if (nextOverrides === layer.overrides) {
          return layer;
        }

        return {
          ...layer,
          overrides: nextOverrides,
        };
      },
      useGestureHistory,
    );
  }

  function applyObjectsMutation(
    updater: (objects: readonly ObjectState[]) => ObjectState[],
    useGestureHistory: boolean,
  ): void {
    applyContentMutation((current) => {
      const nextObjects = updater(current.objects);
      if (nextObjects === current.objects) {
        return current;
      }

      return {
        ...current,
        objects: nextObjects,
      };
    }, useGestureHistory);
  }

  function upsertObjectAtCell(row: number, column: number, useGestureHistory: boolean): void {
    applyObjectsMutation((currentObjects) => {
      const nextObject: ObjectState = {
        id: nextObjectID(currentObjects),
        layerId: selectedLayer.id,
        sourceId: selectedTile.sourceId,
        frame: selectedTile.frame,
        row,
        column,
        footprint: { ...objectFootprint },
        walkable: objectWalkable,
      };
      const existingIndex = currentObjects.findIndex(
        (object) =>
          object.layerId === selectedLayer.id && object.row === row && object.column === column,
      );
      if (existingIndex < 0) {
        return [...currentObjects, nextObject];
      }

      const existingObject = currentObjects[existingIndex]!;
      if (
        existingObject.sourceId === nextObject.sourceId &&
        existingObject.frame === nextObject.frame &&
        existingObject.walkable === nextObject.walkable &&
        existingObject.footprint.rows === nextObject.footprint.rows &&
        existingObject.footprint.columns === nextObject.footprint.columns
      ) {
        return currentObjects as ObjectState[];
      }

      const nextObjects = [...currentObjects];
      nextObjects[existingIndex] = {
        ...nextObject,
        id: existingObject.id,
      };
      return nextObjects;
    }, useGestureHistory);
  }

  function removeObjectAtCell(row: number, column: number, useGestureHistory: boolean): void {
    applyObjectsMutation((currentObjects) => {
      const target = findObjectAtCell(currentObjects, selectedLayer.id, row, column);
      if (!target) {
        return currentObjects as ObjectState[];
      }

      return currentObjects.filter((object) => object.id !== target.id);
    }, useGestureHistory);
  }

  function undo(): void {
    endGesture();
    dragStateRef.current = null;
    setPreviewRect(null);

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

  function handlePointerDown(row: number, column: number): void {
    setHoveredCell({ row, column });

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

    if (terrainTool === "stamp" || terrainTool === "clearStamp") {
      startGesture();
      const tile = terrainTool === "stamp" ? { ...selectedTile, stamped: true } : null;
      dragStateRef.current = {
        tool: terrainTool,
        layerId: selectedLayer.id,
        filled: false,
        tile,
        startRow: row,
        startColumn: column,
        endRow: row,
        endColumn: column,
      };
      applyOverrideMutation(selectedLayer.id, row, column, tile, true);
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

  function handlePointerEnter(row: number, column: number): void {
    setHoveredCell({ row, column });

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

    if (dragState.tool === "stamp" || dragState.tool === "clearStamp") {
      applyOverrideMutation(dragState.layerId, row, column, dragState.tile, true);
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
    setEditorMode(layerId === OBJECT_LAYER_ID ? "objects" : "terrain");
  }

  function handleSelectTile(sourceId: PixelFarmAssetSourceId, frame: number): void {
    setSelectedTile({
      sourceId,
      frame,
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
      (current) => ({
        layers: current.layers.filter((layer) => layer.id !== selectedLayer.id),
        objects: current.objects.filter((object) => object.layerId !== selectedLayer.id),
      }),
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
        selectedLayerId,
        selectedTile,
        editorMode,
        terrainTool,
        objectTool,
        objectWalkable,
        objectFootprint,
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
    setEditorMode("terrain");
    setTerrainTool("paint");
    setObjectTool("place");
    setObjectWalkable(false);
    setObjectFootprint({ ...DEFAULT_OBJECT_FOOTPRINT });
    setCellSize(INITIAL_CELL_SIZE);
    dragStateRef.current = null;
    setPreviewRect(null);
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
                <Button
                  type="button"
                  size="sm"
                  variant={terrainTool === "stamp" ? "default" : "outline"}
                  onClick={() => setTerrainTool("stamp")}
                >
                  {COPY.tools.stamp}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={terrainTool === "clearStamp" ? "default" : "outline"}
                  onClick={() => setTerrainTool("clearStamp")}
                >
                  {COPY.tools.clearStamp}
                </Button>
              </>
            ) : (
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
                <label className="inline-flex items-center gap-2 rounded-full border border-[#92714c] bg-[#f5e9c3] px-3 py-1.5 text-sm text-[#5a452b]">
                  <Switch checked={objectWalkable} onCheckedChange={setObjectWalkable} />
                  <span>{COPY.walkable}</span>
                </label>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#92714c] bg-[#f5e9c3] px-3 py-1.5 text-sm text-[#5a452b]">
                  <span>{COPY.footprint}</span>
                  <div className="flex gap-1">
                    {OBJECT_FOOTPRINT_PRESETS.map((preset) => (
                      <Button
                        key={preset.id}
                        type="button"
                        size="sm"
                        variant={
                          objectFootprint.rows === preset.rows &&
                          objectFootprint.columns === preset.columns
                            ? "default"
                            : "ghost"
                        }
                        onClick={() =>
                          setObjectFootprint({
                            rows: preset.rows,
                            columns: preset.columns,
                          })
                        }
                      >
                        {preset.label}
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
              onPointerLeave={() => setHoveredCell(null)}
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
                    showFinalPreview || editorMode === "objects"
                      ? previewTilesForLayers(layers, objects, rowIndex, columnIndex)
                      : (() => {
                          const tile = previewTile(selectedLayer, rowIndex, columnIndex);
                          return tile ? [tile] : [];
                        })();
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
                      onPointerDown={() => handlePointerDown(rowIndex, columnIndex)}
                      onPointerEnter={() => handlePointerEnter(rowIndex, columnIndex)}
                    >
                      {tiles.map((tile, tileIndex) => (
                        <span
                          key={`${tile.sourceId}-${tile.frame}-${tileIndex}`}
                          className="pointer-events-none absolute inset-0"
                          style={frameStyle(tile.sourceId, tile.frame, cellSize)}
                        />
                      ))}
                    </button>
                  );
                }),
              )}

              {showBrushPreview && (
                <span
                  className="pointer-events-none absolute z-20 opacity-90"
                  style={{
                    left: GRID_PADDING + hoveredCell.column * (cellSize + GRID_GAP),
                    top: GRID_PADDING + hoveredCell.row * (cellSize + GRID_GAP),
                    width: cellSize,
                    height: cellSize,
                    ...frameStyle(selectedTile.sourceId, selectedTile.frame, cellSize),
                  }}
                />
              )}

              {editorMode === "objects" && objectTool === "place" && hoveredCell !== null && (
                <span
                  className="pointer-events-none absolute z-10 border-2"
                  style={{
                    left: GRID_PADDING + hoveredCell.column * (cellSize + GRID_GAP),
                    top: GRID_PADDING + hoveredCell.row * (cellSize + GRID_GAP),
                    width:
                      objectFootprint.columns * cellSize + (objectFootprint.columns - 1) * GRID_GAP,
                    height: objectFootprint.rows * cellSize + (objectFootprint.rows - 1) * GRID_GAP,
                    borderColor: objectWalkable ? "rgba(88, 160, 84, 0.8)" : "rgba(171, 82, 56, 0.88)",
                    backgroundColor: objectWalkable
                      ? "rgba(142, 212, 132, 0.15)"
                      : "rgba(203, 116, 87, 0.16)",
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <aside className="sticky top-6 flex h-[calc(100vh-3rem)] w-[460px] shrink-0 flex-col gap-4 rounded-[28px] border border-[#92714c] bg-[#efe3b7] p-5 shadow-[0_20px_60px_rgba(89,70,36,0.16)]">
          <div>
            <h2 className="text-lg font-semibold">{COPY.paletteTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-[#695238]">{COPY.paletteHint}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#8d6b43]">
              {`${selectedLayer.label} · ${COPY.selectedTile} ${selectedTile.sourceId}:${selectedTile.frame}`}
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
                          aria-pressed={selectedTile.sourceId === sourceId && selectedTile.frame === frame}
                          className={cn(
                            "border border-transparent transition-transform hover:scale-[1.08]",
                            selectedTile.sourceId === sourceId && selectedTile.frame === frame
                              ? "scale-[1.08] border-[#7b4e20] ring-2 ring-[#f3d46f] shadow-[0_0_0_2px_rgba(123,78,32,0.28)]"
                              : "",
                          )}
                          style={{
                            width: PALETTE_CELL_SIZE,
                            height: PALETTE_CELL_SIZE,
                            ...frameStyle(sourceId, frame, PALETTE_CELL_SIZE),
                          }}
                          onClick={() => handleSelectTile(sourceId, frame)}
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
