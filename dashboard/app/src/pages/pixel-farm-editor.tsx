import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { pixelFarmAutoTileFrame } from "@/lib/pixel-farm/autotile";
import {
  maskHasTile,
  PIXEL_FARM_MASK_LAYER_IDS,
  PIXEL_FARM_MASKS,
  PIXEL_FARM_TILE_OVERRIDES,
  tileOverrideFrame,
  tileOverrideKey,
  type PixelFarmMaskLayerId,
  type PixelFarmTileOverrideMap,
} from "@/lib/pixel-farm/island-mask";
import {
  PIXEL_FARM_AUTO_TILE_FRAMES,
  PIXEL_FARM_TILESET_CONFIG,
} from "@/lib/pixel-farm/tileset-config";

type MaskState = Record<PixelFarmMaskLayerId, string[]>;
type OverrideState = Record<PixelFarmMaskLayerId, PixelFarmTileOverrideMap>;
type SelectedFrameState = Record<PixelFarmMaskLayerId, number>;
type EditorTool = "paint" | "erase" | "fill" | "rectangle" | "stamp" | "clearStamp";

interface ContentState {
  masks: MaskState;
  overrides: OverrideState;
}

interface HistoryState {
  past: ContentState[];
  present: ContentState;
  future: ContentState[];
}

