/**
 * PostHog renderer-side client initialization.
 *
 * posthog-js is intentionally loaded on demand so analytics does not add parse
 * and execute cost to the initial renderer bundle.
 */

// Same public API key used by the main process (posthog-node).
// PostHog project API keys are client-side safe — designed to be embedded in source.
const POSTHOG_KEY = "phc_lOKFRov0SWy2R71BNJ2t978tmNYc3ND7WwueOteV5vw";
const POSTHOG_HOST = "https://us.i.posthog.com";

type PostHogClient = typeof import("posthog-js").default;

let clientPromise: Promise<PostHogClient> | null = null;
let initializedClientPromise: Promise<PostHogClient> | null = null;

function loadPostHog(): Promise<PostHogClient> {
  clientPromise ??= import("posthog-js").then((mod) => mod.default);
  return clientPromise;
}

function getInitializedPostHog(): Promise<PostHogClient> {
  initializedClientPromise ??= loadPostHog()
    .then((posthog) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        defaults: "2026-01-30",

        // Privacy: start opted out until we confirm the user has opted in.
        opt_out_capturing_by_default: true,

        // Electron-specific: disable web-oriented autocapture.
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,

        persistence: "localStorage",
      });
      return posthog;
    })
    .catch((error) => {
      initializedClientPromise = null;
      throw error;
    });

  return initializedClientPromise;
}

/**
 * Initialize posthog-js in the renderer process.
 *
 * Starts with capturing disabled (opt_out_capturing_by_default).
 * Call {@link syncAnalyticsSettings} after loading app settings to enable
 * capturing based on the user's preference.
 */
export function initPostHog(): void {
  void getInitializedPostHog().catch(() => {
    // Analytics should never break the app.
  });
}

/**
 * Sync posthog-js capturing state with the main process analytics settings.
 *
 * Reads AppSettings via IPC and enables/disables capturing + sets the
 * anonymous user ID to match the main process client.
 *
 * Call this:
 * - Once after app mount (settings become available)
 * - Whenever the user toggles analytics on/off in settings
 */
export async function syncAnalyticsSettings(): Promise<void> {
  try {
    const [posthog, settings] = await Promise.all([
      getInitializedPostHog(),
      window.claude.settings.get(),
    ]);

    if (settings.analyticsEnabled) {
      posthog.opt_in_capturing();

      // Use the same anonymous user ID as the main process PostHog client
      // so events from both processes correlate to the same distinct_id.
      if (settings.analyticsUserId) {
        posthog.identify(settings.analyticsUserId);
      }
    } else {
      posthog.opt_out_capturing();
    }
  } catch {
    // Settings not available yet — stay opted out (safe default)
  }
}

export function capturePostHogException(error: Error, properties?: Record<string, unknown>): void {
  void getInitializedPostHog()
    .then((posthog) => {
      posthog.captureException(error, properties);
    })
    .catch(() => {
      // Analytics should never break the app.
    });
}
