import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Edit3, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Memory, MemoryStats } from "@/types/memory";

const CONFIDENCE_SEGMENTS = [
  { key: "confirmed", value: 42, color: "#3b82f6" },
  { key: "high", value: 38, color: "#22c55e" },
  { key: "medium", value: 20, color: "#fbbf24" },
] as const;

const PROFILE_ITEMS = ["priority", "style", "constraint", "recall"] as const;

export function MemoryProfileOverview({ stats, memories, loading, className }: { stats: MemoryStats | undefined; memories: Memory[]; loading: boolean; className?: string }) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const companionDays = useMemo(() => {
    const values = memories.map((memory) => Date.parse(memory.created_at)).filter(Number.isFinite);
    return values.length ? Math.max(1, Math.ceil((Date.now() - Math.min(...values)) / 86_400_000)) : 0;
  }, [memories]);
  const memoryCount = stats?.total ?? memories.length;

  if (loading && !stats && memories.length === 0) return <ProfileSkeleton className={className} />;

  return <section data-testid="memory-profile-overview" className={cn("relative", className)} style={{ animation: "slide-up 0.45s cubic-bezier(0.16,1,0.3,1)" }}>
    <header className="mb-5 flex flex-col gap-4 border-b border-foreground/7 pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 className="text-[clamp(1.55rem,2.4vw,2.15rem)] font-semibold tracking-[-0.065em]">{t("memory_profile.page_title")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("memory_profile.page_subtitle", { days: companionDays, count: memoryCount })}</p></div>
      <div className="flex items-center gap-3"><span className="text-xs text-soft-foreground">{t("memory_profile.last_updated")}</span><Button variant="outline" className="rounded-xl" onClick={() => navigator.clipboard?.writeText(t("memory_profile.share_copy"))}><Share2 className="size-4" />{t("memory_profile.share")}</Button></div>
    </header>

    <div className="grid gap-4 xl:grid-cols-[minmax(260px,.88fr)_minmax(390px,1.35fr)_minmax(260px,.74fr)]">
      <article className="surface-card relative overflow-hidden p-5"><div className="absolute -left-8 top-16 size-44 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,.15),transparent_68%)]" /><h3 className="sr-only">{t("memory_profile.personal.title")}</h3><div className="relative flex h-full items-center gap-4"><Avatar /><div className="min-w-0"><p className="truncate text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.personal.name")}</p><p className="mt-1 text-sm text-muted-foreground">{t("memory_profile.personal.role")}</p><dl className="mt-7 space-y-3"><Stat label={t("memory_profile.personal.companion_duration")} value={t("memory_profile.personal.days", { count: companionDays })} /><Stat label={t("memory_profile.personal.memory_count")} value={t("memory_profile.personal.memories", { count: memoryCount })} /><Stat label={t("memory_profile.personal.confirmed")} value="42%" /></dl></div></div></article>

      <article className="surface-card relative overflow-hidden p-5"><div className="absolute right-4 top-4 flex size-24 items-center justify-center rounded-full bg-blue-500/10"><span className="size-11 rounded-[1.1rem] bg-blue-500/80 shadow-[0_0_30px_rgba(59,130,246,.6)]" /></div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-500">{t("memory_profile.current_understanding.eyebrow")}</p><h3 className="mt-2 text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.current_understanding.title")}</h3><p className="mt-6 max-w-[80%] text-sm leading-7 text-foreground/78">{t("memory_profile.current_understanding.description")}</p><div className="mt-6 flex flex-wrap items-center gap-2"><span className="mr-2 text-sm font-semibold text-blue-500">{t("memory_profile.confidence.label", { value: 94 })}</span><span className="h-2 w-32 overflow-hidden rounded-full bg-foreground/8"><span className="block h-full w-[94%] rounded-full bg-blue-500" /></span><FeedbackButton active={feedback === "up"} onClick={() => setFeedback("up")} icon={<ThumbsUp className="size-3.5" />} label={t("memory_profile.feedback.accurate")} /><FeedbackButton active={false} onClick={() => {}} icon={<Edit3 className="size-3.5" />} label={t("memory_profile.feedback.edit")} /><FeedbackButton active={feedback === "down"} onClick={() => setFeedback("down")} icon={<ThumbsDown className="size-3.5" />} label={t("memory_profile.feedback.inaccurate")} /></div></article>

      <article className="surface-card p-5"><div className="flex items-center justify-between"><h3 className="text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.confidence.title")}</h3><span className="text-sm text-soft-foreground">{t("memory_profile.confidence.current")}</span></div><div className="mt-5 grid grid-cols-[140px_1fr] items-center gap-4"><ConfidencePie /><div className="space-y-3">{CONFIDENCE_SEGMENTS.map((segment) => <div key={segment.key} className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><span className="size-2.5 rounded-full" style={{ background: segment.color }} />{t(`memory_profile.confidence.segments.${segment.key}`)}</span><span className="font-semibold">{segment.value}%</span></div>)}</div></div></article>
    </div>

    <div className="mt-4 grid gap-4 xl:grid-cols-[.88fr_1.35fr_.74fr]">
      <ProfileCard title={t("memory_profile.topics.title")} action={t("memory_profile.topics.action")}><RadarChart /></ProfileCard>
      <ProfileCard title={t("memory_profile.composition.title")}><div className="grid items-center gap-4 sm:grid-cols-[170px_1fr]"><CompositionRing total={memoryCount} /><div className="grid gap-2 sm:grid-cols-2">{["profile", "communication", "learning", "project", "status"].map((name, index) => <span key={name} className="flex items-center justify-between rounded-full border border-foreground/8 bg-background/30 px-3 py-2 text-sm"><span className="flex items-center gap-2 truncate"><span className="size-2.5 rounded-full bg-emerald-400/75" />{t(`memory_profile.composition.items.${name}`)}</span><strong className="ml-2">{Math.max(memoryCount - index * 12, 0)}</strong></span>)}</div></div></ProfileCard>
      <ProfileCard title={t("memory_profile.relationships.title")} action={t("memory_profile.relationships.action")}><RelationshipChart /></ProfileCard>
    </div>

    <article className="surface-card mt-4 p-5"><h3 className="text-xl font-semibold tracking-[-0.045em]">{t("memory_profile.items.title")}</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{PROFILE_ITEMS.map((item, index) => <div key={item} className="rounded-2xl border border-foreground/8 bg-background/25 p-4"><span className={cn("inline-block size-3 rounded-full", index === 0 ? "bg-blue-500" : index === 1 ? "bg-blue-400" : index === 2 ? "bg-emerald-400" : "bg-amber-400")} /><h4 className="mt-3 font-semibold">{t(`memory_profile.items.${item}.title`)}</h4><p className="mt-2 text-sm text-foreground/76">{t(`memory_profile.items.${item}.body`)}</p><p className="mt-2 text-xs text-soft-foreground">{t(`memory_profile.items.${item}.meta`)}</p></div>)}</div></article>
  </section>;
}

