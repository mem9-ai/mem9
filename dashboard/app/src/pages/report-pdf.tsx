import { useMemo } from "react";
import { useMemoryAnalysisReport } from "@/api/memory-analysis-reports";
import {
  buildReportPdfPayloadFromReportContent,
  buildTemplateReportPdfPayload,
  REPORT_PDF_API_KEY_STORAGE_KEY,
  type ReportPdfPayload,
  type ReportPdfTopicBlock,
} from "@/lib/report-pdf";
import { getActiveApiKey } from "@/lib/session";
import { cn } from "@/lib/utils";

const TEMPLATE_META: Record<string, { name: string; goal: string }> = {
  focus_area: {
    name: "关注点变化",
    goal: "识别用户最近关注点相对历史关注点的变化",
  },
  long_term_goal: {
    name: "长期目标变化",
    goal: "梳理新增、强化或再次确认的长期目标",
  },
  emotion: {
    name: "情绪趋势变化",
    goal: "分析对话中的阶段性情绪变化",
  },
};

function getReportIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("reportId") ?? "";
}

function buildFallbackPayload(reportId: string): ReportPdfPayload {
  return buildTemplateReportPdfPayload({
    templateName: "关注点变化",
    goal: "识别用户最近关注点相对历史关注点的变化",
    templateId: "focus_area",
    reportIndex: Number(reportId) || 0,
  });
}

function getReportPdfApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return getActiveApiKey() ?? window.localStorage.getItem(REPORT_PDF_API_KEY_STORAGE_KEY);
}

