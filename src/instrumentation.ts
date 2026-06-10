/**
 * Next.js instrumentation hook — runs once when a server instance boots.
 *
 * Why this exists: Vercel Cron (vercel.json → /api/cron/retry) only fires on
 * DEPLOYED Vercel instances. During local `next dev` nothing ever calls the
 * retry processor, so failed messages sit PENDING/QUEUED forever.
 *
 * To mimic the production cron locally, we start an in-process interval that
 * drains due retry jobs on the same cadence (every minute by default). It calls
 * retryService.processDueJobs() directly — no HTTP round-trip and no CRON_SECRET
 * required.
 *
 * This is DEV-ONLY. On Vercel (NODE_ENV=production) it's a no-op and the real
 * Vercel Cron drives the processor. It also only runs in the Node.js runtime,
 * never the Edge runtime.
 *
 * Env overrides:
 * - DISABLE_LOCAL_RETRY_CRON=true   → never run (e.g. to test the "stuck" UX)
 * - ENABLE_LOCAL_RETRY_CRON=true    → force-run even outside development
 * - LOCAL_RETRY_CRON_INTERVAL_MS=n  → change the tick interval (default 60000)
 */

const GLOBAL_KEY = Symbol.for("candidateflow.localRetryCron");

export async function register(): Promise<void> {
  // Edge runtime can't reach the database client / Node timers we rely on.
  // Bail only for the edge runtime; treat anything else (nodejs, or an
  // unset value in some dev contexts) as the Node server.
  if (process.env.NEXT_RUNTIME === "edge") return;

  const explicitlyDisabled = process.env.DISABLE_LOCAL_RETRY_CRON === "true";
  const explicitlyEnabled = process.env.ENABLE_LOCAL_RETRY_CRON === "true";
  const isDev = process.env.NODE_ENV === "development";

  if (explicitlyDisabled) return;
  if (!isDev && !explicitlyEnabled) return;

  // Guard against double-registration (HMR / multiple server inits) so we
  // never stack more than one interval.
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: boolean;
  };
  if (globalRef[GLOBAL_KEY]) return;
  globalRef[GLOBAL_KEY] = true;

  // Default to 15s locally (vs the 60s Vercel Cron) so the sub-minute backoff
  // delays are honored reasonably promptly and overdue jobs don't appear to
  // hang. Override with LOCAL_RETRY_CRON_INTERVAL_MS.
  const intervalMs = Number(
    process.env.LOCAL_RETRY_CRON_INTERVAL_MS ?? 15_000
  );

  const { retryService } = await import("@/services/retry");
  const { retryLogger } = await import("@/lib/logger");

  retryLogger.info({
    msg: "Local retry cron enabled (dev) — Vercel Cron does not fire locally",
    intervalMs,
  });

  const tick = async (): Promise<void> => {
    try {
      const result = await retryService.processDueJobs();
      // Only log when there was actually something to do, to avoid noise.
      if (result.processed > 0) {
        retryLogger.info({ msg: "Local retry cron tick processed jobs", ...result });
      }
    } catch (err) {
      retryLogger.error({
        msg: "Local retry cron tick failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Kick off a first pass shortly after boot so stuck jobs clear quickly,
  // then settle into the regular interval.
  const initialDelay = Math.min(intervalMs, 5_000);
  setTimeout(tick, initialDelay);

  const interval = setInterval(tick, intervalMs);
  // Don't let this timer keep the process alive on its own.
  if (typeof interval.unref === "function") interval.unref();
}
