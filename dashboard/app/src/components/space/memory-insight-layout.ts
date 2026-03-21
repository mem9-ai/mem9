export type InsightPoint = {
  x: number;
  y: number;
};

export type InsightCircleItem = {
  id: string;
  diameter: number;
  width?: number;
  height?: number;
};

export type InsightRectItem = {
  id: string;
  width: number;
  height: number;
};

export type PackedRootBubbles = {
  positions: Record<string, InsightPoint>;
  height: number;
};

export type PackedLaneColumn = {
  positions: Record<string, InsightPoint>;
  height: number;
};

export type PackedLaneAnchors = {
  positions: Record<string, InsightPoint>;
  heights: Record<string, number>;
  height: number;
};

export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasBounds = {
  width: number;
  height: number;
};

type PlacedCircle = InsightCircleItem & InsightPoint & {
  width: number;
  height: number;
};
type PlacedRect = InsightRectItem & InsightPoint;

const ROOT_PADDING = 24;
const ROOT_GUTTER = 18;
const ROOT_SEARCH_STEP = 14;
const ROOT_MIN_HEIGHT = 240;

const COLUMN_PADDING = 12;
const COLUMN_GAP = 12;
const COLUMN_SEARCH_STEP = 10;
const COLUMN_MIN_HEIGHT = 96;
const LANE_MIN_HEIGHT = 180;
const CANVAS_PADDING = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function circleIntersects(
  candidate: PlacedCircle,
  existing: PlacedCircle,
  gutter: number,
): boolean {
  return !(
    candidate.x + candidate.width + gutter <= existing.x ||
    existing.x + existing.width + gutter <= candidate.x ||
    candidate.y + candidate.height + gutter <= existing.y ||
    existing.y + existing.height + gutter <= candidate.y
  );
}

function rectIntersects(
  candidate: PlacedRect,
  existing: PlacedRect,
  gap: number,
): boolean {
  return !(
    candidate.x + candidate.width + gap <= existing.x ||
    existing.x + existing.width + gap <= candidate.x ||
    candidate.y + candidate.height + gap <= existing.y ||
    existing.y + existing.height + gap <= candidate.y
  );
}

function generateSearchOffsets(step: number, maxDistance: number): InsightPoint[] {
  const offsets: InsightPoint[] = [{ x: 0, y: 0 }];

  for (let distance = step; distance <= maxDistance; distance += step) {
    const ring: InsightPoint[] = [];
    for (let delta = -distance; delta <= distance; delta += step) {
      ring.push({ x: delta, y: -distance });
      ring.push({ x: delta, y: distance });
      ring.push({ x: -distance, y: delta });
      ring.push({ x: distance, y: delta });
    }

    offsets.push(...ring);
  }

  return offsets;
}

const ROOT_OFFSETS = generateSearchOffsets(ROOT_SEARCH_STEP, 960);
const COLUMN_OFFSETS = generateSearchOffsets(COLUMN_SEARCH_STEP, 720);

function resolveCirclePosition({
  item,
  desired,
  width,
  placed,
  padding = ROOT_PADDING,
  gutter = ROOT_GUTTER,
}: {
  item: InsightCircleItem;
  desired: InsightPoint;
  width: number;
  placed: PlacedCircle[];
  padding?: number;
  gutter?: number;
}): PlacedCircle {
  const itemWidth = item.width ?? item.diameter;
  const itemHeight = item.height ?? item.diameter;
  const maxX = Math.max(padding, width - padding - itemWidth);

  for (const offset of ROOT_OFFSETS) {
    const candidate: PlacedCircle = {
      ...item,
      width: itemWidth,
      height: itemHeight,
      x: clamp(desired.x + offset.x, padding, maxX),
      y: Math.max(padding, desired.y + offset.y),
    };

    if (!placed.some((existing) => circleIntersects(candidate, existing, gutter))) {
      return candidate;
    }
  }

  let scanY = Math.max(padding, desired.y);
  while (scanY < 6000) {
    for (let scanX = padding; scanX <= maxX; scanX += ROOT_SEARCH_STEP) {
      const candidate: PlacedCircle = {
        ...item,
        width: itemWidth,
        height: itemHeight,
        x: scanX,
        y: scanY,
      };

      if (!placed.some((existing) => circleIntersects(candidate, existing, gutter))) {
        return candidate;
      }
    }

    scanY += ROOT_SEARCH_STEP;
  }

  return {
    ...item,
    width: itemWidth,
    height: itemHeight,
    x: padding,
    y: scanY,
  };
}

