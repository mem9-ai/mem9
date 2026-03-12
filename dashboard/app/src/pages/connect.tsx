import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/api/client";
import { setSpaceId } from "@/lib/session";

export function ConnectPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const normalizedInput = input.trim();
    try {
      await api.verifySpace(normalizedInput);
      setSpaceId(normalizedInput);
      navigate({ to: "/space" });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("connect.error.invalid"),
      );
    } finally {
      setLoading(false);
    }
  }

  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === "zh-CN" ? "en" : "zh-CN");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="fixed right-6 top-6 z-10 flex items-center gap-1">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLang}
          className="gap-1.5 text-soft-foreground hover:text-foreground"
        >
          <Globe className="size-4" />
          {i18n.language === "zh-CN" ? "EN" : "中文"}
        </Button>
      </div>

      <div
        className="w-full max-w-[380px]"
        style={{ animation: "slide-up 0.5s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <div className="mb-10 flex justify-center">
          <img
            src="/your-memory/mem9-logo.svg"
            alt="mem9"
            className="h-8 w-auto dark:invert"
          />
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-[-0.04em]">
            {t("connect.title")}
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {t("connect.subtitle")}
          </p>
        </div>

        <div className="surface-card p-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (error) setError("");
                }}
                placeholder={t("connect.placeholder")}
                className={`h-11 bg-popover text-[15px] placeholder:text-soft-foreground ${
                  error
                    ? "border-destructive focus-visible:ring-destructive/20"
                    : ""
                }`}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              {error && (
                <p
                  className="mt-2 text-sm text-destructive"
                  style={{
                    animation: "slide-up 0.2s cubic-bezier(0.16,1,0.3,1)",
                  }}
                >
                  {error}
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-11 w-full text-sm font-medium"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  {t("connect.submit")}
                  <ArrowRight className="ml-1 size-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-soft-foreground">
            {t("connect.security")}
          </p>
        </div>

        <div className="mt-10 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-ring">
            {t("connect.how_title")}
          </h2>
          <div className="space-y-3">
            {(["how_1", "how_2", "how_3"] as const).map((key, i) => (
              <div key={key} className="flex items-start gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(`connect.${key}`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
