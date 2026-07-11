import { useEffect } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { syncAnalyticsSettings } from "@/lib/analytics/posthog";

export function App() {
  // Defer analytics loading until after first paint and idle time.
  useEffect(() => {
    const sync = () => {
      void syncAnalyticsSettings();
    };

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(sync, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(sync, 1000);
    return () => window.clearTimeout(id);
  }, []);
  // Guard: if the preload script failed, window.claude won't exist.
  // Throwing here lets the ErrorBoundary show a visible message instead of a blank window.
  if (!window.claude) {
    throw new Error(
      "window.claude is not available — the preload script likely failed to load. " +
      "Check the Electron console for errors.",
    );
  }

  return (
    <TooltipProvider>
      <AppLayout />
      <Toaster
        position="top-right"
        toastOptions={{
          className: "bg-background/90 backdrop-blur-md border border-border text-foreground shadow-lg",
        }}
      />
    </TooltipProvider>
  );
}
