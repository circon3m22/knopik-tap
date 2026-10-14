"use client";

import { useEffect } from "react";

/**
 * A DOM-only visibility bridge: does not rerender the game when the page
 * moves to the background and does not change game timers or save behavior.
 */
export function MobilePerformanceLifecycle() {
  useEffect(() => {
    const updateVisibility = () => {
      document.documentElement.dataset.knopikVisible = document.hidden ? "false" : "true";
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility, { passive: true });
    window.addEventListener("pageshow", updateVisibility, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("pageshow", updateVisibility);
      delete document.documentElement.dataset.knopikVisible;
    };
  }, []);

  return null;
}
