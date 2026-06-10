/**
 * POST /api/cron/retry — process due retry jobs.
 *
 * Called by Vercel Cron on a schedule (see vercel.json).
 * Also manually triggerable from the dashboard for demos.
 *
 * Security: CRON_SECRET header required (set in Vercel env vars).
 * This prevents unauthorized triggering of the retry processor.
 */
import type { NextRequest } from "next/server";
import { retryService } from "@/services/retry";
import { retryLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — allow longer for large retry batches

export async function POST(request: NextRequest): Promise<Response> {
  // Verify cron secret (Vercel sets this automatically in cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    retryLogger.warn({ msg: "Unauthorized cron trigger attempt" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  retryLogger.info({ msg: "Cron retry processor triggered" });

  try {
    const result = await retryService.processDueJobs();

    retryLogger.info({ msg: "Cron retry processor complete", ...result });

    return Response.json({
      ok: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    retryLogger.error({ msg: "Cron retry processor failed", error });
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

// Also support GET for Vercel Cron (which can send GET requests)
export const GET = POST;
