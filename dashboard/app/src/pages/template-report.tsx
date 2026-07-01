import { useEffect, useMemo, useState } from "react";
import {
  useMemoryAnalysisReport,
  type MemoryAnalysisChange,
  type MemoryAnalysisChangeDimensionGroup,
  type MemoryAnalysisChangeEvidence,
  type MemoryAnalysisReportType,
  type MemorySignalDimension,
} from "@/api/memory-analysis-reports";
import {
  REPORT_PDF_API_KEY_HANDOFF_PARAM,
  requestReportPdfApiKey,
} from "@/lib/report-pdf";
import { getActiveApiKey } from "@/lib/session";
import { Activity, RefreshCw, Sparkles, Target, TrendingUp } from "lucide-react";

const SECTION_ORDER: MemorySignalDimension[] = [
  "focus_area",
  "long_term_goal",
  "emotion",
  "preference_signal",
  "growth_signal",
];

// const dimensionIcon: Record<MemorySignalDimension, typeof Target> = {
//   long_term_goal: Target,
//   focus_area: TrendingUp,
//   emotion: Activity,
//   preference_signal: Sparkles,
//   growth_signal: RefreshCw,
// };

const SECTION_META: Record<MemorySignalDimension, {
  eyebrow: string;
  title: string;
  sideNote: string;
  guide: string;
  icon: typeof Target | null;
}> = {
  focus_area: {
    eyebrow: "01 FOCUS",
    title: "关注点",
    sideNote: "左侧保留模块语义，右侧用变化卡片承载洞察、摘要和相关记忆，便于快速扫读。",
    guide: "展示兴趣迁移、主题升降趋势，以及每个结论背后的记忆依据。",
    icon: TrendingUp,
  },
  long_term_goal: {
    eyebrow: "02 GOALS",
    title: "长期目标",
    icon: Target,
    sideNote: "目标模块信息量最高，使用大摘要区承接整体判断，再把新增、强化、弱化拆成独立卡片。",
    guide: "长期目标模块优先展示 title 和汇总信息，再展示多个变化卡片。",
  },
  emotion: {
    eyebrow: "03 EMOTION",
    title: "情绪趋势",
    sideNote: "沿用参考图的深色阶段卡片，但加入多阶段证据堆叠，让情绪趋势更像时间线。",
    guide: "阶段卡片展示时间段、情绪标题和阶段总结；证据可以排列在旁侧或穿插在下方。",
    icon: Activity
  },
  preference_signal: {
    eyebrow: "04 PREFERENCE",
    title: "偏好信号",
    sideNote: "偏好信号偏长期稳定，用更轻的卡片密度呈现，避免抢过目标模块和情绪模块的权重。",
    guide: "展示稳定偏好、交互偏好和内容组织偏好；结构与关注点一致，保留标签化记忆证据。",
    icon: Sparkles
  },
  growth_signal: {
    eyebrow: "05 GROWTH",
    title: "成长观察",
    sideNote: "最后一屏做总结性收束，给用户一个这段周期发生了什么的整体答案。",
    guide: "把本期变化收束为更高层次的成长判断，同时保留记忆证据，避免报告变成空泛评价。",
    icon: RefreshCw
  },
};

const TEMPLATE_META: Record<MemoryAnalysisReportType, string> = {
  focus_area: "关注点",
  long_term_goal: "长期目标",
  emotion: "情绪趋势",
  preference_signal: "偏好信号",
  growth_signal: "成长信号",
};

function getReportIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("reportId") ?? "";
}

function getReportApiKeyHandoffNonceFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(REPORT_PDF_API_KEY_HANDOFF_PARAM) ?? "";
}

function getReportApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return getActiveApiKey();
}

