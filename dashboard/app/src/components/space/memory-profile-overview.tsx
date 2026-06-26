import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Edit3, Share2, ThumbsDown, ThumbsUp, UserRound } from "lucide-react";
import { useUserProfile } from "@/api/analysis-queries";
import { Button } from "@/components/ui/button";
import { MemoryCompositionChart } from "@/components/space/memory-composition-chart";
import { buildFacetComposition, buildPulseComposition } from "@/lib/memory-pulse";
import { useBackgroundMemoryInsightGraph } from "@/lib/memory-insight-background";
import { cn } from "@/lib/utils";
import type { AnalysisCategoryCard, MemoryAnalysisMatch, UserProfileRelationshipItem } from "@/types/analysis";
import type { MemoryInsightCardNode } from "@/lib/memory-insight";
import type { Memory, MemoryStats, TopicSummary } from "@/types/memory";

const CONFIDENCE_SEGMENTS = [
  { key: "confirmed", value: 42, color: "#3b82f6" },
  { key: "high", value: 38, color: "#22c55e" },
  { key: "medium", value: 20, color: "#fbbf24" },
] as const;

const PROFILE_ITEMS = ["priority", "style", "constraint", "recall"] as const;

export function MemoryProfileOverview({ spaceId, stats, memories, cards, matchMap, facetSummary, loading, className }: { spaceId: string; stats: MemoryStats | undefined; memories: Memory[]; cards: AnalysisCategoryCard[]; matchMap: Map<string, MemoryAnalysisMatch>; facetSummary: TopicSummary | undefined; loading: boolean; className?: string }) {
  const { i18n, t } = useTranslation();
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const profileQuery = useUserProfile(spaceId);
  const profile = profileQuery.data;
  const companionDays = useMemo(() => {
    const values = memories.map((memory) => Date.parse(memory.created_at)).filter(Number.isFinite);
    return values.length ? Math.max(1, Math.ceil((Date.now() - Math.min(...values)) / 86_400_000)) : 0;
  }, [memories]);
  const memoryCount = stats?.total ?? memories.length;
  const currentUnderstanding = profile?.summary.text?.trim()
    || (profileQuery.isLoading ? t("memory_profile.current_understanding.loading") : t("memory_profile.current_understanding.description"));
  const lastUpdated = profile?.generatedAt
    ? t("memory_profile.last_updated_at", { value: formatProfileDate(profile.generatedAt, i18n.language) })
    : t("memory_profile.last_updated");
  const composition = useMemo(() => {
    const compositionStats = stats ?? {
      total: memoryCount,
      pinned: memories.filter((memory) => memory.memory_type === "pinned").length,
      insight: memories.filter((memory) => memory.memory_type === "insight").length,
    };

    return facetSummary?.topics.length
      ? buildFacetComposition(compositionStats, facetSummary.topics)
      : buildPulseComposition(compositionStats, memories, cards);
  }, [cards, facetSummary, memories, memoryCount, stats]);
  const { data: insightGraph } = useBackgroundMemoryInsightGraph({ cards, memories, matchMap });

  if (loading && !stats && memories.length === 0) return <ProfileSkeleton className={className} />;

  return <section data-testid="memory-profile-overview" className={cn("relative", className)} style={{ animation: "slide-up 0.45s cubic-bezier(0.16,1,0.3,1)" }}>
    <header className="surface-card mb-5 flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div><h2 className="text-[clamp(1.55rem,2.4vw,2.15rem)] font-semibold tracking-[-0.065em]">{t("memory_profile.page_title")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("memory_profile.page_subtitle", { days: companionDays, count: memoryCount })}</p></div>
      <div className="flex items-center gap-3"><span className="text-xs text-soft-foreground">{lastUpdated}</span><Button variant="outline" className="rounded-xl" onClick={() => navigator.clipboard?.writeText(t("memory_profile.share_copy"))}><Share2 className="size-4" />{t("memory_profile.share")}</Button></div>
    </header>

    <div className="grid gap-4 xl:grid-cols-[minmax(260px,.88fr)_minmax(390px,1.35fr)_minmax(260px,.74fr)]">
      <article className="surface-card relative overflow-hidden p-5"><div className="absolute -left-8 top-16 size-44 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,.15),transparent_68%)]" /><h3 className="sr-only">{t("memory_profile.personal.title")}</h3><div className="relative flex h-full items-center gap-4"><Avatar /><div className="min-w-0"><p className="truncate text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.personal.name")}</p><dl className="mt-7 space-y-3"><Stat label={t("memory_profile.personal.companion_duration")} value={t("memory_profile.personal.days", { count: companionDays })} /><Stat label={t("memory_profile.personal.memory_count")} value={t("memory_profile.personal.memories", { count: memoryCount })} /><Stat label={t("memory_profile.personal.confirmed")} value="42%" /></dl></div></div></article>

      <article className="surface-card relative overflow-hidden p-5"><div className="absolute right-5 top-5 flex size-[4.5rem] items-center justify-center rounded-full bg-blue-500/10"><span className="size-8 rounded-xl bg-blue-500/80 shadow-[0_0_24px_rgba(59,130,246,.55)]" /></div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-500">{t("memory_profile.current_understanding.eyebrow")}</p><h3 className="mt-2 text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.current_understanding.title")}</h3><p className="mt-6 max-w-[80%] text-sm leading-7 text-foreground/78">{currentUnderstanding}</p>{profile?.summary.message && <p className="mt-3 max-w-[80%] text-xs leading-5 text-soft-foreground">{profile.summary.message}</p>}<div className="mt-6 flex flex-wrap items-center gap-2"><span className="mr-2 text-sm font-semibold text-blue-500">{t("memory_profile.confidence.label", { value: 94 })}</span><span className="h-2 w-32 overflow-hidden rounded-full bg-foreground/8"><span className="block h-full w-[94%] rounded-full bg-blue-500" /></span><FeedbackButton active={feedback === "up"} onClick={() => setFeedback("up")} icon={<ThumbsUp className="size-3.5" />} label={t("memory_profile.feedback.accurate")} /><FeedbackButton active={false} onClick={() => {}} icon={<Edit3 className="size-3.5" />} label={t("memory_profile.feedback.edit")} /><FeedbackButton active={feedback === "down"} onClick={() => setFeedback("down")} icon={<ThumbsDown className="size-3.5" />} label={t("memory_profile.feedback.inaccurate")} /></div></article>

      <article className="surface-card p-5"><div className="flex items-center justify-between"><h3 className="text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.confidence.title")}</h3><span className="text-sm text-soft-foreground">{t("memory_profile.confidence.current")}</span></div><div className="mt-5 grid grid-cols-[112px_minmax(0,1fr)] items-center gap-4"><ConfidencePie /><div className="space-y-3">{CONFIDENCE_SEGMENTS.map((segment) => <div key={segment.key} className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted-foreground"><span className="size-2.5 shrink-0 rounded-full" style={{ background: segment.color }} />{t(`memory_profile.confidence.segments.${segment.key}`)}</span><span className="shrink-0 font-semibold">{segment.value}%</span></div>)}</div></div></article>
    </div>

    <div className="mt-4 grid gap-4 xl:grid-cols-[.88fr_1.35fr_.74fr]">
      <ProfileCard title={t("memory_profile.topics.title")} action={t("memory_profile.topics.action")}><RadarChart nodes={insightGraph.cards} /></ProfileCard>
      <article className="surface-card min-h-[260px] p-5"><MemoryCompositionChart total={composition.total} outer={composition.outer} inner={composition.inner} innerKind={composition.innerKind} onTypeSelect={() => {}} legendPosition="side" /></article>
      <ProfileCard title={t("memory_profile.relationships.title")} action={t("memory_profile.relationships.action")}><RelationshipList items={profile?.relationships ?? []} loading={profileQuery.isLoading} /></ProfileCard>
    </div>

    <article className="surface-card mt-4 p-5"><h3 className="text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.items.title")}</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{PROFILE_ITEMS.map((item, index) => <div key={item} className="rounded-2xl border border-foreground/8 bg-background/25 p-4"><div className="flex items-center gap-2"><span className={cn("inline-block size-3 shrink-0 rounded-full", index === 0 ? "bg-blue-500" : index === 1 ? "bg-blue-400" : index === 2 ? "bg-emerald-400" : "bg-amber-400")} /><h4 className="font-semibold">{t(`memory_profile.items.${item}.title`)}</h4></div><p className="mt-3 text-sm text-foreground/76">{t(`memory_profile.items.${item}.body`)}</p><p className="mt-2 text-xs text-soft-foreground">{t(`memory_profile.items.${item}.meta`)}</p></div>)}</div></article>
  </section>;
}

