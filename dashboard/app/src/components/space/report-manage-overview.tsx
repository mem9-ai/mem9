import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  HeartHandshake,
  Network,
  Play,
  Search,
  Sprout,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Memory } from "@/types/memory";

type TemplateId = "weekly" | "trend" | "structure" | "growth";

const templateIcons = {
  weekly: Activity,
  trend: Flag,
  structure: BrainCircuit,
  growth: Sprout,
} as const;

const analysisIcons = [UsersRound, Flag, Network, Activity, Sprout, HeartHandshake];

export function ReportManageOverview({
  memories,
  className,
}: {
  memories: Memory[];
  className?: string;
}) {
  const { t } = useTranslation();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("weekly");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "enabled">("all");
  const [generationCount, setGenerationCount] = useState(0);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("2025-06-01");
  const [dateTo, setDateTo] = useState("2025-06-14");
  const datePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!datePickerOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!datePickerRef.current?.contains(event.target as Node)) {
        setDatePickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [datePickerOpen]);

  const templates = useMemo(
    () =>
      (["weekly", "trend", "structure", "growth"] as const).map((id) => ({
        id,
        name: t(`report_manage.templates.${id}.name`),
        cadence: t(`report_manage.templates.${id}.cadence`),
        lastGenerated: t(`report_manage.templates.${id}.last_generated`),
      })),
    [t],
  );

  const visibleTemplates = templates.filter((template) => {
    const matchesSearch = template.name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
    return matchesSearch && (status === "all" || template.id !== "growth" || true);
  });
  const selected = templates.find((template) => template.id === selectedTemplate) ?? templates[0]!;

  const generate = () => {
    setGenerationCount((count) => count + 1);
    toast.success(t("report_manage.generate_success", { template: selected.name }));
  };

  return (
    <section className={cn("relative overflow-hidden", className)} data-testid="report-manage-overview">
      <div className="relative">
        <div className="surface-card flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">{t("report_manage.eyebrow")}</p>
            <h2 className="mt-2 text-[clamp(1.45rem,2vw,1.85rem)] font-semibold tracking-[-0.06em] text-foreground">{t("report_manage.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("report_manage.subtitle")}</p>
          </div>
          <Button onClick={generate} className="h-10 rounded-xl px-5 shadow-sm"><Play className="size-4" />{t("report_manage.generate")}</Button>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(255px,0.78fr)_minmax(0,2.22fr)]">
          <aside className="rounded-2xl border border-foreground/7 bg-foreground/[0.018] p-3 sm:p-4">
            <h3 className="text-base font-semibold tracking-[-0.03em]">{t("report_manage.library_title")}</h3>
            <div className="mt-4 flex gap-2">
              <label className="relative min-w-0 flex-1">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-soft-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 bg-background/65 pl-8 text-xs" placeholder={t("report_manage.search_placeholder")} />
              </label>
              <button onClick={() => setStatus((current) => current === "all" ? "enabled" : "all")} className="rounded-lg border border-foreground/8 px-2.5 text-xs text-muted-foreground hover:bg-foreground/[0.04]">
                {status === "all" ? t("report_manage.status_all") : t("report_manage.status_enabled")}
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {visibleTemplates.map((template) => {
                const Icon = templateIcons[template.id];
                const active = template.id === selectedTemplate;
                return <button key={template.id} onClick={() => setSelectedTemplate(template.id)} className={cn("w-full rounded-xl border p-3 text-left transition-all", active ? "border-ring/45 bg-ring/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "border-foreground/7 bg-background/25 hover:border-foreground/16 hover:bg-foreground/[0.025]")}>
                  <div className="flex items-center gap-2.5"><span className="flex size-7 items-center justify-center rounded-lg bg-foreground/[0.06] text-ring"><Icon className="size-3.5" /></span><span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{template.name}</span><span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{t("report_manage.enabled")}</span></div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-soft-foreground"><span>{t("report_manage.cadence", { value: template.cadence })}</span><ChevronRight className="size-3.5" /></div>
                  <p className="mt-1 text-[11px] text-soft-foreground">{t("report_manage.last_generated", { value: template.lastGenerated })}</p>
                </button>;
              })}
            </div>
            <p className="mt-4 text-xs text-soft-foreground">{t("report_manage.template_count", { count: templates.length })}</p>
          </aside>

          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground">{t("report_manage.details_title")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"><span className="flex size-7 items-center justify-center rounded-full bg-blue-500/15 text-blue-500"><Activity className="size-3.5" /></span><span className="text-lg font-semibold tracking-[-0.035em]">{selected.name}</span><span className="rounded-md bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("report_manage.enabled")}</span><span className="text-sm text-soft-foreground">v1.0</span></div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.45fr)]">
              <div className="rounded-2xl border border-foreground/7 bg-foreground/[0.018] p-4"><h3 className="font-semibold">{t("report_manage.description_title")}</h3><dl className="mt-3 space-y-2.5 text-sm"><DetailRow label={t("report_manage.goal_label")} value={t(`report_manage.templates.${selectedTemplate}.goal`)} /><DetailRow label={t("report_manage.period_label")} value={selected.cadence} /><DetailRow label={t("report_manage.input_label")} value={t("report_manage.input_value")} /><DetailRow label={t("report_manage.output_label")} value={t("report_manage.output_value")} /><DetailRow label={t("report_manage.evidence_label")} value={t("report_manage.evidence_value")} /></dl></div>
              <div className="rounded-2xl border border-foreground/7 bg-foreground/[0.018] p-4"><h3 className="font-semibold">{t("report_manage.analysis_title")}</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{analysisIcons.map((Icon, index) => <div key={index} className="rounded-xl border border-foreground/7 bg-background/25 p-3"><div className="flex items-center gap-2"><Icon className="size-4 shrink-0 text-ring" /><p className="text-sm font-medium">{t(`report_manage.analysis_items.${index}.title`)}</p></div><p className="mt-2 text-xs leading-relaxed text-soft-foreground">{t(`report_manage.analysis_items.${index}.body`)}</p></div>)}</div></div>
            </div>

            <div className="rounded-2xl border border-foreground/7 bg-foreground/[0.018] p-4"><h3 className="font-semibold">{t("report_manage.settings_title")}</h3><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><div ref={datePickerRef} className="relative"><button type="button" onClick={() => setDatePickerOpen((open) => !open)} aria-expanded={datePickerOpen} className="inline-flex items-center gap-2 rounded-lg border border-foreground/8 bg-background/35 px-3 py-2 text-sm transition-colors hover:bg-foreground/[0.05]"><CalendarDays className="size-4 text-soft-foreground" />{dateFrom} – {dateTo}</button>{datePickerOpen && <DateRangePicker from={dateFrom} to={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} onApply={() => setDatePickerOpen(false)} />}</div><span className="rounded-lg border border-foreground/8 bg-background/35 px-3 py-2 text-sm text-muted-foreground">{t("report_manage.memory_count", { count: memories.length })}</span></div><Button onClick={generate} className="rounded-xl"><Play className="size-4" />{t("report_manage.generate_template")}</Button></div></div>

            <div className="overflow-hidden rounded-2xl border border-foreground/7 bg-foreground/[0.018]"><div className="flex items-center justify-between border-b border-foreground/7 px-4 py-3"><h3 className="font-semibold">{t("report_manage.history_title")}</h3><span className="text-xs text-soft-foreground">v1.0</span></div><div className="divide-y divide-foreground/7">{[0, 1, ...(generationCount ? [2] : [])].map((row) => <div key={row} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1.15fr_.7fr_.8fr_auto] sm:items-center"><span className="font-medium">{row === 0 && generationCount ? t("report_manage.history_now") : row === 0 ? "Jun 01 – Jun 14" : "May 18 – May 31"}</span><span><span className="rounded-md bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("report_manage.complete")}</span></span><span className="text-muted-foreground">{t("report_manage.memory_count", { count: Math.max(memories.length - row * 14, 0) })}</span><div className="flex gap-2"><Button variant="outline" size="xs" onClick={() => toast.info(t("report_manage.preview_hint"))}>{t("report_manage.preview")}<ArrowUpRight className="size-3" /></Button><Button variant="ghost" size="icon-xs" title={t("report_manage.download")} onClick={() => toast.info(t("report_manage.download_hint"))}><Download className="size-3.5" /></Button></div></div>)}</div></div>
            <p className="flex items-center gap-2 text-xs text-soft-foreground"><span className="flex size-4 items-center justify-center rounded-full border border-current text-[10px]">i</span>{t("report_manage.note")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[3.4rem_minmax(0,1fr)] gap-2"><dt className="text-soft-foreground">{label}</dt><dd className="min-w-0 text-muted-foreground">{value}</dd></div>;
}

function DateRangePicker({ from, to, onChange, onApply }: { from: string; to: string; onChange: (from: string, to: string) => void; onApply: () => void }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => toLocalDate(from));
  const [selectingStart, setSelectingStart] = useState(false);
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" }).format(new Date(2024, 0, index + 1)));
  const cells = Array.from({ length: startOffset + daysInMonth }, (_, index) => index < startOffset ? null : new Date(month.getFullYear(), month.getMonth(), index - startOffset + 1));

  const selectDate = (date: Date) => {
    const value = toIsoDate(date);
    if (selectingStart || value <= from) {
      onChange(value, value <= to ? to : value);
      setSelectingStart(false);
      return;
    }
    onChange(from, value);
    setSelectingStart(true);
  };

  return <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 w-[296px] rounded-2xl border border-foreground/10 bg-popover p-3 shadow-2xl"><div className="flex items-center justify-between"><button type="button" className="flex size-8 items-center justify-center rounded-lg hover:bg-foreground/[0.06]" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></button><p className="text-sm font-semibold">{new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(month)}</p><button type="button" className="flex size-8 items-center justify-center rounded-lg hover:bg-foreground/[0.06]" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight className="size-4" /></button></div><div className="mt-3 grid grid-cols-7 text-center text-[11px] text-soft-foreground">{weekdays.map((weekday, index) => <span key={`${weekday}-${index}`} className="py-1">{weekday}</span>)}</div><div className="grid grid-cols-7 gap-y-1">{cells.map((date, index) => { if (!date) return <span key={`empty-${index}`} />; const value = toIsoDate(date); const selected = value === from || value === to; const inRange = value > from && value < to; return <button key={value} type="button" onClick={() => selectDate(date)} className={cn("mx-auto flex size-8 items-center justify-center rounded-full text-xs transition-colors", selected ? "bg-primary text-primary-foreground" : inRange ? "bg-primary/12 text-foreground" : "hover:bg-foreground/[0.07]")}>{date.getDate()}</button>; })}</div><div className="mt-3 flex items-center justify-between border-t border-foreground/8 pt-3"><span className="text-xs text-muted-foreground">{from} – {to}</span><Button size="sm" onClick={onApply}>{t("report_manage.apply_date")}</Button></div></div>;
}

function toLocalDate(value: string): Date { const [year, month, day] = value.split("-").map(Number); return new Date(year ?? 2025, (month ?? 1) - 1, day ?? 1); }
function toIsoDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
