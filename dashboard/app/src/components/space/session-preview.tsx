import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { Loader2, User, MessageSquare, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import type { SessionMessage } from "@/types/memory";
import { formatRelativeTime } from "@/lib/time";

type SessionContentBlock =
  | {
      kind: "markdown";
      content: string;
    }
  | {
      kind: "metadata";
      label: string;
      raw: string;
      summary: string;
    };

const UNTRUSTED_METADATA_PATTERN = /^(.+?\(untrusted metadata\)):\s*$/;
const FENCED_CODE_BLOCK_PATTERN = /^```[\w-]*\s*$/;

const slugifyMetadataLabel = (label: string): string => {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const countToken = (value: string, token: "{" | "}"): number => {
  return [...value].filter((char) => char === token).length;
};

const compactMetadataValue = (value: unknown): string => {
  const normalized =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";

  if (!normalized) return "";
  if (normalized.length <= 30) return normalized;
  return `${normalized.slice(0, 12)}…${normalized.slice(-8)}`;
};

const normalizeMetadataRaw = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const lines = trimmed.split("\n");
  if (lines.length < 2) return trimmed;
  if (!FENCED_CODE_BLOCK_PATTERN.test(lines[0]?.trim() ?? "")) return trimmed;
  if ((lines[lines.length - 1] ?? "").trim() !== "```") return trimmed;

  return lines.slice(1, -1).join("\n").trim();
};

const summarizeMetadata = (raw: string): string => {
  const trimmed = normalizeMetadataRaw(raw);
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const preferredKeys = [
        "name",
        "sender",
        "label",
        "timestamp",
        "message_id",
        "id",
      ];
      const orderedValues: string[] = [];
      const seen = new Set<string>();

      for (const key of preferredKeys) {
        const value = compactMetadataValue(parsed[key]);
        if (!value || seen.has(value)) continue;
        orderedValues.push(value);
        seen.add(value);
        if (orderedValues.length >= 3) {
          return orderedValues.join(" · ");
        }
      }

      for (const value of Object.values(parsed)) {
        const normalized = compactMetadataValue(value);
        if (!normalized || seen.has(normalized)) continue;
        orderedValues.push(normalized);
        seen.add(normalized);
        if (orderedValues.length >= 3) {
          break;
        }
      }

      if (orderedValues.length > 0) {
        return orderedValues.join(" · ");
      }
    }
  } catch {
    // Fall through to plain-text summary.
  }

  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
};

const buildSessionContentBlocks = (content: string): SessionContentBlock[] => {
  const lines = content.split("\n");
  const blocks: SessionContentBlock[] = [];
  const markdownBuffer: string[] = [];

  const flushMarkdownBuffer = () => {
    const markdown = markdownBuffer.join("\n").trim();
    markdownBuffer.length = 0;
    if (!markdown) return;
    blocks.push({
      kind: "markdown",
      content: markdown,
    });
  };

  let index = 0;
  while (index < lines.length) {
    const current = lines[index] ?? "";
    const labelMatch = current.trim().match(UNTRUSTED_METADATA_PATTERN);

    if (!labelMatch) {
      markdownBuffer.push(current);
      index += 1;
      continue;
    }

    flushMarkdownBuffer();
    index += 1;

    while (index < lines.length && lines[index]?.trim() === "") {
      index += 1;
    }

    const metadataLines: string[] = [];
    const firstLine = lines[index]?.trim() ?? "";

    if (firstLine.startsWith("```")) {
      while (index < lines.length) {
        const line = lines[index] ?? "";
        metadataLines.push(line);
        index += 1;
        if (line.trim() === "```" && metadataLines.length > 1) {
          break;
        }
      }
    } else if (firstLine.startsWith("{")) {
      let depth = 0;
      while (index < lines.length) {
        const line = lines[index] ?? "";
        metadataLines.push(line);
        depth += countToken(line, "{");
        depth -= countToken(line, "}");
        index += 1;
        if (depth <= 0) {
          break;
        }
      }
    } else {
      while (index < lines.length) {
        const line = lines[index] ?? "";
        const trimmed = line.trim();
        if (!trimmed) break;
        if (UNTRUSTED_METADATA_PATTERN.test(trimmed)) break;
        metadataLines.push(line);
        index += 1;
      }
    }

    const raw = metadataLines.join("\n").trim();
    blocks.push({
      kind: "metadata",
      label: labelMatch[1] ?? "",
      raw,
      summary: summarizeMetadata(raw),
    });
  }

  flushMarkdownBuffer();
  return blocks.length > 0
    ? blocks
    : [
        {
          kind: "markdown",
          content,
        },
      ];
};