function ProfileSkeleton({ className }: { className?: string }) { return <section data-testid="memory-profile-skeleton" className={cn("grid gap-4 xl:grid-cols-3", className)}>{[0, 1, 2].map((item) => <div key={item} className="surface-card h-64 animate-pulse" />)}</section>; }
function Avatar() { return <div className="flex w-[42%] min-w-[112px] items-center justify-center"><span className="flex size-28 items-center justify-center rounded-full border border-blue-500/15 bg-blue-500/10 text-blue-500 shadow-[inset_0_1px_0_rgba(255,255,255,.28),0_12px_28px_rgba(59,130,246,.14)]"><UserRound className="size-14 stroke-[1.45]" aria-hidden /></span></div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="flex items-baseline justify-between gap-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>; }
function FeedbackButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) { return <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors", active ? "border-blue-500/50 bg-blue-500/12 text-blue-500" : "border-foreground/8 text-muted-foreground hover:bg-foreground/[.04]")}>{icon}{label}</button>; }
function ProfileCard({ title, action, children }: { title: string; action?: string; children: ReactNode }) { return <article className="surface-card min-h-[260px] p-5"><div className="flex items-center justify-between"><h3 className="text-xl font-semibold tracking-[-0.045em]">{title}</h3>{action && <button className="text-sm font-medium text-blue-500 hover:underline">{action}</button>}</div><div className="mt-4">{children}</div></article>; }
function ConfidencePie() { const { t } = useTranslation(); return <div role="img" aria-label={t("memory_profile.confidence.chart_label")} className="profile-confidence-ring relative flex size-28 items-center justify-center rounded-full transition-transform duration-300 hover:scale-[1.04]" style={{ background: "conic-gradient(#3b82f6 0 42%, #22c55e 42% 80%, #fbbf24 80% 100%)" }}><div className="flex size-[76px] flex-col items-center justify-center rounded-full bg-card"><strong className="text-2xl tracking-[-.08em]">94%</strong><span className="text-[10px] text-soft-foreground">{t("memory_profile.confidence.trusted")}</span></div></div>; }
function RadarChart({ nodes }: { nodes: MemoryInsightCardNode[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const labels = [
    { x: 130, y: 14, anchor: "middle", countDy: "1em" },
    { x: 207, y: 83, anchor: "start", countDy: "1.25em" },
    { x: 182, y: 157, anchor: "start", countDy: "1.25em" },
    { x: 82, y: 157, anchor: "end", countDy: "1.25em" },
    { x: 56, y: 85, anchor: "end", countDy: "1.25em" },
  ] as const;
  const points = [[130,39],[199,86],[174,145],[89,142],[65,92]] as const;
  const topicNodes = [...nodes]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "en"))
    .slice(0, 5);
  const path = topicNodes.length > 1
    ? `${topicNodes.map((_, index) => `${index === 0 ? "M" : "L"}${points[index]![0]} ${points[index]![1]}`).join(" ")}${topicNodes.length > 2 ? " Z" : ""}`
    : "";

  return <svg viewBox="0 0 260 190" className="profile-radar mx-auto h-[190px] w-full max-w-[280px]" aria-label="Memory Insight topics">
    <g fill="none" stroke="currentColor" className="text-foreground/10"><path d="M130 14 235 80 195 171 65 171 25 80Z" /><path d="M130 43 205 89 177 150 83 150 55 89Z" /><path d="M130 71 175 98 160 129 100 129 85 98Z" /></g>
    {path && <path className="profile-radar-area" d={path} fill="rgba(59,130,246,.35)" stroke="#3b82f6" strokeWidth="2" />}
    {topicNodes.map((node, index) => { const [x, y] = points[index]!; const label = labels[index]!; const active = hoveredIndex === index; return <g key={node.id} tabIndex={0} role="img" aria-label={`${node.label}: ${node.count}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} className="cursor-pointer"><text x={label.x} y={label.y} textAnchor={label.anchor} className={cn("text-[10px] font-medium transition-all duration-200", active ? "fill-blue-500" : "fill-muted-foreground")} style={{ transform: active ? "translateY(-2px)" : "translateY(0)" }}><tspan x={label.x}>{node.label}</tspan><tspan x={label.x} dy={label.countDy} className={cn("text-[9px] tabular-nums transition-colors duration-200", active ? "fill-blue-500/75" : "fill-foreground/60")}>{node.count}</tspan></text><circle cx={x} cy={y} r={active ? 12 : 7} fill="#3b82f6" opacity={active ? .2 : 0} className="transition-all duration-200" /><circle className="profile-radar-node transition-all duration-200" cx={x} cy={y} r={active ? 6 : 4} fill="#3b82f6" /><title>{`${node.label}: ${node.count}`}</title></g>; })}
  </svg>;
}

function RelationshipList({ items, loading }: { items: UserProfileRelationshipItem[]; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) {
    return <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-foreground/[.045]" />)}</div>;
  }

  if (items.length === 0) {
    return <p className="pt-8 text-center text-sm text-muted-foreground">{t("memory_profile.relationships.empty")}</p>;
  }

  return <div className="space-y-3">{items.slice(0, 4).map((item) => <article key={`${item.relation ?? "relationship"}-${item.name}`} className="rounded-xl border border-foreground/8 bg-background/25 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.relation || t("memory_profile.relationships.unspecified")}</p></div><span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-500">{item.importance}</span></div><p className="mt-2 text-[11px] text-soft-foreground">{t("memory_profile.relationships.evidence_count", { count: item.evidenceCount })}</p>{item.evidence[0]?.quote && <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/70">{item.evidence[0].quote}</p>}</article>)}</div>;
}

function formatProfileDate(value: string, locale: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}
