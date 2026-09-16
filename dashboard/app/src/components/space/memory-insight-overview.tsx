import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Maximize2, Minimize2, Move, RefreshCcw, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  computeCanvasBounds,
  layoutLaneAnchors,
  layoutLaneColumn,
  packRootBubbles,
  resolveLaneNodeDrop,
  resolveRootBubbleDrop,
  type InsightPoint,
  type InsightRectItem,
} from "@/components/space/memory-insight-layout";
import {
  formatInsightCategoryLabel,
  normalizeInsightCategoryKey,
  type MemoryInsightEntityNode,
  type MemoryInsightMemoryNode,
  type MemoryInsightNodeKind,
  type MemoryInsightTagNode,
} from "@/lib/memory-insight";
import { useBackgroundMemoryInsightGraph } from "@/lib/memory-insight-background";
import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

type InsightRenderableKind = MemoryInsightNodeKind | "more";

type LanePath = {
  tagId?: string;
  entityId?: string;
};

type LaneRenderableItem = {
  id: string;
  kind: InsightRenderableKind;
  label: string;
  tooltip?: string;
  subtitle?: string;
  meta?: string;
  count?: number;
  width: number;
  height: number;
  active?: boolean;
  bubble?: boolean;
  diameter?: number;
  driftStyle?: CSSProperties;
  bubbleColor?: string;
  draggable?: boolean;
  onClick: () => void;
};

type DragState = {
  pointerId: number;
  nodeId: string;
  element: HTMLButtonElement;
  startClientX: number;
  startClientY: number;
  origin: InsightPoint;
  lastPosition: InsightPoint;
  maxX: number;
  maxY: number;
  moved: boolean;
  onClick: () => void;
  onDrop: (position: InsightPoint) => void;
};

type PanState = {
  pointerId: number;
  element: HTMLDivElement;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
};

type PositionedNode = LaneRenderableItem & {
  position: InsightPoint;
  muted?: boolean;
};

type InsightPerformanceMode = "full" | "reduced";

type RootBubbleRelationEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  sharedMemoryCount: number;
  sharedTagCount: number;
  strength: number;
};

type RootRelationRenderableEdge = RootBubbleRelationEdge & {
  sourceX: number;
  sourceY: number;
  controlX: number;
  controlY: number;
  targetX: number;
  targetY: number;
  intensity: number;
  strokeWidth: number;
  opacity: number;
  sourceColor: string;
  targetColor: string;
  strokeColor: string;
  dist: number;
};

type SampledPathPoint = InsightPoint & {
  distance: number;
};

type SampledRootRelationEdge = RootRelationRenderableEdge & {
  sampledPath: SampledPathPoint[];
  pathLength: number;
  highlightLength: number;
  cycleDurationMs: number;
  animationOffsetMs: number;
};

const DRIFT_SEEDS = [
  { x: 5, y: -16, duration: 10.6, delay: -2.2, rotate: -2.0, scale: 0.028 },
  { x: -6, y: -18, duration: 12.0, delay: -6.8, rotate: 1.6, scale: 0.025 },
  { x: 4, y: -13, duration: 9.8, delay: -4.4, rotate: -1.2, scale: 0.022 },
  { x: -5, y: -17, duration: 11.4, delay: -8.6, rotate: 2.1, scale: 0.030 },
  { x: 6, y: -14, duration: 12.8, delay: -10.3, rotate: -1.8, scale: 0.026 },
  { x: -4, y: -20, duration: 10.9, delay: -12.1, rotate: 1.3, scale: 0.024 },
];

const BUBBLE_COLOR_PALETTE = [
  "#1a8aff",
  "#00e5ff",
  "#a855f7",
  "#ff3eb5",
  "#00e676",
  "#ff9100",
  "#ff4444",
  "#00ffd5",
] as const;

const ROOT_BUBBLE_RANGE = {
  compact: { min: 10, max: 64 },
  desktop: { min: 12, max: 84 },
} as const;

const ROOT_BUBBLE_EXPONENT = {
  compact: 0.94,
  desktop: 0.9,
} as const;

const BRANCH_LIMITS = {
  tags: { compact: 4, desktop: 6 },
  entities: { compact: 4, desktop: 6 },
  memories: { compact: 5, desktop: 5 },
} as const;

const CANVAS_GAP = {
  compact: 28,
  desktop: 40,
} as const;

const LANE_COLUMN_WIDTHS = {
  bubble: { compact: 210, desktop: 250 },
  tag: { compact: 200, desktop: 232 },
  entity: { compact: 208, desktop: 240 },
  memory: { compact: 232, desktop: 292 },
} as const;

const LANE_GAP = {
  compact: 16,
  desktop: 24,
} as const;