const MetadataContent = ({
  label,
  raw,
  summary,
  compact,
  t,
}: {
  label: string;
  raw: string;
  summary: string;
  compact: boolean;
  t: TFunction;
}) => {
  const [expanded, setExpanded] = useState(false);
  const slug = slugifyMetadataLabel(label);
  const normalizedRaw = normalizeMetadataRaw(raw);

  if (!compact) {
    return (
      <div className="my-3 space-y-2">
        <p className="text-[12px] font-medium text-foreground/80">{label}:</p>
        <pre className="whitespace-pre-wrap break-all rounded-xl border border-border/50 bg-secondary/50 px-3 py-3 font-mono text-[12px] leading-6 text-foreground/80">
          {normalizedRaw}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="my-3 rounded-2xl border border-border/45 bg-secondary/35 px-3.5 py-3"
      data-testid={`session-metadata-${slug}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground/80">{label}:</p>
          <p
            className="mt-1 text-[12px] leading-5 text-muted-foreground break-words"
            data-testid={`session-metadata-summary-${slug}`}
          >
            {summary || t("session_preview.metadata_summary_empty")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="shrink-0 rounded-full border border-border/50 px-2.5 py-1 text-[11px] font-medium text-foreground/70 transition-colors hover:border-border/80 hover:text-foreground"
          aria-expanded={expanded}
          data-testid={`session-metadata-toggle-${slug}`}
        >
          {expanded
            ? t("session_preview.hide_metadata")
            : t("session_preview.show_metadata")}
        </button>
      </div>

      {expanded && (
        <pre
          className="mt-3 whitespace-pre-wrap break-all rounded-xl border border-border/50 bg-background/70 px-3 py-3 font-mono text-[11px] leading-6 text-foreground/80"
          data-testid={`session-metadata-body-${slug}`}
        >
          {normalizedRaw}
        </pre>
      )}
    </div>
  );
};

const SessionMessageContent = ({
  content,
  compactMetadata,
  t,
}: {
  content: string;
  compactMetadata: boolean;
  t: TFunction;
}) => {
  const blocks = useMemo(() => buildSessionContentBlocks(content), [content]);

  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        block.kind === "markdown" ? (
          <SessionMarkdownContent
            key={`${block.kind}-${index}`}
            content={block.content}
          />
        ) : (
          <MetadataContent
            key={`${block.kind}-${block.label}-${index}`}
            label={block.label}
            raw={block.raw}
            summary={block.summary}
            compact={compactMetadata}
            t={t}
          />
        ),
      )}
    </div>
  );
};

const getRoleLabel = (
  t: TFunction,
  role: SessionMessage["role"],
): string => {
  return t(`session_preview.role.${role}`, { defaultValue: role });
};

const getToolResultPreview = (content: string): string => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("```"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};

const SessionMarkdownContent = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
      allowedElements={[
        "a",
        "blockquote",
        "br",
        "code",
        "em",
        "li",
        "ol",
        "p",
        "pre",
        "strong",
        "ul",
      ]}
      components={{
        a: ({ node: _node, className, href, ...props }) => (
          <a
            {...props}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "text-primary underline underline-offset-4 break-all hover:text-primary/80",
              className,
            )}
          />
        ),
        blockquote: ({ node: _node, className, ...props }) => (
          <blockquote
            {...props}
            className={cn(
              "my-3 border-l-2 border-border/60 pl-3 italic text-foreground/75",
              className,
            )}
          />
        ),
        code: ({ node: _node, className, children, ...props }) => {
          const isInline = !className?.includes("language-");

          if (isInline) {
            return (
              <code
                {...props}
                className={cn(
                  "rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[12px]",
                  className,
                )}
              >
                {children}
              </code>
            );
          }

          return (
            <code
              {...props}
              className={cn("font-mono text-[12px] leading-6", className)}
            >
              {children}
            </code>
          );
        },
        li: ({ node: _node, className, ...props }) => (
          <li {...props} className={cn("ml-4", className)} />
        ),
        ol: ({ node: _node, className, ...props }) => (
          <ol {...props} className={cn("my-3 list-decimal space-y-1", className)} />
        ),
        p: ({ node: _node, className, ...props }) => (
          <p {...props} className={cn("my-0 leading-relaxed", className)} />
        ),
        pre: ({ node: _node, className, ...props }) => (
          <pre
            {...props}
            className={cn(
              "my-3 overflow-x-auto rounded-xl border border-border/50 bg-secondary/70 px-4 py-3",
              className,
            )}
          />
        ),
        strong: ({ node: _node, className, ...props }) => (
          <strong {...props} className={cn("font-semibold text-foreground", className)} />
        ),
        ul: ({ node: _node, className, ...props }) => (
          <ul {...props} className={cn("my-3 list-disc space-y-1", className)} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

const ToolResultMessageContent = ({
  message,
  compactMetadata,
  expanded,
  t,
}: {
  message: SessionMessage;
  compactMetadata: boolean;
  expanded: boolean;
  t: TFunction;
}) => {
  const preview = getToolResultPreview(message.content);
  return (
    <div className="w-full">
      {!expanded ? (
        <p
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-5 text-muted-foreground"
          data-testid={`tool-result-preview-${message.id}`}
        >
          {preview || t("session_preview.tool_result_empty")}
        </p>
      ) : null}

      {expanded ? (
        <div data-testid={`tool-result-body-${message.id}`}>
          <SessionMessageContent
            content={message.content}
            compactMetadata={compactMetadata}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
};

const ToolResultMessageRow = ({
  message,
  compactMetadata,
  t,
}: {
  message: SessionMessage;
  compactMetadata: boolean;
  t: TFunction;
}) => {
  const [expanded, setExpanded] = useState(false);
  const toggleLabel = expanded
    ? t("session_preview.hide_tool_result")
    : t("session_preview.show_tool_result");

  return (
    <div className="relative flex gap-4">
      <div className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-[3px] border-background bg-primary/10 text-primary">
        <Bot className="size-3" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5 pb-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-foreground/70">
            {getRoleLabel(t, message.role)}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatRelativeTime(t, message.created_at)}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto shrink-0 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline underline-offset-4"
            aria-expanded={expanded}
            aria-label={toggleLabel}
            data-testid={`tool-result-toggle-${message.id}`}
          >
            {toggleLabel}
          </button>
        </div>
        <div className="w-full break-words rounded-2xl rounded-tl-sm border border-primary/10 bg-primary/[0.03] px-4 py-2.5 text-[13px] leading-relaxed text-foreground/90">
          <div className="break-words">
            <ToolResultMessageContent
              message={message}
              compactMetadata={compactMetadata}
              expanded={expanded}
              t={t}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export const DetailSessionPreview = ({
  messages,
  loading,
  compactMetadata = false,
  t,
}: {
  messages: SessionMessage[];
  loading: boolean;
  compactMetadata?: boolean;
  t: TFunction;
}) => {
  if (!loading && messages.length === 0) return null;

  return (
    <section className="relative mt-2">
      <div className="flex items-center gap-2 mb-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <MessageSquare className="size-3.5" />
        {t("session_preview.title")}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("session_preview.loading")}
        </div>
      ) : (
        <div className="relative space-y-5 before:absolute before:inset-y-2 before:left-[11px] before:w-px before:bg-border/40">
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isToolResult = message.role === "toolResult";

            if (isToolResult) {
              return (
                <ToolResultMessageRow
                  key={message.id}
                  message={message}
                  compactMetadata={compactMetadata}
                  t={t}
                />
              );
            }

            return (
              <div key={message.id} className="relative flex gap-4">
                <div
                  className={cn(
                    "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-[3px] border-background",
                    isUser
                      ? "bg-secondary text-foreground/50"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  {isUser ? <User className="size-3" /> : <Bot className="size-3" />}
                </div>
                <div className="flex-1 pt-0.5 pb-1 min-w-0">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[11px] font-medium text-foreground/70 uppercase tracking-wider">
                      {getRoleLabel(t, message.role)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {formatRelativeTime(t, message.created_at)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "break-words rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed",
                      "inline-block max-w-full",
                      isUser
                        ? "rounded-tl-sm bg-secondary/60 text-foreground/90"
                        : "rounded-tl-sm border border-primary/10 bg-primary/[0.03] text-foreground/90",
                    )}
                  >
                    <div className="break-words">
                      <SessionMessageContent
                        content={message.content}
                        compactMetadata={compactMetadata}
                        t={t}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
