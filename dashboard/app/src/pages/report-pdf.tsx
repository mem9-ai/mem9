import { useMemo } from "react";
import {
  buildTemplateReportPdfPayload,
  REPORT_PDF_STORAGE_KEY,
  type ReportPdfPayload,
  type ReportPdfTopicBlock,
} from "@/lib/report-pdf";
import { cn } from "@/lib/utils";

function readReportPayload(): ReportPdfPayload {
  if (typeof window === "undefined") {
    return buildTemplateReportPdfPayload({
      templateName: "关注点变化",
      goal: "识别用户最近关注点相对历史关注点的变化",
      templateId: "focus_change",
      reportIndex: 0,
    });
  }

  const raw =
    window.sessionStorage.getItem(REPORT_PDF_STORAGE_KEY) ??
    window.localStorage.getItem(REPORT_PDF_STORAGE_KEY);
  if (!raw) {
    return buildTemplateReportPdfPayload({
      templateName: "关注点变化",
      goal: "识别用户最近关注点相对历史关注点的变化",
      templateId: "focus_change",
      reportIndex: 0,
    });
  }

  try {
    return JSON.parse(raw) as ReportPdfPayload;
  } catch {
    return buildTemplateReportPdfPayload({
      templateName: "关注点变化",
      goal: "识别用户最近关注点相对历史关注点的变化",
      templateId: "focus_change",
      reportIndex: 0,
    });
  }
}

export function ReportPdfPage() {
  const report = useMemo(() => readReportPayload(), []);

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
