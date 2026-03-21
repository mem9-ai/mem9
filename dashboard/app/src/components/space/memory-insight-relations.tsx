import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowUpRight,
  GitBranch,
  Maximize2,
  Minimize2,
  Move,
  Network,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { MobilePanelShell } from "@/components/space/mobile-panel-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type MemoryInsightRelationCluster,
  type MemoryInsightRelationEdge,
  type MemoryInsightRelationEntity,
  type MemoryInsightRelationGraph,
  type MemoryInsightRelationType,
} from "@/lib/memory-insight-relations";
import { useBackgroundMemoryInsightRelationGraph } from "@/lib/memory-insight-background";
import { formatInsightCategoryLabel } from "@/lib/memory-insight";
import type { AnalysisCategory, AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

type InsightPoint = {
  x: number;
  y: number;
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
};

type PanState = {
  pointerId: number;
  element: HTMLDivElement;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
};

type DisplayNode = {
  entity: MemoryInsightRelationEntity;
  position: InsightPoint;
  size: number;
};

type StrengthPreset = "all" | "medium" | "strong";

const ENTITY_LIMIT = 30;
const EDGE_LIMIT = 80;
const RING_RADII = [0.18, 0.3, 0.42] as const;
const RELATION_COLORS: Record<MemoryInsightRelationType, string> = {
  co_occurrence: "#94a3b8",
  depends_on: "#c46a6a",
  used_with: "#6d8fa5",
  deployed_to: "#5a9a6b",
  scheduled_with: "#b08d57",
  points_to: "#7c6f9b",
};
const CATEGORY_COLOR_PALETTE = [
  "#6d8fa5",
  "#b08d57",
  "#7c6f9b",
  "#5a9a6b",
  "#c46a6a",
  "#8a7a5a",
] as const;
const DESKTOP_MEDIA_QUERY = "(min-width: 1200px)";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
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

function useIsDesktopViewport(): boolean {
  const getMatch = () =>
    typeof window === "undefined" ? true : window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  const [matches, setMatches] = useState(getMatch);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return matches;
}

function categoryTone(category?: string | null): string {
  if (!category) {
    return "#7a8a7a";
  }

  return CATEGORY_COLOR_PALETTE[
    hashString(category) % CATEGORY_COLOR_PALETTE.length
  ]!;
}

function entitySize(count: number, maxCount: number): number {
  const ratio = maxCount > 0 ? count / maxCount : 0;
  return Math.round(54 + ratio * 34);
}

function relationStrokeWidth(edge: MemoryInsightRelationEdge): number {
  return 1.5 + Math.min(edge.coOccurrenceCount, 6) * 0.85;
}

function previewMemoryContent(memory: Memory): string {
  return memory.content.length > 108
    ? `${memory.content.slice(0, 105).trimEnd()}...`
    : memory.content;
}

function strengthThreshold(preset: StrengthPreset): number {
  switch (preset) {
    case "medium":
      return 2;
    case "strong":
      return 3;
    default:
      return 1;
  }
}

function computeDateLabel(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function computeGlobalLayout(
  entities: MemoryInsightRelationEntity[],
  canvasWidth: number,
  canvasHeight: number,
  maxCount: number,
): Record<string, DisplayNode> {
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const layout: Record<string, DisplayNode> = {};
  const ringSplits = [8, 18, entities.length];
  let cursor = 0;

  ringSplits.forEach((limit, ringIndex) => {
    const ringEntities = entities.slice(cursor, limit);
    cursor = limit;
    if (ringEntities.length === 0) {
      return;
    }

    const radius = Math.min(canvasWidth, canvasHeight) * RING_RADII[ringIndex]!;
    ringEntities.forEach((entity, index) => {
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / ringEntities.length;
      const size = entitySize(entity.count, maxCount);
      layout[entity.id] = {
        entity,
        size,
        position: {
          x: centerX + Math.cos(angle) * radius - size / 2,
          y: centerY + Math.sin(angle) * radius - size / 2,
        },
      };
    });
  });

  return layout;
}

function computeFocusedLayout(
  graph: MemoryInsightRelationGraph,
  selectedEntityId: string,
  depth: 1 | 2,
  canvasWidth: number,
  canvasHeight: number,
): Record<string, DisplayNode> {
  const selected = graph.entitiesById.get(selectedEntityId);
  if (!selected) {
    return {};
  }

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const maxCount = Math.max(...graph.entities.map((entity) => entity.count), 1);
  const layout: Record<string, DisplayNode> = {};
  const firstHop = graph.edges
    .filter((edge) => edge.sourceId === selectedEntityId || edge.targetId === selectedEntityId)
    .slice(0, 12);
  const firstHopIds = Array.from(
    new Set(
      firstHop.map((edge) =>
        edge.sourceId === selectedEntityId ? edge.targetId : edge.sourceId,
      ),
    ),
  );
  const secondHopIds = depth === 2
    ? Array.from(
        new Set(
          graph.edges
            .filter(
              (edge) =>
                firstHopIds.includes(edge.sourceId) ||
                firstHopIds.includes(edge.targetId),
            )
            .flatMap((edge) => [edge.sourceId, edge.targetId])
            .filter(
              (entityId) => entityId !== selectedEntityId && !firstHopIds.includes(entityId),
            ),
        ),
      ).slice(0, 18)
    : [];

  const selectedSize = entitySize(selected.count, maxCount) + 16;
  layout[selected.id] = {
    entity: selected,
    size: selectedSize,
    position: {
      x: centerX - selectedSize / 2,
      y: centerY - selectedSize / 2,
    },
  };

  const placeRing = (entityIds: string[], radius: number) => {
    entityIds.forEach((entityId, index) => {
      const entity = graph.entitiesById.get(entityId);
      if (!entity) {
        return;
      }
      const size = entitySize(entity.count, maxCount);
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / Math.max(entityIds.length, 1);
      layout[entity.id] = {
        entity,
        size,
        position: {
          x: centerX + Math.cos(angle) * radius - size / 2,
          y: centerY + Math.sin(angle) * radius - size / 2,
        },
      };
    });
  };

  placeRing(firstHopIds, Math.min(canvasWidth, canvasHeight) * 0.22);
  placeRing(secondHopIds, Math.min(canvasWidth, canvasHeight) * 0.38);

  return layout;
}

function buildDisplayGraph(
  graph: MemoryInsightRelationGraph,
  selectedEntityId: string | null,
  depth: 1 | 2,
): { nodes: MemoryInsightRelationEntity[]; edges: MemoryInsightRelationEdge[] } {
  if (!selectedEntityId) {
    const entityIds = new Set(graph.topEntityIds.slice(0, ENTITY_LIMIT));
    const edges = graph.topEdgeIds
      .map((edgeId) => graph.edgesById.get(edgeId))
      .filter((edge): edge is MemoryInsightRelationEdge => Boolean(edge))
      .filter((edge) => entityIds.has(edge.sourceId) && entityIds.has(edge.targetId))
      .slice(0, EDGE_LIMIT);

    return {
      nodes: graph.entities.filter((entity) => entityIds.has(entity.id)),
      edges,
    };
  }

  const firstHopEdges = graph.edges.filter(
    (edge) => edge.sourceId === selectedEntityId || edge.targetId === selectedEntityId,
  );
  const firstHopIds = new Set(
    firstHopEdges.flatMap((edge) =>
      edge.sourceId === selectedEntityId ? [edge.targetId] : [edge.sourceId],
    ),
  );
  const visibleIds = new Set<string>([selectedEntityId, ...firstHopIds]);

  if (depth === 2) {
    graph.edges.forEach((edge) => {
      if (firstHopIds.has(edge.sourceId) || firstHopIds.has(edge.targetId)) {
        visibleIds.add(edge.sourceId);
        visibleIds.add(edge.targetId);
      }
    });
  }

  return {
    nodes: graph.entities.filter((entity) => visibleIds.has(entity.id)),
    edges: graph.edges.filter(
      (edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId),
    ),
  };
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h3>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/8 bg-background/70 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function RelationshipTypeBadge({
  type,
  label,
}: {
  type: MemoryInsightRelationType;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: RELATION_COLORS[type],
        backgroundColor: `color-mix(in srgb, ${RELATION_COLORS[type]} 18%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

function RelationDetailPanel({
  graph,
  memoriesById,
  selectedEntity,
  selectedEdge,
  onEntitySelect,
  onEdgeSelect,
  onMemorySelect,
}: {
  graph: MemoryInsightRelationGraph;
  memoriesById: Map<string, Memory>;
  selectedEntity: MemoryInsightRelationEntity | null;
  selectedEdge: MemoryInsightRelationEdge | null;
  onEntitySelect: (entityId: string) => void;
  onEdgeSelect: (edgeId: string) => void;
  onMemorySelect: (memory: Memory) => void;
}) {
  const { t, i18n } = useTranslation();
  const translateCategory = (value: string) => formatInsightCategoryLabel(value, t);

  if (selectedEdge) {
    const evidenceMemories = selectedEdge.evidenceMemoryIds
      .map((memoryId) => memoriesById.get(memoryId))
      .filter((memory): memory is Memory => Boolean(memory))
      .slice(0, 5);

    return (
        <div
          className="space-y-5"
          data-testid="memory-insight-relations-detail"
        >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ring">
            {t("memory_insight.relations.detail_edge")}
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.04em] text-foreground">
            {selectedEdge.sourceLabel} → {selectedEdge.targetLabel}
          </h3>
          <div className="mt-2">
            <RelationshipTypeBadge
              type={selectedEdge.relationType}
              label={t(`memory_insight.relations.type.${selectedEdge.relationType}`)}
            />
          </div>
        </div>

        <DetailSection title={t("memory_insight.relations.metrics_title")}>
          <SummaryRow
            label={t("memory_insight.relations.metric.co_occurrence")}
            value={String(selectedEdge.coOccurrenceCount)}
          />
          <SummaryRow
            label={t("memory_insight.relations.metric.conditional_strength")}
            value={selectedEdge.conditionalStrength.toFixed(2)}
          />
          <SummaryRow
            label={t("memory_insight.relations.metric.lift")}
            value={selectedEdge.lift.toFixed(2)}
          />
          <SummaryRow
            label={t("memory_insight.relations.metric.recency_boost")}
            value={selectedEdge.recencyBoost.toFixed(2)}
          />
        </DetailSection>

        {(selectedEdge.sharedCategories.length > 0 || selectedEdge.sharedTags.length > 0) && (
          <DetailSection title={t("memory_insight.relations.shared_context")}>
            {selectedEdge.sharedCategories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedEdge.sharedCategories.map((category) => (
                  <span
                    key={category}
                    className="rounded-full bg-secondary/60 px-2 py-1 text-[11px] text-foreground/80"
                  >
                    {translateCategory(category)}
                  </span>
                ))}
              </div>
            )}
            {selectedEdge.sharedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedEdge.sharedTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </DetailSection>
        )}

        <DetailSection title={t("memory_insight.relations.evidence_title")}>
          {evidenceMemories.map((memory) => (
            <button
              key={memory.id}
              type="button"
              onClick={() => onMemorySelect(memory)}
              className="block w-full rounded-xl border border-foreground/8 bg-background/70 px-3 py-3 text-left hover:border-foreground/18"
              data-testid={`relation-evidence-memory:${memory.id}`}
            >
              <div className="text-sm font-medium text-foreground">
                {previewMemoryContent(memory)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {computeDateLabel(memory.updated_at, i18n.language)}
              </div>
            </button>
          ))}
        </DetailSection>
      </div>
    );
  }

  if (selectedEntity) {
    const relationEdges = graph.edges
      .filter(
        (edge) => edge.sourceId === selectedEntity.id || edge.targetId === selectedEntity.id,
      )
      .slice(0, 8);
    const evidenceMemories = selectedEntity.memoryIds
      .map((memoryId) => memoriesById.get(memoryId))
      .filter((memory): memory is Memory => Boolean(memory))
      .slice(0, 5);
    const timeline = evidenceMemories
      .slice()
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

    return (
      <div
        className="space-y-5"
        data-testid="memory-insight-relations-detail"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ring">
            {t("memory_insight.relations.detail_entity")}
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.04em] text-foreground">
            {selectedEntity.label}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedEntity.dominantCategory ? (
              <span className="rounded-full bg-secondary/60 px-2 py-1 text-[11px] text-foreground/80">
                {translateCategory(selectedEntity.dominantCategory)}
              </span>
            ) : null}
            <span className="rounded-full bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground">
              {t("memory_insight.relations.entity_count", {
                count: selectedEntity.count,
              })}
            </span>
          </div>
        </div>

        <DetailSection title={t("memory_insight.relations.metrics_title")}>
          <SummaryRow
            label={t("memory_insight.relations.metric.distinct_categories")}
            value={String(selectedEntity.distinctCategories)}
          />
          <SummaryRow
            label={t("memory_insight.relations.metric.distinct_tags")}
            value={String(selectedEntity.distinctTags)}
          />
          <SummaryRow
            label={t("memory_insight.relations.metric.degree")}
            value={String(selectedEntity.degree)}
          />
          <SummaryRow
            label={t("memory_insight.relations.metric.rising_score")}
            value={`${selectedEntity.growth.toFixed(2)}x`}
          />
        </DetailSection>

        {relationEdges.length > 0 && (
          <DetailSection title={t("memory_insight.relations.related_entities")}>
            {relationEdges.map((edge) => {
              const otherEntityId =
                edge.sourceId === selectedEntity.id ? edge.targetId : edge.sourceId;
              const otherEntity = graph.entitiesById.get(otherEntityId);
              if (!otherEntity) {
                return null;
              }

              return (
                <button
                  key={edge.id}
                  type="button"
                  onClick={() => {
                    onEntitySelect(otherEntity.id);
                    onEdgeSelect(edge.id);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-foreground/8 bg-background/70 px-3 py-2.5 text-left hover:border-foreground/18"
                >
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {otherEntity.label}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <RelationshipTypeBadge
                        type={edge.relationType}
                        label={t(`memory_insight.relations.type.${edge.relationType}`)}
                      />
                      <span>
                        {t("memory_insight.relations.shared_memories", {
                          count: edge.coOccurrenceCount,
                        })}
                      </span>
                    </div>
                  </div>
                  <ArrowUpRight className="size-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </DetailSection>
        )}

        {(selectedEntity.categories.length > 0 || selectedEntity.tags.length > 0) && (
          <DetailSection title={t("memory_insight.relations.shared_context")}>
            {selectedEntity.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedEntity.categories.map((category) => (
                  <span
                    key={category}
                    className="rounded-full bg-secondary/60 px-2 py-1 text-[11px] text-foreground/80"
                  >
                    {translateCategory(category)}
                  </span>
                ))}
              </div>
            )}
            {selectedEntity.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedEntity.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </DetailSection>
        )}

        <DetailSection title={t("memory_insight.relations.evidence_title")}>
          {evidenceMemories.map((memory) => (
            <button
              key={memory.id}
              type="button"
              onClick={() => onMemorySelect(memory)}
              className="block w-full rounded-xl border border-foreground/8 bg-background/70 px-3 py-3 text-left hover:border-foreground/18"
              data-testid={`relation-evidence-memory:${memory.id}`}
            >
              <div className="text-sm font-medium text-foreground">
                {previewMemoryContent(memory)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {computeDateLabel(memory.updated_at, i18n.language)}
              </div>
            </button>
          ))}
        </DetailSection>

        {timeline.length > 0 && (
          <DetailSection title={t("memory_insight.relations.timeline_title")}>
            {timeline.map((memory) => (
              <div
                key={memory.id}
                className="rounded-xl border border-foreground/8 bg-background/70 px-3 py-2"
              >
                <div className="text-xs font-medium text-foreground">
                  {computeDateLabel(memory.updated_at, i18n.language)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {previewMemoryContent(memory)}
                </div>
              </div>
            ))}
          </DetailSection>
        )}
      </div>
    );
  }

  return (
      <div
        className="space-y-5"
        data-testid="memory-insight-relations-detail"
      >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ring">
          {t("memory_insight.relations.detail_global")}
        </p>
        <h3 className="mt-2 text-lg font-semibold tracking-[-0.04em] text-foreground">
          {t("memory_insight.relations.overview_title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("memory_insight.relations.overview_helper")}
        </p>
      </div>

      <DetailSection title={t("memory_insight.relations.bridge_title")}>
        {graph.bridgeEntities.slice(0, 5).map((entity) => (
          <button
            key={entity.id}
            type="button"
            onClick={() => onEntitySelect(entity.id)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-foreground/8 bg-background/70 px-3 py-2.5 text-left hover:border-foreground/18"
          >
            <div>
              <div className="text-sm font-medium text-foreground">{entity.label}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t("memory_insight.relations.bridge_meta", {
                  categories: entity.distinctCategories,
                  tags: entity.distinctTags,
                })}
              </div>
            </div>
            <GitBranch className="size-3.5 text-muted-foreground" />
          </button>
        ))}
      </DetailSection>

      <DetailSection title={t("memory_insight.relations.cluster_title")}>
        {graph.clusters.slice(0, 4).map((cluster: MemoryInsightRelationCluster) => (
          <div
            key={cluster.id}
            className="rounded-xl border border-foreground/8 bg-background/70 px-3 py-2.5"
          >
            <div className="text-sm font-medium text-foreground">
              {cluster.labels.slice(0, 3).join(" / ")}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {t("memory_insight.relations.cluster_meta", {
                entities: cluster.entityIds.length,
                edges: cluster.edgeIds.length,
              })}
            </div>
          </div>
        ))}
      </DetailSection>

      <DetailSection title={t("memory_insight.relations.rising_title")}>
        {graph.risingEntities.slice(0, 5).map((entity) => (
          <button
            key={entity.id}
            type="button"
            onClick={() => onEntitySelect(entity.id)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-foreground/8 bg-background/70 px-3 py-2.5 text-left hover:border-foreground/18"
          >
            <div>
              <div className="text-sm font-medium text-foreground">{entity.label}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t("memory_insight.relations.rising_meta", {
                  recent: entity.recentCount,
                  previous: entity.previousCount,
                })}
              </div>
            </div>
            <span className="text-xs font-medium text-foreground">
              {entity.growth.toFixed(2)}x
            </span>
          </button>
        ))}
      </DetailSection>

      <DetailSection title={t("memory_insight.relations.metrics_title")}>
        <SummaryRow
          label={t("memory_insight.relations.entity_total")}
          value={String(graph.topEntityIds.length)}
        />
        <SummaryRow
          label={t("memory_insight.relations.edge_total")}
          value={String(graph.topEdgeIds.length)}
        />
        <SummaryRow
          label={t("memory_insight.relations.memory_total")}
          value={String(graph.totalMemories)}
        />
      </DetailSection>
    </div>
  );
}

export function MemoryInsightRelations({
  cards,
  memories,
  matchMap,
  compact,
  resetToken,
  activeCategory,
  activeTag,
  onMemorySelect,
}: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  compact: boolean;
  resetToken: number;
  activeCategory?: AnalysisCategory;
  activeTag?: string;
  onMemorySelect: (memory: Memory) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktopViewport();
  const memoriesById = useMemo(
    () => new Map(memories.map((memory) => [memory.id, memory])),
    [memories],
  );
  const [relationType, setRelationType] = useState<"all" | MemoryInsightRelationType>("all");
  const [strength, setStrength] = useState<StrengthPreset>("all");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [expandDepth, setExpandDepth] = useState<1 | 2>(1);
  const [manualPositions, setManualPositions] = useState<Record<string, InsightPoint>>({});
  const [panMode, setPanMode] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const dragStateRef = useRef<DragState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const [viewportRef, viewportWidth] = useElementWidth<HTMLDivElement>();

  const { data: graph } = useBackgroundMemoryInsightRelationGraph({
    cards,
    memories,
    matchMap,
    activeCategory,
    activeTag,
    relationType: relationType === "all" ? undefined : relationType,
    minimumCoOccurrence: strengthThreshold(strength),
  });

  const displayGraph = useMemo(
    () => buildDisplayGraph(graph, selectedEntityId, expandDepth),
    [expandDepth, graph, selectedEntityId],
  );
  const selectedEntity = selectedEntityId ? graph.entitiesById.get(selectedEntityId) ?? null : null;
  const selectedEdge = selectedEdgeId ? graph.edgesById.get(selectedEdgeId) ?? null : null;
  const maxEntityCount = useMemo(
    () => Math.max(...displayGraph.nodes.map((entity) => entity.count), 1),
    [displayGraph.nodes],
  );
  const viewportMinHeight = compact
    ? 420
    : isFullscreen
      ? Math.max(window.innerHeight - 180, 660)
      : 580;
  const safeViewportWidth = Math.max(viewportWidth, isDesktop ? 900 : 640);
  const canvasWidth = Math.max(safeViewportWidth, isDesktop ? 960 : 720);
  const canvasHeight = Math.max(viewportMinHeight, isDesktop ? 620 : 560);

  const autoLayout = useMemo(() => {
    const base = selectedEntityId
      ? computeFocusedLayout(graph, selectedEntityId, expandDepth, canvasWidth, canvasHeight)
      : computeGlobalLayout(displayGraph.nodes, canvasWidth, canvasHeight, maxEntityCount);

    const next: Record<string, DisplayNode> = {};
    displayGraph.nodes.forEach((entity) => {
      const fallback = base[entity.id];
      if (!fallback) {
        return;
      }

      next[entity.id] = {
        ...fallback,
        position: manualPositions[entity.id] ?? fallback.position,
      };
    });
    return next;
  }, [
    canvasHeight,
    canvasWidth,
    displayGraph.nodes,
    expandDepth,
    graph,
    manualPositions,
    maxEntityCount,
    selectedEntityId,
  ]);

  useEffect(() => {
    setSelectedEntityId(null);
    setSelectedEdgeId(null);
    setExpandDepth(1);
    setManualPositions({});
    setDraggingNodeId(null);
  }, [resetToken]);

  useEffect(() => {
    if (selectedEntityId && !graph.entitiesById.has(selectedEntityId)) {
      setSelectedEntityId(null);
    }
    if (selectedEdgeId && !graph.edgesById.has(selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [graph.edgesById, graph.entitiesById, selectedEdgeId, selectedEntityId]);

  useEffect(() => {
    const selectionExists = Boolean(selectedEntityId || selectedEdgeId);
    if (!isDesktop) {
      setMobileDetailOpen(selectionExists);
    } else {
      setMobileDetailOpen(false);
    }
  }, [isDesktop, selectedEdgeId, selectedEntityId]);

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
      if (event.code === "Space") {
        setPanMode(false);
      }
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

        dragState.lastPosition = nextPosition;
        dragState.moved = dragState.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;
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
          setManualPositions((current) => ({
            ...current,
            [dragState.nodeId]: dragState.lastPosition,
          }));
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
    nodeId: string,
    origin: InsightPoint,
    size: number,
  ) => {
    if (panMode) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      pointerId: event.pointerId,
      nodeId,
      element: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin,
      lastPosition: origin,
      maxX: Math.max(canvasWidth - size - 16, origin.x),
      maxY: Math.max(canvasHeight - size - 16, origin.y),
      moved: false,
    };
    setDraggingNodeId(nodeId);
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

  const resetLayout = () => {
    setSelectedEntityId(null);
    setSelectedEdgeId(null);
    setExpandDepth(1);
    setManualPositions({});
    viewportRef.current?.scrollTo({
      left: Math.max((canvasWidth - (viewportRef.current?.clientWidth ?? canvasWidth)) / 2, 0),
      top: Math.max((canvasHeight - (viewportRef.current?.clientHeight ?? canvasHeight)) / 2, 0),
      behavior: "smooth",
    });
  };

  const fitView = () => {
    viewportRef.current?.scrollTo({
      left: Math.max((canvasWidth - (viewportRef.current?.clientWidth ?? canvasWidth)) / 2, 0),
      top: Math.max((canvasHeight - (viewportRef.current?.clientHeight ?? canvasHeight)) / 2, 0),
      behavior: "smooth",
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
      // Ignore rejected fullscreen requests.
    }
  };

  const summaryParts = [
    t("memory_insight.relations.entity_total_summary", { count: graph.topEntityIds.length }),
    t("memory_insight.relations.edge_total_summary", { count: graph.topEdgeIds.length }),
  ];

  return (
    <section
      ref={shellRef}
      className={cn(
        "surface-card relative overflow-hidden px-4 py-5 sm:px-6",
        isFullscreen ? "h-screen rounded-none px-5 py-5 sm:px-8" : "",
      )}
      data-testid="memory-insight-relations"
      style={{
        background:
          "radial-gradient(circle at 18% 18%, color-mix(in srgb, var(--type-insight) 12%, transparent) 0%, transparent 28%), radial-gradient(circle at top right, color-mix(in srgb, var(--facet-people) 10%, transparent) 0%, transparent 24%), linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--card) 92%, transparent))",
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent)]" />

      <div className="relative flex h-full flex-col">
        <div className="flex flex-col gap-3 border-b border-foreground/6 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">
              {t("memory_insight.relations.eyebrow")}
            </p>
            <h2 className="mt-2 text-[clamp(1.45rem,2vw,1.85rem)] font-semibold tracking-[-0.06em] text-foreground">
              {t("memory_insight.relations.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("memory_insight.relations.subtitle")}
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-foreground/8 bg-background/55 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
            <Network className="size-3.5" />
            {summaryParts.join(" / ")}
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-foreground/8 bg-background/45">
          <div className="flex flex-col gap-3 border-b border-foreground/8 px-4 py-3 text-xs text-muted-foreground xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1">
              <p>{t("memory_insight.relations.helper")}</p>
              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/72">
                <Move className="size-3" />
                {t("memory_insight.pan_hint")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={relationType}
                onValueChange={(value) => setRelationType(value as "all" | MemoryInsightRelationType)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 min-w-[11rem] bg-background/82 text-xs"
                  data-testid="memory-insight-relations-type-filter"
                >
                  <SelectValue placeholder={t("memory_insight.relations.filter_relation")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("memory_insight.relations.type.all")}</SelectItem>
                  <SelectItem value="co_occurrence">{t("memory_insight.relations.type.co_occurrence")}</SelectItem>
                  <SelectItem value="depends_on">{t("memory_insight.relations.type.depends_on")}</SelectItem>
                  <SelectItem value="used_with">{t("memory_insight.relations.type.used_with")}</SelectItem>
                  <SelectItem value="deployed_to">{t("memory_insight.relations.type.deployed_to")}</SelectItem>
                  <SelectItem value="scheduled_with">{t("memory_insight.relations.type.scheduled_with")}</SelectItem>
                  <SelectItem value="points_to">{t("memory_insight.relations.type.points_to")}</SelectItem>
                </SelectContent>
              </Select>

              <div className="inline-flex rounded-full border border-foreground/10 bg-background/82 p-1">
                {(["all", "medium", "strong"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStrength(value)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      strength === value
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    data-testid={`memory-insight-strength:${value}`}
                  >
                    {t(`memory_insight.relations.strength.${value}`)}
                  </button>
                ))}
              </div>

              {selectedEntityId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setExpandDepth((current) => (current === 1 ? 2 : 1))}
                  className="h-8 gap-1.5 border-foreground/10 bg-background/82 text-xs shadow-sm"
                  data-testid="memory-insight-relations-expand-depth"
                >
                  <GitBranch className="size-3.5" />
                  {expandDepth === 1
                    ? t("memory_insight.relations.expand_2hop")
                    : t("memory_insight.relations.collapse_2hop")}
                </Button>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFullscreenToggle}
                className="h-8 gap-1.5 border-foreground/10 bg-background/82 text-xs shadow-sm"
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

          {graph.topEntityIds.length === 0 ? (
            <div className="flex min-h-[360px] flex-1 items-center justify-center px-6 py-10 text-center">
              <div>
                <Sparkles className="mx-auto size-9 text-muted-foreground/70" />
                <p className="mt-4 text-base font-medium text-foreground">
                  {t("memory_insight.relations.empty_title")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("memory_insight.relations.empty_body")}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="min-h-0 xl:border-r xl:border-foreground/8">
                <div
                  ref={viewportRef}
                  onPointerDown={startViewportPan}
                  className={cn(
                    "relative min-h-0 flex-1 overflow-auto",
                    panMode ? "cursor-grab active:cursor-grabbing" : "",
                  )}
                  style={{ height: viewportMinHeight }}
                  data-testid="memory-insight-relations-viewport"
                >
                  <div
                    className="relative"
                    style={{ width: canvasWidth, height: canvasHeight }}
                  >
                    <div
                      className="pointer-events-none absolute bottom-6 left-6 rounded-full border border-foreground/8 bg-background/76 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur-sm"
                    >
                      {selectedEntityId
                        ? t("memory_insight.relations.canvas_focus")
                        : t("memory_insight.relations.canvas_global")}
                    </div>

                    <svg
                      className="absolute inset-0"
                      width={canvasWidth}
                      height={canvasHeight}
                    >
                      {displayGraph.edges.map((edge) => {
                        const source = autoLayout[edge.sourceId];
                        const target = autoLayout[edge.targetId];
                        if (!source || !target) {
                          return null;
                        }

                        const x1 = source.position.x + source.size / 2;
                        const y1 = source.position.y + source.size / 2;
                        const x2 = target.position.x + target.size / 2;
                        const y2 = target.position.y + target.size / 2;
                        const midX = (x1 + x2) / 2;
                        const midY = (y1 + y2) / 2;
                        const active = selectedEdgeId === edge.id;

                        return (
                          <g key={edge.id}>
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={RELATION_COLORS[edge.relationType]}
                              strokeOpacity={active ? 0.95 : 0.45}
                              strokeWidth={relationStrokeWidth(edge)}
                            />
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke="transparent"
                              strokeWidth={16}
                              onClick={() => {
                                setSelectedEdgeId(edge.id);
                                setSelectedEntityId(null);
                              }}
                              data-testid={`relation-edge:${edge.id}`}
                              style={{ cursor: "pointer" }}
                            />
                            {active ? (
                              <text
                                x={midX}
                                y={midY - 8}
                                textAnchor="middle"
                                fontSize="11"
                                fill={RELATION_COLORS[edge.relationType]}
                              >
                                {t(`memory_insight.relations.type.${edge.relationType}`)}
                              </text>
                            ) : null}
                          </g>
                        );
                      })}
                    </svg>

                    {displayGraph.nodes.map((entity) => {
                      const node = autoLayout[entity.id];
                      if (!node) {
                        return null;
                      }

                      const tone = categoryTone(entity.dominantCategory);
                      const active = selectedEntityId === entity.id;

                      return (
                        <button
                          key={entity.id}
                          type="button"
                          className={cn(
                            "absolute flex flex-col items-center justify-center rounded-full border border-foreground/10 px-2 text-center shadow-sm transition-transform hover:scale-[1.02]",
                            active ? "ring-2 ring-ring/40" : "",
                          )}
                          style={{
                            left: node.position.x,
                            top: node.position.y,
                            width: node.size,
                            height: node.size,
                            backgroundColor: `color-mix(in srgb, ${tone} 16%, var(--background))`,
                            color: tone,
                            transform: draggingNodeId === entity.id ? "scale(1.03)" : undefined,
                          } as CSSProperties}
                          onPointerDown={(event) => startDrag(event, entity.id, node.position, node.size)}
                          onClick={() => {
                            setSelectedEntityId(entity.id);
                            setSelectedEdgeId(null);
                            setExpandDepth(1);
                          }}
                          data-testid={`relation-node-entity:${entity.id}`}
                        >
                          <span className="line-clamp-2 px-2 text-[11px] font-semibold leading-tight">
                            {entity.label}
                          </span>
                          <span className="mt-1 text-[10px] opacity-70">
                            {entity.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {isDesktop ? (
                <aside className="hidden min-h-0 overflow-y-auto px-4 py-4 xl:block">
                  <RelationDetailPanel
                    graph={graph}
                    memoriesById={memoriesById}
                    selectedEntity={selectedEntity}
                    selectedEdge={selectedEdge}
                    onEntitySelect={(entityId) => {
                      setSelectedEntityId(entityId);
                      setSelectedEdgeId(null);
                    }}
                    onEdgeSelect={(edgeId) => setSelectedEdgeId(edgeId)}
                    onMemorySelect={onMemorySelect}
                  />
                </aside>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!isDesktop ? (
        <MobilePanelShell
          open={mobileDetailOpen}
          onOpenChange={setMobileDetailOpen}
          title={selectedEntity?.label ?? selectedEdge?.sourceLabel ?? t("memory_insight.relations.title")}
          description={selectedEdge
            ? t("memory_insight.relations.detail_edge")
            : selectedEntity
              ? t("memory_insight.relations.detail_entity")
              : t("memory_insight.relations.detail_global")}
          closeLabel={t("detail.close")}
          contentClassName="top-auto right-0 bottom-0 left-0 h-[75vh] max-h-[75vh] w-full max-w-full rounded-t-[1.5rem] rounded-b-none sm:max-w-full"
        >
          <div className="px-4 py-4">
            <RelationDetailPanel
              graph={graph}
              memoriesById={memoriesById}
              selectedEntity={selectedEntity}
              selectedEdge={selectedEdge}
              onEntitySelect={(entityId) => {
                setSelectedEntityId(entityId);
                setSelectedEdgeId(null);
              }}
              onEdgeSelect={(edgeId) => setSelectedEdgeId(edgeId)}
              onMemorySelect={onMemorySelect}
            />
          </div>
        </MobilePanelShell>
      ) : null}
    </section>
  );
}
