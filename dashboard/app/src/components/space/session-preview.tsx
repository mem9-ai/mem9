import type { TFunction } from "i18next";
import { Loader2, User, MessageCircle, MessageSquare, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import type { SessionMessage } from "@/types/memory";
import { formatRelativeTime } from "@/lib/time";

function getRoleLabel(t: TFunction, role: SessionMessage["role"]): string {
  return t(`session_preview.role.${role}`, { defaultValue: role });
}

function SessionMarkdownContent({ content }: { content: string }) {
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
}

export function CardSessionPreview({
  messages,
  t,
}: {
  messages: SessionMessage[];
  t: TFunction;
}) {
  const previewMessages = messages.slice(0, 2);

  if (previewMessages.length === 0) return null;

  return (
    <div className="mt-3.5 relative pl-3.5 border-l-[2px] border-border/40 transition-colors group-hover:border-border/60">
      <div className="flex items-center gap-1.5 mb-2">
        <MessageCircle className="size-3 text-muted-foreground/70" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
          {t("session_preview.title")}
        </span>
      </div>
      <div className="space-y-1.5">
        {previewMessages.map((message) => {
          return (
            <div key={message.id} className="flex gap-2 items-start text-xs text-foreground/70 leading-relaxed">
              <span className="font-semibold text-foreground/40 shrink-0 mt-[1px]">
                {getRoleLabel(t, message.role)}
              </span>
              <span className="line-clamp-1 break-all">
                {message.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DetailSessionPreview({
  messages,
  loading,
  t,
}: {
  messages: SessionMessage[];
  loading: boolean;
  t: TFunction;
}) {
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
                  <div className={cn(
                    "rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed inline-block max-w-full break-words",
                    isUser 
                      ? "bg-secondary/60 text-foreground/90 rounded-tl-sm" 
                      : "bg-primary/[0.03] text-foreground/90 rounded-tl-sm border border-primary/10"
                  )}>
                    <div className="break-words">
                      <SessionMarkdownContent content={message.content} />
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
}