function ProfileSkeleton({ className }: { className?: string }) { return <section data-testid="memory-profile-skeleton" className={cn("grid gap-4 xl:grid-cols-3", className)}>{[0, 1, 2].map((item) => <div key={item} className="surface-card h-64 animate-pulse" />)}</section>; }
function Avatar() { return <div className="relative flex w-[42%] min-w-[112px] flex-col items-center"><span className="absolute top-1 size-28 rounded-full bg-[linear-gradient(145deg,#f8d3b0,#c68a62)]" /><span className="mt-20 size-36 rounded-[45%_45%_35%_35%] bg-[linear-gradient(145deg,#9b6be9,#6334bd)]" /></div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="flex items-baseline justify-between gap-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>; }
function FeedbackButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) { return <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors", active ? "border-blue-500/50 bg-blue-500/12 text-blue-500" : "border-foreground/8 text-muted-foreground hover:bg-foreground/[.04]")}>{icon}{label}</button>; }
function ProfileCard({ title, action, children }: { title: string; action?: string; children: ReactNode }) { return <article className="surface-card min-h-[260px] p-5"><div className="flex items-center justify-between"><h3 className="text-xl font-semibold tracking-[-0.045em]">{title}</h3>{action && <button className="text-sm font-medium text-blue-500 hover:underline">{action}</button>}</div><div className="mt-4">{children}</div></article>; }
function ConfidencePie() { const { t } = useTranslation(); return <div role="img" aria-label={t("memory_profile.confidence.chart_label")} className="relative flex size-36 items-center justify-center rounded-full" style={{ background: "conic-gradient(#3b82f6 0 42%, #22c55e 42% 80%, #fbbf24 80% 100%)" }}><div className="flex size-24 flex-col items-center justify-center rounded-full bg-card"><strong className="text-3xl tracking-[-.08em]">94%</strong><span className="text-[10px] text-soft-foreground">{t("memory_profile.confidence.trusted")}</span></div></div>; }
function RadarChart() { return <svg viewBox="0 0 260 190" className="mx-auto h-[190px] w-full max-w-[280px]" aria-hidden><g fill="none" stroke="currentColor" className="text-foreground/10"><path d="M130 14 235 80 195 171 65 171 25 80Z" /><path d="M130 43 205 89 177 150 83 150 55 89Z" /><path d="M130 71 175 98 160 129 100 129 85 98Z" /></g><path d="M130 39 199 86 174 145 89 142 65 92Z" fill="rgba(59,130,246,.35)" stroke="#3b82f6" strokeWidth="2" />{[[130,39],[199,86],[174,145],[89,142],[65,92]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="#3b82f6" />)}</svg>; }
function CompositionRing({ total }: { total: number }) { return <div className="relative mx-auto flex size-36 items-center justify-center rounded-full border-[14px] border-sky-400/65 before:absolute before:size-24 before:rounded-full before:border-[10px] before:border-emerald-300/60"><strong className="z-10 text-3xl tracking-[-.08em]">{total}</strong></div>; }
function RelationshipChart() { const { t } = useTranslation(); return <div className="relative mx-auto mt-3 h-[180px] max-w-[250px]"><div className="absolute left-1/2 top-10 size-20 -translate-x-1/2 rounded-full border-2 border-blue-500/70 bg-background/60 text-center text-sm leading-[5rem]">{t("memory_profile.relationships.user")}</div>{[["daughter","left-0 top-16"],["partner","right-0 top-16"],["parents","bottom-0 left-1/2 -translate-x-1/2"]].map(([key, position]) => <div key={key} className={cn("absolute flex size-14 items-center justify-center rounded-full bg-fuchsia-500/15 text-xs text-foreground/85", position)}>{t(`memory_profile.relationships.${key}`)}</div>)}<span className="absolute left-[25%] top-[5.75rem] h-px w-[24%] bg-blue-500/65" /><span className="absolute right-[25%] top-[5.75rem] h-px w-[24%] bg-blue-500/65" /><span className="absolute bottom-[3.1rem] left-1/2 h-8 w-px bg-blue-500/65" /></div>; }