interface DragState {
  tool: "paint" | "erase" | "rectangle" | "stamp" | "clearStamp";
  layer: PixelFarmMaskLayerId;
  filled: boolean;
  overrideFrame: number | null;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

interface EditorState {
  content: ContentState;
  selectedFrames: SelectedFrameState;
  selectedLayer: PixelFarmMaskLayerId;
  tool: EditorTool;
  cellSize: number;
}

const CELL_SIZE_MIN = 12;
const CELL_SIZE_MAX = 32;
const CELL_SIZE_STEP = 2;
const INITIAL_CELL_SIZE = 18;
const PALETTE_CELL_SIZE = 28;
const MAX_HISTORY = 100;
const DRAFT_STORAGE_KEY = "pixel-farm-mask-editor-draft-v3";
const EXPORT_ENDPOINT = "/your-memory/__pixel-farm/export-generated-mask-data";
const DEFAULT_SELECTED_FRAMES: SelectedFrameState = {
  soil: PIXEL_FARM_AUTO_TILE_FRAMES.center,
  grassDark: PIXEL_FARM_AUTO_TILE_FRAMES.center,
  grassLight: PIXEL_FARM_AUTO_TILE_FRAMES.center,
  bush: PIXEL_FARM_AUTO_TILE_FRAMES.center,
};
const COPY = {
  eyebrow: "DEV TOOL",
  title: "Mask Editor",
  finalPreview: "Final preview",
  saveHint: "Saves the current draft to localStorage.",
  paletteTitle: "Tileset Palette",
  paletteHint: "Pick a frame, then use Stamp or Clear stamp on the grid.",
  exportTitle: "Export File",
  exportHint: "Writes the generated file for island masks and tile overrides.",
  undo: "Undo",
  redo: "Redo",
  save: "Save draft",
  saved: "Saved",
  export: "Export file",
  exporting: "Exporting",
  exported: "Exported",
  exportFailed: "Export failed",
  zoomIn: "Zoom In",
  zoomOut: "Zoom Out",
  reset: "Reset source",
  selectedFrame: "Selected frame",
  generatedFile: "Generated file",
  tools: {
    paint: "Paint",
    erase: "Erase",
    fill: "Fill",
    rectangle: "Rectangle",
    stamp: "Stamp",
    clearStamp: "Clear stamp",
  },
  layers: {
    soil: "0 Soil",
    grassDark: "1 Dark grass",
    grassLight: "2 Light grass",
    bush: "3 Bush",
  } satisfies Record<PixelFarmMaskLayerId, string>,
} as const;

function cloneMasks(): MaskState {
  return {
    soil: [...PIXEL_FARM_MASKS.soil],
    grassDark: [...PIXEL_FARM_MASKS.grassDark],
    grassLight: [...PIXEL_FARM_MASKS.grassLight],
    bush: [...PIXEL_FARM_MASKS.bush],
  };
}

function cloneOverrides(): OverrideState {
  return {
    soil: { ...PIXEL_FARM_TILE_OVERRIDES.soil },
    grassDark: { ...PIXEL_FARM_TILE_OVERRIDES.grassDark },
    grassLight: { ...PIXEL_FARM_TILE_OVERRIDES.grassLight },
    bush: { ...PIXEL_FARM_TILE_OVERRIDES.bush },
  };
}

function cloneContent(): ContentState {
  return {
    masks: cloneMasks(),
    overrides: cloneOverrides(),
  };
}

function sameContent(left: ContentState, right: ContentState): boolean {
  return (
    left.masks.soil === right.masks.soil &&
    left.masks.grassDark === right.masks.grassDark &&
    left.masks.grassLight === right.masks.grassLight &&
    left.masks.bush === right.masks.bush &&
    left.overrides.soil === right.overrides.soil &&
    left.overrides.grassDark === right.overrides.grassDark &&
    left.overrides.grassLight === right.overrides.grassLight &&
    left.overrides.bush === right.overrides.bush
  );
}

function appendPast(past: ContentState[], snapshot: ContentState): ContentState[] {
  if (past.length >= MAX_HISTORY) {
    return [...past.slice(1), snapshot];
  }

  return [...past, snapshot];
}

function setTileOverride(
  overrides: PixelFarmTileOverrideMap,
  row: number,
  column: number,
  frame: number | null,
): PixelFarmTileOverrideMap {
  const key = tileOverrideKey(row, column);
  const current = overrides[key];

  if (frame === null) {
    if (current === undefined) {
      return overrides;
    }

    const { [key]: _removed, ...rest } = overrides;
    return rest;
  }

  if (current === frame) {
    return overrides;
  }

  return {
    ...overrides,
    [key]: frame,
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

function fillMaskArea(mask: string[], row: number, column: number, filled: boolean): string[] {
  const sourceRow = mask[row];
  if (!sourceRow || column < 0 || column >= sourceRow.length) {
    return mask;
  }

  const target = sourceRow[column];
  const replacement = filled ? "#" : ".";
  if (target === replacement) {
    return mask;
  }

  const grid = mask.map((item) => item.split(""));
  const queue: Array<[number, number]> = [[row, column]];

  while (queue.length > 0) {
    const [currentRow, currentColumn] = queue.shift()!;
    if (grid[currentRow]?.[currentColumn] !== target) {
      continue;
    }

    grid[currentRow]![currentColumn] = replacement;
    queue.push([currentRow - 1, currentColumn]);
    queue.push([currentRow + 1, currentColumn]);
    queue.push([currentRow, currentColumn - 1]);
    queue.push([currentRow, currentColumn + 1]);
  }

  return grid.map((item) => item.join(""));
}

function fillMaskRect(
  mask: string[],
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
  filled: boolean,
): string[] {
  const top = Math.min(startRow, endRow);
  const bottom = Math.max(startRow, endRow);
  const left = Math.min(startColumn, endColumn);
  const right = Math.max(startColumn, endColumn);
  const nextMask = [...mask];

  for (let row = top; row <= bottom; row += 1) {
    let nextRow = nextMask[row];
    if (!nextRow) {
      continue;
    }

    for (let column = left; column <= right; column += 1) {
      const replacement = filled ? "#" : ".";
      if (column < 0 || column >= nextRow.length || nextRow[column] === replacement) {
        continue;
      }

      nextRow = `${nextRow.slice(0, column)}${replacement}${nextRow.slice(column + 1)}`;
    }

    nextMask[row] = nextRow;
  }

  return nextMask;
}

function pruneOverrideMap(
  layerId: PixelFarmMaskLayerId,
  mask: readonly string[],
  overrides: PixelFarmTileOverrideMap,
): PixelFarmTileOverrideMap {
  let changed = false;
  const next: PixelFarmTileOverrideMap = {};
  const frameCount = PIXEL_FARM_TILESET_CONFIG[layerId].frameCount;

  for (const [key, frame] of Object.entries(overrides)) {
    const [rowText, columnText] = key.split(":");
    const row = Number.parseInt(rowText ?? "", 10);
    const column = Number.parseInt(columnText ?? "", 10);

    if (
      Number.isNaN(row) ||
      Number.isNaN(column) ||
      !maskHasTile(mask, row, column) ||
      !Number.isInteger(frame) ||
      frame < 0 ||
      frame >= frameCount
    ) {
      changed = true;
      continue;
    }

    next[key] = frame;
  }

  return changed ? next : overrides;
}

function pruneOverrides(masks: MaskState, overrides: OverrideState): OverrideState {
  const next = {
    soil: pruneOverrideMap("soil", masks.soil, overrides.soil),
    grassDark: pruneOverrideMap("grassDark", masks.grassDark, overrides.grassDark),
    grassLight: pruneOverrideMap("grassLight", masks.grassLight, overrides.grassLight),
    bush: pruneOverrideMap("bush", masks.bush, overrides.bush),
  };

  if (
    next.soil === overrides.soil &&
    next.grassDark === overrides.grassDark &&
    next.grassLight === overrides.grassLight &&
    next.bush === overrides.bush
  ) {
    return overrides;
  }

  return next;
}

function layerColor(masks: MaskState, row: number, column: number): string {
  if (masks.grassLight[row]?.[column] === "#") {
    return "#bedc7f";
  }

  if (masks.bush[row]?.[column] === "#") {
    return "#4a7a36";
  }

  if (masks.grassDark[row]?.[column] === "#") {
    return "#87bb63";
  }

  if (masks.soil[row]?.[column] === "#") {
    return "#9e7c53";
  }

  return "#9bd4c3";
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

function sanitizeOverrideMap(
  layerId: PixelFarmMaskLayerId,
  input: unknown,
  mask: readonly string[],
): PixelFarmTileOverrideMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const next: PixelFarmTileOverrideMap = {};
  const frameCount = PIXEL_FARM_TILESET_CONFIG[layerId].frameCount;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const [rowText, columnText] = key.split(":");
    const row = Number.parseInt(rowText ?? "", 10);
    const column = Number.parseInt(columnText ?? "", 10);

    if (
      Number.isNaN(row) ||
      Number.isNaN(column) ||
      !maskHasTile(mask, row, column) ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= frameCount
    ) {
      continue;
    }

    next[key] = value;
  }

  return next;
}

function sanitizeSelectedFrames(input: unknown): SelectedFrameState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_SELECTED_FRAMES };
  }

  const source = input as Partial<Record<PixelFarmMaskLayerId, unknown>>;
  const next = { ...DEFAULT_SELECTED_FRAMES };

  for (const layerId of PIXEL_FARM_MASK_LAYER_IDS) {
    const frame = source[layerId];
    if (
      typeof frame === "number" &&
      Number.isInteger(frame) &&
      frame >= 0 &&
      frame < PIXEL_FARM_TILESET_CONFIG[layerId].frameCount
    ) {
      next[layerId] = frame;
    }
  }

  return next;
}

