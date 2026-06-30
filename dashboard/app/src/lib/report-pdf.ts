export const REPORT_PDF_STORAGE_KEY = "mem9.reportPdfPayload";
export const REPORT_PDF_API_KEY_HANDOFF_PARAM = "keyHandoff";
const REPORT_PDF_API_KEY_HANDOFF_CHANNEL = "mem9.reportPdfApiKeyHandoff";
const REPORT_PDF_API_KEY_REQUEST = "request-report-pdf-api-key";
const REPORT_PDF_API_KEY_RESPONSE = "report-pdf-api-key";
const REPORT_PDF_API_KEY_REQUEST_TIMEOUT_MS = 1_500;
const REPORT_PDF_API_KEY_HANDOFF_TTL_MS = 30_000;

const pendingReportPdfApiKeyHandoffs = new Map<string, number>();
const pendingReportPdfApiKeyRequests = new Map<string, Promise<string | null>>();

interface ReportPdfApiKeyRequestMessage {
  type: typeof REPORT_PDF_API_KEY_REQUEST;
  requestId: string;
  nonce: string;
}

interface ReportPdfApiKeyResponseMessage {
  type: typeof REPORT_PDF_API_KEY_RESPONSE;
  requestId: string;
  nonce: string;
  apiKey: string;
}

type ReportPdfApiKeyHandoffMessage =
  | ReportPdfApiKeyRequestMessage
  | ReportPdfApiKeyResponseMessage;

function isReportPdfApiKeyHandoffMessage(
  value: unknown,
): value is ReportPdfApiKeyHandoffMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ReportPdfApiKeyHandoffMessage>;
  if (
    message.type === REPORT_PDF_API_KEY_REQUEST &&
    typeof message.requestId === "string" &&
    typeof (message as Partial<ReportPdfApiKeyRequestMessage>).nonce === "string"
  ) {
    return true;
  }

  return (
    message.type === REPORT_PDF_API_KEY_RESPONSE &&
    typeof message.requestId === "string" &&
    typeof (message as Partial<ReportPdfApiKeyResponseMessage>).nonce === "string" &&
    typeof (message as Partial<ReportPdfApiKeyResponseMessage>).apiKey === "string"
  );
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanupExpiredReportPdfApiKeyHandoffs(now = Date.now()): void {
  for (const [nonce, expiresAt] of pendingReportPdfApiKeyHandoffs) {
    if (expiresAt <= now) {
      pendingReportPdfApiKeyHandoffs.delete(nonce);
    }
  }
}

function consumeReportPdfApiKeyHandoffNonce(nonce: string): boolean {
  cleanupExpiredReportPdfApiKeyHandoffs();
  const expiresAt = pendingReportPdfApiKeyHandoffs.get(nonce);
  if (!expiresAt) {
    return false;
  }

  pendingReportPdfApiKeyHandoffs.delete(nonce);
  return expiresAt > Date.now();
}

export function createReportPdfApiKeyHandoffNonce(): string {
  const nonce = createRequestId();
  cleanupExpiredReportPdfApiKeyHandoffs();
  pendingReportPdfApiKeyHandoffs.set(
    nonce,
    Date.now() + REPORT_PDF_API_KEY_HANDOFF_TTL_MS,
  );
  window.setTimeout(() => {
    pendingReportPdfApiKeyHandoffs.delete(nonce);
  }, REPORT_PDF_API_KEY_HANDOFF_TTL_MS);
  return nonce;
}

export function startReportPdfApiKeyHandoff(apiKey: string): () => void {
  if (typeof BroadcastChannel === "undefined") {
    return () => {};
  }

  const channel = new BroadcastChannel(REPORT_PDF_API_KEY_HANDOFF_CHANNEL);
  const handleMessage = (event: MessageEvent<unknown>) => {
    if (!isReportPdfApiKeyHandoffMessage(event.data)) {
      return;
    }

    if (event.data.type !== REPORT_PDF_API_KEY_REQUEST) {
      return;
    }

    if (!consumeReportPdfApiKeyHandoffNonce(event.data.nonce)) {
      return;
    }

    channel.postMessage({
      type: REPORT_PDF_API_KEY_RESPONSE,
      requestId: event.data.requestId,
      nonce: event.data.nonce,
      apiKey,
    } satisfies ReportPdfApiKeyResponseMessage);
  };

  channel.addEventListener("message", handleMessage);

  return () => {
    channel.removeEventListener("message", handleMessage);
    channel.close();
  };
}

export function requestReportPdfApiKey(
  nonce: string,
  timeoutMs = REPORT_PDF_API_KEY_REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  if (!nonce || typeof BroadcastChannel === "undefined") {
    return Promise.resolve(null);
  }

  const pendingRequest = pendingReportPdfApiKeyRequests.get(nonce);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = new Promise<string | null>((resolve) => {
    const channel = new BroadcastChannel(REPORT_PDF_API_KEY_HANDOFF_CHANNEL);
    const requestId = createRequestId();
    const cleanup = () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isReportPdfApiKeyHandoffMessage(event.data)) {
        return;
      }

      if (
        event.data.type !== REPORT_PDF_API_KEY_RESPONSE ||
        event.data.requestId !== requestId ||
        event.data.nonce !== nonce
      ) {
        return;
      }

      window.clearTimeout(timer);
      cleanup();
      resolve(event.data.apiKey);
    };

    channel.addEventListener("message", handleMessage);
    channel.postMessage({
      type: REPORT_PDF_API_KEY_REQUEST,
      requestId,
      nonce,
    } satisfies ReportPdfApiKeyRequestMessage);
  });

  pendingReportPdfApiKeyRequests.set(nonce, request);
  void request.finally(() => {
    pendingReportPdfApiKeyRequests.delete(nonce);
  });
  return request;
}