const ROOT_RELATION_ANIMATION_BUDGET = {
  sparse: 8,
  medium: 6,
  dense: 4,
} as const;
const ROOT_RELATION_MEDIUM_EDGE_THRESHOLD = 32;
const ROOT_RELATION_DENSE_EDGE_THRESHOLD = 60;
const ROOT_RELATION_BASE_DPR_CAP = 1.5;
const ROOT_RELATION_DENSE_DPR_CAP = 1.25;
const ROOT_RELATION_HIGHLIGHT_LENGTH_RATIO = 0.14;
const ROOT_RELATION_HIGHLIGHT_LENGTH_MIN = 24;
const ROOT_RELATION_HIGHLIGHT_LENGTH_MAX = 72;
const ROOT_RELATION_CYCLE_DURATION_MS = {
  min: 2800,
  max: 5200,
} as const;
const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function previewMemoryContent(memory: Memory): string {
  const normalizedContent = normalizeInlineText(memory.content);
  return normalizedContent.length > 120
    ? `${normalizedContent.slice(0, 117).trimEnd()}...`
    : normalizedContent;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededUnitInterval(value: string): number {
  return (hashString(value) % 10_000) / 9_999;
}

function seededRange(value: string, min: number, max: number): number {
  return min + seededUnitInterval(value) * (max - min);
}

function roundSeed(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function bubbleDiameter(count: number, maxCount: number, compact: boolean): number {
  const range = compact ? ROOT_BUBBLE_RANGE.compact : ROOT_BUBBLE_RANGE.desktop;
  const exponent = compact ? ROOT_BUBBLE_EXPONENT.compact : ROOT_BUBBLE_EXPONENT.desktop;
  const safeMax = Math.max(maxCount, 1);
  const ratio = Math.max(0, Math.min(1, count / safeMax));
  const emphasizedRatio = Math.pow(ratio, exponent);
  return Math.round(range.min + emphasizedRatio * (range.max - range.min));
}

function nodeDimensions(
  kind: InsightRenderableKind,
  count: number,
  compact: boolean,
  maxCardCount: number,
): { width: number; height: number } {
  if (kind === "card") {
    const diameter = bubbleDiameter(count, maxCardCount, compact);
    const width = Math.max(diameter, compact ? 76 : 88);
    return {
      width,
      height: diameter + (compact ? 34 : 38),
    };
  }

  if (kind === "memory") {
    return {
      width: compact ? 220 : 268,
      height: compact ? 106 : 122,
    };
  }

  if (kind === "entity") {
    return {
      width: compact ? 182 : 204,
      height: compact ? 72 : 80,
    };
  }

  if (kind === "more") {
    return {
      width: compact ? 134 : 148,
      height: compact ? 52 : 56,
    };
  }

  return {
    width: compact ? 188 : 212,
    height: compact ? 72 : 80,
  };
}

function createBubbleMotionStyle(id: string): CSSProperties {
  const seed = DRIFT_SEEDS[hashString(id) % DRIFT_SEEDS.length]!;
  return {
    "--insight-drift-x": `${seed.x}px`,
    "--insight-drift-y": `${seed.y}px`,
    "--insight-drift-rotate": `${seed.rotate}deg`,
    "--insight-drift-scale": `${seed.scale}`,
    "--insight-drift-duration": `${(seed.duration * 0.65).toFixed(2)}s`,
    "--insight-drift-delay": `${seed.delay}s`,
    "--insight-twinkle-duration": `${roundSeed(seededRange(`${id}:twinkle-duration`, 3.0, 5.8))}s`,
    "--insight-twinkle-delay": `${roundSeed(-seededRange(`${id}:twinkle-delay`, 0.2, 7.8))}s`,
    "--insight-twinkle-min-brightness": `${roundSeed(seededRange(`${id}:twinkle-min-brightness`, 0.88, 0.96))}`,
    "--insight-twinkle-max-brightness": `${roundSeed(seededRange(`${id}:twinkle-max-brightness`, 1.18, 1.38))}`,
    "--insight-twinkle-min-saturate": `${roundSeed(seededRange(`${id}:twinkle-min-saturate`, 1.06, 1.16))}`,
    "--insight-twinkle-max-saturate": `${roundSeed(seededRange(`${id}:twinkle-max-saturate`, 1.32, 1.6))}`,
    "--insight-halo-min-opacity": `${roundSeed(seededRange(`${id}:halo-min-opacity`, 0.32, 0.48))}`,
    "--insight-halo-max-opacity": `${roundSeed(seededRange(`${id}:halo-max-opacity`, 0.72, 0.96))}`,
    "--insight-halo-min-scale": `${roundSeed(seededRange(`${id}:halo-min-scale`, 0.80, 0.90))}`,
    "--insight-halo-max-scale": `${roundSeed(seededRange(`${id}:halo-max-scale`, 1.08, 1.22))}`,
    "--insight-halo-min-blur": `${roundSeed(seededRange(`${id}:halo-min-blur`, 10, 13), 1)}px`,
    "--insight-halo-max-blur": `${roundSeed(seededRange(`${id}:halo-max-blur`, 15, 20), 1)}px`,
  } as CSSProperties;
}

function bubbleToneColor(category: string): string {
  return BUBBLE_COLOR_PALETTE[
    hashString(category) % BUBBLE_COLOR_PALETTE.length
  ]!;
}

function mixHexColors(left: string, right: string, ratio = 0.5): string {
  if (!/^#[\da-fA-F]{6}$/.test(left) || !/^#[\da-fA-F]{6}$/.test(right)) {
    return left;
  }

  const mixChannel = (offset: number) => {
    const leftValue = Number.parseInt(left.slice(offset, offset + 2), 16);
    const rightValue = Number.parseInt(right.slice(offset, offset + 2), 16);
    return Math.round(leftValue * (1 - ratio) + rightValue * ratio)
      .toString(16)
      .padStart(2, "0");
  };

  return `#${mixChannel(1)}${mixChannel(3)}${mixChannel(5)}`;
}

function bubbleSizeTier(diameter?: number): "small" | "medium" | "large" | undefined {
  if (typeof diameter !== "number") {
    return undefined;
  }

  if (diameter <= 112) {
    return "small";
  }

  if (diameter <= 168) {
    return "medium";
  }

  return "large";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToRgba(hex: string, alpha: number): string {
  if (!/^#[\da-fA-F]{6}$/.test(hex)) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function getRootRelationAnimationBudget(edgeCount: number, prefersReducedMotion: boolean): number {
  if (prefersReducedMotion || edgeCount <= 0) {
    return 0;
  }

  if (edgeCount > ROOT_RELATION_DENSE_EDGE_THRESHOLD) {
    return ROOT_RELATION_ANIMATION_BUDGET.dense;
  }

  if (edgeCount > ROOT_RELATION_MEDIUM_EDGE_THRESHOLD) {
    return ROOT_RELATION_ANIMATION_BUDGET.medium;
  }

  return ROOT_RELATION_ANIMATION_BUDGET.sparse;
}

export function getRootRelationEffectiveDpr(
  edgeCount: number,
  devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
): number {
  const cap = edgeCount > ROOT_RELATION_DENSE_EDGE_THRESHOLD
    ? ROOT_RELATION_DENSE_DPR_CAP
    : ROOT_RELATION_BASE_DPR_CAP;
  return clamp(devicePixelRatio, 1, cap);
}

export function getRootRelationHighlightLength(pathLength: number): number {
  return clamp(
    pathLength * ROOT_RELATION_HIGHLIGHT_LENGTH_RATIO,
    ROOT_RELATION_HIGHLIGHT_LENGTH_MIN,
    ROOT_RELATION_HIGHLIGHT_LENGTH_MAX,
  );
}

function quadraticBezierPoint(
  sourceX: number,
  sourceY: number,
  controlX: number,
  controlY: number,
  targetX: number,
  targetY: number,
  t: number,
): InsightPoint {
  const inverseT = 1 - t;
  return {
    x: inverseT * inverseT * sourceX + 2 * inverseT * t * controlX + t * t * targetX,
    y: inverseT * inverseT * sourceY + 2 * inverseT * t * controlY + t * t * targetY,
  };
}

export function sampleBezierPath(
  edge: Pick<RootRelationRenderableEdge, "sourceX" | "sourceY" | "controlX" | "controlY" | "targetX" | "targetY" | "dist">,
): { points: SampledPathPoint[]; length: number } {
  const segments = clamp(Math.ceil(edge.dist / 14), 16, 48);
  const points: SampledPathPoint[] = [];
  let length = 0;
  let previousPoint: InsightPoint | null = null;

  for (let index = 0; index <= segments; index += 1) {
    const point = quadraticBezierPoint(
      edge.sourceX,
      edge.sourceY,
      edge.controlX,
      edge.controlY,
      edge.targetX,
      edge.targetY,
      index / segments,
    );

    if (previousPoint) {
      const deltaX = point.x - previousPoint.x;
      const deltaY = point.y - previousPoint.y;
      length += Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }

    points.push({
      ...point,
      distance: length,
    });
    previousPoint = point;
  }

  return { points, length };
}

function pointAtDistance(
  points: SampledPathPoint[],
  distance: number,
  totalLength: number,
): InsightPoint {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (distance <= 0) {
    const firstPoint = points[0]!;
    return { x: firstPoint.x, y: firstPoint.y };
  }

  if (distance >= totalLength) {
    const lastPoint = points[points.length - 1]!;
    return { x: lastPoint.x, y: lastPoint.y };
  }

  for (let index = 1; index < points.length; index += 1) {
    const currentPoint = points[index]!;
    if (currentPoint.distance < distance) {
      continue;
    }

    const previousPoint = points[index - 1]!;
    const span = currentPoint.distance - previousPoint.distance || 1;
    const ratio = (distance - previousPoint.distance) / span;
    return {
      x: previousPoint.x + (currentPoint.x - previousPoint.x) * ratio,
      y: previousPoint.y + (currentPoint.y - previousPoint.y) * ratio,
    };
  }

  const lastPoint = points[points.length - 1]!;
  return { x: lastPoint.x, y: lastPoint.y };
}

function collectPathSegmentPoints(
  points: SampledPathPoint[],
  startDistance: number,
  endDistance: number,
  totalLength: number,
): InsightPoint[] {
  if (points.length === 0 || endDistance <= startDistance) {
    return [];
  }

  const segmentPoints: InsightPoint[] = [
    pointAtDistance(points, startDistance, totalLength),
  ];

  for (const point of points) {
    if (point.distance <= startDistance || point.distance >= endDistance) {
      continue;
    }

    segmentPoints.push({ x: point.x, y: point.y });
  }

  segmentPoints.push(pointAtDistance(points, endDistance, totalLength));
  return segmentPoints;
}

function strokePolyline(
  context: CanvasRenderingContext2D,
  points: Array<InsightPoint | SampledPathPoint>,
): void {
  if (points.length < 2) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index]!.x, points[index]!.y);
  }
  context.stroke();
}

function configureCanvasContext(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  dpr: number,
): CanvasRenderingContext2D | null {
  if (!canvas) {
    return null;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const pixelWidth = Math.max(Math.round(width * dpr), 1);
  const pixelHeight = Math.max(Math.round(height * dpr), 1);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

function drawBaseEdges(
  context: CanvasRenderingContext2D,
  edges: SampledRootRelationEdge[],
  dpr: number,
): void {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  const wideStrokeBoost = dpr > 1.35 ? 1.6 : 1.9;

  edges.forEach((edge) => {
    const gradient = context.createLinearGradient(
      edge.sourceX,
      edge.sourceY,
      edge.targetX,
      edge.targetY,
    );
    gradient.addColorStop(0, hexToRgba(edge.sourceColor, 0.34 + edge.intensity * 0.16));
    gradient.addColorStop(0.5, hexToRgba(edge.strokeColor, 0.24 + edge.intensity * 0.14));
    gradient.addColorStop(1, hexToRgba(edge.targetColor, 0.34 + edge.intensity * 0.16));

    context.save();
    context.strokeStyle = gradient;
    context.lineWidth = edge.strokeWidth + wideStrokeBoost;
    context.globalAlpha = Math.min(0.18 + edge.intensity * 0.22, 0.46);
    strokePolyline(context, edge.sampledPath);
    context.restore();

    context.save();
    context.strokeStyle = gradient;
    context.lineWidth = Math.max(edge.strokeWidth * 0.82, 1);
    context.globalAlpha = Math.min(0.22 + edge.opacity * 0.52, 0.62);
    strokePolyline(context, edge.sampledPath);
    context.restore();
  });

  context.restore();
}

function drawAnimatedEdges(
  context: CanvasRenderingContext2D,
  edges: SampledRootRelationEdge[],
  now: number,
  dpr: number,
): void {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  edges.forEach((edge) => {
    if (edge.pathLength <= 0) {
      return;
    }

    const cycleProgress = ((now + edge.animationOffsetMs) % edge.cycleDurationMs) / edge.cycleDurationMs;
    const headDistance = cycleProgress * edge.pathLength;
    const leadDistance = headDistance - edge.highlightLength;
    const segmentGroups = leadDistance >= 0
      ? [collectPathSegmentPoints(edge.sampledPath, leadDistance, headDistance, edge.pathLength)]
      : [
          collectPathSegmentPoints(edge.sampledPath, edge.pathLength + leadDistance, edge.pathLength, edge.pathLength),
          collectPathSegmentPoints(edge.sampledPath, 0, headDistance, edge.pathLength),
        ];

    for (const segmentPoints of segmentGroups) {
      if (segmentPoints.length < 2) {
        continue;
      }

      const startPoint = segmentPoints[0]!;
      const endPoint = segmentPoints[segmentPoints.length - 1]!;
      const gradient = context.createLinearGradient(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
      gradient.addColorStop(0, hexToRgba(edge.strokeColor, 0));
      gradient.addColorStop(0.55, hexToRgba(edge.strokeColor, 0.56 + edge.intensity * 0.16));
      gradient.addColorStop(1, "rgba(255, 255, 255, 0.96)");

      context.save();
      context.strokeStyle = gradient;
      context.lineWidth = edge.strokeWidth + 1.8;
      context.globalAlpha = 0.66;
      context.shadowColor = hexToRgba(edge.strokeColor, 0.34 + edge.intensity * 0.16);
      context.shadowBlur = 12 / Math.max(dpr * 0.75, 1);
      strokePolyline(context, segmentPoints);
      context.restore();

      context.save();
      context.strokeStyle = gradient;
      context.lineWidth = Math.max(edge.strokeWidth * 0.95, 1.6);
      context.globalAlpha = 0.98;
      strokePolyline(context, segmentPoints);
      context.restore();
    }

    const headPoint = pointAtDistance(edge.sampledPath, headDistance, edge.pathLength);
    const radius = 4.4 + edge.intensity * 1.8;
    const headGlow = context.createRadialGradient(
      headPoint.x,
      headPoint.y,
      0,
      headPoint.x,
      headPoint.y,
      radius * 2.4,
    );
    headGlow.addColorStop(0, "rgba(255, 255, 255, 0.96)");
    headGlow.addColorStop(0.4, hexToRgba(edge.strokeColor, 0.86));
    headGlow.addColorStop(1, hexToRgba(edge.strokeColor, 0));

    context.save();
    context.fillStyle = headGlow;
    context.globalAlpha = Math.min(0.66 + edge.intensity * 0.16, 0.9);
    context.beginPath();
    context.arc(headPoint.x, headPoint.y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });

  context.restore();
}

function rootSpreadWidth(viewportWidth: number, compact: boolean, canvasGap: number): number {
  const desired = viewportWidth - canvasGap * 2;
  return compact
    ? clamp(desired, 320, 720)
    : clamp(desired, 560, 1800);
}

function getBranchLimit(kind: keyof typeof BRANCH_LIMITS, compact: boolean): number {
  return compact ? BRANCH_LIMITS[kind].compact : BRANCH_LIMITS[kind].desktop;
}

function sortMemoryNodes(memoryNodes: MemoryInsightMemoryNode[]): MemoryInsightMemoryNode[] {
  return [...memoryNodes].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.memoryId.localeCompare(right.memoryId, "en"),
  );
}

function buildRootBubbleRelationEdges(input: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
}): RootBubbleRelationEdge[] {
  const { cards, memories, matchMap } = input;
  if (cards.length < 2 || memories.length === 0) {
    return [];
  }

  const cardByCategory = new Map<string, string>();
  cards.forEach((card) => {
    cardByCategory.set(normalizeInsightCategoryKey(card.category), `card:${card.category}`);
  });
  const cardIDs = new Set(cardByCategory.values());

  const tagSetsByCardID = new Map<string, Set<string>>();
  const aggregateByPair = new Map<string, Omit<RootBubbleRelationEdge, "id" | "strength">>();
  const pairKey = (left: string, right: string) => {
    return left < right ? `${left}=>${right}` : `${right}=>${left}`;
  };

  memories.forEach((memory) => {
    const match = matchMap.get(memory.id);
    if (!match || match.categories.length === 0) {
      return;
    }

    const cardIDsForMemory = Array.from(new Set(
      match.categories
        .map((category) => cardByCategory.get(normalizeInsightCategoryKey(category)))
        .filter((value): value is string => typeof value === "string"),
    ));

    if (cardIDsForMemory.length < 2) {
      return;
    }

    const normalizedTags = new Set(
      memory.tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    );

    cardIDsForMemory.forEach((cardID) => {
      if (!cardIDs.has(cardID)) {
        return;
      }
      let tagSet = tagSetsByCardID.get(cardID);
      if (!tagSet) {
        tagSet = new Set<string>();
        tagSetsByCardID.set(cardID, tagSet);
      }
      normalizedTags.forEach((tag) => tagSet.add(tag));
    });

    for (let index = 0; index < cardIDsForMemory.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < cardIDsForMemory.length; compareIndex += 1) {
        const sourceId = cardIDsForMemory[index]!;
        const targetId = cardIDsForMemory[compareIndex]!;
        const key = pairKey(sourceId, targetId);
        const previous = aggregateByPair.get(key);
        aggregateByPair.set(key, {
          sourceId: sourceId < targetId ? sourceId : targetId,
          targetId: sourceId < targetId ? targetId : sourceId,
          sharedMemoryCount: (previous?.sharedMemoryCount ?? 0) + 1,
          sharedTagCount: previous?.sharedTagCount ?? 0,
        });
      }
    }
  });

  aggregateByPair.forEach((aggregate, key) => {
    const sourceTags = tagSetsByCardID.get(aggregate.sourceId) ?? new Set<string>();
    const targetTags = tagSetsByCardID.get(aggregate.targetId) ?? new Set<string>();
    let sharedTagCount = 0;
    sourceTags.forEach((tag) => {
      if (targetTags.has(tag)) {
        sharedTagCount += 1;
      }
    });
    aggregateByPair.set(key, {
      ...aggregate,
      sharedTagCount,
    });
  });

  const edges = Array.from(aggregateByPair.values())
    .map((edge) => ({
      ...edge,
      strength: edge.sharedMemoryCount + Math.min(edge.sharedTagCount, 10) * 0.4,
      id: `${edge.sourceId}=>${edge.targetId}`,
    }))
    .filter((edge) => edge.sharedMemoryCount > 0 || edge.sharedTagCount >= 2)
    .sort((left, right) => right.strength - left.strength || right.sharedMemoryCount - left.sharedMemoryCount);

  return edges;
}

function omitKeys<T extends Record<string, unknown>>(record: T, keys: string[]): T {
  if (keys.length === 0) {
    return record;
  }

  const next = { ...record };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateWidth = () => setWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setWidth(entry ? entry.contentRect.width : element.clientWidth);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

function usePrefersReducedMotion(): boolean {
  const getMatch = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches;

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getMatch);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return prefersReducedMotion;
}

function InsightNodeButton({
  kind,
  performanceMode,
  label,
  tooltip,
  subtitle,
  meta,
  count,
  active,
  bubble,
  diameter,
  driftStyle,
  bubbleColor,
  dataTestId,
  style,
  muted,
  draggable,
  dragging,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onClick,
}: {
  kind: InsightRenderableKind;
  performanceMode: InsightPerformanceMode;
  label: string;
  tooltip?: string;
  subtitle?: string;
  meta?: string;
  count?: number;
  active?: boolean;
  bubble?: boolean;
  diameter?: number;
  driftStyle?: CSSProperties;
  bubbleColor?: string;
  dataTestId: string;
  style?: CSSProperties;
  muted?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onClick: () => void;
}) {
  const displayLabel = normalizeInlineText(label);
  const displayTooltip = normalizeInlineText(tooltip ?? label);
  const displaySubtitle = subtitle ? normalizeInlineText(subtitle) : undefined;
  const displayMeta = meta ? normalizeInlineText(meta) : undefined;
  const tooltipText = bubble
    ? displayTooltip
    : [displayTooltip, displaySubtitle, displayMeta].filter(Boolean).join("\n");

  const kindStyles: Record<InsightRenderableKind, string> = {
    card: "border-type-insight/24 text-foreground",
    tag:
      "border-type-pinned/18 bg-type-pinned/9 text-foreground shadow-[0_14px_28px_rgba(176,141,87,0.12)]",
    entity:
      "border-facet-people/18 bg-facet-people/8 text-foreground shadow-[0_14px_28px_rgba(196,106,106,0.1)]",
    memory:
      "border-border/50 bg-card text-foreground shadow-[0_14px_28px_rgba(0,0,0,0.08)]",
    more:
      "border-dashed border-foreground/14 bg-background/82 text-foreground/78 shadow-[0_10px_22px_rgba(0,0,0,0.05)]",
  };

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      className={cn(
        dragging
          ? "absolute isolate text-left transition-[left,top,box-shadow,filter] duration-75"
          : "absolute isolate text-left transition-[left,top,transform,box-shadow,filter] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        bubble
          ? "memory-insight-bubble z-[3] flex flex-col items-center justify-start bg-transparent p-0 text-center shadow-none ring-0"
          : kind === "more"
            ? "z-[2] flex items-center justify-center rounded-full border px-3 py-2 text-center"
            : "z-[2] flex flex-col rounded-[1.35rem] p-3",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        kindStyles[kind],
        muted ? "opacity-45 saturate-50" : "",
        active ? "ring-2 ring-foreground/18" : "ring-1 ring-transparent",
      )}
      style={
        bubbleColor
          ? {
              ...style,
              "--insight-bubble-color": bubbleColor,
            } as CSSProperties
          : style
      }
      data-testid={dataTestId}
      title={tooltipText || undefined}
      data-bubble-diameter={diameter}
      data-bubble-size={bubbleSizeTier(diameter)}
      data-performance-mode={performanceMode}
      data-active={active ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
    >
          {bubble ? (
        <>
          <span
            className={cn(
              "memory-insight-bubble-motion",
              active ? "memory-insight-bubble-motion-paused" : "",
            )}
            style={{
              width: diameter,
              height: diameter,
              ...(driftStyle ?? {}),
            }}
          >
            <span className="memory-insight-bubble-core">
              <span className="memory-insight-bubble-halo absolute inset-[-16px] rounded-full" />
              <span className="memory-insight-bubble-shell absolute inset-0 rounded-full" />
              <span
                className="memory-insight-bubble-visual absolute inset-[3px] rounded-full"
              />
            </span>
          </span>
          <span className="memory-insight-bubble-label mt-2 block w-full px-1">
            <span className="line-clamp-2 block text-[12px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
              {displayLabel}
            </span>
            {typeof count === "number" ? (
              <span className="mt-1 block text-[11px] font-medium tabular-nums text-foreground/62">
                {count}
              </span>
            ) : null}
          </span>
        </>
      ) : kind === "more" ? (
        <span className="text-xs font-medium tracking-[-0.01em]">{label}</span>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold tracking-[-0.02em]">
                {displayLabel}
              </div>
              {displaySubtitle ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {displaySubtitle}
                </div>
              ) : null}
            </div>
            {typeof count === "number" ? (
              <div className="shrink-0 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground/80">
                {count}
              </div>
            ) : null}
          </div>
          {displayMeta ? (
            <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {displayMeta}
            </div>
          ) : null}
        </>
      )}
    </button>
  );
}

function MemoryInsightCanvas({
  cards,
  memories,
  matchMap,
  compact,
  resetToken,
  onMemorySelect,
}: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  compact: boolean;
  resetToken: number;
  onMemorySelect: (memory: Memory) => void;
}) {
  const { t } = useTranslation();
  const [expandedCardIds, setExpandedCardIds] = useState<string[]>([]);
  const [activePathByCardId, setActivePathByCardId] = useState<Record<string, LanePath>>({});
  const [tagRevealCounts, setTagRevealCounts] = useState<Record<string, number>>({});
  const [entityRevealCounts, setEntityRevealCounts] = useState<Record<string, number>>({});
  const [memoryRevealCounts, setMemoryRevealCounts] = useState<Record<string, number>>({});
  const graphExpansion = useMemo(
    () => ({
      expandedCardIds,
      activePathByCardId,
      tagRevealCounts,
      entityRevealCounts,
      memoryRevealCounts,
      defaultTagLimit: getBranchLimit("tags", compact),
      defaultEntityLimit: getBranchLimit("entities", compact),
      defaultMemoryLimit: getBranchLimit("memories", compact),
    }),
    [
      activePathByCardId,
      compact,
      entityRevealCounts,
      expandedCardIds,
      memoryRevealCounts,
      tagRevealCounts,
    ],
  );
  const { data: graph } = useBackgroundMemoryInsightGraph({
    cards,
    memories,
    matchMap,
    expansion: graphExpansion,
  });
  const memoriesById = useMemo(
    () => new Map(memories.map((memory) => [memory.id, memory])),
    [memories],
  );
  const cardsById = useMemo(
    () => new Map(graph.cards.map((card) => [card.id, card])),
    [graph.cards],
  );
  const tagsByCardId = useMemo(() => {
    const mapping = new Map<string, MemoryInsightTagNode[]>();
    for (const tag of graph.tags) {
      const bucket = mapping.get(tag.parentId) ?? [];
      bucket.push(tag);
      mapping.set(tag.parentId, bucket);
    }
    return mapping;
  }, [graph.tags]);
  const entitiesByTagId = useMemo(() => {
    const mapping = new Map<string, MemoryInsightEntityNode[]>();
    for (const entity of graph.entities) {
      const bucket = mapping.get(entity.parentId) ?? [];
      bucket.push(entity);
      mapping.set(entity.parentId, bucket);
    }
    return mapping;
  }, [graph.entities]);
  const memoriesByEntityId = useMemo(() => {
    const mapping = new Map<string, MemoryInsightMemoryNode[]>();
    for (const memoryNode of graph.memories) {
      const bucket = mapping.get(memoryNode.parentId) ?? [];
      bucket.push(memoryNode);
      mapping.set(memoryNode.parentId, bucket);
    }
    return mapping;
  }, [graph.memories]);
  const maxCardCount = useMemo(
    () => Math.max(...graph.cards.map((card) => card.count), 1),
    [graph.cards],
  );

  const [manualRootPositions, setManualRootPositions] = useState<Record<string, InsightPoint>>({});
  const [manualLanePositions, setManualLanePositions] = useState<Record<string, InsightPoint>>({});
  const [panMode, setPanMode] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [hoveredRootCardId, setHoveredRootCardId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const dragStateRef = useRef<DragState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const suppressedClickNodeRef = useRef<string | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previousExpandedCardIdsRef = useRef<string[]>([]);
  const [viewportRef, viewportWidth] = useElementWidth<HTMLDivElement>();
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    setExpandedCardIds([]);
    setActivePathByCardId({});
    setTagRevealCounts({});
    setEntityRevealCounts({});
    setMemoryRevealCounts({});
    setManualRootPositions({});
    setManualLanePositions({});
    setDraggingNodeId(null);
    setHoveredRootCardId(null);
    dragStateRef.current = null;
    panStateRef.current = null;
  }, [resetToken]);

  useEffect(() => {
    const shouldIgnoreSpace = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      return target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || shouldIgnoreSpace(event.target)) {
        return;
      }

      event.preventDefault();
      setPanMode(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      setPanMode(false);
    };

    const handleBlur = () => setPanMode(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (dragState && dragState.pointerId === event.pointerId) {
        const deltaX = event.clientX - dragState.startClientX;
        const deltaY = event.clientY - dragState.startClientY;
        const nextPosition = {
          x: clamp(dragState.origin.x + deltaX, 0, dragState.maxX),
          y: clamp(dragState.origin.y + deltaY, 0, dragState.maxY),
        };

        dragState.moved = dragState.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;
        dragState.lastPosition = nextPosition;
        dragState.element.style.transform = `translate3d(${nextPosition.x - dragState.origin.x}px, ${nextPosition.y - dragState.origin.y}px, 0)`;
        return;
      }

      const panState = panStateRef.current;
      if (panState && panState.pointerId === event.pointerId) {
        panState.element.scrollLeft = panState.startScrollLeft - (event.clientX - panState.startClientX);
        panState.element.scrollTop = panState.startScrollTop - (event.clientY - panState.startClientY);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (dragState && dragState.pointerId === event.pointerId) {
        dragState.element.style.transform = "";
        if (dragState.moved) {
          suppressedClickNodeRef.current = dragState.nodeId;
          dragState.onDrop(dragState.lastPosition);
          window.setTimeout(() => {
            if (suppressedClickNodeRef.current === dragState.nodeId) {
              suppressedClickNodeRef.current = null;
            }
          }, 0);
        }

        dragStateRef.current = null;
        setDraggingNodeId(null);
        document.body.style.userSelect = "";
      }

      const panState = panStateRef.current;
      if (panState && panState.pointerId === event.pointerId) {
        panStateRef.current = null;
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === shellRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    config: Omit<DragState, "pointerId" | "element" | "startClientX" | "startClientY" | "lastPosition" | "moved">,
  ) => {
    if (panMode) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      ...config,
      pointerId: event.pointerId,
      element: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastPosition: config.origin,
      moved: false,
    };
    setDraggingNodeId(config.nodeId);
    document.body.style.userSelect = "none";
  };

  const startViewportPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panMode || event.target !== event.currentTarget) {
      return;
    }

    panStateRef.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: event.currentTarget.scrollLeft,
      startScrollTop: event.currentTarget.scrollTop,
    };
    document.body.style.userSelect = "none";
  };

  const guardedClick = (nodeId: string, onClick: () => void) => {
    if (suppressedClickNodeRef.current === nodeId) {
      return;
    }

    onClick();
  };

  const clearEntityBranchState = (entityId?: string) => {
    if (!entityId) {
      return;
    }

    const memoryNodeIds = (memoriesByEntityId.get(entityId) ?? []).map((memoryNode) => memoryNode.id);
    setMemoryRevealCounts((current) => omitKeys(current, [entityId]));
    setManualLanePositions((current) => omitKeys(current, [entityId, ...memoryNodeIds]));
  };

  const clearTagBranchState = (tagId?: string, entityId?: string) => {
    if (!tagId) {
      clearEntityBranchState(entityId);
      return;
    }

    const entityNodeIds = (entitiesByTagId.get(tagId) ?? []).map((entity) => entity.id);
    const memoryNodeIds = entityNodeIds.flatMap((candidateEntityId) =>
      (memoriesByEntityId.get(candidateEntityId) ?? []).map((memoryNode) => memoryNode.id),
    );

    setEntityRevealCounts((current) => omitKeys(current, [tagId]));
    setMemoryRevealCounts((current) => omitKeys(current, entityNodeIds));
    setManualLanePositions((current) =>
      omitKeys(current, [tagId, ...entityNodeIds, ...memoryNodeIds]),
    );
  };

  const clearCardState = (cardId: string) => {
    const tagIds = (tagsByCardId.get(cardId) ?? []).map((tag) => tag.id);
    const entityIds = tagIds.flatMap((tagId) =>
      (entitiesByTagId.get(tagId) ?? []).map((entity) => entity.id),
    );
    const memoryIds = entityIds.flatMap((entityId) =>
      (memoriesByEntityId.get(entityId) ?? []).map((memoryNode) => memoryNode.id),
    );
    setActivePathByCardId((current) => omitKeys(current, [cardId]));
    setTagRevealCounts((current) => omitKeys(current, [cardId]));
    setEntityRevealCounts((current) => omitKeys(current, tagIds));
    setMemoryRevealCounts((current) => omitKeys(current, entityIds));
    setManualLanePositions((current) =>
      omitKeys(current, [cardId, ...tagIds, ...entityIds, ...memoryIds]),
    );
  };

  const selectTag = (cardId: string, tagId: string) => {
    setActivePathByCardId((current) => {
      const currentPath = current[cardId] ?? {};
      const nextTagId = currentPath.tagId === tagId ? undefined : tagId;
      return {
        ...current,
        [cardId]: {
          tagId: nextTagId,
          entityId: undefined,
        },
      };
    });

    const currentPath = activePathByCardId[cardId] ?? {};
    clearTagBranchState(currentPath.tagId, currentPath.entityId);
  };

  const selectEntity = (cardId: string, entityId: string) => {
    setActivePathByCardId((current) => {
      const currentPath = current[cardId] ?? {};
      const nextEntityId = currentPath.entityId === entityId ? undefined : entityId;
      return {
        ...current,
        [cardId]: {
          tagId: currentPath.tagId,
          entityId: nextEntityId,
        },
      };
    });

    const currentPath = activePathByCardId[cardId] ?? {};
    clearEntityBranchState(currentPath.entityId);
  };

  const toggleCard = (cardId: string) => {
    setExpandedCardIds((current) => {
      if (current.includes(cardId)) {
        clearCardState(cardId);
        return current.filter((candidate) => candidate !== cardId);
      }
      return [cardId, ...current.filter((candidate) => candidate !== cardId)];
    });
  };

  const handleFullscreenToggle = async () => {
    const element = shellRef.current;
    if (!element) {
      return;
    }

    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement && element.requestFullscreen) {
        await element.requestFullscreen();
      }
    } catch {
      // Ignore rejected fullscreen requests and keep current layout state.
    }
  };

  const viewportMinHeight = compact
    ? 400
    : isFullscreen
      ? Math.max(window.innerHeight - 180, 640)
      : 520;

  const canvasGap = compact ? CANVAS_GAP.compact : CANVAS_GAP.desktop;
  const laneGap = compact ? LANE_GAP.compact : LANE_GAP.desktop;
  const bubbleColumnWidth = compact ? LANE_COLUMN_WIDTHS.bubble.compact : LANE_COLUMN_WIDTHS.bubble.desktop;
  const tagColumnWidth = compact ? LANE_COLUMN_WIDTHS.tag.compact : LANE_COLUMN_WIDTHS.tag.desktop;
  const entityColumnWidth = compact ? LANE_COLUMN_WIDTHS.entity.compact : LANE_COLUMN_WIDTHS.entity.desktop;
  const memoryColumnWidth = compact ? LANE_COLUMN_WIDTHS.memory.compact : LANE_COLUMN_WIDTHS.memory.desktop;
  const laneWidth = bubbleColumnWidth + tagColumnWidth + entityColumnWidth + memoryColumnWidth + laneGap * 3;
  const safeViewportWidth = Math.max(viewportWidth, compact ? 720 : 1080);
  const rootRegionWidth = rootSpreadWidth(safeViewportWidth, compact, canvasGap);
  const rootRegionOffsetX = canvasGap;
  const laneStartX = rootRegionOffsetX + rootRegionWidth + canvasGap * 2;

  const expandedCards = useMemo(
    () =>
      expandedCardIds
        .map((cardId) => cardsById.get(cardId))
        .filter((card): card is NonNullable<typeof card> => Boolean(card)),
    [cardsById, expandedCardIds],
  );
  const expandedCardSet = useMemo(() => new Set(expandedCardIds), [expandedCardIds]);
  const poolCards = useMemo(
    () => graph.cards.filter((card) => !expandedCardSet.has(card.id)),
    [expandedCardSet, graph.cards],
  );

  const poolLayout = useMemo(
    () =>
      packRootBubbles({
        items: poolCards.map((card) => ({
          id: card.id,
          ...nodeDimensions("card", card.count, compact, maxCardCount),
          diameter: bubbleDiameter(card.count, maxCardCount, compact),
        })),
        width: rootRegionWidth,
        manualPositions: Object.fromEntries(
          Object.entries(manualRootPositions).filter(([id]) => poolCards.some((card) => card.id === id)),
        ),
      }),
    [compact, manualRootPositions, maxCardCount, poolCards, rootRegionWidth],
  );

  const laneDrafts = useMemo(() => {
    return expandedCards.map((card) => {
      const path = activePathByCardId[card.id] ?? {};
      const allTags = tagsByCardId.get(card.id) ?? [];
      const tagLimit = getBranchLimit("tags", compact);
      const shownTagCount = tagRevealCounts[card.id] ?? tagLimit;
      const shownTags = allTags.slice(0, shownTagCount);
      const totalTagCount = card.childCount ?? allTags.length;
      const hiddenTagCount = Math.max(totalTagCount - shownTags.length, 0);
      const selectedTag = path.tagId
        ? shownTags.find((tag) => tag.id === path.tagId) ?? allTags.find((tag) => tag.id === path.tagId)
        : undefined;

      const allEntities = selectedTag ? entitiesByTagId.get(selectedTag.id) ?? [] : [];
      const entityLimit = getBranchLimit("entities", compact);
      const shownEntityCount = selectedTag
        ? entityRevealCounts[selectedTag.id] ?? entityLimit
        : entityLimit;
      const shownEntities = allEntities.slice(0, shownEntityCount);
      const totalEntityCount = selectedTag?.childCount ?? allEntities.length;
      const hiddenEntityCount = Math.max(totalEntityCount - shownEntities.length, 0);
      const selectedEntity = path.entityId
        ? shownEntities.find((entity) => entity.id === path.entityId) ?? allEntities.find((entity) => entity.id === path.entityId)
        : undefined;

      const allMemoryNodes = selectedEntity
        ? sortMemoryNodes(memoriesByEntityId.get(selectedEntity.id) ?? [])
        : [];
      const memoryLimit = getBranchLimit("memories", compact);
      const shownMemoryCount = selectedEntity
        ? memoryRevealCounts[selectedEntity.id] ?? memoryLimit
        : memoryLimit;
      const shownMemoryNodes = allMemoryNodes.slice(0, shownMemoryCount);
      const totalMemoryCount = selectedEntity?.count ?? allMemoryNodes.length;
      const hiddenMemoryCount = Math.max(totalMemoryCount - shownMemoryNodes.length, 0);

      const bubbleSize = nodeDimensions("card", card.count, compact, maxCardCount);
      const bubbleDiameterValue = bubbleDiameter(card.count, maxCardCount, compact);
      const focusBubbleWidth = Math.max(bubbleColumnWidth - 24, bubbleSize.width + 28);
      const bubbleItems: LaneRenderableItem[] = [
        {
          id: card.id,
          kind: "card",
          label: formatInsightCategoryLabel(card.category, t),
          count: card.count,
          width: bubbleSize.width,
          height: bubbleSize.height,
          active: true,
          bubble: true,
          diameter: bubbleDiameterValue,
          bubbleColor: bubbleToneColor(card.category),
          draggable: true,
          onClick: () => toggleCard(card.id),
        },
      ];

      const tagItems: LaneRenderableItem[] = shownTags.map((tag) => {
        const dimensions = nodeDimensions("tag", tag.count, compact, maxCardCount);
        return {
          id: tag.id,
          kind: "tag",
          label: tag.label,
          subtitle: t("memory_insight.tag_subtitle"),
          count: tag.count,
          width: dimensions.width,
          height: dimensions.height,
          active: path.tagId === tag.id,
          draggable: true,
          onClick: () => selectTag(card.id, tag.id),
        };
      });

      if (hiddenTagCount > 0) {
        const dimensions = nodeDimensions("more", hiddenTagCount, compact, maxCardCount);
        tagItems.push({
          id: `more:${card.id}:tags`,
          kind: "more",
          label: t("memory_insight.more_tags", { count: hiddenTagCount }),
          width: dimensions.width,
          height: dimensions.height,
          onClick: () => {
            setTagRevealCounts((current) => ({
              ...current,
              [card.id]: Math.min(totalTagCount, shownTagCount + tagLimit),
            }));
          },
        });
      }

      const entityItems: LaneRenderableItem[] = shownEntities.map((entity) => {
        const dimensions = nodeDimensions("entity", entity.count, compact, maxCardCount);
        return {
          id: entity.id,
          kind: "entity",
          label: entity.label,
          subtitle: t(`memory_insight.entity_kind.${entity.entityKind}`),
          count: entity.count,
          width: dimensions.width,
          height: dimensions.height,
          active: path.entityId === entity.id,
          onClick: () => selectEntity(card.id, entity.id),
        };
      });

      if (selectedTag && hiddenEntityCount > 0) {
        const dimensions = nodeDimensions("more", hiddenEntityCount, compact, maxCardCount);
        entityItems.push({
          id: `more:${selectedTag.id}:entities`,
          kind: "more",
          label: t("memory_insight.more_entities", { count: hiddenEntityCount }),
          width: dimensions.width,
          height: dimensions.height,
          onClick: () => {
            setEntityRevealCounts((current) => ({
              ...current,
              [selectedTag.id]: Math.min(totalEntityCount, shownEntityCount + entityLimit),
            }));
          },
        });
      }

      const memoryItems: LaneRenderableItem[] = shownMemoryNodes
        .map((memoryNode) => {
          const memory = memoriesById.get(memoryNode.memoryId);
          if (!memory) {
            return null;
          }

          const dimensions = nodeDimensions("memory", 1, compact, maxCardCount);
          return {
            id: memoryNode.id,
            kind: "memory" as const,
            label: previewMemoryContent(memory),
            tooltip: normalizeInlineText(memory.content),
            subtitle: memory.memory_type === "pinned"
              ? t("space.stats.pinned")
              : t("space.stats.insight"),
            meta: memory.tags.length > 0
              ? memory.tags.slice(0, compact ? 2 : 4).map((tag) => `#${tag}`).join(" ")
              : t("memory_insight.memory_meta_empty"),
            width: dimensions.width,
            height: dimensions.height,
            onClick: () => onMemorySelect(memory),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (selectedEntity && hiddenMemoryCount > 0) {
        const dimensions = nodeDimensions("more", hiddenMemoryCount, compact, maxCardCount);
        memoryItems.push({
          id: `more:${selectedEntity.id}:memories`,
          kind: "more",
          label: t("memory_insight.more_memories", { count: hiddenMemoryCount }),
          width: dimensions.width,
          height: dimensions.height,
          onClick: () => {
            setMemoryRevealCounts((current) => ({
              ...current,
              [selectedEntity.id]: Math.min(totalMemoryCount, shownMemoryCount + memoryLimit),
            }));
          },
        });
      }

      return {
        card,
        bubbleItems,
        tagItems,
        entityItems,
        memoryItems,
        selectedTagId: selectedTag?.id,
        selectedEntityId: selectedEntity?.id,
        selectedTag,
        focusBubbleWidth,
      };
    });
  }, [
    activePathByCardId,
    compact,
    entitiesByTagId,
    entityRevealCounts,
    expandedCards,
    matchMap,
    maxCardCount,
    memoriesByEntityId,
    memoriesById,
    memoryRevealCounts,
    onMemorySelect,
    selectEntity,
    selectTag,
    t,
    tagRevealCounts,
    tagsByCardId,
  ]);
  const laneDraftSignature = useMemo(() => draftLaneKey(laneDrafts), [laneDrafts]);

  const laneHeights = useMemo(() => {
    return laneDrafts.map((draft) => {
      const laneItemIds = [
        ...draft.bubbleItems.map((item) => item.id),
        ...draft.tagItems.map((item) => item.id),
        ...draft.entityItems.map((item) => item.id),
        ...draft.memoryItems.map((item) => item.id),
      ];

      const bubbleLayout = layoutLaneColumn({
        items: draft.bubbleItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: draft.focusBubbleWidth,
        manualPositions: Object.fromEntries(
          Object.entries(manualLanePositions)
            .filter(([id]) => laneItemIds.includes(id))
            .map(([id, position]) => [id, { x: position.x, y: position.y }]),
        ),
      });
      const tagLayout = layoutLaneColumn({
        items: draft.tagItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: tagColumnWidth,
      });
      const entityLayout = layoutLaneColumn({
        items: draft.entityItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: entityColumnWidth,
      });
      const memoryLayout = layoutLaneColumn({
        items: draft.memoryItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: memoryColumnWidth,
      });

      return Math.max(
        bubbleLayout.height,
        tagLayout.height,
        entityLayout.height,
        memoryLayout.height,
        compact ? 180 : 220,
      );
    });
  }, [compact, entityColumnWidth, laneDraftSignature, manualLanePositions, memoryColumnWidth, tagColumnWidth]);

  const laneAnchors = useMemo(
    () =>
      layoutLaneAnchors({
        laneIds: expandedCards.map((card) => card.id),
        startX: laneStartX,
        startY: 28,
        laneHeights,
        gap: canvasGap,
      }),
    [canvasGap, expandedCards, laneHeights, laneStartX],
  );

  useEffect(() => {
    const previous = previousExpandedCardIdsRef.current;
    previousExpandedCardIdsRef.current = expandedCardIds;

    if (expandedCardIds.length <= previous.length) {
      return;
    }

    const newestCardId = expandedCardIds.find((cardId) => !previous.includes(cardId));
    if (!newestCardId) {
      return;
    }

    const anchor = laneAnchors.positions[newestCardId];
    const viewport = viewportRef.current;
    if (!anchor || !viewport) {
      return;
    }

    window.requestAnimationFrame(() => {
      const nextLeft = Math.max(anchor.x - canvasGap, 0);
      const nextTop = Math.max(anchor.y - canvasGap, 0);

      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          left: nextLeft,
          top: nextTop,
          behavior: "smooth",
        });
        return;
      }

      viewport.scrollLeft = nextLeft;
      viewport.scrollTop = nextTop;
    });
  }, [canvasGap, expandedCardIds, laneAnchors.positions, viewportRef]);

  const rawRootRelationEdges = useMemo(() => {
    const rootCardsById = new Map(
      poolCards.map((card) => [
        `card:${card.category}`,
        {
          card,
          color: bubbleToneColor(card.category),
        },
      ]),
    );
    const edges = buildRootBubbleRelationEdges({
      cards: poolCards,
      memories,
      matchMap,
    });

    if (edges.length === 0) {
      return [];
    }

    const maxStrength = edges[0]?.strength ?? 1;
    return edges
      .map((edge) => {
        const sourceEntry = rootCardsById.get(edge.sourceId);
        const targetEntry = rootCardsById.get(edge.targetId);
        const sourcePosition = poolLayout.positions[edge.sourceId];
        const targetPosition = poolLayout.positions[edge.targetId];
        if (!sourceEntry || !targetEntry || !sourcePosition || !targetPosition) {
          return null;
        }

        const sourceBubbleSize = nodeDimensions("card", sourceEntry.card.count, compact, maxCardCount);
        const targetBubbleSize = nodeDimensions("card", targetEntry.card.count, compact, maxCardCount);
        const sourceDiameter = bubbleDiameter(sourceEntry.card.count, maxCardCount, compact);
        const targetDiameter = bubbleDiameter(targetEntry.card.count, maxCardCount, compact);
        const intensity = Math.min(edge.strength / Math.max(maxStrength, 1), 1);
        const sourceX = rootRegionOffsetX + sourcePosition.x + sourceBubbleSize.width / 2;
        const sourceY = sourcePosition.y + sourceDiameter / 2;
        const targetX = rootRegionOffsetX + targetPosition.x + targetBubbleSize.width / 2;
        const targetY = targetPosition.y + targetDiameter / 2;
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const perpX = -dy / (dist || 1);
        const perpY = dx / (dist || 1);
        const curveOffset = Math.min(dist * 0.15, 40) * (hashString(edge.id) % 2 === 0 ? 1 : -1);
        const controlX = (sourceX + targetX) / 2 + perpX * curveOffset;
        const controlY = (sourceY + targetY) / 2 + perpY * curveOffset;
        const sourceColor = sourceEntry.color;
        const targetColor = targetEntry.color;

        return {
          ...edge,
          sourceX,
          sourceY,
          controlX,
          controlY,
          targetX,
          targetY,
          intensity,
          strokeWidth: 1 + intensity * 3.8,
          opacity: 0.12 + intensity * 0.5,
          sourceColor,
          targetColor,
          strokeColor: mixHexColors(sourceColor, targetColor),
          dist,
        } satisfies RootRelationRenderableEdge;
      })
      .filter((edge): edge is RootRelationRenderableEdge => edge !== null);
  }, [compact, matchMap, maxCardCount, memories, poolCards, poolLayout.positions, rootRegionOffsetX]);

  const sampledRootRelationEdges = useMemo<SampledRootRelationEdge[]>(
    () =>
      rawRootRelationEdges.map((edge) => {
        const sampledPath = sampleBezierPath(edge);
        return {
          ...edge,
          sampledPath: sampledPath.points,
          pathLength: sampledPath.length,
          highlightLength: getRootRelationHighlightLength(sampledPath.length),
          cycleDurationMs:
            ROOT_RELATION_CYCLE_DURATION_MS.min +
            (1 - edge.intensity) * (ROOT_RELATION_CYCLE_DURATION_MS.max - ROOT_RELATION_CYCLE_DURATION_MS.min),
          animationOffsetMs: hashString(edge.id) % ROOT_RELATION_CYCLE_DURATION_MS.max,
        };
      }),
    [rawRootRelationEdges],
  );

  const rootPoolCardIds = useMemo(
    () => new Set(poolCards.map((card) => card.id)),
    [poolCards],
  );
  const animationBudget = useMemo(
    () => getRootRelationAnimationBudget(sampledRootRelationEdges.length, prefersReducedMotion),
    [prefersReducedMotion, sampledRootRelationEdges.length],
  );
  const effectiveCanvasDpr = useMemo(
    () => getRootRelationEffectiveDpr(sampledRootRelationEdges.length),
    [sampledRootRelationEdges.length],
  );
  const performanceMode: InsightPerformanceMode = prefersReducedMotion ? "reduced" : "full";
  const isDraggingRootBubble = draggingNodeId ? rootPoolCardIds.has(draggingNodeId) : false;

  useEffect(() => {
    if (hoveredRootCardId && !rootPoolCardIds.has(hoveredRootCardId)) {
      setHoveredRootCardId(null);
    }
  }, [hoveredRootCardId, rootPoolCardIds]);

  const animatedRootRelationEdges = useMemo(() => {
    if (animationBudget === 0 || isDraggingRootBubble) {
      return [];
    }

    const prioritizedEdges = hoveredRootCardId
      ? sampledRootRelationEdges.filter(
          (edge) => edge.sourceId === hoveredRootCardId || edge.targetId === hoveredRootCardId,
        )
      : [];
    const prioritizedEdgeIds = new Set(prioritizedEdges.map((edge) => edge.id));
    const selectedEdges = prioritizedEdges.slice(0, animationBudget);

    if (selectedEdges.length < animationBudget) {
      selectedEdges.push(
        ...sampledRootRelationEdges
          .filter((edge) => !prioritizedEdgeIds.has(edge.id))
          .slice(0, animationBudget - selectedEdges.length),
      );
    }

    return selectedEdges;
  }, [animationBudget, hoveredRootCardId, isDraggingRootBubble, sampledRootRelationEdges]);

  const animatedRootRelationEdgeIds = useMemo(
    () => animatedRootRelationEdges.map((edge) => edge.id).join(","),
    [animatedRootRelationEdges],
  );

  const canvasNodes = useMemo(() => {
    const positionedNodes: PositionedNode[] = [];

    poolCards.forEach((card) => {
      const bubbleSize = nodeDimensions("card", card.count, compact, maxCardCount);
      const diameter = bubbleDiameter(card.count, maxCardCount, compact);
      const localPosition = poolLayout.positions[card.id] ?? { x: 0, y: 0 };
      positionedNodes.push({
        id: card.id,
        kind: "card",
        label: formatInsightCategoryLabel(card.category, t),
        count: card.count,
        width: bubbleSize.width,
        height: bubbleSize.height,
        active: false,
        bubble: true,
        diameter,
        bubbleColor: bubbleToneColor(card.category),
        draggable: true,
        driftStyle: draggingNodeId === card.id || prefersReducedMotion
          ? undefined
          : createBubbleMotionStyle(card.id),
        position: {
          x: rootRegionOffsetX + localPosition.x,
          y: localPosition.y,
        },
        onClick: () => toggleCard(card.id),
      });
    });

    laneDrafts.forEach((draft) => {
      const anchor = laneAnchors.positions[draft.card.id] ?? { x: laneStartX, y: 28 };
      const bubbleLayout = layoutLaneColumn({
        items: draft.bubbleItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: draft.focusBubbleWidth,
        manualPositions: Object.fromEntries(
          draft.bubbleItems
            .map((item) => item.id)
            .filter((id) => manualLanePositions[id])
            .map((id) => [id, { x: manualLanePositions[id]!.x - anchor.x, y: manualLanePositions[id]!.y - anchor.y }]),
        ),
      });
      const tagLayout = layoutLaneColumn({
        items: draft.tagItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: tagColumnWidth,
        manualPositions: Object.fromEntries(
          draft.tagItems
            .map((item) => item.id)
            .filter((id) => manualLanePositions[id])
            .map((id) => [id, {
              x: manualLanePositions[id]!.x - (anchor.x + draft.focusBubbleWidth + laneGap),
              y: manualLanePositions[id]!.y - anchor.y,
            }]),
        ),
      });
      const entityLayout = layoutLaneColumn({
        items: draft.entityItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: entityColumnWidth,
      });
      const memoryLayout = layoutLaneColumn({
        items: draft.memoryItems.map(
          (item): InsightRectItem => ({ id: item.id, width: item.width, height: item.height }),
        ),
        width: memoryColumnWidth,
      });

      draft.bubbleItems.forEach((item) => {
        const local = bubbleLayout.positions[item.id] ?? { x: 12, y: 12 };
        positionedNodes.push({
          ...item,
          active: true,
          position: {
            x: anchor.x + local.x,
            y: anchor.y + local.y,
          },
        });
      });

      draft.tagItems.forEach((item) => {
        const local = tagLayout.positions[item.id] ?? { x: 12, y: 12 };
        positionedNodes.push({
          ...item,
          position: {
            x: anchor.x + draft.focusBubbleWidth + laneGap + local.x,
            y: anchor.y + local.y,
          },
        });
      });

      draft.entityItems.forEach((item) => {
        const local = entityLayout.positions[item.id] ?? { x: 12, y: 12 };
        positionedNodes.push({
          ...item,
          position: {
            x: anchor.x + draft.focusBubbleWidth + tagColumnWidth + laneGap * 2 + local.x,
            y: anchor.y + local.y,
          },
        });
      });

      draft.memoryItems.forEach((item) => {
        const local = memoryLayout.positions[item.id] ?? { x: 12, y: 12 };
        positionedNodes.push({
          ...item,
          position: {
            x: anchor.x + draft.focusBubbleWidth + tagColumnWidth + entityColumnWidth + laneGap * 3 + local.x,
            y: anchor.y + local.y,
          },
        });
      });
    });

    return positionedNodes;
  }, [
    compact,
    draggingNodeId,
    entityColumnWidth,
    laneAnchors.positions,
    laneDraftSignature,
    laneGap,
    laneStartX,
    manualLanePositions,
    maxCardCount,
    memoryColumnWidth,
    poolCards,
    poolLayout.positions,
    rootRegionOffsetX,
    prefersReducedMotion,
    t,
    tagColumnWidth,
  ]);

  const canvasBounds = useMemo(
    () =>
      computeCanvasBounds({
        leftRegionWidth: rootRegionOffsetX + rootRegionWidth,
        leftRegionHeight: poolLayout.height,
        laneWidth,
        laneAnchors: laneAnchors.positions,
        laneHeights: laneAnchors.heights,
        nodes: canvasNodes.map((node) => ({
          x: node.position.x,
          y: node.position.y,
          width: node.width,
          height: node.height,
        })),
        viewportWidth: safeViewportWidth,
        viewportHeight: viewportMinHeight,
      }),
    [canvasNodes, laneAnchors.positions, laneHeights, laneWidth, poolLayout.height, rootRegionOffsetX, rootRegionWidth, safeViewportWidth, viewportMinHeight],
  );

  useEffect(() => {
    const context = configureCanvasContext(
      baseCanvasRef.current,
      canvasBounds.width,
      canvasBounds.height,
      effectiveCanvasDpr,
    );
    if (!context) {
      return;
    }

    drawBaseEdges(context, sampledRootRelationEdges, effectiveCanvasDpr);
  }, [canvasBounds.height, canvasBounds.width, effectiveCanvasDpr, sampledRootRelationEdges]);

  useEffect(() => {
    const canvas = fxCanvasRef.current;
    const context = configureCanvasContext(
      canvas,
      canvasBounds.width,
      canvasBounds.height,
      effectiveCanvasDpr,
    );
    if (!canvas || !context) {
      return;
    }

    if (animatedRootRelationEdges.length === 0) {
      return;
    }

    let animationFrameId = 0;
    const renderFrame = (now: number) => {
      const frameContext = configureCanvasContext(
        canvas,
        canvasBounds.width,
        canvasBounds.height,
        effectiveCanvasDpr,
      );
      if (!frameContext) {
        return;
      }

      drawAnimatedEdges(frameContext, animatedRootRelationEdges, now, effectiveCanvasDpr);
      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [animatedRootRelationEdges, canvasBounds.height, canvasBounds.width, effectiveCanvasDpr]);

  const summaryParts = useMemo(() => {
    const parts = [t("memory_insight.summary_root", { count: graph.cards.length })];
    if (expandedCards.length > 0) {
      parts.push(t("memory_insight.summary_open", { count: expandedCards.length }));
    }
    return parts;
  }, [expandedCards.length, graph.cards.length, t]);

  const fitView = () => {
    viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };

  const resetLayout = () => {
    setExpandedCardIds([]);
    setActivePathByCardId({});
    setTagRevealCounts({});
    setEntityRevealCounts({});
    setMemoryRevealCounts({});
    setManualRootPositions({});
    setManualLanePositions({});
    setDraggingNodeId(null);
    viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };

  return (
    <section
      ref={shellRef}
      className={cn(
        "surface-card relative overflow-hidden px-4 py-5 sm:px-6",
        isFullscreen ? "h-screen rounded-none px-5 py-5 sm:px-8" : "",
      )}
      data-testid="memory-insight-overview"
      data-performance-mode={performanceMode}
      data-edge-layer="canvas"
      data-animation-budget={animationBudget}
      data-effective-dpr={effectiveCanvasDpr}
      data-animated-edge-ids={animatedRootRelationEdgeIds}
      data-highlighted-root={hoveredRootCardId ?? ""}
      style={{
        background:
          "radial-gradient(circle at top right, color-mix(in srgb, var(--facet-people) 12%, transparent) 0%, transparent 30%), radial-gradient(circle at 10% 20%, color-mix(in srgb, var(--type-insight) 16%, transparent) 0%, transparent 36%), linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--card) 92%, transparent))",
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent)]" />

      <div className="relative flex h-full flex-col">
        <div className="flex flex-col gap-3 border-b border-foreground/6 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
              {t("memory_insight.eyebrow")}
            </p>
            <h2 className="mt-2 text-[clamp(1.45rem,2vw,1.85rem)] font-semibold tracking-[-0.06em] text-foreground">
              {t("memory_insight.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("memory_insight.subtitle")}
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-foreground/8 bg-background/55 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
            <Sparkles className="size-3.5" />
            {summaryParts.join(" / ")}
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-foreground/8 bg-background/45">
          <div className="flex flex-col gap-3 border-b border-foreground/8 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p>{t("memory_insight.helper")}</p>
              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/72">
                <Move className="size-3" />
                {t("memory_insight.pan_hint")}
              </p>
            </div>
            <div
              className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap"
              data-testid="memory-insight-controls"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFullscreenToggle}
                className="h-8 gap-1.5 border-foreground/10 bg-background/82 text-xs shadow-sm"
                data-testid="memory-insight-fullscreen-toggle"
              >
                {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                {isFullscreen ? t("memory_insight.exit_fullscreen") : t("memory_insight.enter_fullscreen")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetLayout}
                className="h-8 gap-1.5 border-foreground/10 bg-background/82 text-xs shadow-sm"
              >
                <RefreshCcw className="size-3.5" />
                {t("memory_insight.reset_layout")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fitView}
                className="h-8 gap-1.5 border-foreground/10 bg-background/82 text-xs shadow-sm"
              >
                <Maximize2 className="size-3.5" />
                {t("memory_insight.fit_view")}
              </Button>
            </div>
          </div>

          <div
            ref={viewportRef}
            onPointerDown={startViewportPan}
            className={cn(
              "relative min-h-0 flex-1 overflow-auto",
              panMode ? "cursor-grab active:cursor-grabbing" : "",
            )}
            style={{ height: viewportMinHeight }}
            data-testid="memory-insight-canvas-viewport"
          >
            <div
              className="relative"
              style={{
                width: canvasBounds.width,
                height: canvasBounds.height,
              }}
            >
              <div
                className="pointer-events-none absolute bottom-6 left-6 rounded-full border border-foreground/8 bg-background/76 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur-sm"
                data-testid="memory-insight-canvas-badge"
              >
                {t("memory_insight.canvas_hint")}
              </div>

              {sampledRootRelationEdges.length > 0 ? (
                <>
                  <canvas
                    ref={baseCanvasRef}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-0"
                    style={{ width: canvasBounds.width, height: canvasBounds.height }}
                    data-testid="memory-insight-base-canvas"
                  />
                  <canvas
                    ref={fxCanvasRef}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-[1]"
                    style={{ width: canvasBounds.width, height: canvasBounds.height }}
                    data-testid="memory-insight-fx-canvas"
                  />
                </>
              ) : null}

              {canvasNodes.map((node) => {
                const isRootBubble = node.kind === "card" && !expandedCardSet.has(node.id);
                const diameter = node.diameter ?? node.width;

                return (
                  <InsightNodeButton
                    key={node.id}
                    kind={node.kind}
                    performanceMode={performanceMode}
                    label={node.label}
                    tooltip={node.tooltip}
                    subtitle={node.subtitle}
                    meta={node.meta}
                    count={node.count}
                    active={node.active}
                    bubble={node.bubble}
                    diameter={node.diameter}
                    bubbleColor={node.bubbleColor}
                    driftStyle={isRootBubble && draggingNodeId !== node.id
                      ? node.driftStyle
                      : undefined}
                    muted={node.muted}
                    draggable={node.draggable}
                    dragging={draggingNodeId === node.id}
                    dataTestId={`insight-node-${node.id}`}
                    style={{
                      left: node.position.x,
                      top: node.position.y,
                      width: node.width,
                      height: node.height,
                    }}
                    onPointerEnter={isRootBubble ? () => setHoveredRootCardId(node.id) : undefined}
                    onPointerLeave={isRootBubble ? () => setHoveredRootCardId((current) => (
                      current === node.id ? null : current
                    )) : undefined}
                    onFocus={isRootBubble ? () => setHoveredRootCardId(node.id) : undefined}
                    onBlur={isRootBubble ? () => setHoveredRootCardId((current) => (
                      current === node.id ? null : current
                    )) : undefined}
                    onClick={() => guardedClick(node.id, node.onClick)}
                    onPointerDown={node.draggable
                      ? (event) => {
                          if (node.kind === "card" && !expandedCardSet.has(node.id)) {
                            const localPosition = poolLayout.positions[node.id] ?? { x: 0, y: 0 };
                            startDrag(event, {
                              nodeId: node.id,
                              origin: localPosition,
                              maxX: Math.max(
                                0,
                                canvasBounds.width - rootRegionOffsetX - node.width - 24,
                              ),
                              maxY: Math.max(canvasBounds.height - node.height - 24, node.position.y + 240),
                              onClick: node.onClick,
                              onDrop: (nextPosition) => {
                                const siblings = poolCards
                                  .filter((candidate) => candidate.id !== node.id)
                                  .map((candidate) => {
                                    const candidateSize = nodeDimensions(
                                      "card",
                                      candidate.count,
                                      compact,
                                      maxCardCount,
                                    );
                                    const candidateDiameter = bubbleDiameter(candidate.count, maxCardCount, compact);
                                    const candidatePosition = poolLayout.positions[candidate.id] ?? { x: 0, y: 0 };
                                    return {
                                      id: candidate.id,
                                      x: candidatePosition.x,
                                      y: candidatePosition.y,
                                      diameter: candidateDiameter,
                                      width: candidateSize.width,
                                      height: candidateSize.height,
                                    };
                                  });
                                const resolved = resolveRootBubbleDrop({
                                  id: node.id,
                                  position: nextPosition,
                                  diameter,
                                  blockWidth: node.width,
                                  blockHeight: node.height,
                                  width: canvasBounds.width - rootRegionOffsetX - 24,
                                  siblings,
                                });
                                setManualRootPositions((current) => ({
                                  ...current,
                                  [node.id]: resolved,
                                }));
                              },
                            });
                            return;
                          }

                          if (node.kind === "card" && expandedCardSet.has(node.id)) {
                            const anchor = laneAnchors.positions[node.id] ?? { x: laneStartX, y: 28 };
                            startDrag(event, {
                              nodeId: node.id,
                              origin: node.position,
                              maxX: anchor.x + bubbleColumnWidth - node.width - 12,
                              maxY: anchor.y + (laneAnchors.heights[node.id] ?? 220) - node.height - 12,
                              onClick: node.onClick,
                              onDrop: (nextPosition) => {
                                const siblings = [node.id]
                                  .filter(() => false)
                                  .map(() => ({ id: "", x: 0, y: 0, width: 0, height: 0 }));
                                const resolved = resolveLaneNodeDrop({
                                  id: node.id,
                                  position: {
                                    x: nextPosition.x - anchor.x,
                                    y: nextPosition.y - anchor.y,
                                  },
                                  width: node.width,
                                  height: node.height,
                                  columnWidth: bubbleColumnWidth,
                                  siblings,
                                });
                                setManualLanePositions((current) => ({
                                  ...current,
                                  [node.id]: {
                                    x: anchor.x + resolved.x,
                                    y: anchor.y + resolved.y,
                                  },
                                }));
                              },
                            });
                            return;
                          }

                          if (node.kind === "tag") {
                            const parentCardId = expandedCards.find((card) =>
                              (tagsByCardId.get(card.id) ?? []).some((tag) => tag.id === node.id),
                            )?.id;
                            if (!parentCardId) {
                              return;
                            }
                            const anchor = laneAnchors.positions[parentCardId] ?? { x: laneStartX, y: 28 };
                            const columnX = anchor.x + bubbleColumnWidth + laneGap;
                            startDrag(event, {
                              nodeId: node.id,
                              origin: node.position,
                              maxX: columnX + tagColumnWidth - node.width - 12,
                              maxY: anchor.y + (laneAnchors.heights[parentCardId] ?? 220) - node.height - 12,
                              onClick: node.onClick,
                              onDrop: (nextPosition) => {
                                const siblingIds = (tagsByCardId.get(parentCardId) ?? [])
                                  .map((tag) => tag.id)
                                  .filter((id) => id !== node.id);
                                const siblings = siblingIds
                                  .map((id) => {
                                    const siblingNode = canvasNodes.find((candidate) => candidate.id === id);
                                    if (!siblingNode) {
                                      return null;
                                    }
                                    return {
                                      id,
                                      x: siblingNode.position.x - columnX,
                                      y: siblingNode.position.y - anchor.y,
                                      width: siblingNode.width,
                                      height: siblingNode.height,
                                    };
                                  })
                                  .filter((value): value is NonNullable<typeof value> => value !== null);
                                const resolved = resolveLaneNodeDrop({
                                  id: node.id,
                                  position: {
                                    x: nextPosition.x - columnX,
                                    y: nextPosition.y - anchor.y,
                                  },
                                  width: node.width,
                                  height: node.height,
                                  columnWidth: tagColumnWidth,
                                  siblings,
                                });
                                setManualLanePositions((current) => ({
                                  ...current,
                                  [node.id]: {
                                    x: columnX + resolved.x,
                                    y: anchor.y + resolved.y,
                                  },
                                }));
                              },
                            });
                          }
                        }
                      : undefined}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function draftLaneKey(
  drafts: Array<{
    card: { id: string };
    selectedTagId?: string;
    selectedEntityId?: string;
    bubbleItems: Array<{ id: string; active?: boolean }>;
    tagItems: Array<{ id: string; active?: boolean }>;
    entityItems: Array<{ id: string; active?: boolean }>;
    memoryItems: Array<{ id: string; active?: boolean }>;
  }>,
): string {
  return drafts
    .map((draft) =>
      [
        draft.card.id,
        draft.selectedTagId ?? "",
        draft.selectedEntityId ?? "",
        draft.bubbleItems.map((item) => `${item.id}:${item.active ? "1" : "0"}`).join(","),
        draft.tagItems.map((item) => `${item.id}:${item.active ? "1" : "0"}`).join(","),
        draft.entityItems.map((item) => `${item.id}:${item.active ? "1" : "0"}`).join(","),
        draft.memoryItems.map((item) => `${item.id}:${item.active ? "1" : "0"}`).join(","),
      ].join("|"))
    .join("::");
}

export function MemoryInsightOverview(props: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  compact: boolean;
  resetToken: number;
  onMemorySelect: (memory: Memory) => void;
}) {
  return <MemoryInsightCanvas {...props} />;
}
