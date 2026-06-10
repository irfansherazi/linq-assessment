/**
 * Vercel KV pub/sub helpers for real-time SSE events.
 *
 * Events are pushed to a per-recruiter Redis list by webhook handlers
 * and consumed by the SSE endpoint (/api/events).
 *
 * Graceful degradation: if KV env vars are not set (local dev before
 * `vercel env pull`), publish is a no-op and the app works normally
 * without real-time updates.
 *
 * To set up:
 *   1. npx vercel kv create candidateflow-kv
 *   2. npx vercel env pull   (writes KV_REST_API_URL etc. to .env.local)
 */
import { kv } from "@vercel/kv";

export interface RealtimeEvent {
  type:
    | "message.received"
    | "message.sent"
    | "message.failed"
    | "screening.updated"
    | "candidate.updated";
  candidateId?: string;
  linqMessageId?: string;
  timestamp: number;
}

function kvKey(recruiterId: string): string {
  return `events:${recruiterId}`;
}

function isKvConfigured(): boolean {
  return !!(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );
}

const MAX_EVENTS_PER_QUEUE = 100;

/**
 * In-memory fallback used ONLY when KV is not configured (typically local
 * `next dev`). Because dev runs as a single Node process, the webhook handler
 * that publishes and the SSE endpoint that consumes share this map, so
 * real-time updates work locally without provisioning Upstash/Vercel KV.
 *
 * This is NOT suitable for production: serverless instances don't share memory,
 * so events published by one function wouldn't be visible to the SSE stream
 * running in another. In production, KV is configured and this path is unused.
 *
 * Stored on globalThis so it survives dev hot-reloads (which re-evaluate modules
 * but keep the same process).
 */
const globalForEvents = globalThis as typeof globalThis & {
  __inMemoryEventQueues?: Map<string, RealtimeEvent[]>;
};

function memoryQueues(): Map<string, RealtimeEvent[]> {
  if (!globalForEvents.__inMemoryEventQueues) {
    globalForEvents.__inMemoryEventQueues = new Map();
  }
  return globalForEvents.__inMemoryEventQueues;
}

/**
 * Publish a real-time event to a recruiter's event queue.
 * Events are consumed by the SSE endpoint and forwarded to the browser.
 */
export async function publishEvent(
  recruiterId: string,
  event: Omit<RealtimeEvent, "timestamp">
): Promise<void> {
  const payload: RealtimeEvent = { ...event, timestamp: Date.now() };

  // ── Local fallback: in-memory queue when KV isn't configured ──────
  if (!isKvConfigured()) {
    const queues = memoryQueues();
    const queue = queues.get(recruiterId) ?? [];
    queue.push(payload);
    // Cap to avoid unbounded growth; keep the most recent events.
    if (queue.length > MAX_EVENTS_PER_QUEUE) {
      queue.splice(0, queue.length - MAX_EVENTS_PER_QUEUE);
    }
    queues.set(recruiterId, queue);
    return;
  }

  try {
    // Push to list; cap at 100 events to avoid unbounded growth
    await kv.lpush(kvKey(recruiterId), JSON.stringify(payload));
    await kv.ltrim(kvKey(recruiterId), 0, 99);
    // Short TTL — events are only useful for seconds
    await kv.expire(kvKey(recruiterId), 300);
  } catch {
    // KV failure is non-fatal — events are best-effort
  }
}

/**
 * Pop the next event from a recruiter's queue.
 * Returns null if the queue is empty or KV is not configured.
 */
export async function popEvent(
  recruiterId: string
): Promise<RealtimeEvent | null> {
  // ── Local fallback: drain the in-memory queue (FIFO) ─────────────
  if (!isKvConfigured()) {
    const queue = memoryQueues().get(recruiterId);
    if (!queue || queue.length === 0) return null;
    return queue.shift() ?? null;
  }

  try {
    const raw = await kv.rpop<string>(kvKey(recruiterId));
    if (!raw) return null;
    return JSON.parse(raw) as RealtimeEvent;
  } catch {
    return null;
  }
}
