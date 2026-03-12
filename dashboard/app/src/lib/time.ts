import type { TFunction } from "i18next";

export function formatRelativeTime(t: TFunction, isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return t("time.just_now");
  if (minutes < 60) return t("time.minutes_ago", { n: minutes });
  if (hours < 24) return t("time.hours_ago", { n: hours });
  if (days < 2) return t("time.yesterday");
  if (days < 30) return t("time.days_ago", { n: days });

  return new Date(isoDate).toLocaleDateString(
    t("_locale") === "zh-CN" ? "zh-CN" : "en-US",
  );
}
