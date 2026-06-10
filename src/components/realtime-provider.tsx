"use client";

import { useRealtime } from "@/hooks/use-realtime";

/**
 * Mounts the SSE connection for real-time dashboard updates.
 * Rendered once inside the dashboard layout.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtime();
  return <>{children}</>;
}