export interface ReportPdfTopicBlock {
  title: string;
  tags: string[];
  description: string;
  evidence: string;
  share: string;
}

export interface ReportPdfEvidenceItem {
  id: string;
  text: string;
  confidence: number;
}

export interface ReportPdfPayload {
  brand: string;
  badge: string;
  title: string;
  subtitle: string;
  summary: {
    eyebrow: string;
    title: string;
    body: string;
    recommendation: string;
  };
  before: ReportPdfTopicBlock;
  after: ReportPdfTopicBlock;
  explanation: {
    title: string;
    paragraphs: string[];
    confidence: number;
  };
  evidenceTitle: string;
  evidence: ReportPdfEvidenceItem[];
  footer: {
    generatedBy: string;
    template: string;
    reportId: string;
    page: string;
  };
}

export function buildTemplateReportPdfPayload({
  templateName,
  goal,
  templateId,
  reportIndex,
}: {
  templateName: string;
  goal: string;
  templateId: string;
  reportIndex: number;
}): ReportPdfPayload {
  const reportId = `rpt_focus_20250614_${String(reportIndex + 1).padStart(3, "0")}`;

  return {
    brand: "MEM9 Your Memory",
    badge: "PDF 报告",
    title: `${templateName}报告`,
    subtitle: `${goal}，并提供变化结论、证据与置信度。`,
    summary: {
      eyebrow: "EXECUTIVE SUMMARY",
      title: "本期关注点从“饮食控制 / 体重管理”扩展到“KET 备考 / 学习计划 / 健康习惯”。",
      body: "用户仍保留健康管理主题，但最近两周学习相关记忆频次显著上升，KET 备考成为更强的即时关注点。",
      recommendation: "建议：后续 Agent 在召回时优先结合学习计划与健康习惯，不再只围绕减脂目标组织陪伴策略。",
    },
    before: {
      title: "历史主要关注",
      tags: ["饮食控制", "体重管理", "步数目标"],
      description: "历史记忆中，用户多次提到饮食约束、减重目标和步数管理。",
      evidence: "代表证据：mem_0872、mem_0906、mem_1018",
      share: "主题占比：健康 / 饮食相关 52%",
    },
    after: {
      title: "本期主要关注",
      tags: ["KET 备考", "学习计划", "健康习惯"],
      description: "本期新增多条学习计划与 KET 相关记忆，健康主题转为支撑性背景。",
      evidence: "代表证据：mem_1021、mem_1034、mem_1088",
      share: "主题占比：学习相关 48%，健康相关 35%",
    },
    explanation: {
      title: "变化解释",
      paragraphs: [
        "学习相关关注上升主要来自 KET 备考计划、单词复习安排和备考陪伴需求。",
        "健康主题未消失，而是从“目标本身”转为“执行约束与生活习惯背景”，与学习计划共同构成用户当前关注。",
      ],
      confidence: 91,
    },
    evidenceTitle: "关键证据",
    evidence: [
      { id: "mem_1021", text: "用户最近多次提到 KET 备考计划。", confidence: 94 },
      { id: "mem_1034", text: "单词计划与复习节奏成为高频主题。", confidence: 82 },
      { id: "mem_0872", text: "步数目标和健康习惯仍作为背景约束。", confidence: 91 },
    ],
    footer: {
      generatedBy: "Generated by mem9 Your Memory",
      template: `${templateId}_v1`,
      reportId,
      page: "Page 1 / 1",
    },
  };
}

export function buildReportPdfPayloadFromReportContent({
  reportContent,
  templateName,
  goal,
  templateId,
  reportId,
}: {
  reportContent: string;
  templateName: string;
  goal: string;
  templateId: string;
  reportId: string;
}): ReportPdfPayload {
  const fallback = buildTemplateReportPdfPayload({
    templateName,
    goal,
    templateId,
    reportIndex: Number(reportId) || 0,
  });

  if (!reportContent.trim()) {
    return {
      ...fallback,
      footer: { ...fallback.footer, reportId },
    };
  }

  try {
    const parsed = JSON.parse(reportContent) as Partial<ReportPdfPayload>;
    if (isReportPdfPayloadLike(parsed)) {
      return {
        ...fallback,
        ...parsed,
        footer: {
          ...fallback.footer,
          ...parsed.footer,
          reportId: parsed.footer?.reportId ?? reportId,
        },
      };
    }
  } catch {
    // Plain-text report content is rendered as the summary body below.
  }

  return {
    ...fallback,
    summary: {
      ...fallback.summary,
      body: reportContent,
    },
    footer: {
      ...fallback.footer,
      reportId,
    },
  };
}

function isReportPdfPayloadLike(value: Partial<ReportPdfPayload>): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.title === "string" &&
    typeof value.summary === "object" &&
    typeof value.before === "object" &&
    typeof value.after === "object"
  );
}
