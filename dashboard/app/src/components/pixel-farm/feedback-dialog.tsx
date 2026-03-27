import { useState } from "react";
import { MessageSquareWarning, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { trackMixpanelEvent } from "@/lib/mixpanel";

type FeedbackType = "bug" | "suggestion" | "other";

export function PixelFarmFeedbackDialog() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("suggestion");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isSuccess, setIsSuccess] = useState(false);

  const resetForm = () => {
    setContent("");
    setType("suggestion");
    setIsSubmitting(false);
    setIsSuccess(false);
  };

  const handleOpen = () => {
    resetForm();
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    // Optional: delay reset slightly to avoid seeing the form clear while animating out
    setTimeout(resetForm, 150);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    trackMixpanelEvent("Dashboard/MemoryFarm/FeedbackSubmitted", {
      pageName: "memory-farm",
      feedbackType: type,
      content: content.trim(),
    });

    setIsSuccess(true);
    setTimeout(() => {
      handleClose();
    }, 1500);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        data-mp-event="Dashboard/MemoryFarm/FeedbackOpenClicked"
        data-mp-page-name="memory-farm"
        className="absolute bottom-4 left-4 z-20 flex cursor-pointer items-center gap-2 rounded-md border-[2px] border-[#3f3322] bg-[#f6dca6] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[#3f3322] shadow-[2px_2px_0px_0px_#3f3322] transition-all hover:bg-[#ffe8b6] active:translate-y-[2px] active:shadow-none"
      >
        <MessageSquareWarning className="h-3.5 w-3.5" />
        {t("pixel_farm.feedback.button")}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000]/40 p-4"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md rounded-lg border-[4px] border-[#3f3322] bg-[#f6dca6] p-6 shadow-[4px_4px_0_0_#3f3322]">
            {isSuccess ? (
              <div className="flex flex-col items-center justify-center py-8 text-center animate-in fade-in zoom-in duration-300">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-[#294c34] bg-[#5fa861] shadow-[2px_2px_0_0_#294c34]">
                  <Check className="h-6 w-6 text-[#fff0c6]" strokeWidth={3} />
                </div>
                <p className="text-[14px] font-bold uppercase tracking-wider text-[#3f3322]">
                  {t("pixel_farm.feedback.success")}
                </p>
              </div>
            ) : (
              <>
                <h2 className="mb-5 text-[14px] font-bold uppercase tracking-wider text-[#3f3322]">
                  {t("pixel_farm.feedback.title")}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#8d6b43]">
                  {t("pixel_farm.feedback.type_label")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(["bug", "suggestion", "other"] as const).map((tValue) => (
                    <button
                      key={tValue}
                      type="button"
                      onClick={() => setType(tValue)}
                      className={`cursor-pointer rounded-md border-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                        type === tValue
                          ? "border-[#294c34] bg-[#5fa861] text-[#fff0c6] shadow-[2px_2px_0px_0px_#294c34] active:translate-y-[2px] active:shadow-none"
                          : "border-[#8d6b43] bg-[#d2b881] text-[#5a452b] shadow-[2px_2px_0px_0px_#8d6b43] hover:bg-[#dfc48c] active:translate-y-[2px] active:shadow-none"
                      }`}
                    >
                      {t(`pixel_farm.feedback.type_${tValue}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#8d6b43]">
                  {t("pixel_farm.feedback.content_label")}
                </label>
                <textarea
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t("pixel_farm.feedback.content_placeholder")}
                  className="h-28 w-full resize-none rounded-md border-2 border-[#8d6b43] bg-[#fff0c6] p-3 text-[13px] text-[#3f3322] shadow-[inset_2px_2px_0px_0px_rgba(141,107,67,0.2)] placeholder:text-[#8d6b43]/60 focus:border-[#3f3322] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="cursor-pointer rounded-md px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[#8d6b43] hover:text-[#5a452b]"
                >
                  {t("pixel_farm.feedback.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!content.trim() || isSubmitting}
                  className="cursor-pointer rounded-md border-[2px] border-[#294c34] bg-[#5fa861] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#fff0c6] shadow-[2px_2px_0_0_#294c34] transition-all hover:bg-[#6cba6e] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:border-[#8d6b43] disabled:bg-[#d2b881] disabled:text-[#5a452b]/50 disabled:shadow-[2px_2px_0_0_#8d6b43] disabled:active:translate-y-0"
                >
                  {t("pixel_farm.feedback.submit")}
                </button>
              </div>
            </form>
            </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
