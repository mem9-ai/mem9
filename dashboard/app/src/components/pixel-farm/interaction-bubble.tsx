import { useEffect, useState } from "react";

interface PixelFarmInteractionBubbleProps {
  content: string;
  currentIndex: number;
  screenX: number;
  screenY: number;
  tagLabel: string;
  totalCount: number;
}

export function PixelFarmInteractionBubble({
  content,
  currentIndex,
  screenX,
  screenY,
  tagLabel,
  totalCount,
}: PixelFarmInteractionBubbleProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        left: screenX,
        top: screenY,
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translate(-50%, calc(-100% - 12px)) scale(1)"
          : "translate(-50%, calc(-100% - 2px)) scale(0.78)",
        transformOrigin: "50% 100%",
        transition:
          "opacity 140ms ease-out, transform 240ms cubic-bezier(0.2, 1.4, 0.28, 1)",
      }}
    >
      <div className="relative w-[min(22rem,calc(100vw-2rem))] rounded-[22px] border border-[#f6dca6]/20 bg-[#101920]/94 px-4 py-3 text-left text-[#f6dca6] shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-sm">
        <div
          className="absolute left-1/2 top-full h-4 w-4 -translate-x-1/2 -translate-y-[7px] rotate-45 border-r border-b border-[#f6dca6]/20 bg-[#101920]/94"
          style={{
            boxShadow: "8px 8px 16px rgba(0,0,0,0.12)",
          }}
        />
        <div className="relative z-10 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-[#f6dca6]/72">
          <span className="truncate">{tagLabel}</span>
          <span className="shrink-0">
            {currentIndex + 1} / {totalCount}
          </span>
        </div>
        <p
          className="relative z-10 mt-2 text-sm leading-5 text-[#f8ecd2]"
          style={{
            display: "-webkit-box",
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
          }}
        >
          {content}
        </p>
      </div>
    </div>
  );
}