function frameStyle(layerId: PixelFarmMaskLayerId, frame: number, size: number): CSSProperties {
  const tileset = PIXEL_FARM_TILESET_CONFIG[layerId];
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

function previewFrame(
  layerId: PixelFarmMaskLayerId,
  masks: MaskState,
  overrides: OverrideState,
  row: number,
  column: number,
): number | null {
  const mask = masks[layerId];
  if (!maskHasTile(mask, row, column)) {
    return null;
  }

  return tileOverrideFrame(overrides[layerId], row, column) ?? pixelFarmAutoTileFrame(mask, row, column);
}

function compositePreviewCell(
  masks: MaskState,
  overrides: OverrideState,
  row: number,
  column: number,
): { layerId: PixelFarmMaskLayerId; frame: number } | null {
  for (let index = PIXEL_FARM_MASK_LAYER_IDS.length - 1; index >= 0; index -= 1) {
    const layerId = PIXEL_FARM_MASK_LAYER_IDS[index]!;
    const frame = previewFrame(layerId, masks, overrides, row, column);
    if (frame !== null) {
      return { layerId, frame };
    }
  }

  return null;
}

function loadDraftState(): EditorState {
  const defaults: EditorState = {
    content: cloneContent(),
    selectedFrames: { ...DEFAULT_SELECTED_FRAMES },
    selectedLayer: "soil",
    tool: "paint",
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
      masks?: Partial<Record<PixelFarmMaskLayerId, unknown>>;
      overrides?: Partial<Record<PixelFarmMaskLayerId, unknown>>;
      selectedFrames?: unknown;
      selectedLayer?: unknown;
      tool?: unknown;
      cellSize?: unknown;
    };
    const masks: MaskState = {
      soil: sanitizeMaskRows(parsed.masks?.soil, PIXEL_FARM_MASKS.soil),
      grassDark: sanitizeMaskRows(parsed.masks?.grassDark, PIXEL_FARM_MASKS.grassDark),
      grassLight: sanitizeMaskRows(parsed.masks?.grassLight, PIXEL_FARM_MASKS.grassLight),
      bush: sanitizeMaskRows(parsed.masks?.bush, PIXEL_FARM_MASKS.bush),
    };
    const overrides: OverrideState = {
      soil: sanitizeOverrideMap("soil", parsed.overrides?.soil, masks.soil),
      grassDark: sanitizeOverrideMap("grassDark", parsed.overrides?.grassDark, masks.grassDark),
      grassLight: sanitizeOverrideMap("grassLight", parsed.overrides?.grassLight, masks.grassLight),
      bush: sanitizeOverrideMap("bush", parsed.overrides?.bush, masks.bush),
    };

    return {
      content: { masks, overrides },
      selectedFrames: sanitizeSelectedFrames(parsed.selectedFrames),
      selectedLayer:
        typeof parsed.selectedLayer === "string" &&
        PIXEL_FARM_MASK_LAYER_IDS.includes(parsed.selectedLayer as PixelFarmMaskLayerId)
          ? (parsed.selectedLayer as PixelFarmMaskLayerId)
          : defaults.selectedLayer,
      tool:
        parsed.tool === "paint" ||
        parsed.tool === "erase" ||
        parsed.tool === "fill" ||
        parsed.tool === "rectangle" ||
        parsed.tool === "stamp" ||
        parsed.tool === "clearStamp"
          ? parsed.tool
          : defaults.tool,
      cellSize:
        typeof parsed.cellSize === "number"
          ? Math.min(CELL_SIZE_MAX, Math.max(CELL_SIZE_MIN, parsed.cellSize))
          : defaults.cellSize,
    };
  } catch {
    return defaults;
  }
}