export function TemplateReportPage() {
  const reportId = useMemo(() => getReportIdFromUrl(), []);
  const apiKeyHandoffNonce = useMemo(() => getReportApiKeyHandoffNonceFromUrl(), []);
  const [handoffApiKey, setHandoffApiKey] = useState<string | null>(null);
  const [isResolvingApiKey, setIsResolvingApiKey] = useState(false);
  const apiKey = useMemo(() => getReportApiKey() ?? handoffApiKey, [handoffApiKey]);
  const reportQuery = useMemoryAnalysisReport(apiKey, reportId || null);
  const reportView = useMemo(() => {
    const detail = reportQuery.data;
    if (!detail) return null;

    const dimensions = parseReportDimensions(detail.report_content);
    const changesByDimension = Object.fromEntries(
      SECTION_ORDER.map((dimension) => [
        dimension,
        dimensions.find((group) => group.dimension === dimension)?.changes ?? [],
      ]),
    ) as Record<MemorySignalDimension, MemoryAnalysisChange[]>;
    const summariesByDimension = Object.fromEntries(
      SECTION_ORDER.map((dimension) => [
        dimension,
        dimensions.find((group) => group.dimension === dimension)?.summary ?? "",
      ]),
    ) as Record<MemorySignalDimension, string>;
    const allEvidence = SECTION_ORDER
      .flatMap((dimension) => changesByDimension[dimension])
      .flatMap((change) => change.evidence);
    const templateId = normalizeTemplateId(detail.template_id);

    return {
      changesByDimension,
      confirmedCount: allEvidence.filter((evidence) => evidence.correctness === "correct").length,
      generatedAt: detail.generated_at,
      memoryCount: detail.memory_count,
      periodLabel: formatChinesePeriod(detail.startTime, detail.endTime),
      reportId: String(detail.report_id || reportId),
      summariesByDimension,
      templateName: TEMPLATE_META[templateId],
      topChange: pickFirstTitle([
        changesByDimension.focus_area,
        changesByDimension.long_term_goal,
        changesByDimension.growth_signal,
      ]),
      keyShift: pickFirstTitle([
        changesByDimension.long_term_goal,
        changesByDimension.growth_signal,
        changesByDimension.preference_signal,
      ]),
      dimensions
    };
  }, [reportId, reportQuery.data]);

  useEffect(() => {
    if (apiKey || !reportId || !apiKeyHandoffNonce) {
      return;
    }

    let cancelled = false;
    setIsResolvingApiKey(true);
    void requestReportPdfApiKey(apiKeyHandoffNonce).then((nextApiKey) => {
      if (!cancelled) {
        setHandoffApiKey(nextApiKey);
        setIsResolvingApiKey(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [apiKey, apiKeyHandoffNonce, reportId]);

  if (!reportId) {
    return <TemplateReportState title="缺少 reportId" description="请从模板生成记录中点击查看模板进入报告页面。" />;
  }

  if (!apiKey && isResolvingApiKey) {
    return <TemplateReportState title="正在连接 Space" description="正在从当前 MEM9 页面获取临时访问凭证..." />;
  }

  if (!apiKey) {
    return <TemplateReportState title="未连接 Space" description="请先返回 MEM9 页面连接 Space，再查看模板报告。" />;
  }

  if (reportQuery.isLoading) {
    return <TemplateReportState title="正在加载报告" description="正在根据 reportId 获取报告详情..." />;
  }

  if (reportQuery.isError) {
    return <TemplateReportState title="报告加载失败" description="无法从 /v1/memory-analysis/report/:id 获取报告详情。" />;
  }

  if (reportQuery.data === null) {
    return <TemplateReportState title="报告不存在" description={`未找到 reportId=${reportId} 的报告。`} />;
  }

  if (!reportView) {
    return <TemplateReportState title="报告不可用" description="报告详情为空，请返回模板生成记录后重试。" />;
  }

  return (
    <main className="min-h-screen bg-[#05070c] text-[#f5f2ff]">
      <article className="mx-auto w-full max-w-[1160px] px-5 py-10 sm:px-8 lg:px-12 lg:py-12">
        <header className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div>
            <h1 className="mt-3 text-[clamp(2.8rem,7vw,4.2rem)] font-black leading-none tracking-[-0.04em]">
              周期报告
            </h1>
            <p className="mt-5 max-w-3xl text-base font-semibold leading-8 text-[#a7a1b8] sm:text-lg">
              将内置模板从分类展示改为统一叙事流，按关注点、长期目标、情绪趋势、偏好信号和成长观察依次阅读。
            </p>
          </div>
          <aside className="rounded-[24px] border border-[#3b334d] bg-[#12111b]/90 p-6 shadow-[0_18px_70px_rgba(0,0,0,0.34)]">
            <p className="text-xs font-bold text-[#7f778f]">报告周期</p>
            <p className="mt-3 text-2xl font-black">{reportView.periodLabel || "未设置"}</p>
            <div className="mt-5 space-y-3 border-t border-white/7 pt-4 text-sm font-bold text-[#a9a3b7]">
              <MetricRow label="记忆证据" value={`${reportView.memoryCount} 条`} />
              <MetricRow label="已确认" value={`${reportView.confirmedCount} 条`} />
            </div>
          </aside>
        </header>

        {reportView.memoryCount === 0 || !reportView.dimensions.length ? (
          <section className="mt-10 rounded-[24px] border border-[#3b334d] bg-[#12111b]/90 p-8 text-center shadow-[0_18px_70px_rgba(0,0,0,0.34)]">
            <h2 className="text-2xl font-black">暂无周期报告数据</h2>
            <p className="mt-3 text-sm font-semibold leading-7 text-[#a7a1b8]">
              选择报告中的 session 记忆不足以形成洞察。
            </p>
          </section>
        ) : <>
          <section className="mt-10 grid gap-4 border-b border-white/8 pb-8 md:grid-cols-2">
            <SummaryPill label="本期主线" value={reportView.topChange || "暂无主线变化"} />
            <SummaryPill label="重点变化" value={reportView.keyShift || "暂无重点变化"} />
          </section>

          <div className="divide-y divide-white/8">
            {SECTION_ORDER.map((dimension) => (
              <ReportSection
                key={dimension}
                changes={reportView.changesByDimension[dimension]}
                dimension={dimension}
                // icon={dimensionIcon[dimension]}
                summary={reportView.summariesByDimension[dimension]}
              />
            ))}
          </div>

          <footer className="border-t border-white/8 py-8 text-xs font-semibold text-[#706b7c]">
            Generated by mem9 Your Memory · Report ID: {reportView.reportId} · 生成时间：{formatReportDate(reportView.generatedAt)}
          </footer>
        </>}
      </article>
    </main>
  );
}

function TemplateReportState({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#05070c] px-6 text-[#f5f2ff]">
      <section className="max-w-lg rounded-[24px] border border-[#3b334d] bg-[#12111b] p-8 text-center shadow-[0_18px_70px_rgba(0,0,0,0.34)]">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-7 text-[#a7a1b8]">{description}</p>
      </section>
    </main>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="text-[#e8e2ff]">{value}</span>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-[linear-gradient(135deg,rgba(93,75,132,0.36),rgba(22,27,34,0.72))] px-5 py-5">
      <p className="text-xs font-black text-[#827994]">{label}</p>
      <p className="mt-2 line-clamp-2 text-xl font-black tracking-[-0.03em] text-[#f5f2ff]">{value}</p>
    </div>
  );
}

function ReportSection({
  dimension,
  changes,
  summary,
}: {
  dimension: MemorySignalDimension;
  changes: MemoryAnalysisChange[];
  summary: string;
}) {
  const meta = SECTION_META[dimension];
  const description = summary.trim() || meta.sideNote;
  // const Icon = dimensionIcon[dimension];

  return (
    <section className="grid gap-6 py-9 lg:grid-cols-[13.5rem_minmax(0,1fr)]">      
      <div>
        <p className="text-xs font-black tracking-[0.12em] text-[#a996f6]">{meta.eyebrow}</p>
        <h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">{meta.title}</h2>

        <p className="mt-6 text-sm font-semibold leading-7 text-[#6f6a79]">{description}</p>
      </div>
      <div>
        {changes.length === 0 ? (
          <EmptyDimensionCard title={`暂无${meta.title}数据`} />
        ) : (
          <div className="mt-6 space-y-5">
            <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {changes.map((change, index) => (
                <ChangeCard
                  key={`${dimension}-${change.title}-${change.period.start}-${index}`}
                  change={change}
                  compact={dimension === "emotion"}
                  dimension={dimension}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyDimensionCard({ title }: { title: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-white/7 bg-white/[0.035] px-5 py-6 text-sm font-bold text-[#817b8c]">
      {title}
    </div>
  );
}

function ChangeCard({
  change,
  compact,
  dimension,
}: {
  change: MemoryAnalysisChange;
  compact: boolean;
  dimension: MemorySignalDimension;
}) {
  return (
    <article className="min-w-0 w-full rounded-[18px] border border-[#352d46] bg-[#12111b]/88 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-4">
        <h3 className="min-w-0 text-xl font-black leading-tight tracking-[-0.03em]">{change.title || SECTION_META[dimension].title}</h3>
        <StatusBadge label={SECTION_META[dimension].title} tone={dimension === "emotion" ? "pending" : "stable"} />
      </div>
      {change.summary ? <p className="mt-4 text-sm font-semibold leading-7 text-[#aaa3b8]">{change.summary}</p> : null}
      <EvidenceList evidence={change.evidence.slice(0, compact ? 2 : 3)} />
    </article>
  );
}

function EvidenceList({ evidence }: { evidence: MemoryAnalysisChangeEvidence[] }) {
  if (evidence.length === 0) {
    return (
      <div className="mt-5 rounded-xl border border-white/7 bg-white/[0.035] px-4 py-3 text-xs font-bold text-[#776f86]">
        暂无相关记忆证据。
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-2">
      {evidence.map((item, index) => (
        <div key={`${item.evidenceId}-${index}`} className="flex min-w-0 gap-3 rounded-xl border border-white/7 bg-white/[0.045] px-4 py-3 text-xs font-bold leading-6 text-[#bbb5c8]">
          <EvidenceBadge correctness={item.correctness} />
          <span className="min-w-0 flex-1">{item.quote || "无记忆摘录"}</span>
        </div>
      ))}
    </div>
  );
}

function EvidenceBadge({ correctness }: { correctness: string }) {
  const label = correctness === "incorrect" ? "不正确" : correctness === "correct" ? "已确认" : "";
  const className = correctness === "incorrect"
    ? "bg-[#5a3037] text-[#ffb4bd]"
    : correctness === "correct"
      ? "bg-[#24463e] text-[#a8f1d4]"
      : "bg-[#26364c] text-[#b9d7ff]";
  if (!label) {
    return null;
  }

  return (
    <span className={`mt-0.5 h-5 shrink-0 rounded-md px-2 text-[10px] font-black leading-5 ${className}`}>
      {label}
    </span>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "stable" | "pending" }) {
  const className = tone === "stable"
    ? "bg-[#4d426e] text-[#d7ccff]"
    : "bg-[#26364c] text-[#bfd8ff]";
  return <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${className}`}>{label}</span>;
}

function parseReportDimensions(reportContent: string): MemoryAnalysisChangeDimensionGroup[] {
  if (!reportContent.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(reportContent) as { dimensions?: unknown };
    if (!Array.isArray(parsed.dimensions)) {
      return [];
    }
    return parsed.dimensions.map(normalizeDimensionGroup).filter((group) => group.changes.length > 0);
  } catch {
    return [];
  }
}

function normalizeDimensionGroup(group: unknown): MemoryAnalysisChangeDimensionGroup {
  const record = toRecord(group);
  const dimension = normalizeDimension(record.dimension);
  const changes = Array.isArray(record.changes) ? record.changes.map(normalizeChange) : [];

  return {
    dimension,
    summary: typeof record.summary === "string" ? record.summary : "",
    changes,
  };
}

function normalizeChange(change: unknown): MemoryAnalysisChange {
  const record = toRecord(change);
  const period = toRecord(record.period);

  return {
    title: typeof record.title === "string" ? record.title : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    period: {
      start: typeof period.start === "string" ? period.start : "",
      end: typeof period.end === "string" ? period.end : "",
    },
    evidence: Array.isArray(record.evidence) ? record.evidence.map(normalizeEvidence) : [],
  };
}

function normalizeEvidence(evidence: unknown): MemoryAnalysisChangeEvidence {
  const record = toRecord(evidence);

  return {
    evidenceId: typeof record.evidenceId === "string" ? record.evidenceId : "",
    quote: typeof record.quote === "string" ? record.quote : "",
    correctness: typeof record.correctness === "string" ? record.correctness : "",
    edited: record.edited === true,
    review: isRecord(record.review) ? record.review : null,
  };
}

function normalizeTemplateId(value: string): MemoryAnalysisReportType {
  return isReportTemplateId(value) ? value : "focus_area";
}

function normalizeDimension(value: unknown): MemorySignalDimension {
  return isReportTemplateId(value) ? value : "focus_area";
}

function isReportTemplateId(value: unknown): value is MemoryAnalysisReportType {
  return value === "long_term_goal"
    || value === "focus_area"
    || value === "emotion"
    || value === "preference_signal"
    || value === "growth_signal";
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickFirstTitle(groups: MemoryAnalysisChange[][]): string {
  for (const group of groups) {
    const title = group.find((change) => change.title.trim())?.title.trim();
    if (title) return title;
  }
  return "";
}

function formatReportDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatChinesePeriod(start: string, end: string): string {
  const formattedStart = formatChineseDateOnly(start);
  const formattedEnd = formatChineseDateOnly(end);

  if (!formattedStart && !formattedEnd) {
    return "";
  }

  if (!formattedStart || !formattedEnd) {
    return formattedStart || formattedEnd;
  }

  return `${formattedStart} - ${formattedEnd}`;
}

function formatChineseDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