export function ReportPdfPage() {
  const reportId = useMemo(() => getReportIdFromUrl(), []);
  const apiKey = useMemo(() => getReportPdfApiKey(), []);
  const reportQuery = useMemoryAnalysisReport(apiKey, reportId || null);
  const report = useMemo(() => {
    const detail = reportQuery.data;
    if (!detail) return buildFallbackPayload(reportId);

    const meta = TEMPLATE_META[detail.template_id] ?? {
      name: detail.template_id || "关注点变化",
      goal: "识别用户记忆中的阶段性变化",
    };
    return buildReportPdfPayloadFromReportContent({
      reportContent: detail.report_content,
      templateName: meta.name,
      goal: meta.goal,
      templateId: detail.template_id || "focus_area",
      reportId: String(detail.report_id || reportId),
    });
  }, [reportId, reportQuery.data]);

  if (!reportId) {
    return <ReportPdfState title="缺少 reportId" description="请从模板生成记录中点击“查看模板”进入报告页面。" />;
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

  return (
    <main className="min-h-screen bg-[#f3f7fc] px-6 py-10 text-[#111827] print:bg-white print:px-0 print:py-0">
      <article className="mx-auto w-full max-w-[1280px] space-y-9 print:max-w-none print:space-y-6">
        <section className="rounded-[2rem] bg-[#111827] px-12 py-11 text-white shadow-sm print:rounded-none print:px-10 print:py-9">
          <div className="flex items-start justify-between gap-6">
            <p className="text-2xl font-extrabold tracking-[-0.04em]">{report.brand}</p>
            <span className="rounded-full bg-white/7 px-6 py-2 text-sm font-bold">{report.badge}</span>
          </div>
          <h1 className="mt-9 text-[3.25rem] font-extrabold leading-none tracking-[-0.08em] print:text-[2.6rem]">
            {report.title}
          </h1>
          <p className="mt-5 max-w-4xl text-xl font-bold leading-relaxed text-slate-300 print:text-base">
            {report.subtitle}
          </p>
        </section>

        <section className="rounded-[1.6rem] border border-[#d9e2ef] bg-white px-9 py-8 shadow-sm print:break-inside-avoid">
          <p className="text-xs font-extrabold uppercase tracking-[0.45em] text-[#63748b]">
            {report.summary.eyebrow}
          </p>
          <h2 className="mt-3 text-[2rem] font-extrabold leading-tight tracking-[-0.06em] text-[#111827] print:text-[1.55rem]">
            {report.summary.title}
          </h2>
          <p className="mt-4 text-base font-bold leading-relaxed text-[#314154]">{report.summary.body}</p>
          <p className="mt-3 text-base font-bold leading-relaxed text-[#314154]">{report.summary.recommendation}</p>
        </section>

        <section className="grid gap-9 lg:grid-cols-2 print:grid-cols-2 print:gap-6">
          <TopicBlock eyebrow="BEFORE" block={report.before} tone="amber" />
          <TopicBlock eyebrow="AFTER" block={report.after} tone="blue" />
        </section>

        <section className="rounded-[1.6rem] border border-[#d9e2ef] bg-white px-9 py-8 shadow-sm print:break-inside-avoid">
          <h2 className="text-2xl font-extrabold tracking-[-0.05em]">{report.explanation.title}</h2>
          <div className="mt-5 space-y-4 text-base font-bold leading-relaxed text-[#314154]">
            {report.explanation.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-5">
            <span className="text-sm font-bold text-[#64748b]">结论置信度：{report.explanation.confidence}%</span>
            <div className="h-4 w-[360px] overflow-hidden rounded-full bg-[#dce5ef]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#5a9dfb] to-[#64d7f6]"
                style={{ width: `${report.explanation.confidence}%` }}
              />
            </div>
          </div>
        </section>

        <section className="rounded-[1.6rem] border border-[#d9e2ef] bg-white px-9 py-8 shadow-sm print:break-inside-avoid">
          <h2 className="text-2xl font-extrabold tracking-[-0.05em]">{report.evidenceTitle}</h2>
          <div className="mt-6 space-y-3">
            {report.evidence.map((item) => (
              <div key={item.id} className="grid gap-3 rounded-xl border border-[#dfe7f1] bg-[#f8fbff] px-5 py-4 text-base font-bold text-[#263446] sm:grid-cols-[7rem_minmax(0,1fr)_4rem] sm:items-center">
                <span className="font-extrabold text-[#172033]">{item.id}</span>
                <span>{item.text}</span>
                <span className="text-right text-sm text-[#64748b]">{item.confidence}%</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe3ee] pt-5 text-xs font-semibold text-[#68778b]">
          <span>
            {report.footer.generatedBy} · Template: {report.footer.template} · Report ID: {report.footer.reportId}
          </span>
          <span>{report.footer.page}</span>
        </footer>
      </article>
    </main>
  );
}

function ReportPdfState({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f7fc] px-6 text-[#111827]">
      <section className="max-w-lg rounded-[1.5rem] border border-[#d9e2ef] bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-[-0.05em]">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-relaxed text-[#64748b]">{description}</p>
      </section>
    </main>
  );
}

function TopicBlock({
  eyebrow,
  block,
  tone,
}: {
  eyebrow: string;
  block: ReportPdfTopicBlock;
  tone: "amber" | "blue";
}) {
  return (
    <section className="rounded-[1.6rem] border border-[#d9e2ef] bg-white px-8 py-8 shadow-sm print:break-inside-avoid">
      <p className="text-xs font-extrabold uppercase tracking-[0.45em] text-[#63748b]">{eyebrow}</p>
      <h2 className="mt-4 text-2xl font-extrabold tracking-[-0.05em]">{block.title}</h2>
      <div className="mt-6 flex flex-wrap gap-4">
        {block.tags.map((tag, index) => (
          <span
            key={tag}
            className={cn(
              "min-w-[10rem] rounded-full border px-6 py-3 text-center text-sm font-extrabold",
              tone === "amber" && index < 2
                ? "border-[#f6c65f] bg-[#fff3d7] text-[#172033]"
                : tone === "blue" && index < 2
                  ? "border-[#8bbcff] bg-[#eaf3ff] text-[#172033]"
                  : "border-[#9cddb0] bg-[#e8f8ee] text-[#172033]",
            )}
          >
            {tag}
          </span>
        ))}
      </div>
      <p className="mt-6 text-base font-bold leading-relaxed text-[#314154]">{block.description}</p>
      <p className="mt-4 text-sm font-bold leading-relaxed text-[#68778b]">{block.evidence}</p>
      <p className="mt-2 text-sm font-bold leading-relaxed text-[#68778b]">{block.share}</p>
    </section>
  );
}
