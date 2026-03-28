import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Full-viewport overlay with animated colorful edge waves,
 * shown while a deep-analysis job is processing.
 */
export function DeepAnalysisOverlay({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      // trigger fade-in on next frame
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 600);
      return () => clearTimeout(timer);
    }
  }, [active]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`deep-analysis-overlay ${visible ? "deep-analysis-overlay-visible" : ""}`}
      aria-hidden="true"
    >
      <div className="deep-analysis-wave deep-analysis-wave-top" />
      <div className="deep-analysis-wave deep-analysis-wave-bottom" />
      <div className="deep-analysis-wave deep-analysis-wave-left" />
      <div className="deep-analysis-wave deep-analysis-wave-right" />
    </div>,
    document.body,
  );
}
