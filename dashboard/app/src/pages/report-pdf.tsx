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

const WEEKLY_REPORT_DESCRIPTION = "识别近期关注内容与历史关注内容的变化";

const TEMPLATE_META: Record<MemoryAnalysisReportType, { name: string; title: string }> = {
  focus_area: {
    name: "关注点",
    title: "关注点变化报告",
  },
  long_term_goal: {
    name: "长期目标",
    title: "长期目标变化报告",
  },
  emotion: {
    name: "情绪趋势",
    title: "情绪趋势变化报告",
  },
  preference_signal: {
    name: "偏好信号",
    title: "偏好信号变化报告",
  },
  growth_signal: {
    name: "成长信号",
    title: "成长信号变化报告",
  },
};

function getReportIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("reportId") ?? "";
}

function getReportPdfApiKeyHandoffNonceFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(REPORT_PDF_API_KEY_HANDOFF_PARAM) ?? "";
}

function getReportPdfApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return getActiveApiKey();
}

export function ReportPdfPage() {
  const reportId = useMemo(() => getReportIdFromUrl(), []);
  const apiKeyHandoffNonce = useMemo(() => getReportPdfApiKeyHandoffNonceFromUrl(), []);
  const [handoffApiKey, setHandoffApiKey] = useState<string | null>(null);
  const [isResolvingApiKey, setIsResolvingApiKey] = useState(false);
  const apiKey = useMemo(() => getReportPdfApiKey() ?? handoffApiKey, [handoffApiKey]);
  const reportQuery = useMemoryAnalysisReport(apiKey, reportId || null);
  const reportView = useMemo(() => {
    const detail = reportQuery.data;
    if (!detail) return null;

    const templateId = normalizeTemplateId(detail.template_id);
    const meta = TEMPLATE_META[templateId];
    const dimensions = parseReportDimensions(detail.report_content);
    const changes = dimensions.find((group) => group.dimension === templateId)?.changes ?? [];

    return {
      changes,
      endTime: detail.endTime,
      generatedAt: detail.generated_at,
      memoryCount: detail.memory_count,
      reportId: String(detail.report_id || reportId),
      reportRange: formatPeriod(detail.startTime, detail.endTime),
      startTime: detail.startTime,
      templateId,
      title: meta.title,
      typeName: meta.name,
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
    return <ReportPdfState title="缺少 reportId" description="请从模板生成记录中点击“查看模板”进入报告页面。" />;
  }

  if (!apiKey && isResolvingApiKey) {
    return <ReportPdfState title="正在连接 Space" description="正在从当前 MEM9 页面获取临时访问凭证..." />;
  }

  if (!apiKey) {
    return <ReportPdfState title="未连接 Space" description="请先返回 MEM9 页面连接 Space，再查看报告。" />;
  }

  if (reportQuery.isLoading) {
    return <ReportPdfState title="正在加载报告" description="正在根据 reportId 获取报告详情..." />;
  }

  if (reportQuery.isError) {
    return <ReportPdfState title="报告加载失败" description="无法从 /v1/memory-analysis/report/:report_id 获取报告详情。" />;
  }

  if (reportQuery.data === null) {
    return <ReportPdfState title="报告不存在" description={`未找到 reportId=${reportId} 的报告。`} />;
  }

  if (!reportView) {
    return <ReportPdfState title="报告不可用" description="报告详情为空，请返回模板生成记录后重试。" />;
  }

  return (
    <main className="min-h-screen bg-[#f3f7fc] px-6 py-10 text-[#111827] print:bg-white print:px-0 print:py-0">
      <article className="mx-auto w-full max-w-[1120px] space-y-8 print:max-w-none print:space-y-6">
        <section className="rounded-[2rem] bg-[#111827] px-12 py-11 text-white shadow-sm print:rounded-none print:px-10 print:py-9">
          <div className="flex items-start justify-between gap-6">
            <p className="text-2xl font-extrabold">MEM9 Your Memory</p>
            <span className="rounded-full bg-white/7 px-6 py-2 text-sm font-bold">PDF 报告</span>
          </div>
          <h1 className="mt-9 text-[3.25rem] font-extrabold leading-none print:text-[2.6rem]">
            {reportView.title}
          </h1>
          <p className="mt-5 max-w-4xl text-xl font-bold leading-relaxed text-slate-300 print:text-base">
            {WEEKLY_REPORT_DESCRIPTION}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-bold text-slate-300">
            <span>{reportView.memoryCount}条记忆</span>
            {reportView.reportRange ? (
              <>
                <span className="text-white/25">|</span>
                <span>{reportView.reportRange}</span>
              </>
            ) : null}
          </div>
        </section>

        {reportView.changes.length === 0 ? (
          <section className="rounded-[1.6rem] border border-[#d9e2ef] bg-white px-9 py-10 text-center shadow-sm print:break-inside-avoid">
            <h2 className="text-2xl font-extrabold">暂无{reportView.typeName}变化数据</h2>
            <p className="mt-3 text-sm font-bold leading-relaxed text-[#68778b]">
              当前报告内容中没有找到 dimensions.dimension = {reportView.templateId} 的数据。
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            {reportView.changes.map((change, index) => (
              <ChangeReportCard key={`${change.title}-${change.period.start}-${index}`} change={change} index={index} />
            ))}
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe3ee] pt-5 text-xs font-semibold text-[#68778b]">
          <span>
            Generated by mem9 Your Memory · Template: {reportView.templateId}_v1 · Report ID: {reportView.reportId}
          </span>
          <span>生成时间：{formatReportDate(reportView.generatedAt)} · Page 1 / 1</span>
        </footer>
      </article>
    </main>
  );
}

function ReportPdfState({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f7fc] px-6 text-[#111827]">
      <section className="max-w-lg rounded-[1.5rem] border border-[#d9e2ef] bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-relaxed text-[#64748b]">{description}</p>
      </section>
    </main>
  );
}

function ChangeReportCard({ change, index }: { change: MemoryAnalysisChange; index: number }) {
  const title = change.title.trim() || `变化 ${index + 1}`;
  const summary = change.summary.trim();
  const periodLabel = formatPeriod(change.period.start, change.period.end);

  return (
    <article className="rounded-[1.4rem] border border-[#d9e2ef] bg-white px-8 py-7 shadow-sm print:break-inside-avoid">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.32em] text-[#63748b]">
            CHANGE {String(index + 1).padStart(2, "0")}
          </p>
          <h2 className="mt-3 text-2xl font-extrabold leading-tight text-[#111827]">{title}</h2>
        </div>
        {periodLabel ? (
          <span className="shrink-0 rounded-full bg-[#eaf3ff] px-4 py-2 text-sm font-bold text-[#314154]">
            {periodLabel}
          </span>
        ) : null}
      </div>

      {summary ? <p className="mt-5 text-base font-bold leading-relaxed text-[#314154]">{summary}</p> : null}

      <div className="mt-6 border-t border-[#dfe7f1] pt-5">
        <h3 className="text-base font-extrabold text-[#172033]">关键记忆列表</h3>
        {change.evidence.length > 0 ? (
          <div className="mt-3 space-y-3">
            {change.evidence.map((evidence, evidenceIndex) => (
              <MemoryEvidenceItem key={`${evidence.evidenceId}-${evidenceIndex}`} evidence={evidence} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm font-bold text-[#68778b]">暂无关键记忆。</p>
        )}
      </div>
    </article>
  );
}

function MemoryEvidenceItem({
  evidence,
}: {
  evidence: MemoryAnalysisChangeEvidence;
}) {
  const quote = evidence.quote.trim();

  return (
    <div className="rounded-xl border border-[#dfe7f1] bg-[#f8fbff] px-5 py-4 text-sm font-bold text-[#263446]">
      <span className="leading-6">{quote || "无记忆摘录"}</span>
    </div>
  );
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
  return isMemorySignalDimension(value) ? value : "focus_area";
}

function isReportTemplateId(value: unknown): value is MemoryAnalysisReportType {
  return value === "long_term_goal"
    || value === "focus_area"
    || value === "emotion"
    || value === "preference_signal"
    || value === "growth_signal";
}

function isMemorySignalDimension(value: unknown): value is MemorySignalDimension {
  return isReportTemplateId(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function formatPeriod(start: string, end: string): string {
  const formattedStart = formatDateOnly(start);
  const formattedEnd = formatDateOnly(end);

  if (!formattedStart && !formattedEnd) {
    return "";
  }

  if (!formattedStart || !formattedEnd) {
    return formattedStart || formattedEnd;
  }

  return `${formattedStart} - ${formattedEnd}`;
}

function formatDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