export function PixelFarmEditorPage() {
  const initialState = useMemo(loadDraftState, []);
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialState.content,
    future: [],
  });
  const [selectedFrames, setSelectedFrames] = useState<SelectedFrameState>(initialState.selectedFrames);
  const [selectedLayer, setSelectedLayer] = useState<PixelFarmMaskLayerId>(initialState.selectedLayer);
  const [tool, setTool] = useState<EditorTool>(initialState.tool);
  const [cellSize, setCellSize] = useState(initialState.cellSize);
  const [showFinalPreview, setShowFinalPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [previewRect, setPreviewRect] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const historyRef = useRef(history);
  const gestureSnapshotRef = useRef<ContentState | null>(null);
  const gestureCommittedRef = useRef(false);

  historyRef.current = history;

  const { masks, overrides } = history.present;
  const rows = masks.soil.length;
  const columns = masks.soil[0]?.length ?? 0;
  const selectedTileset = PIXEL_FARM_TILESET_CONFIG[selectedLayer];

  useEffect(() => {
    setSaved(false);
    setExportState("idle");
  }, [cellSize, masks, overrides, selectedFrames, selectedLayer, tool]);

  useEffect(() => {
    const stopDrag = () => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      if (dragState.tool === "rectangle") {
        applyMaskMutation(
          (currentMasks) => ({
            ...currentMasks,
            [dragState.layer]: fillMaskRect(
              currentMasks[dragState.layer],
              dragState.startRow,
              dragState.startColumn,
              dragState.endRow,
              dragState.endColumn,
              dragState.filled,
            ),
          }),
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

  function startGesture() {
    if (gestureSnapshotRef.current) {
      return;
    }

    gestureSnapshotRef.current = historyRef.current.present;
    gestureCommittedRef.current = false;
  }

  function endGesture() {
    gestureSnapshotRef.current = null;
    gestureCommittedRef.current = false;
  }

  function applyContentMutation(
    updater: (current: ContentState) => ContentState,
    useGestureHistory: boolean,
  ) {
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

  function applyMaskMutation(
    updater: (current: MaskState) => MaskState,
    useGestureHistory: boolean,
  ) {
    applyContentMutation((current) => {
      const nextMasks = updater(current.masks);
      if (nextMasks === current.masks) {
        return current;
      }

      return {
        masks: nextMasks,
        overrides: pruneOverrides(nextMasks, current.overrides),
      };
    }, useGestureHistory);
  }

  function applyMaskUpdate(
    layer: PixelFarmMaskLayerId,
    updater: (mask: string[]) => string[],
    useGestureHistory: boolean,
  ) {
    applyMaskMutation(
      (current) => ({
        ...current,
        [layer]: updater(current[layer]),
      }),
      useGestureHistory,
    );
  }

  function applyOverrideUpdate(
    layer: PixelFarmMaskLayerId,
    row: number,
    column: number,
    frame: number | null,
    useGestureHistory: boolean,
  ) {
    if (!maskHasTile(historyRef.current.present.masks[layer], row, column)) {
      return;
    }

    applyContentMutation((current) => {
      const nextLayer = setTileOverride(current.overrides[layer], row, column, frame);
      if (nextLayer === current.overrides[layer]) {
        return current;
      }

      return {
        masks: current.masks,
        overrides: {
          ...current.overrides,
          [layer]: nextLayer,
        },
      };
    }, useGestureHistory);
  }

  function undo() {
    endGesture();
    setPreviewRect(null);
    dragStateRef.current = null;
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

  function redo() {
    endGesture();
    setPreviewRect(null);
    dragStateRef.current = null;
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

  function handlePointerDown(row: number, column: number) {
    if (tool === "fill") {
      applyMaskUpdate(selectedLayer, (mask) => fillMaskArea(mask, row, column, true), false);
      return;
    }

    if (tool === "rectangle") {
      dragStateRef.current = {
        tool,
        layer: selectedLayer,
        filled: true,
        overrideFrame: null,
        startRow: row,
        startColumn: column,
        endRow: row,
        endColumn: column,
      };
      setPreviewRect(dragStateRef.current);
      return;
    }

    if (tool === "stamp" || tool === "clearStamp") {
      startGesture();
      const overrideFrame = tool === "stamp" ? selectedFrames[selectedLayer] : null;
      dragStateRef.current = {
        tool,
        layer: selectedLayer,
        filled: false,
        overrideFrame,
        startRow: row,
        startColumn: column,
        endRow: row,
        endColumn: column,
      };
      applyOverrideUpdate(selectedLayer, row, column, overrideFrame, true);
      return;
    }

    startGesture();
    const filled = tool === "paint";
    dragStateRef.current = {
      tool,
      layer: selectedLayer,
      filled,
      overrideFrame: null,
      startRow: row,
      startColumn: column,
      endRow: row,
      endColumn: column,
    };
    applyMaskUpdate(selectedLayer, (mask) => updateMaskCell(mask, row, column, filled), true);
  }

  function handlePointerEnter(row: number, column: number) {
    const dragState = dragStateRef.current;
    if (!dragState) {
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
      applyOverrideUpdate(dragState.layer, row, column, dragState.overrideFrame, true);
      return;
    }

    applyMaskUpdate(
      dragState.layer,
      (mask) => updateMaskCell(mask, row, column, dragState.filled),
      true,
    );
  }

  async function handleExport() {
    setExportState("exporting");

    try {
      const response = await fetch(EXPORT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          masks,
          overrides,
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

  function handleSaveDraft() {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        masks,
        overrides,
        selectedFrames,
        selectedLayer,
        tool,
        cellSize,
      }),
    );
    setSaved(true);
  }

  function handleReset() {
    endGesture();
    setHistory({
      past: [],
      present: cloneContent(),
      future: [],
    });
    setSelectedFrames({ ...DEFAULT_SELECTED_FRAMES });
    setSelectedLayer("soil");
    setTool("paint");
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
              {PIXEL_FARM_MASK_LAYER_IDS.map((layerId) => (
                <Button
                  key={layerId}
                  type="button"
                  size="sm"
                  variant={selectedLayer === layerId ? "default" : "outline"}
                  onClick={() => setSelectedLayer(layerId)}
                >
                  {COPY.layers[layerId]}
                </Button>
              ))}
              <label className="ml-1 inline-flex items-center gap-2 rounded-full border border-[#92714c] bg-[#f5e9c3] px-3 py-1.5 text-sm text-[#5a452b]">
                <Switch checked={showFinalPreview} onCheckedChange={setShowFinalPreview} />
                <span>{COPY.finalPreview}</span>
              </label>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={tool === "paint" ? "default" : "outline"}
              onClick={() => setTool("paint")}
            >
              {COPY.tools.paint}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tool === "erase" ? "default" : "outline"}
              onClick={() => setTool("erase")}
            >
              {COPY.tools.erase}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tool === "fill" ? "default" : "outline"}
              onClick={() => setTool("fill")}
            >
              {COPY.tools.fill}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tool === "rectangle" ? "default" : "outline"}
              onClick={() => setTool("rectangle")}
            >
              {COPY.tools.rectangle}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tool === "stamp" ? "default" : "outline"}
              onClick={() => setTool("stamp")}
            >
              {COPY.tools.stamp}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tool === "clearStamp" ? "default" : "outline"}
              onClick={() => setTool("clearStamp")}
            >
              {COPY.tools.clearStamp}
            </Button>
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
              onClick={() =>
                setCellSize((size) => Math.max(CELL_SIZE_MIN, size - CELL_SIZE_STEP))
              }
            >
              {COPY.zoomOut}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setCellSize((size) => Math.min(CELL_SIZE_MAX, size + CELL_SIZE_STEP))
              }
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
              className="grid w-max gap-px rounded-md bg-[#7ab6ab] p-px"
              style={{
                gridTemplateColumns: `repeat(${columns}, ${cellSize}px)`,
              }}
            >
              {masks.soil.map((rowValue, rowIndex) =>
                rowValue.split("").map((_, columnIndex) => {
                  const currentMask = masks[selectedLayer];
                  const isActive = currentMask[rowIndex]?.[columnIndex] === "#";
                  const isPreviewed =
                    previewRect?.layer === selectedLayer &&
                    rowIndex >= Math.min(previewRect.startRow, previewRect.endRow) &&
                    rowIndex <= Math.max(previewRect.startRow, previewRect.endRow) &&
                    columnIndex >= Math.min(previewRect.startColumn, previewRect.endColumn) &&
                    columnIndex <= Math.max(previewRect.startColumn, previewRect.endColumn);
                  const override = tileOverrideFrame(overrides[selectedLayer], rowIndex, columnIndex);
                  const compositeCell = showFinalPreview
                    ? compositePreviewCell(masks, overrides, rowIndex, columnIndex)
                    : null;
                  const frame = showFinalPreview
                    ? compositeCell?.frame ?? null
                    : previewFrame(selectedLayer, masks, overrides, rowIndex, columnIndex);
                  const frameLayer = showFinalPreview
                    ? compositeCell?.layerId ?? selectedLayer
                    : selectedLayer;
                  const shadows: string[] = [];

                  if (isActive) {
                    shadows.push("inset 0 0 0 2px rgba(34,31,24,0.65)");
                  }

                  if (override !== null) {
                    shadows.push("0 0 0 2px rgba(255,196,108,0.92)");
                  }

                  if (isPreviewed) {
                    shadows.push("inset 0 0 0 2px rgba(255,248,190,0.95)");
                  }

                  return (
                    <button
                      key={`${rowIndex}-${columnIndex}`}
                      type="button"
                      className={cn("cursor-crosshair border-0 p-0 transition-transform hover:scale-[1.08]")}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: layerColor(masks, rowIndex, columnIndex),
                        boxShadow: shadows.join(", ") || undefined,
                        ...(frame === null ? {} : frameStyle(frameLayer, frame, cellSize)),
                      }}
                      onPointerDown={() => handlePointerDown(rowIndex, columnIndex)}
                      onPointerEnter={() => handlePointerEnter(rowIndex, columnIndex)}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </section>

        <aside className="flex w-[460px] shrink-0 flex-col gap-4 rounded-[28px] border border-[#92714c] bg-[#efe3b7] p-5 shadow-[0_20px_60px_rgba(89,70,36,0.16)]">
          <div>
            <h2 className="text-lg font-semibold">{COPY.paletteTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-[#695238]">{COPY.paletteHint}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#8d6b43]">
              {`${COPY.layers[selectedLayer]} · ${COPY.selectedFrame} ${selectedFrames[selectedLayer]}`}
            </p>
          </div>

          <div
            className="grid gap-1 rounded-[20px] border border-[#92714c] bg-[#fff9df] p-3"
            style={{
              gridTemplateColumns: `repeat(${selectedTileset.columns}, ${PALETTE_CELL_SIZE}px)`,
            }}
          >
            {Array.from({ length: selectedTileset.frameCount }, (_, frame) => (
              <button
                key={frame}
                type="button"
                aria-pressed={selectedFrames[selectedLayer] === frame}
                className={cn(
                  "border border-transparent transition-transform hover:scale-[1.08]",
                  selectedFrames[selectedLayer] === frame
                    ? "scale-[1.08] border-[#7b4e20] ring-2 ring-[#f3d46f] shadow-[0_0_0_2px_rgba(123,78,32,0.28)]"
                    : "",
                )}
                style={{
                  width: PALETTE_CELL_SIZE,
                  height: PALETTE_CELL_SIZE,
                  ...frameStyle(selectedLayer, frame, PALETTE_CELL_SIZE),
                }}
                onClick={() =>
                  setSelectedFrames((current) => ({
                    ...current,
                    [selectedLayer]: frame,
                  }))
                }
              />
            ))}
          </div>

          <div>
            <h2 className="text-lg font-semibold">{COPY.exportTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-[#695238]">{COPY.exportHint}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#8d6b43]">
              {COPY.generatedFile}: `src/lib/pixel-farm/generated-mask-data.ts`
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleSaveDraft}>
              {saved ? COPY.saved : COPY.save}
            </Button>
            <Button type="button" size="sm" onClick={handleExport}>
              {exportState === "exporting"
                ? COPY.exporting
                : exportState === "done"
                  ? COPY.exported
                  : exportState === "error"
                    ? COPY.exportFailed
                    : COPY.export}
            </Button>
          </div>
        </aside>
      </div>
    </main>
  );
}