function resolveRectPosition({
  item,
  desired,
  width,
  placed,
  padding = COLUMN_PADDING,
  gap = COLUMN_GAP,
}: {
  item: InsightRectItem;
  desired: InsightPoint;
  width: number;
  placed: PlacedRect[];
  padding?: number;
  gap?: number;
}): PlacedRect {
  const maxX = Math.max(padding, width - padding - item.width);

  for (const offset of COLUMN_OFFSETS) {
    const candidate: PlacedRect = {
      ...item,
      x: clamp(desired.x + offset.x, padding, maxX),
      y: Math.max(padding, desired.y + offset.y),
    };

    if (!placed.some((existing) => rectIntersects(candidate, existing, gap))) {
      return candidate;
    }
  }

  let scanY = Math.max(padding, desired.y);
  while (scanY < 6000) {
    for (let scanX = padding; scanX <= maxX; scanX += COLUMN_SEARCH_STEP) {
      const candidate: PlacedRect = {
        ...item,
        x: scanX,
        y: scanY,
      };

      if (!placed.some((existing) => rectIntersects(candidate, existing, gap))) {
        return candidate;
      }
    }

    scanY += COLUMN_SEARCH_STEP;
  }

  return {
    ...item,
    x: padding,
    y: scanY,
  };
}

export function packRootBubbles({
  items,
  width,
  manualPositions = {},
  padding = ROOT_PADDING,
  gutter = ROOT_GUTTER,
}: {
  items: InsightCircleItem[];
  width: number;
  manualPositions?: Record<string, InsightPoint>;
  padding?: number;
  gutter?: number;
}): PackedRootBubbles {
  const safeWidth = Math.max(width, 160);
  const positions: Record<string, InsightPoint> = {};
  const placed: PlacedCircle[] = [];
  const manualItems = items.filter((item) => manualPositions[item.id]);
  const autoItems = items.filter((item) => !manualPositions[item.id]);

  for (const item of manualItems) {
    const desired = manualPositions[item.id] ?? { x: padding, y: padding };
    const resolved = resolveCirclePosition({
      item,
      desired,
      width: safeWidth,
      placed,
      padding,
      gutter,
    });
    placed.push(resolved);
    positions[item.id] = { x: resolved.x, y: resolved.y };
  }

  let cursorX = padding;
  let cursorY = padding;
  let rowHeight = 0;

  for (const item of autoItems) {
    if (cursorX + item.diameter > safeWidth - padding && cursorX > padding) {
      cursorX = padding;
      cursorY += rowHeight + gutter;
      rowHeight = 0;
    }

    const itemWidth = item.width ?? item.diameter;
    const itemHeight = item.height ?? item.diameter;

    if (cursorX + itemWidth > safeWidth - padding && cursorX > padding) {
      cursorX = padding;
      cursorY += rowHeight + gutter;
      rowHeight = 0;
    }

    const desired = { x: cursorX, y: cursorY };
    const resolved = resolveCirclePosition({
      item,
      desired,
      width: safeWidth,
      placed,
      padding,
      gutter,
    });

    placed.push(resolved);
    positions[item.id] = { x: resolved.x, y: resolved.y };
    cursorX += itemWidth + gutter;
    rowHeight = Math.max(rowHeight, itemHeight);
  }

  const contentHeight = placed.reduce(
    (maxHeight, item) => Math.max(maxHeight, item.y + item.height + padding),
    ROOT_MIN_HEIGHT,
  );

  return {
    positions,
    height: Math.max(contentHeight, ROOT_MIN_HEIGHT),
  };
}

export function resolveRootBubbleDrop({
  id,
  position,
  diameter,
  blockWidth,
  blockHeight,
  width,
  siblings,
  padding = ROOT_PADDING,
  gutter = ROOT_GUTTER,
}: {
  id: string;
  position: InsightPoint;
  diameter: number;
  blockWidth?: number;
  blockHeight?: number;
  width: number;
  siblings: PlacedCircle[];
  padding?: number;
  gutter?: number;
}): InsightPoint {
  const resolved = resolveCirclePosition({
    item: {
      id,
      diameter,
      width: blockWidth ?? diameter,
      height: blockHeight ?? diameter,
    },
    desired: position,
    width,
    placed: siblings,
    padding,
    gutter,
  });

  return { x: resolved.x, y: resolved.y };
}

export function layoutLaneColumn({
  items,
  width,
  manualPositions = {},
  padding = COLUMN_PADDING,
  gap = COLUMN_GAP,
}: {
  items: InsightRectItem[];
  width: number;
  manualPositions?: Record<string, InsightPoint>;
  padding?: number;
  gap?: number;
}): PackedLaneColumn {
  const safeWidth = Math.max(width, 120);
  const positions: Record<string, InsightPoint> = {};
  const placed: PlacedRect[] = [];
  const manualItems = items.filter((item) => manualPositions[item.id]);
  const autoItems = items.filter((item) => !manualPositions[item.id]);

  for (const item of manualItems) {
    const desired = manualPositions[item.id] ?? {
      x: (safeWidth - item.width) / 2,
      y: padding,
    };
    const resolved = resolveRectPosition({
      item,
      desired,
      width: safeWidth,
      placed,
      padding,
      gap,
    });
    placed.push(resolved);
    positions[item.id] = { x: resolved.x, y: resolved.y };
  }

  let cursorY = padding;

  for (const item of autoItems) {
    const desired = {
      x: Math.max(padding, (safeWidth - item.width) / 2),
      y: cursorY,
    };
    const resolved = resolveRectPosition({
      item,
      desired,
      width: safeWidth,
      placed,
      padding,
      gap,
    });
    placed.push(resolved);
    positions[item.id] = { x: resolved.x, y: resolved.y };
    cursorY += item.height + gap;
  }

  const contentHeight = placed.reduce(
    (maxHeight, item) => Math.max(maxHeight, item.y + item.height + padding),
    COLUMN_MIN_HEIGHT,
  );

  return {
    positions,
    height: Math.max(contentHeight, COLUMN_MIN_HEIGHT),
  };
}

export function resolveLaneNodeDrop({
  id,
  position,
  width,
  height,
  columnWidth,
  siblings,
  padding = COLUMN_PADDING,
  gap = COLUMN_GAP,
}: {
  id: string;
  position: InsightPoint;
  width: number;
  height: number;
  columnWidth: number;
  siblings: Array<InsightRectItem & InsightPoint>;
  padding?: number;
  gap?: number;
}): InsightPoint {
  const resolved = resolveRectPosition({
    item: { id, width, height },
    desired: position,
    width: columnWidth,
    placed: siblings,
    padding,
    gap,
  });

  return { x: resolved.x, y: resolved.y };
}

export function layoutLaneAnchors({
  laneIds,
  startX,
  startY,
  laneHeights,
  gap,
}: {
  laneIds: string[];
  startX: number;
  startY: number;
  laneHeights: number[];
  gap: number;
}): PackedLaneAnchors {
  const positions: Record<string, InsightPoint> = {};
  const heights: Record<string, number> = {};
  let cursorY = startY;

  laneIds.forEach((laneId, index) => {
    const height = Math.max(laneHeights[index] ?? LANE_MIN_HEIGHT, LANE_MIN_HEIGHT);
    positions[laneId] = {
      x: startX,
      y: cursorY,
    };
    heights[laneId] = height;
    cursorY += height + gap;
  });

  return {
    positions,
    heights,
    height: Math.max(cursorY - startY - gap, 0),
  };
}

export function computeCanvasBounds({
  leftRegionWidth,
  leftRegionHeight,
  laneWidth,
  laneAnchors,
  laneHeights,
  nodes,
  viewportWidth,
  viewportHeight,
}: {
  leftRegionWidth: number;
  leftRegionHeight: number;
  laneWidth: number;
  laneAnchors: Record<string, InsightPoint>;
  laneHeights: Record<string, number>;
  nodes: CanvasRect[];
  viewportWidth: number;
  viewportHeight: number;
}): CanvasBounds {
  let maxRight = leftRegionWidth + CANVAS_PADDING;
  let maxBottom = leftRegionHeight + CANVAS_PADDING;

  for (const anchor of Object.values(laneAnchors)) {
    maxRight = Math.max(maxRight, anchor.x + laneWidth + CANVAS_PADDING);
  }

  for (const [laneId, anchor] of Object.entries(laneAnchors)) {
    maxBottom = Math.max(
      maxBottom,
      anchor.y + (laneHeights[laneId] ?? LANE_MIN_HEIGHT) + CANVAS_PADDING,
    );
  }

  for (const node of nodes) {
    maxRight = Math.max(maxRight, node.x + node.width + CANVAS_PADDING);
    maxBottom = Math.max(maxBottom, node.y + node.height + CANVAS_PADDING);
  }

  return {
    width: Math.max(viewportWidth, maxRight),
    height: Math.max(viewportHeight, maxBottom),
  };
}
